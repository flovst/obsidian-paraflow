import type { EditorView } from '@codemirror/view';
import { MarkdownView, type Command, type Editor, type EditorPosition, type Plugin, type WorkspaceLeaf } from 'obsidian';
import type { createObsidianLinkNavigation } from './obsidian.js';
import type { LinkOpenIntent } from './intent.js';

/** Obsidian 1.15 runtime boundary: the same token and editor source used by its link commands. */
interface NativeLinkCommandHost {
	commands: { findCommand(id: string): Command | undefined };
	workspace: {
		activeEditor: {
			editor?: Editor & { getClickableTokenAt(position: EditorPosition): { type: string; text: string } | null };
			editMode?: { cm: EditorView; path: string };
		} | null;
	};
}

const linkCommands: ReadonlyArray<readonly [string, LinkOpenIntent]> = [
	['editor:follow-link', 'current'],
	['editor:open-link-in-new-leaf', 'tab'],
	['editor:open-link-in-new-split', 'split'],
	['editor:open-link-in-new-window', 'window'],
];

/** Guard commands after host shortcut resolution, including user bindings and command-palette execution. */
export function registerNativeLinkCommandGuard(plugin: Plugin, navigation: ReturnType<typeof createObsidianLinkNavigation>, enabled: () => boolean): void {
	const host = plugin.app as unknown as NativeLinkCommandHost;
	for (const [id, intent] of linkCommands) {
		const command = host.commands.findCommand(id);
		if (!command?.checkCallback) continue;
		const original = command.checkCallback;
		const guarded: NonNullable<Command['checkCallback']> = function (checking) {
			if (checking || !enabled()) return original.call(command, checking);
			const active = host.workspace.activeEditor;
			const editor = active?.editor;
			const mode = active?.editMode;
			if (!editor || !mode) return original.call(command, checking);
			const token = editor.getClickableTokenAt(editor.getCursor());
			if (token?.type !== 'internal-link') return original.call(command, checking);
			let origin: WorkspaceLeaf | null = null;
			plugin.app.workspace.iterateAllLeaves(leaf => {
				if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(mode.cm.dom)) origin = leaf;
			});
			if (!origin) return original.call(command, checking);
			navigation.openAutomatic(token.text, { leaf: origin, sourcePath: mode.path, window: mode.cm.dom.ownerDocument.defaultView! }, intent);
			return true;
		};
		command.checkCallback = guarded;
		plugin.register(() => { if (command.checkCallback === guarded) command.checkCallback = original; });
	}
}
