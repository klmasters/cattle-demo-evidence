<script>
	import { LineChart } from '@evidence-dev/core-components';

	// House style for every line chart on the site. Pages use <KMLineChart> instead of
	// <LineChart> and pass the same props; anything passed in overrides these defaults.
	// Chart text is drawn on a canvas, so it ignores page CSS and needs its font set here.
	export let echartsOptions = {};
</script>

<LineChart
	lineWidth={2}
	markers={false}
	chartAreaHeight={220}
	{...$$restProps}
	echartsOptions={{
		animation: false,
		textStyle: { fontFamily: "'DM Sans', system-ui, sans-serif" },
		...echartsOptions
	}}
/>
