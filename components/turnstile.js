// Shared by the forms on the upload page. Loads Cloudflare's Turnstile script once, however many
// forms ask for it (a second copy of the script makes Cloudflare complain), and draws the
// "are you a person" check into a box.

// Public half of the Turnstile widget (the secret half lives in Cloudflare).
const SITE_KEY = '0x4AAAAAAFWwILY3pKIpeGIf';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading = null;

function loadScript() {
	if (window.turnstile) return Promise.resolve();
	if (!loading) {
		loading = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = SCRIPT_URL;
			script.async = true;
			script.onload = resolve;
			script.onerror = () => {
				loading = null; // let a later form try again
				reject(new Error('load failed'));
			};
			document.head.appendChild(script);
		});
	}
	return loading;
}

/**
 * Draws the check into `box`.
 * onToken(token) gets the token when the check passes, and '' when it expires or fails.
 * onNote(message) gets a sentence to show the visitor when the check cannot load or run.
 * Returns { reset() }: call it after a token has been used (each works once).
 */
export function mountTurnstile(box, { onToken, onNote }) {
	let widgetId = null;
	loadScript().then(
		() => {
			try {
				widgetId = window.turnstile.render(box, {
					sitekey: SITE_KEY,
					callback: (token) => onToken(token),
					'expired-callback': () => onToken(''),
					'error-callback': (code) => {
						onToken('');
						onNote(`The check could not run (error ${code}). Reload the page; if it keeps failing, try another browser.`);
					},
				});
			} catch (err) {
				onNote(`The check could not start (${err?.message ?? 'unknown error'}).`);
			}
		},
		() =>
			onNote(
				'The check could not be loaded. A browser extension or network filter may be blocking challenges.cloudflare.com.',
			),
	);
	return {
		reset() {
			if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
		},
	};
}
