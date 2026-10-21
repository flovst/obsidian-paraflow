import { Facet, type EditorState, type Extension, type Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, type Decoration, type DecorationSet } from '@codemirror/view';

// Obsidian-specific adapter: private controller/property interception is not a portable
// editor contract. Rebinding repairs lifetime mismatches, not the private-API dependency.
// Porting guidance: docs/specs/host-display-adaptation.zh-CN.md.

type NativeFilter = (from: number, to: number, decoration: Decoration) => boolean;
type Ownership = (state: EditorState, view: EditorView) => NativeFilter | null;
/** A true result means the semantic owner replaces this exact native decoration. */
export const nativeBlockOwnership = Facet.define<Ownership>();
export const nativeInlineOwnership = Facet.define<Ownership>();

interface NativeField {
	createF: (state: EditorState) => DecorationSet;
	updateF: (value: DecorationSet, transaction: Transaction) => DecorationSet;
}
interface NativeController {
	view: EditorView;
	editor: { cm: EditorView };
	decorations: NativeField;
	imageWidgetAt: unknown;
	reconcile: unknown;
}
interface NativeInline {
	decorations: DecorationSet;
	buildDeco: (view: EditorView) => DecorationSet;
}
interface InlineBinding {
	owner: NativeInline;
	get: () => DecorationSet;
	restore: (rebuild: boolean) => void;
}
interface BlockBinding {
	owner: NativeController;
	field: NativeField;
	create: NativeField['createF'];
	update: NativeField['updateF'];
}

type BindingStatus = 'bound' | 'missing' | 'ambiguous' | 'unsupported-descriptor' | 'unbound' | 'inactive' | 'disposed';
interface BindingObservation {
	readonly status: BindingStatus;
	readonly matches: number;
}
export interface NativeDecorationBindingStatus {
	readonly lifecycle: 'active' | 'inactive' | 'disposed';
	readonly block: BindingObservation;
	readonly inline: BindingObservation;
}
interface FilterCache {
	state: EditorState;
	raw: DecorationSet;
	filtered: DecorationSet;
	viewport: { from: number; to: number };
	visibleRanges: readonly { from: number; to: number }[];
}

function blockControllers(view: EditorView): NativeController[] {
	const values = (view.state as unknown as { values?: unknown[] }).values;
	return values?.filter((value): value is NativeController => {
		if (!value || typeof value !== 'object') return false;
		const item = value as Partial<NativeController>;
		return item.view === view && item.editor?.cm === view && typeof item.decorations?.createF === 'function' &&
			typeof item.decorations.updateF === 'function' && typeof item.imageWidgetAt === 'function' && typeof item.reconcile === 'function';
	}) ?? [];
}

function blockController(view: EditorView): NativeController | null {
	const matches = blockControllers(view);
	return matches.length === 1 ? matches[0]! : null;
}

function inlineController(view: EditorView): NativeInline | null {
	const plugins = (view as unknown as { plugins?: { value?: unknown }[] }).plugins;
	const matches = plugins?.map(plugin => plugin.value).filter((value): value is NativeInline => {
		if (!value || typeof value !== 'object') return false;
		const item = value as Partial<NativeInline>;
		// This literal is the native reveal policy's semantic key, not a minified
		// class name. Unsupported versions retain their original decorations.
		return typeof item.buildDeco === 'function' && typeof item.decorations?.between === 'function' &&
			Function.prototype.toString.call(item.buildDeco).includes('obsidian-search-match-highlight');
	}) ?? [];
	return matches.length === 1 ? matches[0]! : null;
}

function propertyDescriptor(owner: object, name: string): PropertyDescriptor | undefined {
	for (let current: object | null = owner; current; current = Object.getPrototypeOf(current) as object | null) {
		const descriptor = Object.getOwnPropertyDescriptor(current, name);
		if (descriptor) return descriptor;
	}
	return undefined;
}

function dataProperty(owner: object, name: string): unknown {
	return propertyDescriptor(owner, name)?.value as unknown;
}

