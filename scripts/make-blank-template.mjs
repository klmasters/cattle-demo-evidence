// Rebuilds static/cattle_upload_template.xlsx, the blank template linked from the Add Events page.
// Run after changing the columns or lists in functions/_lib/schema-v8.js:
//   node scripts/make-blank-template.mjs
import { writeFileSync } from 'node:fs'
import { templateWorkbook } from '../functions/_lib/template.js'

const bytes = templateWorkbook({ kind: 'blank' })
writeFileSync(new URL('../static/cattle_upload_template.xlsx', import.meta.url), bytes)
console.log(`wrote static/cattle_upload_template.xlsx (${bytes.length} bytes)`)
