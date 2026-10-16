<!--
  The upload form. Sends the chosen file (or Google Sheets link) to /api/upload and shows what
  came back: a success message, or the list of problems the server found. Nothing is saved
  unless every row passes.
-->
<script>
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { mountTurnstile } from './turnstile.js';

	let widgetBox;
	let check = null; // lets us ask for a fresh token after each try
	let token = '';
	let widgetNote = ''; // what to tell the visitor if the check cannot start or fails

	let file = null;
	let transactionsFile = null;
	let sheetUrl = '';
	let busy = false;
	let result = null; // the server's JSON answer, or { ok: false, message } for network trouble
	let showAllErrors = false;

	const SHOWN = 25;

	// Draw the check into the box above the Upload button.
	onMount(() => {
		check = mountTurnstile(widgetBox, {
			onToken: (t) => {
				token = t;
				if (t) widgetNote = '';
			},
			onNote: (message) => (widgetNote = message),
		});
		// If nothing has happened after a while, say so instead of leaving a silent disabled button.
		const timer = setTimeout(() => {
			if (!token && !widgetNote) widgetNote = 'The check is taking a long time. Reload the page, or try another browser.';
		}, 15000);
		return () => clearTimeout(timer);
	});

	async function submit() {
		result = null;
		showAllErrors = false;
		const form = new FormData();
		if (file) form.append('file', file);
		if (transactionsFile) form.append('transactions_file', transactionsFile);
		if (sheetUrl.trim()) form.append('sheet_url', sheetUrl.trim());
		if (!file && !sheetUrl.trim()) {
			result = { ok: false, message: 'Choose a file or paste a Google Sheets link first.' };
			return;
		}
		if (!token) {
			result = { ok: false, message: 'Please wait for the "are you a person" check above the button to finish.' };
			return;
		}
		form.append('cf-turnstile-response', token);
		busy = true;
		try {
			const response = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
			result = await response.json();
		} catch {
			result = { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
		} finally {
			busy = false;
			// A token works once, so get a fresh one for the next try.
			token = '';
			check?.reset();
		}
	}

	$: errors = result?.errors ?? [];
	$: warnings = result?.warnings ?? [];
	$: infos = result?.infos ?? [];
	$: visibleErrors = showAllErrors ? errors : errors.slice(0, SHOWN);
	const where = (i) => [i.sheet, i.row ? `row ${i.row}` : null, i.column].filter(Boolean).join(', ');
</script>

<svelte:head>
	<link rel="preconnect" href="https://challenges.cloudflare.com" />
</svelte:head>

<form class="km-upload" method="post" on:submit|preventDefault={submit}>
	<label>
		<span>Spreadsheet (.xlsx) or Events CSV</span>
		<input type="file" accept=".xlsx,.csv" on:change={(e) => (file = e.target.files[0] ?? null)} />
	</label>
	<label>
		<span>Transactions CSV <em>(optional, only with an Events CSV)</em></span>
		<input type="file" accept=".csv" on:change={(e) => (transactionsFile = e.target.files[0] ?? null)} />
	</label>
	<label>
		<span>Or a public Google Sheets link</span>
		<input type="url" placeholder="https://docs.google.com/spreadsheets/d/..." bind:value={sheetUrl} />
	</label>
	<div bind:this={widgetBox}></div>
	{#if widgetNote}<p class="km-note">{widgetNote}</p>{/if}
	<!-- Disabled until the page's scripts are running and the check has passed; before that a click
	     would be a plain browser form submit that reloads the page and clears the chosen file. -->
	<button type="submit" disabled={busy || !token}>{busy ? 'Checking…' : token ? 'Upload' : 'Waiting for the check…'}</button>
</form>

{#if result}
	<div class="km-result" class:ok={result.ok} role="status">
		<p class="km-msg">{result.message}</p>
		{#if result.counts}
			<p>
				{result.counts.events} event{result.counts.events === 1 ? '' : 's'} and
				{result.counts.transactions} transaction{result.counts.transactions === 1 ? '' : 's'} read from the file.
			</p>
		{/if}
		{#if errors.length}
			<p><strong>{result.errorCount ?? errors.length} problem{(result.errorCount ?? errors.length) === 1 ? '' : 's'}:</strong></p>
			<ul>
				{#each visibleErrors as item}
					<li><span class="where">{where(item)}</span> {item.message}</li>
				{/each}
			</ul>
			{#if errors.length > SHOWN && !showAllErrors}
				<button type="button" class="link" on:click={() => (showAllErrors = true)}>Show all {errors.length}</button>
			{/if}
		{/if}
		{#if warnings.length}
			<p><strong>{result.warningCount ?? warnings.length} warning{(result.warningCount ?? warnings.length) === 1 ? '' : 's'} (not blocking):</strong></p>
			<ul>
				{#each warnings.slice(0, SHOWN) as item}
					<li><span class="where">{where(item)}</span> {item.message}</li>
				{/each}
			</ul>
		{/if}
		{#if infos.length}
			<p><strong>{infos.length === 1 ? 'Note' : 'Notes'}:</strong></p>
			<ul>
				{#each infos.slice(0, SHOWN) as item}
					<li><span class="where">{where(item)}</span> {item.message}</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.km-upload {
		display: grid;
		gap: 1rem;
		max-width: 32rem;
		margin: 1rem 0 1.5rem;
		padding: 1.25rem 1.4rem;
		background: rgba(255, 255, 255, 0.6);
		border: 1px solid rgba(61, 102, 66, 0.15);
		border-radius: 6px;
	}
	label span {
		display: block;
		margin-bottom: 0.3rem;
		font-family: 'DM Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #3a5c3d;
	}
	label em {
		text-transform: none;
		letter-spacing: 0;
	}
	input[type='url'] {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		border: 1px solid rgba(61, 102, 66, 0.35);
		border-radius: 4px;
		font: inherit;
		background: #fff;
	}
	button[type='submit'] {
		justify-self: start;
		padding: 0.55rem 1.4rem;
		border: 0;
		border-radius: 4px;
		background: #3d6642;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button[type='submit']:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.km-result {
		max-width: 44rem;
		padding: 1rem 1.25rem;
		border-left: 4px solid #e8843e;
		background: rgba(232, 132, 62, 0.08);
		border-radius: 4px;
	}
	.km-result.ok {
		border-left-color: #2f7d3c;
		background: rgba(47, 125, 60, 0.08);
	}
	.km-result p {
		margin: 0.3rem 0;
	}
	.km-msg {
		font-weight: 600;
	}
	.km-result ul {
		margin: 0.3rem 0 0.6rem 1.2rem;
		padding: 0;
		font-size: 0.9rem;
	}
	.where {
		font-family: 'DM Mono', ui-monospace, monospace;
		font-size: 0.8rem;
		color: #3a5c3d;
	}
	.km-note {
		margin: 0;
		font-size: 0.9rem;
		color: #8a3b12;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: #3d6642;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
</style>