function observedBlockControllers(view: EditorView): { owner: object; field: object | null }[] {
	const values = (view.state as unknown as { values?: unknown[] }).values;
	return values?.flatMap<{ owner: object; field: object | null }>(value => {
		if (!value || typeof value !== 'object') return [];
		const editor = dataProperty(value, 'editor');
		if (dataProperty(value, 'view') !== view || !editor || typeof editor !== 'object' ||
			dataProperty(editor, 'cm') !== view || typeof dataProperty(value, 'imageWidgetAt') !== 'function' ||
			typeof dataProperty(value, 'reconcile') !== 'function') return [];
		const descriptor = propertyDescriptor(value, 'decorations');
		if (descriptor && !('value' in descriptor)) return [{ owner: value, field: null }];
		const field = descriptor?.value as unknown;
		if (!field || typeof field !== 'object') return [];
		const create = propertyDescriptor(field, 'createF'), update = propertyDescriptor(field, 'updateF');
		if (create && !('value' in create) || update && !('value' in update)) return [{ owner: value, field: null }];
		return typeof dataProperty(field, 'createF') === 'function' && typeof dataProperty(field, 'updateF') === 'function'
			? [{ owner: value, field }] : [];
	}) ?? [];
}

const ownership = ViewPlugin.fromClass(class {
	private blockRestore: (() => void) | null = null;
	private blockBinding: BlockBinding | null = null;
	private inlineBinding: InlineBinding | null = null;
	private inlineCheckPending = false;
	private disposed = false;
	private cache = new Map<typeof nativeBlockOwnership, FilterCache>();
	constructor(readonly view: EditorView) {
		this.install();
		// Some native plugins are constructed later in the same CM initialization.
		queueMicrotask(() => { if (!this.disposed) { this.install(); this.view.dispatch({}); } });
	}
	update(): void {
		this.install();
		// Native plugins later in the update order may replace their descriptor or instance.
		if (this.inlineCheckPending) return;
		this.inlineCheckPending = true;
		queueMicrotask(() => {
			this.inlineCheckPending = false;
			if (!this.disposed && this.installInline()) this.view.dispatch({});
		});
	}
	readBindingStatus(): NativeDecorationBindingStatus {
		if (this.disposed) return inactiveBindingStatus('disposed');
		const blocks = observedBlockControllers(this.view);
		const block = this.blockBinding;
		const blockStatus: BindingStatus = blocks.length === 0 ? 'missing' : blocks.length > 1 ? 'ambiguous' :
			blocks[0]!.field === null ? 'unsupported-descriptor' :
			block && block.owner === blocks[0]!.owner && blocks[0]!.field === block.field &&
			Object.getOwnPropertyDescriptor(block.field, 'createF')?.value === block.create &&
			Object.getOwnPropertyDescriptor(block.field, 'updateF')?.value === block.update ? 'bound' : 'unbound';
		const plugins = (this.view as unknown as { plugins?: { value?: unknown }[] }).plugins;
		// Do not invoke native decorations getters: even our own getter filters and caches.
		const inlines = plugins?.map(plugin => plugin.value).filter((value): value is NativeInline => {
			if (!value || typeof value !== 'object') return false;
			const item = value as Partial<NativeInline>;
			const descriptor = propertyDescriptor(item, 'decorations');
			const buildDeco = dataProperty(item, 'buildDeco');
			const raw = descriptor?.value as unknown;
			return typeof buildDeco === 'function' &&
				Function.prototype.toString.call(buildDeco).includes('obsidian-search-match-highlight') &&
				!!descriptor && (!('value' in descriptor) || !!raw && typeof raw === 'object' && typeof dataProperty(raw, 'between') === 'function');
		}) ?? [];
		const inline = this.inlineBinding, candidate = inlines[0];
		const descriptor = candidate && Object.getOwnPropertyDescriptor(candidate, 'decorations');
		const inlineStatus: BindingStatus = inlines.length === 0 ? 'missing' : inlines.length > 1 ? 'ambiguous' :
			inline && inline.owner === candidate && descriptor?.get === inline.get ? 'bound' :
			!descriptor?.configurable || !('value' in descriptor) ? 'unsupported-descriptor' : 'unbound';
		return { lifecycle: 'active', block: { status: blockStatus, matches: blocks.length }, inline: { status: inlineStatus, matches: inlines.length } };
	}
	private filter(raw: DecorationSet, state: EditorState, facet: typeof nativeBlockOwnership): DecorationSet {
		if (this.disposed) return raw;
		const cached = this.cache.get(facet);
		const viewport = this.view.viewport, visibleRanges = this.view.visibleRanges;
		// A native field or earlier plugin can populate this during the same update.
		// Visibility also changes without a transaction (scrolling and folding).
		if (cached?.state === state && cached.raw === raw && cached.viewport.from === viewport.from && cached.viewport.to === viewport.to &&
			cached.visibleRanges.length === visibleRanges.length && cached.visibleRanges.every((range, index) =>
				range.from === visibleRanges[index]!.from && range.to === visibleRanges[index]!.to)) return cached.filtered;
		const policies = state.facet(facet).map(provider => provider(state, this.view)).filter((policy): policy is NativeFilter => policy !== null);
		const filtered = policies.length ? raw.update({ filter: (from, to, decoration) => !policies.some(policy => policy(from, to, decoration)) }) : raw;
		this.cache.set(facet, { state, raw, filtered, viewport: { ...viewport }, visibleRanges: visibleRanges.map(range => ({ ...range })) });
		return filtered;
	}
	private install(): void {
		if (!this.blockRestore) {
			const owner = blockController(this.view);
			if (owner) {
				const field = owner.decorations;
				const originalCreate = field.createF, originalUpdate = field.updateF;
				const create: NativeField['createF'] = state => this.filter(originalCreate(state), state, nativeBlockOwnership);
				const update: NativeField['updateF'] = (value, transaction) => this.filter(originalUpdate(value, transaction), transaction.state, nativeBlockOwnership);
				field.createF = create; field.updateF = update;
				this.blockBinding = { owner, field, create, update };
				this.blockRestore = () => {
					if (field.createF === create) field.createF = originalCreate;
					if (field.updateF === update) field.updateF = originalUpdate;
				};
			}
		}
		this.installInline();
	}
	private installInline(): boolean {
		const previous = this.inlineBinding;
		const plugins = (this.view as unknown as { plugins?: { value?: unknown }[] }).plugins;
		// Identity checks must not read the filtered getter before the host replaces
		// its decorations. Mode changes can still replace the instance or descriptor.
		if (previous && plugins?.some(plugin => plugin.value === previous.owner) &&
			Object.getOwnPropertyDescriptor(previous.owner, 'decorations')?.get === previous.get) return false;
		const owner = inlineController(this.view);
		const descriptor = owner && Object.getOwnPropertyDescriptor(owner, 'decorations');
		previous?.restore(false);
		this.inlineBinding = null;
		this.cache.delete(nativeInlineOwnership);
		if (!owner || !descriptor?.configurable || !('value' in descriptor)) return previous !== null;
		let raw = owner.decorations, active = true;
		const get = (): DecorationSet => active ? this.filter(raw, this.view.state, nativeInlineOwnership) : raw;
		Object.defineProperty(owner, 'decorations', { configurable: true, enumerable: descriptor.enumerable,
			get, set: (value: DecorationSet) => { raw = value; } });
		this.inlineBinding = { owner, get, restore: rebuild => {
			active = false;
			if (Object.getOwnPropertyDescriptor(owner, 'decorations')?.get !== get) return;
			Object.defineProperty(owner, 'decorations', { ...descriptor, value: raw });
			if (rebuild) owner.decorations = owner.buildDeco(this.view);
		} };
		return true;
	}
	destroy(): void {
		this.disposed = true;
		this.blockRestore?.();
		queueMicrotask(() => {
			const alive = !(this.view as unknown as { destroyed: boolean }).destroyed;
			// Only rebuild a native instance that survived removal of this extension.
			this.inlineBinding?.restore(alive && inlineController(this.view) === this.inlineBinding.owner);
			this.inlineBinding = null;
			if (alive) this.view.dispatch({});
		});
	}
});

/** Shared singleton: no wrapper chains when several semantic owners participate. */
export function createNativeDecorationOwnership(): Extension { return ownership; }

function inactiveBindingStatus(lifecycle: 'inactive' | 'disposed'): NativeDecorationBindingStatus {
	return { lifecycle, block: { status: lifecycle, matches: 0 }, inline: { status: lifecycle, matches: 0 } };
}

/** On-demand host-adapter observation; does not install, filter or rebuild decorations. */
export function readNativeDecorationBindingStatus(view: EditorView): NativeDecorationBindingStatus {
	if ((view as unknown as { destroyed: boolean }).destroyed) return inactiveBindingStatus('disposed');
	return view.plugin(ownership)?.readBindingStatus() ?? inactiveBindingStatus('inactive');
}

export function isNativeReplacement(decoration: Decoration): boolean {
	return (decoration as Decoration & { isReplace?: boolean }).isReplace === true;
}
