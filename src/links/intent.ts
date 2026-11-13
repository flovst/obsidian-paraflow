/** Opening position shared by rendered links, editors and host menus. */
export type LinkOpenIntent = 'current' | 'tab' | 'split' | 'window';

export function linkOpenIntent(event: Pick<MouseEvent, 'altKey' | 'shiftKey'>): LinkOpenIntent {
	return event.altKey ? event.shiftKey ? 'window' : 'split' : 'tab';
}

export function isExternalLink(destination: string): boolean {
	return /^[\t\n\f\r ]*(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(destination);
}
