<script>
	import { AreaChart } from '@evidence-dev/core-components';

	// House style for every area chart on the site; the twin of KMLineChart.svelte.
	// Pages use <KMAreaChart> instead of <AreaChart>; anything passed in overrides these defaults.
	export let echartsOptions = {};
</script>

<AreaChart
	markers={false}
	chartAreaHeight={240}
	{...$$restProps}
	echartsOptions={{
		animation: false,
		textStyle: { fontFamily: "'DM Sans', system-ui, sans-serif" },
		...echartsOptions
	}}
/>
