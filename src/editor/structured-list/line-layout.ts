import { Prec, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { createDetachedEl } from '../../dom.js';
import { isGeometryOnly } from '../runtime/line-layout.js';

const listPadding = 'padding-inline-start: calc(var(--paraflow-container-inset, 0px) + var(--paraflow-live-list-base-indent) + var(--paraflow-list-layout-depth) * var(--paraflow-live-list-indent) + var(--paraflow-live-list-content-offset) + var(--paraflow-list-layout-hanging))';
const layoutProviders = new WeakSet<(view: EditorView) => DecorationSet>();
const sourceCache = new WeakMap<EditorView, { state: EditorView['state']; viewport: EditorView['viewport']; ranges: EditorView['visibleRanges']; sets: DecorationSet[] }>();
const classSetCache = new WeakMap<DecorationSet, boolean>();
function hasLineClasses(set: DecorationSet): boolean {
	const cached = classSetCache.get(set);
	if (cached !== undefined) return cached;
	let present = false;
	for (const cursor = set.iter(); cursor.value; cursor.next()) {
		const spec = cursor.value.spec as LineSpec;
		if (cursor.from === cursor.to && !spec.widget && !spec.block && classNames(spec)) { present = true; break; }
	}
	classSetCache.set(set, present);
	return present;
}
export function registerLineLayoutProvider(provider: (view: EditorView) => DecorationSet): void { layoutProviders.add(provider); }
export function lineClassSources(view: EditorView): DecorationSet[] {
	const previous = sourceCache.get(view);
	if (previous?.state === view.state && previous.viewport === view.viewport && previous.ranges === view.visibleRanges) return previous.sets;
	const sets = view.state.facet(EditorView.decorations).filter(provider => typeof provider !== 'function' || !layoutProviders.has(provider))
		.map(provider => typeof provider === 'function' ? provider(view) : provider).filter(set => !isGeometryOnly(set) && hasLineClasses(set));
	sourceCache.set(view, { state: view.state, viewport: view.viewport, ranges: view.visibleRanges, sets });
	return sets;
}

class ListOriginWidget extends WidgetType {
	eq(): boolean { return true; }
	toDOM(view: EditorView): HTMLElement {
		const span = createDetachedEl(view.dom.ownerDocument, 'span');
		span.className = 'paraflow-list-origin-spacer';
		span.setAttribute('aria-hidden', 'true');
		return span;
	}
}
const originWidget = new ListOriginWidget();

interface LayoutCache {
	sets: readonly DecorationSet[];
	lists: boolean;
	callouts: boolean;
	decorations: DecorationSet;
}
interface OriginCache { sets: readonly DecorationSet[]; lists: boolean; callouts: boolean; origins: Set<number> }
const originCache = new WeakMap<EditorView, OriginCache>();
function sameOriginInputs(previous: OriginCache | undefined, sets: readonly DecorationSet[], lists: boolean, callouts: boolean): previous is OriginCache {
	return !!previous && previous.lists === lists && previous.callouts === callouts && previous.sets.length === sets.length &&
		sets.every((set, index) => set === previous.sets[index]);
}
interface LineSpec { widget?: unknown; block?: boolean; class?: string; attributes?: { class?: string } }

function classNames(spec: LineSpec): string {
	return `${spec.class ?? ''} ${spec.attributes?.class ?? ''}`.trim();
}

function classesFor(set: DecorationSet, rows: Map<number, Set<string>>): void {
	for (const cursor = set.iter(); cursor.value; cursor.next()) {
		const spec = cursor.value.spec as LineSpec;
		if (cursor.from !== cursor.to || spec.widget || spec.block) continue;
		const classes = classNames(spec);
		if (!classes) continue;
		const row = rows.get(cursor.from) ?? new Set<string>();
		rows.set(cursor.from, row);
		for (const name of classes.split(/\s+/u)) row.add(name);
	}
}

/** Source origins are owned by the same semantic line decorations as their gutters. */
export function ownedLineOrigins(view: EditorView, lists: boolean, callouts: boolean): Set<number> {
	const sets = lineClassSources(view), previous = originCache.get(view);
	if (sameOriginInputs(previous, sets, lists, callouts)) return previous.origins;
	const rows = new Map<number, Set<string>>();
	for (const set of sets) classesFor(set, rows);
	const owned = new Set<number>();
	for (const [from, classes] of rows) {
		if (ownsOrigin(classes, lists, callouts)) owned.add(from);
	}
	originCache.set(view, { sets, lists, callouts, origins: owned });
	return owned;
}

function ownsOrigin(classes: Set<string>, lists: boolean, callouts: boolean): boolean {
	return classes.has('paraflow-code-line') || classes.has('paraflow-math-source-block') ||
		Array.from(classes).some(name => /^paraflow-list-owned-line-[1-6]$/u.test(name)) || ownsNative(classes, lists, callouts);
}

function ownsNative(classes: Set<string>, lists: boolean, callouts: boolean): boolean {
	if (classes.has('paraflow-list-owned-line') || classes.has('paraflow-code-line')) return false;
	if (!lists && !(callouts && classes.has('paraflow-callout-line'))) return false;
	return classes.has('paraflow-list-marker-line') || Array.from(classes).some(name => /^HyperMD-list-line-[1-6]$/u.test(name));
}

function layoutFor(sets: readonly DecorationSet[], lists: boolean, callouts: boolean): DecorationSet {
	const rows = new Map<number, Set<string>>();
	for (const set of sets) classesFor(set, rows);
	const lines: ReturnType<Decoration['range']>[] = [];
	for (const [from, classes] of rows) {
		if (classes.has('paraflow-math-source-block')) continue;
		const owned = Array.from(classes).some(name => /^paraflow-list-owned-line-[1-6]$/u.test(name));
		const native = ownsNative(classes, lists, callouts);
		if (owned || native) lines.push(Decoration.line({ attributes: { style: listPadding } }).range(from));
		if (native) lines.push(Decoration.widget({ widget: originWidget, side: -10000 }).range(from));
	}
	return Decoration.set(lines, true);
}

function matches(cache: LayoutCache | undefined, sets: readonly DecorationSet[], lists: boolean, callouts: boolean): cache is LayoutCache {
	return !!cache && cache.lists === lists && cache.callouts === callouts && cache.sets.length === sets.length &&
		sets.every((set, index) => set === cache.sets[index]);
}

/** Merge the same public line attributes as CodeMirror, including host fallback rows. */
export function createListLineLayout(
	isActive: (view: EditorView) => boolean,
	listEnabled: () => boolean,
	calloutEnabled: () => boolean,
): Extension {
	const cache = new WeakMap<EditorView, LayoutCache>();
	const provide = (view: EditorView): DecorationSet => {
		const lists = listEnabled(), callouts = calloutEnabled();
		if (!isActive(view) || !lists && !callouts) return Decoration.none;
		const sets = lineClassSources(view);
		const previous = cache.get(view);
		if (matches(previous, sets, lists, callouts)) return previous.decorations;
		const decorations = layoutFor(sets, lists, callouts);
		cache.set(view, { sets, lists, callouts, decorations });
		return decorations;
	};
	layoutProviders.add(provide);
	return Prec.lowest(EditorView.decorations.of(provide));
}
