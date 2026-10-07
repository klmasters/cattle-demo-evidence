<script>
	import '@evidence-dev/tailwind/fonts.css';
	import '../app.css';
	import { EvidenceDefaultLayout } from '@evidence-dev/core-components';
	export let data;

	// The main site lives at the domain root; this site lives under /ag-data/.
	const MAIN_SITE = 'https://kennanmasters.com';
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400&family=DM+Sans:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<!-- Bar that matches the portfolio nav (portfolio_site/components/nav.html and styles.css). -->
<nav class="km-bar" aria-label="Main site">
	<a href="{MAIN_SITE}/" class="km-logo">KM</a>
	<ul class="km-links">
		<li><a href="{MAIN_SITE}/">Home</a></li>
		<li><a href="{MAIN_SITE}/#work" class="active">Projects</a></li>
		<li><a href="{MAIN_SITE}/contact.html">Contact</a></li>
	</ul>
</nav>

<!-- Breadcrumbs are off: Evidence hardcodes their first crumb as "Home", which reads as the
     portfolio home page but links to the Overview page. -->
<EvidenceDefaultLayout
	{data}
	title="Cattle Herd Demo"
	homePageName="Overview"
	hideBreadcrumbs={true}
>
	<slot slot="content" />
</EvidenceDefaultLayout>

<style>
	:global(:root) {
		/* Same height as the portfolio nav: 2 x 1.25rem padding + a 1.7rem line + 1px border. */
		--km-bar: calc(2.5rem + 1.7rem + 1px);
		--km-leather: #3d6642;
		--km-bark: #2e4d31;
		--km-rust: #e8843e;

		/* Portfolio fonts: DM Sans for text and headings, DM Mono for labels. */
		--km-sans: 'DM Sans', system-ui, sans-serif;
		--km-mono: 'DM Mono', ui-monospace, monospace;

		/* Evidence's own components (tables, inputs, query viewer) read these variables. */
		--ui-font-family: var(--km-sans);
		--ui-font-family-compact: var(--km-sans);
		--monospace-font-family: var(--km-mono);
	}

	/* Evidence puts Tailwind's font-sans on the page text and headings. */
	:global(body),
	:global(.font-sans) {
		font-family: var(--km-sans);
	}
	/* "body" in front raises specificity so this wins over Evidence's heading rule. */
	:global(body h1.markdown),
	:global(body h2.markdown),
	:global(body h3.markdown) {
		font-family: var(--km-sans);
		font-weight: 600;
	}
	:global(thead th) {
		font-family: var(--km-mono);
	}

	/* The bar is fixed, like the portfolio nav. Evidence's own header, desktop sidebar and
	   table of contents are also position: fixed from the top of the screen, so each is
	   pushed down by the bar's height; the page content is pushed down by body padding. */
	:global(body) {
		padding-top: var(--km-bar);
	}
	:global(html) {
		scroll-padding-top: var(--km-bar);
	}
	:global(header.fixed) {
		top: var(--km-bar) !important;
	}
	:global(.fixed.top-20) {
		top: calc(5rem + var(--km-bar)) !important;
	}

	/* On desktop Evidence's header only repeats the site title (the sidebar is always visible),
	   so it is hidden there. It stays on phones: it holds the button that opens the sidebar.
	   768px is where Evidence switches to the always-visible sidebar. With the header gone,
	   the content, sidebar and table of contents all start just below the KM bar. */
	@media (min-width: 768px) {
		:global(header.fixed) {
			display: none !important;
		}
		:global(main.flex-grow) {
			margin-top: 2rem !important;
		}
		:global(.fixed.top-20) {
			top: calc(2rem + var(--km-bar)) !important;
		}
	}

	.km-bar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: var(--km-bar);
		box-sizing: border-box;
		z-index: 45; /* above Evidence's header (40), below its mobile menu overlay (50) */
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 3rem;
		background: rgba(250, 249, 244, 0.88);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(61, 102, 66, 0.15);
	}

	.km-logo {
		font-family: 'DM Mono', monospace;
		font-size: 0.8rem;
		font-weight: 300;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: var(--km-leather);
		text-decoration: none;
	}

	.km-links {
		display: flex;
		gap: 2.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.km-links a {
		font-family: 'DM Mono', monospace;
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--km-bark);
		text-decoration: none;
		transition: color 0.2s;
	}

	.km-links a:hover,
	.km-links a.active {
		color: var(--km-rust);
	}

	@media (max-width: 900px) {
		:global(:root) {
			--km-bar: calc(2rem + 1.7rem + 1px);
		}
		.km-bar {
			padding: 0 1.5rem;
		}
		.km-links {
			gap: 1.5rem;
		}
	}
</style>
