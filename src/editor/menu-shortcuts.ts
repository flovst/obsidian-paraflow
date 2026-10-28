import { createDetachedEl } from '../dom';
export interface MenuShortcutSource {
	commandId?: string;
	systemShortcut?: 'cut' | 'copy' | 'paste' | 'selectAll';
	shortcut?: string;
}

interface Hotkey {modifiers: readonly string[]; key: string;}
interface HotkeyHost {
	hotkeyManager?: {
		getHotkeys(id: string): readonly Hotkey[] | undefined;
		getDefaultHotkeys(id: string): readonly Hotkey[] | undefined;
	};
}

const systemKeys = {cut: 'X', copy: 'C', paste: 'V', selectAll: 'A'};
const keyNames: Record<string, string> = {ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Space'};

/** Read the host's effective bindings when a menu is constructed. An empty override clears a binding. */
export function menuShortcutLabels(source: MenuShortcutSource, app: unknown, mac = false): string[] {
	if (source.shortcut) return [source.shortcut];
	if (source.systemShortcut) return [`${mac ? 'Cmd' : 'Ctrl'}+${systemKeys[source.systemShortcut]}`];
	if (!source.commandId) return [];
	const manager = (app as HotkeyHost | undefined)?.hotkeyManager;
	if (!manager) return [];
	const bindings = manager.getHotkeys(source.commandId) ?? manager.getDefaultHotkeys(source.commandId) ?? [];
	const labels = bindings.map(binding => {
		const modifiers = new Set(binding.modifiers.map(modifier => modifier === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : modifier));
		const parts = ['Ctrl', 'Meta', 'Alt', 'Shift'].filter(modifier => modifiers.has(modifier)).map(modifier => modifier === 'Meta' ? 'Cmd' : modifier);
		const key = keyNames[binding.key] ?? (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
		return [...parts, key].join('+');
	});
	return [...new Set(labels)];
}

export function decorateContextMenuItem(element: HTMLElement, source: MenuShortcutSource, app?: unknown): void {
	element.classList.add('paraflow-context-menu-item');
	element.querySelector('.paraflow-menu-shortcut')?.remove();
	const labels = menuShortcutLabels(source, app, /Mac/u.test(element.ownerDocument.defaultView?.navigator.platform ?? ''));
	if (!labels.length) return;
	const hint = createDetachedEl(element.ownerDocument, 'span');
	hint.className = 'paraflow-menu-shortcut';
	hint.textContent = labels[0]!;
	hint.title = labels.join(' / ');
	element.insertBefore(hint, element.querySelector('.menu-item-icon.mod-submenu'));
}
