import type { Extension } from '@codemirror/state';

export type EditorFeature = 'paragraph' | 'structured-list';

export interface EditorFeatureFlags {
	readonly paragraph: boolean;
	readonly structuredList: boolean;
}

export interface EditorExtensionModules {
	readonly navigationCore: Extension;
	readonly paragraph: Extension;
	readonly structuredList: Extension;
}

export interface EditorExtensionModuleFactories {
	readonly navigationCore: () => Extension;
	readonly paragraph: () => Extension;
	readonly structuredList: () => Extension;
}

export interface EditorExtensionLifecycleHost {
	registerEditorExtension(extension: Extension): void;
	updateOptions(): void;
}

export interface EditorExtensionLifecycle {
	readonly extensionSlot: readonly Extension[];
	refresh(feature: EditorFeature): boolean;
	setEnabled(feature: EditorFeature, enabled: boolean): boolean;
}

const DEFAULT_FLAGS: EditorFeatureFlags = Object.freeze({
	paragraph: false,
	structuredList: false,
});

function compose(
	modules: EditorExtensionModules,
	flags: EditorFeatureFlags,
): readonly Extension[] {
	if (flags.paragraph && flags.structuredList) {
		return [modules.navigationCore, modules.paragraph, modules.structuredList];
	}
	if (flags.paragraph) return [modules.navigationCore, modules.paragraph];
	if (flags.structuredList) return [modules.navigationCore, modules.structuredList];
	return [];
}

export function createEditorExtensionLifecycle(
	host: EditorExtensionLifecycleHost,
	factories: EditorExtensionModuleFactories,
	initialFlags: EditorFeatureFlags = DEFAULT_FLAGS,
): EditorExtensionLifecycle {
	const modules: EditorExtensionModules = {
		navigationCore: factories.navigationCore(),
		paragraph: factories.paragraph(),
		structuredList: factories.structuredList(),
	};
	let flags: EditorFeatureFlags = { ...initialFlags };
	const extensionSlot: Extension[] = [...compose(modules, flags)];
	host.registerEditorExtension(extensionSlot);

	return {
		extensionSlot,
		refresh(feature) {
			const enabled = feature === 'paragraph' ? flags.paragraph : flags.structuredList;
			if (!enabled) return false;
			host.updateOptions();
			return true;
		},
		setEnabled(feature, enabled) {
			const current = feature === 'paragraph' ? flags.paragraph : flags.structuredList;
			if (current === enabled) return false;
			const nextFlags: EditorFeatureFlags = feature === 'paragraph'
				? { ...flags, paragraph: enabled }
				: { ...flags, structuredList: enabled };
			const previousExtensions = [...extensionSlot];
			extensionSlot.splice(0, extensionSlot.length, ...compose(modules, nextFlags));
			try {
				host.updateOptions();
			} catch (error) {
				extensionSlot.splice(0, extensionSlot.length, ...previousExtensions);
				throw error;
			}
			flags = nextFlags;
			return true;
		},
	};
}
