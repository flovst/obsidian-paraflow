import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';

const setLineAttributes = StateEffect.define<DecorationSet>();
const lineAttributes = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(setLineAttributes)) return effect.value;
		return value.map(transaction.changes);
	},
	provide: field => EditorView.decorations.from(field),
});

const attribute = 'data-paraflow-list-rhythm';
const item = (element: Element | null): boolean => !!element &&
	element.matches(':is(.HyperMD-list-line,.paraflow-list-owned-line):not(.paraflow-list-owned-blank-line)');
const owned = (element: Element | null): boolean => !!element &&
	element.matches(':is(.paraflow-list-marker-line,.paraflow-list-owned-line)');
const blank = (element: Element | null): boolean => !!element?.classList.contains('paraflow-list-owned-blank-line');
const continuation = (element: Element | null): boolean => !!element &&
	element.classList.contains('paraflow-list-continuation-line');
const structuralClasses = new Set([
	'HyperMD-list-line', 'paraflow-list-owned-line', 'paraflow-list-owned-blank-line',
	'paraflow-list-marker-line', 'paraflow-list-continuation-line', 'paraflow-list-empty-body-line',
	'cm-table-widget',
]);
const structure = (classes: string | null): string => (classes ?? '').split(/\s+/)
	.filter(name => structuralClasses.has(name)).sort().join(' ');
const wrapperSelector = ':is(.cm-indent,.HyperMD-list-line,.cm-formatting-list,li)';

/** Rendered siblings include folds, viewport gaps and block widgets, unlike source lines. */
class RenderedDOMOwnership {
	private readonly observer: MutationObserver;
	private readonly pending = new Set<Element>();
	private readonly wrappers = new Set<Element>();
	private readonly rows = new WeakMap<Element, Record<string, string>>();
	private scheduled = false;
	private destroyed = false;

	constructor(private readonly view: EditorView) {
		this.observer = new view.dom.ownerDocument.defaultView!.MutationObserver(records => this.flush(records));
		this.observer.observe(view.contentDOM, {
			childList: true, subtree: true, attributes: true, attributeOldValue: true,
			attributeFilter: ['class', 'data-paraflow-before'],
		});
		for (const row of view.contentDOM.children) this.pending.add(row);
		for (const wrapper of view.contentDOM.querySelectorAll(wrapperSelector)) this.wrappers.add(wrapper);
		this.flush(undefined, true);
	}

	private nearby(element: Element | null): void {
		if (!element) return;
		this.pending.add(element);
		this.pending.add(element.previousElementSibling ?? element);
		this.pending.add(element.previousElementSibling?.previousElementSibling ?? element);
		this.pending.add(element.nextElementSibling ?? element);
		this.pending.add(element.nextElementSibling?.nextElementSibling ?? element);
	}

	private wrapperAncestors(element: Element): void {
		if (element.closest('.cm-content') !== this.view.contentDOM) return;
		for (let current: Element | null = element; current && current !== this.view.contentDOM; current = current.parentElement) {
			if (current.matches(wrapperSelector)) this.wrappers.add(current);
		}
	}

