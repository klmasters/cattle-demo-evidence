<!--
  Shown after a successful upload. Cloudflare rebuilds the site in the background and does not say
  when it is done, so this counts down a fixed three minutes (the build usually takes 2 to 3), then
  tells the visitor to refresh. It starts when it appears and uses a clock time rather than counting
  ticks, so a background browser tab that pauses its timer still shows the right time.
-->
<script>
	import { onMount } from 'svelte';

	export let seconds = 180;

	let left = seconds;
	$: done = left <= 0;
	$: clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

	onMount(() => {
		const deadline = Date.now() + seconds * 1000;
		const timer = setInterval(() => {
			left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
			if (left === 0) clearInterval(timer);
		}, 500);
		return () => clearInterval(timer);
	});
</script>

<div class="km-countdown" aria-live="polite">
	{#if done}
		<p><strong>The dashboards should be updated now.</strong> Refresh the page to see the new data.</p>
		<button type="button" on:click={() => location.reload()}>Refresh the page</button>
	{:else}
		<p>The dashboards are rebuilding with your data. Check back in <strong class="clock">{clock}</strong>, then refresh the page.</p>
	{/if}
</div>

<style>
	.km-countdown p {
		margin: 0.5rem 0;
	}
	.clock {
		font-family: 'DM Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	button {
		padding: 0.45rem 1.1rem;
		border: 0;
		border-radius: 4px;
		background: #3d6642;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
</style>
