<!--
  "Download this animal's history": sends the selected tag to /api/animal-history and saves the
  spreadsheet that comes back (one row per event, oldest first). The tag comes from the page's
  Tag number dropdown. Nothing is saved to the database by this.
-->
<script>
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { mountTurnstile } from './turnstile.js';

	export let tag = '';

	let widgetBox;
	let check = null;
	let token = '';
	let widgetNote = '';
	let busy = false;
	let result = null; // { ok, message }

	onMount(() => {
		check = mountTurnstile(widgetBox, {
			onToken: (t) => {
				token = t;
				if (t) widgetNote = '';
			},
			onNote: (message) => (widgetNote = message),
		});
		const timer = setTimeout(() => {
			if (!token && !widgetNote) widgetNote = 'The check is taking a long time. Reload the page, or try another browser.';
		}, 15000);
		return () => clearTimeout(timer);
	});

	// A new animal means any earlier message no longer applies.
	$: tag, (result = null);

	async function download() {
		result = null;
		if (!token) {
			result = { ok: false, message: 'Please wait for the "are you a person" check to finish.' };
			return;
		}
		const form = new FormData();
		form.append('tag', tag);
		form.append('cf-turnstile-response', token);
		busy = true;
		try {
			const response = await fetch(`${base}/api/animal-history`, { method: 'POST', body: form });
			if (response.ok) {
				const rows = Number(response.headers.get('x-row-count'));
				const link = document.createElement('a');
				link.href = URL.createObjectURL(await response.blob());
				link.download = `animal_${tag.replace(/[^A-Za-z0-9_-]/g, '_')}_history.xlsx`;
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(link.href);
				result = { ok: true, message: `Downloaded ${rows} event${rows === 1 ? '' : 's'} for tag ${tag}.` };
			} else {
				result = await response.json();
			}
		} catch {
			result = { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
		} finally {
			busy = false;
			// A token works once, so get a fresh one for the next download.
			token = '';
			check?.reset();
		}
	}
</script>

<div class="km-history">
	<div bind:this={widgetBox}></div>
	{#if widgetNote}<p class="km-note">{widgetNote}</p>{/if}
	<!-- Disabled until the page's scripts are running and the check has passed. -->
	<button type="button" on:click={download} disabled={busy || !token || !tag}>
		{busy ? 'Building…' : token ? `Download history for tag ${tag}` : 'Waiting for the check…'}
	</button>
	{#if result}
		<p class="km-msg" class:ok={result.ok} role="status">{result.message}</p>
	{/if}
</div>

<style>
	.km-history {
		display: grid;
		gap: 0.6rem;
		justify-items: start;
		margin: 0.5rem 0 1rem;
	}
	button {
		padding: 0.55rem 1.4rem;
		border: 0;
		border-radius: 4px;
		background: #3d6642;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.km-msg {
		margin: 0;
		font-weight: 600;
		color: #8a3b12;
	}
	.km-msg.ok {
		color: #2f7d3c;
	}
	.km-note {
		margin: 0;
		font-size: 0.9rem;
		color: #8a3b12;
	}
</style>