	flush(records = this.observer.takeRecords(), committed = false): void {
		for (const record of records) {
			this.wrapperAncestors(record.target as Element);
			if (record.type === 'attributes') {
				const target = record.target as Element;
				if (target.parentElement !== this.view.contentDOM) continue;
				this.pending.add(target);
				const current = target.getAttribute(record.attributeName!);
				if (record.attributeName === 'class'
					? structure(record.oldValue) !== structure(current)
					: record.oldValue !== current) this.nearby(target);
			} else {
				if (record.target === this.view.contentDOM) {
					if (record.previousSibling?.nodeType === 1) this.nearby(record.previousSibling as Element);
					if (record.nextSibling?.nodeType === 1) this.nearby(record.nextSibling as Element);
				} else if (record.target.parentElement === this.view.contentDOM) this.pending.add(record.target as Element);
				for (const child of record.addedNodes) if (child.nodeType === 1) {
					const element = child as Element;
					if (element.parentElement === this.view.contentDOM) this.nearby(element);
					if (element.matches(wrapperSelector)) this.wrappers.add(element);
					for (const wrapper of element.querySelectorAll(wrapperSelector)) this.wrappers.add(wrapper);
				}
			}
		}
		let changed = false;
		for (const row of this.pending) {
			if (row.parentElement !== this.view.contentDOM || !row.classList.contains('cm-line')) continue;
			const next = row.nextElementSibling, previous = row.previousElementSibling;
			const previousAttributes = this.rows.get(row);
			// DOM input may still await the host's observer. Only a completed editor
			// update can change an established row's source-owned empty flag.
			const empty = !committed && previousAttributes
				? 'data-paraflow-empty-line' in previousAttributes
				: row.children.length === 1 && row.firstElementChild!.tagName === 'BR';
			const attributes: Record<string, string> = {};
			for (const [name, value] of [
				['data-paraflow-empty-line', empty],
				['data-paraflow-table-carrier', empty && !!next?.classList.contains('cm-table-widget')],
			] as const) if (value) attributes[name] = '';
			const relations = [
				item(row) && continuation(next) ? 'continuation-before' : '',
				row.classList.contains('paraflow-list-continuation-line') && !continuation(next) ? 'continuation-end' : '',
				blank(row) && item(previous) && item(next) ? 'blank-between' : '',
				item(row) && blank(next) && item(next?.nextElementSibling ?? null) ? 'blank-before' : '',
				owned(row) && next?.classList.contains('paraflow-list-continuation-line') ? 'base-continuation-before' : '',
				owned(row) && next?.getAttribute('data-paraflow-before') === 'list-item' ? 'base-gap-before' : '',
				owned(row) && blank(next) && owned(next?.nextElementSibling ?? null) ? 'base-blank-before' : '',
			].filter(Boolean).join(' ');
			if (relations) attributes[attribute] = relations;
			const children = row.matches(wrapperSelector) ? this.rows.get(row)?.['data-paraflow-children'] : undefined;
			if (children) attributes['data-paraflow-children'] = children;
			this.rows.set(row, attributes);
		}
		this.pending.clear();
		for (const wrapper of this.wrappers) {
			if (wrapper.closest('.cm-content') !== this.view.contentDOM) continue;
			const relations = [
				wrapper.classList.contains('cm-indent') && [...wrapper.children].some(child => child.classList.contains('paraflow-body-tab')) ? 'body-tab' : '',
				wrapper.classList.contains('HyperMD-list-line') && wrapper.querySelector('.list-bullet') ? 'native-bullet' : '',
				wrapper.classList.contains('cm-formatting-list') && wrapper.querySelector('.paraflow-list-separator') ? 'list-separator' : '',
				wrapper.tagName === 'LI' && [...wrapper.children].some(child => child.matches('ul,ol')) ? 'nested-list' : '',
			].filter(Boolean).join(' ');
			if (wrapper.parentElement === this.view.contentDOM && wrapper.classList.contains('cm-line')) {
				const attributes = { ...this.rows.get(wrapper) };
				if (relations) attributes['data-paraflow-children'] = relations;
				else delete attributes['data-paraflow-children'];
				this.rows.set(wrapper, attributes);
				continue;
			}
			if ((wrapper.getAttribute('data-paraflow-children') ?? '') !== relations) {
				if (relations) wrapper.setAttribute('data-paraflow-children', relations);
				else wrapper.removeAttribute('data-paraflow-children');
				changed = true;
			}
		}
		this.wrappers.clear();
		this.scheduleLineAttributes();
		if (changed) this.view.requestMeasure();
	}

	private scheduleLineAttributes(): void {
		if (this.scheduled) return;
		this.scheduled = true;
		// Reconcile the committed row attributes after the final DOM update.
		void Promise.resolve().then(() => {
			this.scheduled = false;
			if (this.destroyed) return;
			const ranges: ReturnType<Decoration['range']>[] = [];
			const groups = new Map<number, Element[]>();
			for (const row of this.view.contentDOM.children) {
				if (!row.classList.contains('cm-line')) continue;
				const from = this.view.state.doc.lineAt(this.view.posAtDOM(row, 0)).from;
				const group = groups.get(from) ?? [];
				group.push(row);
				groups.set(from, group);
			}
			const fragments: Element[] = [];
			for (const [from, group] of groups) {
				// A block widget can split one source line into distinct DOM fragments.
				// Line decorations cannot express different attributes on those fragments.
				if (group.length > 1 || this.view.posAtDOM(group[0]!, 0) !== from) {
					fragments.push(...group);
					continue;
				}
				const attributes = this.rows.get(group[0]!);
				if (attributes && Object.keys(attributes).length) ranges.push(Decoration.line({ attributes }).range(from));
			}
			const decorations = Decoration.set(ranges, true);
			if (!RangeSet.eq([this.view.state.field(lineAttributes)], [decorations])) {
				this.view.dispatch({ effects: setLineAttributes.of(decorations) });
			}
			for (const row of fragments) {
				if (row.parentElement !== this.view.contentDOM) continue;
				const attributes = this.rows.get(row) ?? {};
				for (const name of [attribute, 'data-paraflow-empty-line', 'data-paraflow-table-carrier', 'data-paraflow-children']) {
					const value = attributes[name];
					if (row.getAttribute(name) === (value ?? null)) continue;
					if (value === undefined) row.removeAttribute(name);
					else row.setAttribute(name, value);
					this.view.requestMeasure();
				}
			}
		});
	}

	destroy(): void {
		this.destroyed = true;
		this.observer.disconnect();
		for (const row of this.view.contentDOM.children) {
			if (!this.rows.has(row)) continue;
			for (const name of [attribute, 'data-paraflow-empty-line', 'data-paraflow-table-carrier', 'data-paraflow-children']) row.removeAttribute(name);
		}
		for (const node of this.view.contentDOM.querySelectorAll('[data-paraflow-children]')) {
			if (node.closest('.cm-content') !== this.view.contentDOM || node.parentElement === this.view.contentDOM) continue;
			node.removeAttribute('data-paraflow-children');
		}
		this.pending.clear();
		this.wrappers.clear();
	}
}

const owner = ViewPlugin.fromClass(RenderedDOMOwnership);

/** updateListener runs after CodeMirror has applied its DOM decorations. */
export const renderedDOMOwnership: Extension = [lineAttributes, owner, EditorView.updateListener.of(update => {
	update.view.plugin(owner)!.flush(undefined, update.transactions.length > 0);
})];
