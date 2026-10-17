// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleUpload } from '../functions/_lib/handle.js'

const xlsxBytes = readFileSync(new URL('./fixtures/good.xlsx', import.meta.url))
const BATCH_ID = '1a2b3c4d-0000-4000-8000-000000000000'

// A stand-in for the database: records every query and answers the few we ask.
function fakeDb({ herdRows = [], duplicate = false } = {}) {
  const queries = []
  const client = {
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] }
      if (/distinct on/.test(sql)) return { rows: herdRows }
      if (/insert into ranch_demo.upload_batches/.test(sql)) return { rows: duplicate ? [] : [{ batch_id: BATCH_ID }] }
      return { rows: [] }
    },
  }
  return { queries, deps: { withClient: (fn) => fn(client) } }
}

function post(fields) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new Request('https://example.test/ranch-demo/api/upload', { method: 'POST', body: form })
}
const xlsxFile = () => new File([xlsxBytes], 'herd.xlsx')
const csvFile = (text, name = 'events.csv') => new File([text], name)
const CSV_HEADER = 'tag_number,event_date,event_type,location,type,gender,weight_lbs\n'
const run = async (request, deps) => {
  const res = await handleUpload(request, deps)
  return { status: res.status, body: await res.json() }
}

test('good xlsx is saved in one transaction with parameterized SQL', async () => {
  const db = fakeDb()
  const { status, body } = await run(post({ file: xlsxFile() }), db.deps)
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.ok, true)
  assert.equal(body.batchId, BATCH_ID)
  const sqls = db.queries.map((q) => q.sql)
  assert.match(sqls[0], /distinct on/)                          // herd lookup first
  assert.deepEqual(sqls.filter((s) => /^(begin|commit|rollback)$/.test(s)), ['begin', 'commit'])
  const events = db.queries.find((q) => q.sql.startsWith('insert into ranch_demo.cattle_events'))
  assert.equal(events.params.length, 3 * 13)              // 3 rows x (batch_id + 12 columns)
  assert.equal(events.params[0], BATCH_ID)
  assert.match(events.sql, /\(\$1, \$2, /)               // values are placeholders, not text
  assert.equal(events.sql.includes('Home Pasture'), false)
  const txns = db.queries.find((q) => q.sql.startsWith('insert into ranch_demo.cattle_transactions'))
  assert.equal(txns.params[0], 'UP-1a2b3c4d-1')
  assert.deepEqual(txns.params[4], ['901'])
})

test('a file with errors saves nothing and returns row-level errors', async () => {
  const db = fakeDb()
  const { status, body } = await run(post({ file: csvFile(CSV_HEADER + '901,2026-05-03,vaccinated,Moon,Cow,Female,\n') }), db.deps)
  assert.equal(status, 422)
  assert.equal(body.ok, false)
  assert.equal(body.errors[0].row, 2)
  assert.equal(db.queries.length, 0)   // never touched the database
})

test('the same content twice: second upload is a duplicate and rolls back', async () => {
  const db = fakeDb({ duplicate: true })
  const { status, body } = await run(post({ file: xlsxFile() }), db.deps)
  assert.equal(status, 409)
  assert.match(body.message, /already uploaded/)
  assert.equal(db.queries.some((q) => q.sql === 'rollback'), true)
  assert.equal(db.queries.some((q) => q.sql.startsWith('insert into ranch_demo.cattle_events')), false)
})

test('live herd check: an event for a tag already sold is rejected', async () => {
  const db = fakeDb({ herdRows: [{ tag_number: '901', event_type: 'sold', event_date: '2026-04-01', location: 'Home Pasture', type: 'Cow', gender: 'Female', birth_year: 2019, mother_tag_number: null, date_bought: null }] })
  const { status, body } = await run(post({ file: xlsxFile() }), db.deps)
  assert.equal(status, 422)
  assert.match(body.errors[0].message, /already recorded as sold/)
})

