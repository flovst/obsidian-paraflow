import { createDetachedEl } from '../../dom.js';

/** An inline outer box exposes the block's overflow while retaining its measured block bounds. */
export function blockWidgetShell(content: HTMLElement): HTMLElement {
	const shell = createDetachedEl(content.ownerDocument, 'div');
	shell.className = 'paraflow-block-widget-shell';
	shell.append(content);
	return shell;
}

export function blockWidgetContent(shell: HTMLElement): HTMLElement {
	return shell.firstElementChild as HTMLElement;
}
