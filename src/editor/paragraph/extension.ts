import {
	StateEffect,
	StateField,
	type Extension,
	type StateEffectType,
} from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
	createParagraphKeymap,
	type ParagraphKeymapOptions,
} from './keymap.js';
import { createParagraphProjection } from './projection.js';
import { createParagraphSelectionProtection } from './selection-protection.js';
import { createHeadingProjection } from './heading-projection.js';
import { createLineBreakProjection } from './line-break-projection.js';
import { createInlineSelectionProjection } from './inline-selection-projection.js';
import { createLinkInteraction } from './link-interaction.js';

const PARAGRAPH_ACTIVE_CLASS = 'paraflow-paragraph-editing-active';

export interface ParagraphExtensionOptions extends ParagraphKeymapOptions {
	readonly editLinksOnPlainClick?: () => boolean;
	readonly lineBreakMarkersEnabled?: () => boolean;
}

function isActive(view: EditorView, options: ParagraphExtensionOptions): boolean {
	return options.isLivePreview(view.state) && options.isSurface(view);
}

interface SurfaceIdentity {
	readonly active: boolean;
	readonly token: object;
}

interface TokenViewCounts {
	readonly active: number;
	readonly total: number;
}

function createActivationExtension(
	options: ParagraphExtensionOptions,
	setSurfaceIdentity: StateEffectType<SurfaceIdentity>,
	surfaceIdentityField: StateField<SurfaceIdentity | null>,
	tokenViews: Map<object, TokenViewCounts>,
): Extension {
	const add = (identity: SurfaceIdentity | null, active: boolean): void => {
		if (!identity) return;
		const counts = tokenViews.get(identity.token) ?? { active: 0, total: 0 };
		tokenViews.set(identity.token, {
			active: counts.active + (active ? 1 : 0),
			total: counts.total + 1,
		});
	};
	const remove = (identity: SurfaceIdentity | null, active: boolean): void => {
		if (!identity) return;
		const counts = tokenViews.get(identity.token);
		if (!counts) return;
		if (counts.total === 1) {
			tokenViews.delete(identity.token);
			return;
		}
		tokenViews.set(identity.token, {
			active: counts.active - (active ? 1 : 0),
			total: counts.total - 1,
		});
	};
	return [
		EditorView.editorAttributes.of((view) => ({
			class: isActive(view, options) ? PARAGRAPH_ACTIVE_CLASS : '',
		})),
		ViewPlugin.fromClass(class {
			private active: boolean;
			private destroyed = false;
			private identity: SurfaceIdentity | null;
			private identityUpdateQueued = false;
			private readonly token = {};

			constructor(private readonly view: EditorView) {
				this.active = isActive(view, options);
				this.identity = view.state.field(surfaceIdentityField, false) ?? null;
				add(this.identity, this.active);
				this.queueIdentityUpdate();
			}

			destroy(): void {
				this.destroyed = true;
				remove(this.identity, this.active);
			}

			update(update: ViewUpdate): void {
				remove(this.identity, this.active);
				this.active = isActive(this.view, options);
				this.identity = update.state.field(surfaceIdentityField, false) ?? null;
				add(this.identity, this.active);
				if (this.identity?.token !== this.token || this.identity.active !== this.active) {
					this.queueIdentityUpdate();
				}
			}

			private queueIdentityUpdate(): void {
				if (this.identityUpdateQueued) return;
				this.identityUpdateQueued = true;
				queueMicrotask(() => {
					this.identityUpdateQueued = false;
					if (this.destroyed) return;
					this.view.dispatch({
						effects: setSurfaceIdentity.of({ active: this.active, token: this.token }),
					});
				});
			}
		}),
	];
}

export function createParagraphExtension(options: ParagraphExtensionOptions): Extension {
	const setSurfaceIdentity = StateEffect.define<SurfaceIdentity>();
	const surfaceIdentityField = StateField.define<SurfaceIdentity | null>({
		create: () => null,
		update(identity, transaction) {
			for (const effect of transaction.effects) {
				if (effect.is(setSurfaceIdentity)) return effect.value;
			}
			return identity;
		},
	});
	const tokenViews = new Map<object, TokenViewCounts>();
	return [
		surfaceIdentityField,
		createActivationExtension(
			options,
			setSurfaceIdentity,
			surfaceIdentityField,
			tokenViews,
		),
		createParagraphProjection({ isActive: (view) => isActive(view, options) }),
		createHeadingProjection(
			(view) => isActive(view, options),
			(state) => {
				const identity = state.field(surfaceIdentityField, false);
				return options.isLivePreview(state) && (identity?.active ?? true);
			},
		),
		createLineBreakProjection(
			(view) => isActive(view, options),
			options.lineBreakMarkersEnabled,
		),
		createInlineSelectionProjection(
			(state) => {
				const identity = state.field(surfaceIdentityField, false);
				return options.isLivePreview(state) && (identity?.active ?? true);
			},
			(view) => isActive(view, options),
		),
		createLinkInteraction({
			editLinksOnPlainClick: options.editLinksOnPlainClick ?? (() => true),
			isActive: (view) => isActive(view, options),
		}),
		createParagraphKeymap(options),
		createParagraphSelectionProtection({
			isLivePreview: options.isLivePreview,
			isSurfaceState: (state) => {
				const identity = state.field(surfaceIdentityField, false);
				if (!identity) return false;
				const counts = tokenViews.get(identity.token);
				return counts?.active === 1 && counts.total === 1;
			},
		}),
	];
}
