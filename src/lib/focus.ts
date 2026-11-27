export function isFocusLost(): boolean {
	const {activeElement, body} = globalThis.document;
	return activeElement === null || activeElement === body;
}

/**
 The fallback where nothing better can take the focus (DESIGN.md section 10).
 `<main>` is focusable only while it holds the focus, so a click on empty space
 does not focus it.
 */
export function focusMain(): void {
	const main = globalThis.document.querySelector('main');
	if (!main) {
		return;
	}

	main.tabIndex = -1;
	main.addEventListener(
		'blur',
		() => {
			main.removeAttribute('tabindex');
		},
		{once: true},
	);
	main.focus({preventScroll: true});
}
