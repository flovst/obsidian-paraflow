interface MathPreviewOwner { readonly from: number; readonly to: number }

const previewOwners = new WeakMap<HTMLElement, MathPreviewOwner>();

export function setMathPreviewReplacementOwner(dom: HTMLElement, owner: MathPreviewOwner | undefined): void {
	if (owner) previewOwners.set(dom, owner);
	else previewOwners.delete(dom);
}

/** Only a replacement owns source; the active-source companion is a point widget. */
export function mathPreviewReplacementOwner(dom: HTMLElement): MathPreviewOwner | undefined {
	return previewOwners.get(dom);
}
