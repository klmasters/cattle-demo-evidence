// Cloudflare Pages refuses any file over 25 MiB, and Evidence ships two DuckDB engine files
// (duckdb-eh.wasm and duckdb-mvp.wasm) of 33 and 38 MiB. This script runs after the build:
// it points the site at the identical files on the jsDelivr CDN and deletes the big copies.
//
// Usage: node scripts/externalize-wasm.mjs [build-folder]   (default: build)

import fs from 'node:fs';
import path from 'node:path';

const buildDir = path.resolve(process.argv[2] ?? 'build');
const assetsDir = path.join(buildDir, '_app/immutable/assets');
const chunksDir = path.join(buildDir, '_app/immutable/chunks');

// The CDN copy must be the same version as the installed package, or the engine and the
// worker script that drives it would not match.
const pkg = JSON.parse(fs.readFileSync('node_modules/@duckdb/duckdb-wasm/package.json', 'utf8'));
const cdn = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${pkg.version}/dist`;

let changed = 0;
for (const kind of ['eh', 'mvp']) {
	// Vite names the files duckdb-eh.<hash>.wasm; a tiny chunk duckdb-eh.<hash>.js holds the URL.
	const wasm = fs.readdirSync(assetsDir).find((f) => f.startsWith(`duckdb-${kind}.`) && f.endsWith('.wasm'));
	const chunk = fs.readdirSync(chunksDir).find((f) => f.startsWith(`duckdb-${kind}.`) && f.endsWith('.js'));
	if (!wasm || !chunk) {
		throw new Error(`Could not find the duckdb-${kind} wasm file and its chunk in ${buildDir}`);
	}

	const chunkPath = path.join(chunksDir, chunk);
	const before = fs.readFileSync(chunkPath, 'utf8');
	const after = before.replace(/const a="[^"]*\.wasm"/, `const a="${cdn}/duckdb-${kind}.wasm"`);
	if (after === before) {
		throw new Error(`Did not find the wasm address to replace in ${chunk}`);
	}
	fs.writeFileSync(chunkPath, after);
	fs.rmSync(path.join(assetsDir, wasm));
	console.log(`duckdb-${kind}: now loaded from ${cdn}/duckdb-${kind}.wasm`);
	changed++;
}
console.log(`Done: ${changed} engine files moved to the CDN.`);
