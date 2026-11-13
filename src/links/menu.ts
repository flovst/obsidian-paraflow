import { contentMenuIcon, contentMenuItems, type ContentMenu, type ContentMenuItem } from '../editor/context-menu-model.js';
import { isExternalLink, type LinkOpenIntent } from './intent.js';

const action = new WeakMap<ContentMenuItem, LinkOpenIntent>();

/** Native link open actions live in `open`; insertion actions use `selection-link`. */
function nativeIntent(item: ContentMenuItem): LinkOpenIntent | null {
	const assigned = action.get(item);
	if (assigned) return assigned;
	if (item.section !== 'open' || item.submenu) return null;
	const icon = contentMenuIcon(item);
	if (icon === 'file-minus') return 'current';
	if (['file-plus', 'square-plus', 'file-plus-2', 'copy-plus'].includes(icon)) return 'tab';
	if (icon === 'separator-vertical') return 'split';
	if (['picture-in-picture-2', 'panels-top-left', 'app-window'].includes(icon)) return 'window';
	return null;
}

export function installLinkMenuActions(menu: ContentMenu, destination: string, open: (intent: LinkOpenIntent) => void,
	translate: (label: string) => string): void {
	if (isExternalLink(destination)) return;
	for (const item of contentMenuItems(menu)) {
		const intent = nativeIntent(item);
		if (intent === 'split' || intent === 'window') item.onClick(() => open(intent));
	}
	for (const intent of ['current', 'tab'] as const) {
		const candidates = contentMenuItems(menu).filter(item => nativeIntent(item) === intent);
		let item = candidates[0];
		if (!item) menu.addItem(created => { item = created; });
		const selected = item!;
		action.set(selected, intent);
		selected.setTitle(translate(intent === 'current' ? '在当前标签页打开' : '在新的标签页打开'))
			.setIcon(intent === 'current' ? 'file' : 'file-plus').setSection('open').setDisabled(false).onClick(() => open(intent));
		for (const duplicate of candidates.slice(1)) {
			menu.items.splice(menu.items.indexOf(duplicate), 1);
			duplicate.dom.remove();
		}
	}
}