test('CSV events plus CSV transactions', async () => {
  const db = fakeDb()
  const events = CSV_HEADER + '902,2026-05-02,purchase,Home Pasture,Cow,Female,\n'
  const txns = 'transaction_date,transaction_type,tag_numbers,head_count,price_per_head,total_amount\n2026-05-02,purchase,902,1,1800,1800\n'
  const { status, body } = await run(post({ file: csvFile(events), transactions_file: csvFile(txns, 't.csv') }), db.deps)
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.counts.transactions, 1)
})

test('a transaction with blank tags is saved with its tags filled in, and the response says so as a note', async () => {
  const db = fakeDb()
  const events = CSV_HEADER + '902,2026-05-02,purchase,Home Pasture,Cow,Female,\n903,2026-05-02,purchase,Home Pasture,Cow,Female,\n'
  const txns = 'transaction_date,transaction_type,tag_numbers,head_count,price_per_head,total_amount\n2026-05-02,purchase,,,1800,\n'
  const { status, body } = await run(post({ file: csvFile(events), transactions_file: csvFile(txns, 't.csv') }), db.deps)
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.warningCount, 0)
  assert.equal(body.infoCount, 1)
  assert.match(body.infos[0].message, /902, 903/)
  const saved = db.queries.find((q) => q.sql.startsWith('insert into ranch_demo.cattle_transactions'))
  assert.ok(saved.params.some((p) => Array.isArray(p) && p.join() === '902,903'), 'the linked tags are what gets stored')
  assert.ok(saved.params.includes(3600), 'the total is worked out')
})

test('nothing chosen, and a non-spreadsheet file, give plain messages', async () => {
  assert.equal((await run(post({}), fakeDb().deps)).status, 400)
  const png = new File([new Uint8Array([137, 80, 78, 71, 0, 1, 2])], 'x.png')
  const { status, body } = await run(post({ file: png }), fakeDb().deps)
  assert.equal(status, 422)             // read as a CSV with no recognizable columns
  assert.match(body.errors[0].message, /missing required column/)
})

test('Google Sheets link: only docs.google.com, export address is built by us', async () => {
  const seen = []
  const fetchFn = async (url) => { seen.push(url); return new Response(xlsxBytes, { headers: { 'content-length': String(xlsxBytes.length) } }) }
  const id = 'A'.repeat(44)
  const ok = await run(post({ sheet_url: `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing` }), { ...fakeDb().deps, fetch: fetchFn })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.deepEqual(seen, [`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`])

  seen.length = 0
  for (const bad of ['https://evil.example/spreadsheets/d/' + id, 'http://169.254.169.254/latest', 'https://docs.google.com.evil.example/spreadsheets/d/' + id]) {
    const r = await run(post({ sheet_url: bad }), { ...fakeDb().deps, fetch: fetchFn })
    assert.equal(r.status, 400)
  }
  assert.equal(seen.length, 0)   // nothing was fetched for the bad links
})

test('a private Google Sheet (Google sends back a web page) gets a sharing hint', async () => {
  const fetchFn = async () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })
  const r = await run(post({ sheet_url: `https://docs.google.com/spreadsheets/d/${'B'.repeat(44)}/edit` }), { ...fakeDb().deps, fetch: fetchFn })
  assert.equal(r.status, 400)
  assert.match(r.body.message, /Anyone with the link/)
})

test('database failure returns a generic 500 and no internals', async () => {
  const deps = { withClient: async () => { throw new Error('password authentication failed for user ranch_uploader') } }
  const { status, body } = await run(post({ file: xlsxFile() }), deps)
  assert.equal(status, 500)
  assert.equal(JSON.stringify(body).includes('password'), false)
})

test('GET is not allowed', async () => {
  const res = await handleUpload(new Request('https://example.test/x'), fakeDb().deps)
  assert.equal(res.status, 405)
})

test('a failed bot check returns 403 and nothing is read or saved', async () => {
  const db = fakeDb()
  const { status, body } = await run(post({ file: xlsxFile() }), { ...db.deps, verifyHuman: async () => false })
  assert.equal(status, 403)
  assert.equal(body.ok, false)
  assert.equal(db.queries.length, 0)
})

