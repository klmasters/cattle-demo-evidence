// Database work for an upload. `client` is anything with an async query(sql, params)
// method (a Neon pool client in production, a fake in tests). Every value goes in as a
// parameter ($1, $2, ...), never glued into the SQL text.

import { SAVED_EVENT_COLUMNS as EVENT_COLUMNS } from './schema-v8.js'
import { TRANSACTION_COLUMNS } from './validate.js'

// Fingerprint of the cleaned content, so the same data is caught as a repeat even if it
// arrives as a different file type or with different formatting.
export async function contentHash(events, transactions) {
  const canonical = JSON.stringify({
    events: events.map((e) => EVENT_COLUMNS.map((c) => e[c])),
    transactions: transactions.map((t) => TRANSACTION_COLUMNS.map((c) => t[c])),
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// What is stored about each tag in the upload, from events already saved (voided batches ignored).
// Shape matches the `herd` option of validate(): status comes from the latest event (a sold or
// deceased event wins a same-day tie, as in the current_cattle view), location is where the animal
// last was, and the other traits are the values recorded on its rows.
export async function loadHerd(client, tags) {
  const { rows } = await client.query(
    `with ev as (
       select e.* from ranch_demo.cattle_events e
         left join ranch_demo.upload_batches b on b.batch_id = e.batch_id
        where b.voided is not true and e.tag_number = any($1)
     ),
     latest as (
       select distinct on (tag_number) tag_number, event_type, event_date::text as event_date, location
         from ev
        order by tag_number, event_date desc, (event_type in ('sold', 'deceased')) desc, id desc
     ),
     traits as (
       select tag_number, max(type) as type, max(gender) as gender, max(birth_year) as birth_year,
              max(mother_tag_number) as mother_tag_number, max(date_bought)::text as date_bought
         from ev group by tag_number
     )
     select l.tag_number, l.event_type, l.event_date, l.location, t.type, t.gender, t.birth_year,
            t.mother_tag_number, t.date_bought
       from latest l join traits t using (tag_number)`,
    [tags],
  )
  return new Map(rows.map((r) => [
    r.tag_number,
    {
      status: r.event_type === 'sold' || r.event_type === 'deceased' ? r.event_type : 'active',
      lastEventDate: r.event_date,
      location: r.location,
      type: r.type,
      gender: r.gender,
      birth_year: r.birth_year == null ? null : Number(r.birth_year),
      mother_tag_number: r.mother_tag_number,
      date_bought: r.date_bought,
    },
  ]))
}

// The stored events for the given row_ids (voided batches ignored), as a Map row_id -> event.
// Used to recognise the saved rows in an animal's history file.
export async function loadSavedEvents(client, rowIds) {
  if (rowIds.length === 0) return new Map()
  const { rows } = await client.query(
    `select e.row_id, e.tag_number, e.event_date::text as event_date, e.event_type, e.location, e.type,
            e.gender, e.birth_year, e.mother_tag_number, e.date_bought::text as date_bought,
            e.weight_lbs, e.estimated_months_pregnant, e.notes
       from ranch_demo.cattle_events e
       left join ranch_demo.upload_batches b on b.batch_id = e.batch_id
      where e.row_id = any($1) and b.voided is not true`,
    [rowIds],
  )
  return new Map(rows.map((r) => [r.row_id, r]))
}

// How many batches this uploader (a hashed address, see hashIp) saved in the last hour.
export async function recentUploads(client, uploader) {
  const { rows } = await client.query(
    `select count(*)::int as n from ranch_demo.upload_batches
      where uploader_hash = $1 and uploaded_at > now() - interval '1 hour'`,
    [uploader],
  )
  return rows[0].n
}

function insertRows(table, columns, rows) {
  // One multi-row INSERT: (batch_id, c1, c2, ...) values ($1,$2,...), (...), ...
  const params = []
  const tuples = rows.map((row) => {
    const placeholders = row.map((value) => {
      params.push(value)
      return `$${params.length}`
    })
    return `(${placeholders.join(', ')})`
  })
  return { sql: `insert into ranch_demo.${table} (${columns.join(', ')}) values ${tuples.join(', ')}`, params }
}

/**
 * Saves a validated upload in one transaction.
 * Returns { duplicate: true } if the same content was already uploaded, else { batchId }.
 */
export async function saveUpload(client, { filename, hash, events, transactions, uploader = null }) {
  await client.query('begin')
  try {
    const batch = await client.query(
      `insert into ranch_demo.upload_batches (filename, file_hash, row_count, uploader_hash)
       values ($1, $2, $3, $4)
       on conflict (file_hash) do nothing
       returning batch_id`,
      [filename, hash, events.length, uploader],
    )
    if (batch.rows.length === 0) {
      await client.query('rollback')
      return { duplicate: true }
    }
    const batchId = batch.rows[0].batch_id

    const eventInsert = insertRows(
      'cattle_events', ['batch_id', ...EVENT_COLUMNS],
      events.map((e) => [batchId, ...EVENT_COLUMNS.map((c) => e[c])]),
    )
    await client.query(eventInsert.sql, eventInsert.params)

    if (transactions.length) {
      // Uploaded transactions get ids like UP-1a2b3c4d-1, unique per batch.
      const prefix = `UP-${String(batchId).slice(0, 8)}`
      const txnInsert = insertRows(
        'cattle_transactions', ['transaction_id', 'batch_id', ...TRANSACTION_COLUMNS],
        transactions.map((t, i) => [`${prefix}-${i + 1}`, batchId, ...TRANSACTION_COLUMNS.map((c) => t[c])]),
      )
      await client.query(txnInsert.sql, txnInsert.params)
    }
    await client.query('commit')
    return { batchId }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  }
}
