// Removes pages marked `dev_only: true` in their frontmatter, so they exist locally but never
// reach the live site. It only runs on Cloudflare (which sets CF_PAGES=1), where the checkout is
// thrown away after the build, so a local `npm run build:pages` never deletes your files.
import { readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

if (process.env.CF_PAGES !== '1') {
  console.log('drop-dev-pages: not a Cloudflare build, leaving dev_only pages in place')
  process.exit(0)
}

const dir = 'pages'
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.md')) continue
  const file = join(dir, name)
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))
  if (front && /^dev_only:\s*true\s*$/m.test(front[1])) {
    unlinkSync(file)
    console.log(`drop-dev-pages: removed ${file}`)
  }
}