test('a passing bot check gets the token and ip, then the upload goes through', async () => {
  const db = fakeDb()
  let seen
  const verifyHuman = async (token, ip) => { seen = [token, ip]; return true }
  const request = post({ file: xlsxFile(), 'cf-turnstile-response': 'tok123' })
  request.headers.set?.('cf-connecting-ip', '1.2.3.4')
  const { status } = await run(request, { ...db.deps, verifyHuman })
  assert.equal(status, 200)
  assert.equal(seen[0], 'tok123')
})

test('verifier sends the secret and token to Cloudflare and trusts only success: true', async () => {
  const { makeVerifier } = await import('../functions/_lib/turnstile.js')
  let sent
  const ok = makeVerifier('sekret', async (url, init) => { sent = [url, init.body.get('secret'), init.body.get('response')]; return { json: async () => ({ success: true }) } })
  assert.equal(await ok('tok', '1.2.3.4'), true)
  assert.deepEqual(sent, ['https://challenges.cloudflare.com/turnstile/v0/siteverify', 'sekret', 'tok'])
  assert.equal(await makeVerifier('sekret', async () => ({ json: async () => ({ success: false }) }))('tok'), false)
  assert.equal(await makeVerifier('sekret', async () => { throw new Error('down') })('tok'), false)
  assert.equal(await makeVerifier('', async () => ({ json: async () => ({ success: true }) }))('tok'), false)
  assert.equal(await makeVerifier('sekret', async () => ({ json: async () => ({ success: true }) }))(''), false)
})

test('rate limit: a visitor with 5 saved uploads in the last hour gets 429 and nothing else runs', async () => {
  const queries = []
  const client = { async query(sql, params) { queries.push(sql); return { rows: [{ n: 5 }] } } }
  const request = post({ file: xlsxFile() })
  request.headers.set('cf-connecting-ip', '9.9.9.9')
  const { status, body } = await run(request, { withClient: (fn) => fn(client), hashIp: async (ip) => 'h:' + ip })
  assert.equal(status, 429)
  assert.equal(body.ok, false)
  assert.equal(queries.length, 1)
})

test('rate limit: under the limit the upload saves and records the hashed address', async () => {
  const db = fakeDb()
  const request = post({ file: xlsxFile() })
  request.headers.set('cf-connecting-ip', '9.9.9.9')
  const { status } = await run(request, { ...db.deps, hashIp: async (ip) => 'h:' + ip })
  assert.equal(status, 200)
  const batchInsert = db.queries.find((q) => /insert into ranch_demo.upload_batches/.test(q.sql))
  assert.equal(batchInsert.params[3], 'h:9.9.9.9')
})

test('ip hasher is stable, keyed and never returns the address', async () => {
  const { makeIpHasher } = await import('../functions/_lib/haship.js')
  const a = await makeIpHasher('k1')('1.2.3.4')
  assert.equal(a, await makeIpHasher('k1')('1.2.3.4'))
  assert.notEqual(a, await makeIpHasher('k2')('1.2.3.4'))
  assert.equal(a.includes('1.2.3.4'), false)
})

test('a saved upload triggers the rebuild once; failures and refusals do not', async () => {
  let calls = 0
  const onSaved = () => { calls++ }
  const ok = await run(post({ file: xlsxFile() }), { ...fakeDb().deps, onSaved })
  assert.equal(ok.status, 200)
  assert.equal(calls, 1)
  const dup = await run(post({ file: xlsxFile() }), { ...fakeDb({ duplicate: true }).deps, onSaved })
  assert.equal(dup.status, 409)
  const bad = await run(post({ file: csvFile('nope') }), { ...fakeDb().deps, onSaved })
  assert.notEqual(bad.status, 200)
  assert.equal(calls, 1)
})

test('a crashing rebuild trigger does not break a saved upload', async () => {
  const { status, body } = await run(post({ file: xlsxFile() }), { ...fakeDb().deps, onSaved: () => { throw new Error('boom') } })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
})
