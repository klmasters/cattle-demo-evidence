<!--
  House style for a row of headline numbers. Put <BigValue> tiles inside it:

    <KMStats>
      <BigValue data={q} value=price title="Price" />
      <BigValue data={q} value=change title="vs. last week" />
    </KMStats>

  The tiles share the full width equally and stack on narrow screens. Evidence's own BigValue
  sets a minimum width in an inline style, so those rules need !important to override it.
-->
<div class="km-stats"><slot /></div>

<style>
	.km-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 1rem;
		margin: 0.75rem 0 2rem;
	}

	/* Each tile */
	.km-stats > :global(div) {
		min-width: 0 !important;
		max-width: none !important;
		margin: 0 !important;
		padding: 1.1rem 1.4rem 1.25rem !important;
		background: rgba(255, 255, 255, 0.6);
		border: 1px solid rgba(61, 102, 66, 0.15);
		border-radius: 6px;
	}

	/* Label above the number: small caps in the portfolio's mono font */
	.km-stats :global(p.text-sm) {
		font-family: 'DM Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #3a5c3d;
	}

	/* The number itself */
	.km-stats :global(.text-xl.font-medium) {
		font-size: 2.75rem;
		line-height: 1.1;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin-top: 0.6rem;
	}
</style>
