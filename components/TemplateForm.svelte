<!--
  "Start from the herd": asks what happened and when, then downloads the upload template with rows
  already started (from /api/template):
    animals already on the ranch (working day, pregnancy check, sold, deceased): one row per animal, with optional filters
    moved: one row per animal not already in the chosen pasture
    birth: one row per mother, her tag in the mother column
    purchase: a chosen number of rows, plus a Transactions row ready for the price
  Nothing is saved by this form; the visitor edits the file and uploads it with the form below.
-->
<script>
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { mountTurnstile } from './turnstile.js';

	// kind decides which fields show: 'existing' animals, 'moved', 'birth' or 'purchase'.
	const EVENT_TYPES = [
		{ value: 'worked', label: 'Working day', kind: 'existing', hint: 'Say what was done in the note, for example "vaccinated (Pyramid 5); weighed", and it is copied onto every row. Weights go in the weight_lbs column.' },
		{ value: 'preg_check', label: 'Pregnancy check', kind: 'existing', hint: 'You get a row for every cow with "preg check" in the notes. Fill in the months pregnant for each; for an open cow, change the note to "preg check - open" and leave the months blank.' },
		{ value: 'moved', label: 'Moved to another pasture', kind: 'moved', hint: 'Choose the pasture the animals moved to. Animals already there are left out, and the old pasture goes in each note.' },
		{ value: 'sold', label: 'Sold', kind: 'existing', hint: 'A sold animal leaves the herd. Fill in each sale weight. The Transactions tab has a row ready for the price: add price_per_cwt (or a total_amount) and leave its tag list empty to cover every sale on that date.' },
		{ value: 'deceased', label: 'Deceased', kind: 'existing', hint: 'A deceased animal leaves the herd, and no later events can be added for it.' },
		{ value: 'birth', label: 'Birth', kind: 'birth', hint: "One row per mother, with her tag filled in and the calf's pasture copied from her. Add each calf's tag and gender (and a birth weight if you have one), and delete the rows for cows that have not calved." },
		{ value: 'purchase', label: 'Purchase', kind: 'purchase', hint: "Choose how many animals you bought, then add each animal's tag and gender. The Transactions tab has a row ready: add the price per head and leave its tag list empty." },
	];
	const LOCATIONS = ['Home Pasture', 'North Pasture', 'South Pasture'];
	const TYPES = ['Cow', 'Bull', 'Calf'];
	const GENDERS = ['Female', 'Male'];

	let widgetBox;
	let check = null;
	let token = '';
	let widgetNote = '';

	let eventType = 'worked';
	let eventDate = ''; // set in the browser: the site is built ahead of time, so "today" must not be baked in
	let note = '';
	let locations = []; // ticked boxes in each group; none ticked means "any"
	let types = [];
	let genders = [];
	let mothers = 'pregnant'; // births: 'pregnant' or 'all'
	let count = 5; // purchases: how many rows
	let buyLocation = ''; // purchases: one choice each, '' leaves the column blank
	let buyType = '';
	let buyGender = '';
	let moveTo = ''; // moves: the pasture the animals went to
	let busy = false;
	let result = null; // { ok, message, advice }

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

	$: chosen = EVENT_TYPES.find((t) => t.value === eventType) ?? EVENT_TYPES[0];
	$: kind = chosen.kind;
	$: countOk = (kind !== 'purchase' || (Number.isInteger(count) && count >= 1 && count <= 500)) && (kind !== 'moved' || moveTo !== '');

	const ADVICE = {
		existing: 'Delete the rows for animals you did not work, fill in anything left blank, then upload the file below. Every row left in the file is saved as an event.',
		moved: 'Delete the rows for animals that did not move, then upload the file below. Every row left in the file is saved as a move.',
		birth: "Add each calf's tag and gender, and delete the rows for cows that have not calved. Every row left in the file is saved as a birth.",
		purchase: "Add each animal's tag and gender on the Events tab, and the price per head on the Transactions tab (leave that tab's tag list empty). Every row left in the file is saved.",
	};
	const UNIT = { existing: 'animal', moved: 'animal', birth: 'mother', purchase: 'row' };

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
		if (kind === 'purchase') {
			form.append('count', String(count));
			if (buyLocation) form.append('location', buyLocation);
			if (buyType) form.append('type', buyType);
			if (buyGender) form.append('gender', buyGender);
		} else {
			if (kind === 'birth') form.append('mothers', mothers);
			if (kind === 'moved') form.append('to', moveTo);
			for (const v of locations) form.append('location', v);
			if (kind !== 'birth') for (const v of genders) form.append('gender', v);
			if (kind === 'existing' || kind === 'moved') for (const v of types) form.append('type', v);
		}
		form.append('cf-turnstile-response', token);
		busy = true;
		try {
			const response = await fetch(`${base}/api/template`, { method: 'POST', body: form });
			if (response.ok) {
				const rows = Number(response.headers.get('x-row-count'));
				const link = document.createElement('a');
				link.href = URL.createObjectURL(await response.blob());
				link.download = `cattle_template_${eventType}_${eventDate}.xlsx`;
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(link.href);
				result = {
					ok: true,
					message: `Downloaded a template with ${rows} ${UNIT[kind]}${rows === 1 ? '' : 's'}.`,
					advice: ADVICE[kind],
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
</script>

<form class="km-prefill" method="post" on:submit|preventDefault={submit}>
	<div class="row">
		<label>
			<span>Event</span>
			<select bind:value={eventType}>
				<optgroup label="Animals already on the ranch">
					{#each EVENT_TYPES.filter((t) => t.kind === 'existing' || t.kind === 'moved') as t}
						<option value={t.value}>{t.label}</option>
					{/each}
				</optgroup>
				<optgroup label="New animals">
					{#each EVENT_TYPES.filter((t) => t.kind === 'birth' || t.kind === 'purchase') as t}
						<option value={t.value}>{t.label}</option>
					{/each}
				</optgroup>
			</select>
		</label>
		<label>
			<span>Date</span>
			<input type="date" bind:value={eventDate} min="2000-01-01" required />
		</label>
	</div>
	<p class="km-hint">{chosen.hint}</p>

	{#if kind === 'purchase'}
		<label>
			<span>How many animals?</span>
			<input type="number" bind:value={count} min="1" max="500" step="1" required />
		</label>
		<fieldset>
			<legend>Fill in for every row <em>(optional, leave blank to choose in the file)</em></legend>
			<div class="row three">
				<label>
					<span>Gender</span>
					<select bind:value={buyGender}>
						<option value="">Leave blank</option>
						{#each GENDERS as v}<option value={v}>{v}</option>{/each}
					</select>
				</label>
				<label>
					<span>Type</span>
					<select bind:value={buyType}>
						<option value="">Leave blank</option>
						{#each TYPES as v}<option value={v}>{v}</option>{/each}
					</select>
				</label>
				<label>
					<span>Pasture</span>
					<select bind:value={buyLocation}>
						<option value="">Leave blank</option>
						{#each LOCATIONS as v}<option value={v}>{v}</option>{/each}
					</select>
				</label>
			</div>
		</fieldset>
	{:else}
		{#if kind === 'moved'}
			<label>
				<span>Moved to</span>
				<select bind:value={moveTo} required>
					<option value="">Choose a pasture</option>
					{#each LOCATIONS as v}<option value={v}>{v}</option>{/each}
				</select>
			</label>
		{/if}
		{#if kind === 'birth'}
			<fieldset>
				<legend>Which cows?</legend>
				<div class="group">
					<label class="check"><input type="radio" value="pregnant" bind:group={mothers} /> Pregnant cows only</label>
					<label class="check"><input type="radio" value="all" bind:group={mothers} /> All cows</label>
				</div>
			</fieldset>
		{/if}
		<fieldset>
			<legend>Only include <em>(tick any; none ticked means {kind === 'birth' ? 'every cow' : 'every animal'})</em></legend>
			<div class="row three">
				<div class="group">
					<span>Pasture</span>
					{#each LOCATIONS as v}
						<label class="check"><input type="checkbox" value={v} bind:group={locations} /> {v}</label>
					{/each}
				</div>
				{#if kind === 'existing' || kind === 'moved'}
					<div class="group">
						<span>Type</span>
						{#each TYPES as v}
							<label class="check"><input type="checkbox" value={v} bind:group={types} /> {v}</label>
						{/each}
					</div>
				{/if}
				{#if kind !== 'birth'}
					<div class="group">
						<span>Gender</span>
						{#each GENDERS as v}
							<label class="check"><input type="checkbox" value={v} bind:group={genders} /> {v}</label>
						{/each}
					</div>
				{/if}
			</div>
		</fieldset>
	{/if}

	<label>
		<span>Note <em>(optional, copied onto every row)</em></span>
		<input type="text" bind:value={note} maxlength="500" placeholder={kind === 'purchase' ? 'e.g. bought at the sale barn' : 'e.g. 7-way booster'} />
	</label>
	<div bind:this={widgetBox}></div>
	{#if widgetNote}<p class="km-note">{widgetNote}</p>{/if}
	<!-- Disabled until the page's scripts are running and the check has passed; before that a click
	     would be a plain browser form submit that reloads the page. -->
	<button type="submit" disabled={busy || !token || !eventDate || !countOk}>
		{busy ? 'Building…' : token ? 'Download pre-filled template' : 'Waiting for the check…'}
	</button>
</form>

{#if result}
	<div class="km-result" class:ok={result.ok} role="status">
		<p class="km-msg">{result.message}</p>
		{#if result.advice}<p>{result.advice}</p>{/if}
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
	.group > span,
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
	.group {
		display: grid;
		gap: 0.35rem;
		align-content: start;
	}
	input[type='number'] {
		max-width: 8rem;
	}
	label.check {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}
	select,
	input[type='date'],
	input[type='number'],
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
