<!--
  "Start from the herd": asks what was done and when, then downloads the upload template with one
  Events row per animal on the ranch (from /api/template). Nothing is saved by this form; the
  visitor edits the file and uploads it with the form below.
-->
<script>
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { mountTurnstile } from './turnstile.js';

	// Birth and purchase are left out: those are for animals that are not on the ranch yet.
	const EVENT_TYPES = [
		{ value: 'vaccination', label: 'Vaccination', hint: 'Put the vaccine name in the note and it is copied onto every row.' },
		{ value: 'weight', label: 'Weight', hint: 'Every row needs a weight: fill in the weight_lbs column before uploading.' },
		{ value: 'pregnant', label: 'Pregnancy check', hint: 'Optionally fill in the pregnancy columns (months pregnant, due date).' },
		{ value: 'sold', label: 'Sold', hint: 'A sold animal leaves the herd. Add the sale on the Transactions tab too.' },
		{ value: 'deceased', label: 'Deceased', hint: 'A deceased animal leaves the herd, and no later events can be added for it.' },
	];
	const LOCATIONS = ['Ranch', 'Eureka'];
	const TYPES = ['Cow', 'Bull', 'Calf'];
	const BREEDS = ['Black Angus', 'Red Angus', 'Sim Angus'];

	let widgetBox;
	let check = null;
	let token = '';
	let widgetNote = '';

	let eventType = 'vaccination';
	let eventDate = ''; // set in the browser: the site is built ahead of time, so "today" must not be baked in
	let note = '';
	let location = '';
	let type = '';
	let breed = '';
	let busy = false;
	let result = null; // { ok, message }

	onMount(() => {
		eventDate = new Date().toLocaleDateString('en-CA'); // year-month-day in the visitor's own time zone
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

	async function submit() {
		result = null;
		if (!token) {
			result = { ok: false, message: 'Please wait for the "are you a person" check above the button to finish.' };
			return;
		}
		const form = new FormData();
		form.append('event_type', eventType);
		form.append('event_date', eventDate);
		form.append('note', note);
		form.append('location', location);
		form.append('type', type);
		form.append('breed', breed);
		form.append('cf-turnstile-response', token);
		busy = true;
		try {
			const response = await fetch(`${base}/api/template`, { method: 'POST', body: form });
			if (response.ok) {
				const count = Number(response.headers.get('x-animal-count'));
				const link = document.createElement('a');
				link.href = URL.createObjectURL(await response.blob());
				link.download = `cattle_template_${eventType}_${eventDate}.xlsx`;
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(link.href);
				result = {
					ok: true,
					message: `Downloaded a template with ${count} animal${count === 1 ? '' : 's'}.`,
				};
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

	$: hint = EVENT_TYPES.find((t) => t.value === eventType)?.hint ?? '';
</script>

<form class="km-prefill" method="post" on:submit|preventDefault={submit}>
	<div class="row">
		<label>
			<span>What did you do?</span>
			<select bind:value={eventType}>
				{#each EVENT_TYPES as t}
					<option value={t.value}>{t.label}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>Date</span>
			<input type="date" bind:value={eventDate} min="2000-01-01" required />
		</label>
	</div>
	<p class="km-hint">{hint}</p>
	<label>
		<span>Note <em>(optional, copied onto every row)</em></span>
		<input type="text" bind:value={note} maxlength="500" placeholder="e.g. 7-way booster" />
	</label>
	<fieldset>
		<legend>Only include <em>(optional, blank means every animal)</em></legend>
		<div class="row three">
			<label>
				<span>Location</span>
				<select bind:value={location}>
					<option value="">Any</option>
					{#each LOCATIONS as v}<option value={v}>{v}</option>{/each}
				</select>
			</label>
			<label>
				<span>Type</span>
				<select bind:value={type}>
					<option value="">Any</option>
					{#each TYPES as v}<option value={v}>{v}</option>{/each}
				</select>
			</label>
			<label>
				<span>Breed</span>
				<select bind:value={breed}>
					<option value="">Any</option>
					{#each BREEDS as v}<option value={v}>{v}</option>{/each}
				</select>
			</label>
		</div>
	</fieldset>
	<div bind:this={widgetBox}></div>
	{#if widgetNote}<p class="km-note">{widgetNote}</p>{/if}
	<!-- Disabled until the page's scripts are running and the check has passed; before that a click
	     would be a plain browser form submit that reloads the page. -->
	<button type="submit" disabled={busy || !token || !eventDate}>
		{busy ? 'Building…' : token ? 'Download pre-filled template' : 'Waiting for the check…'}
	</button>
</form>

{#if result}
	<div class="km-result" class:ok={result.ok} role="status">
		<p class="km-msg">{result.message}</p>
		{#if result.ok}
			<p>
				Delete the rows for animals you did not work, fill in anything left blank, then upload the file below.
				Every row left in the file is saved as an event.
			</p>
		{/if}
	</div>
{/if}

<style>
	.km-prefill {
		display: grid;
		gap: 1rem;
		max-width: 32rem;
		margin: 1rem 0 1.5rem;
		padding: 1.25rem 1.4rem;
		background: rgba(255, 255, 255, 0.6);
		border: 1px solid rgba(61, 102, 66, 0.15);
		border-radius: 6px;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.row.three {
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
	}
	label span,
	legend {
		display: block;
		margin-bottom: 0.3rem;
		font-family: 'DM Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #3a5c3d;
	}
	label em,
	legend em {
		text-transform: none;
		letter-spacing: 0;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}
	select,
	input[type='date'],
	input[type='text'] {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		border: 1px solid rgba(61, 102, 66, 0.35);
		border-radius: 4px;
		font: inherit;
		background: #fff;
	}
	.km-hint {
		margin: -0.4rem 0 0;
		font-size: 0.9rem;
		color: #3a5c3d;
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
	.km-note {
		margin: 0;
		font-size: 0.9rem;
		color: #8a3b12;
	}
	@media (max-width: 480px) {
		.row {
			grid-template-columns: 1fr;
		}
	}
</style>
