import type { Extension } from '@codemirror/state';

export type EditorFeature = 'paragraph' | 'structured-list' | 'break-markers';

export interface EditorFeatureFlags {
	readonly paragraph: boolean;
	readonly structuredList: boolean;
	readonly breakMarkers: boolean;
}

export interface EditorExtensionModules {
	readonly navigationCore: Extension;
	readonly paragraph: Extension;
	readonly structuredList: Extension;
	readonly breakMarkers: Extension;
}

export interface EditorExtensionModuleFactories {
	readonly navigationCore: () => Extension;
	readonly paragraph: () => Extension;
	readonly structuredList: () => Extension;
	readonly breakMarkers: () => Extension;
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
	breakMarkers: false,
});

const FEATURE_KEYS = {
	paragraph: 'paragraph',
	'structured-list': 'structuredList',
	'break-markers': 'breakMarkers',
} as const;

function compose(
	modules: EditorExtensionModules,
	flags: EditorFeatureFlags,
): readonly Extension[] {
	const extensions: Extension[] = [];
	if (flags.paragraph || flags.structuredList) extensions.push(modules.navigationCore);
	if (flags.paragraph) extensions.push(modules.paragraph);
	if (flags.structuredList) extensions.push(modules.structuredList);
	if (flags.breakMarkers) extensions.push(modules.breakMarkers);
	return extensions;
}

export function createEditorExtensionLifecycle(
	host: EditorExtensionLifecycleHost,
	factories: EditorExtensionModuleFactories,
	initialFlags: Partial<EditorFeatureFlags> = {},
): EditorExtensionLifecycle {
	const modules: EditorExtensionModules = {
		navigationCore: factories.navigationCore(),
		paragraph: factories.paragraph(),
		structuredList: factories.structuredList(),
		breakMarkers: factories.breakMarkers(),
	};
	let flags: EditorFeatureFlags = { ...DEFAULT_FLAGS, ...initialFlags };
	const extensionSlot: Extension[] = [...compose(modules, flags)];
	host.registerEditorExtension(extensionSlot);

	return {
		extensionSlot,
		refresh(feature) {
			const enabled = flags[FEATURE_KEYS[feature]];
			if (!enabled) return false;
			host.updateOptions();
			return true;
		},
		setEnabled(feature, enabled) {
			const key = FEATURE_KEYS[feature];
			const current = flags[key];
			if (current === enabled) return false;
			const nextFlags: EditorFeatureFlags = { ...flags, [key]: enabled };
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
