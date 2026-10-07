<script>
	import { BarChart } from '@evidence-dev/core-components';

	// House style for every bar chart on the site; the twin of KMLineChart.svelte.
	// Pages use <KMBarChart> instead of <BarChart>; anything passed in overrides these defaults.
	export let echartsOptions = {};
</script>

<BarChart
	chartAreaHeight={220}
	{...$$restProps}
	echartsOptions={{
		animation: false,
		textStyle: { fontFamily: "'DM Sans', system-ui, sans-serif" },
		...echartsOptions
	}}
/>
