import type { Extension } from '@codemirror/state';

export interface EditorExtensionLifecycleHost {
	registerEditorExtension(extension: Extension): void;
	updateOptions(): void;
}

export interface StructuredListExtensionLifecycle {
	readonly extensionSlot: readonly Extension[];
	setEnabled(enabled: boolean): boolean;
}

export function createStructuredListExtensionLifecycle(
	host: EditorExtensionLifecycleHost,
	createModule: () => Extension,
): StructuredListExtensionLifecycle {
	const extensionSlot: Extension[] = [];
	const moduleExtension = createModule();
	host.registerEditorExtension(extensionSlot);
	return {
		extensionSlot,
		setEnabled(enabled) {
			const currentlyEnabled = extensionSlot.length === 1
				&& extensionSlot[0] === moduleExtension;
			if (enabled === currentlyEnabled) return false;
			extensionSlot.splice(0, extensionSlot.length, ...(enabled ? [moduleExtension] : []));
			host.updateOptions();
			return true;
		},
	};
}
