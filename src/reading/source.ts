/** Native PDF postprocessors receive the entire note DOM but no section metadata. */
export async function readNativePrintSource(
	root: HTMLElement,
	hasSectionSource: boolean,
	readSource: () => Promise<string | null>,
): Promise<string | null> {
	if (hasSectionSource || !root.matches('.markdown-preview-view.markdown-rendered') ||
		!root.parentElement?.matches('.print')) return null;
	return readSource();
}
