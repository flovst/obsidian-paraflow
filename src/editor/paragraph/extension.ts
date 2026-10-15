import {
	StateEffect,
	StateField,
	Prec,
	EditorSelection,
	type EditorState,
	type Extension,
	type StateEffectType,
} from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
	createParagraphKeymap,
	type ParagraphKeymapOptions,
} from './keymap.js';
import { createParagraphProjection } from './projection.js';
import { createBlockBoundarySpacing } from './boundary-spacing.js';
import { createParagraphSelectionProtection, normalizeParagraphSelectionEndpoint } from './selection-protection.js';
import { getParagraphProjectionState } from './projection.js';
import { ordinaryParagraphAtCaret } from './syntax.js';
import { classifyCurrentSelectionMode, requireCompositionState, selectionModeAnnotation } from '../runtime/input-state.js';
import { isVirtualTailActive } from '../runtime/virtual-tail.js';
import { createHeadingProjection } from './heading-projection.js';
import { createThematicBreakProjection } from './thematic-break-projection.js';
import { createInlineSelectionProjection, type InlineHtmlRenderer } from './inline-selection-projection.js';
import { createLinkInteraction, type LinkInteractionOptions } from './link-interaction.js';
import { createMathEditingExtension, type MathEditingOptions } from '../math/extension.js';
import {requestTableFocus,tableActivationDestination} from '../table/focus-handoff.js';

const PARAGRAPH_ACTIVE_CLASS = 'paraflow-paragraph-editing-active';

export interface ParagraphExtensionOptions extends ParagraphKeymapOptions {
	readonly editLinksOnPlainClick?: () => boolean;
	readonly openReferenceLink?: LinkInteractionOptions['openReferenceLink'];
	readonly renderInlineHtml?: InlineHtmlRenderer;
	readonly mathRendering?: Pick<MathEditingOptions, 'renderMath' | 'getCachedMath' | 'finishRenderMath'> & { readonly isFocused: (state: EditorState) => boolean };
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
		Prec.highest(ViewPlugin.fromClass(class {
			private active: boolean;
			private destroyed = false;
			private identity: SurfaceIdentity | null;
			private identityUpdateQueued = false;
			private activationCaretUnchanged = false;
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
				if (update.docChanged || update.selectionSet) this.activationCaretUnchanged = false;
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
				this.activationCaretUnchanged = true;
				const initializing = this.identity === null;
				queueMicrotask(() => {
					this.identityUpdateQueued = false;
					if (this.destroyed) return;
					const state = this.view.state;
					const range = state.selection.main;
					const mode = classifyCurrentSelectionMode(state);
					const active = isActive(this.view, options);
					const activating = active && this.identity?.active !== true;
					const eligible = activating && state.selection.ranges.length === 1 && range.empty &&
						!this.view.composing && !requireCompositionState(state) &&
						(mode === 'caret' || mode === 'unknown');
					const initialize = eligible && initializing && this.activationCaretUnchanged && mode === 'unknown' &&
						ordinaryParagraphAtCaret(state, range.head, getParagraphProjectionState(state)?.authority.paragraphs) !== null;
					const normalize = eligible && !isVirtualTailActive(state);
					const normalizedPosition = normalize ? normalizeParagraphSelectionEndpoint(state, range.head, -1) : range.head;
					const tableDestination = normalize ? tableActivationDestination(this.view,normalizedPosition) : null;
					const position = tableDestination?.position ?? normalizedPosition;
					const transaction = state.update({
						effects: setSurfaceIdentity.of({ active, token: this.token }),
						...(position === range.head && !initialize ? {} : {
							selection: position === range.head ? state.selection : EditorSelection.create([EditorSelection.cursor(position, -1, range.bidiLevel ?? undefined, range.goalColumn)]),
							annotations: selectionModeAnnotation.of('normal'),
						}),
					});
					if(tableDestination)requestTableFocus(this.view,transaction,tableDestination.from,tableDestination.bookmark,true);
					this.view.dispatch(transaction);
				});
			}
		})),
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
		createBlockBoundarySpacing(state => {
			const identity = state.field(surfaceIdentityField, false);
			return options.isLivePreview(state) && (identity?.active ?? true);
		}),
		createThematicBreakProjection(view => isActive(view, options)),
		createHeadingProjection(
			(view) => isActive(view, options),
			(state) => {
				const identity = state.field(surfaceIdentityField, false);
				return options.isLivePreview(state) && (identity?.active ?? true);
			},
		),
		createInlineSelectionProjection(
			(state) => {
				const identity = state.field(surfaceIdentityField, false);
				return options.isLivePreview(state) && (identity?.active ?? true);
			},
			(view) => isActive(view, options),
			options.renderInlineHtml,
		),
		options.mathRendering ? createMathEditingExtension({
			...options.mathRendering,
			isStateActive: state => {
				const identity = state.field(surfaceIdentityField, false);
				return options.isLivePreview(state) && (identity?.active ?? true);
			},
		}) : [],
		createLinkInteraction({
			editLinksOnPlainClick: options.editLinksOnPlainClick ?? (() => true),
			openReferenceLink: options.openReferenceLink,
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
