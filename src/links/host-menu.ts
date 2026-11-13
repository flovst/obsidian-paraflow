import { getLanguage, Menu, type Plugin, type WorkspaceLeaf } from 'obsidian';
import type { ContentMenu } from '../editor/context-menu-model.js';
import { translateMenuText } from '../editor/menu-i18n.js';
import { installLinkMenuActions } from './menu.js';
import type { LinkOrigin } from './navigation.js';
import type { createObsidianLinkNavigation } from './obsidian.js';

/** Obsidian's link menu builder also retains explicit Create note for missing targets. */
export function showReadingLinkMenu(plugin: Plugin, navigation: ReturnType<typeof createObsidianLinkNavigation>,
	event: MouseEvent, destination: string, origin: LinkOrigin<WorkspaceLeaf>): void {
	const menu = new Menu();
	plugin.app.workspace.handleLinkContextMenu(menu, destination, origin.sourcePath, origin.leaf);
	installLinkMenuActions(menu as unknown as ContentMenu, destination, intent => navigation.open(destination, origin, intent),
		label => translateMenuText(label, getLanguage()));
	menu.setUseNativeMenu(false);
	menu.showAtMouseEvent(event);
}
