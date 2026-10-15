import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { contentSyntaxTree } from './callout/projection.js';
import type { SyntaxNode } from '@lezer/common';
import { Compartment, EditorSelection, EditorState, Prec, RangeSet, countColumn, findClusterBreak, type Extension } from '@codemirror/state';
import {
	Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, lineNumberMarkers,
	highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';

export interface SourceViewOptions {
	readonly enabled: boolean;
	readonly activeLine: boolean;
	readonly whitespace: boolean;
	readonly indentGuides?: boolean;
	readonly lineNumbers: boolean;
	readonly lineNumberStyle?: 'full' | 'compact';
	readonly lineNumberPosition?: 'editor-left' | 'body-left';
	readonly newlineMarkers: boolean;
	readonly tabSize: number;
}

export interface SourceViewExtensionOptions {
	readonly isSourceView: (view: EditorView) => boolean;
	readonly getOptions: () => SourceViewOptions;
}

const scope = '.markdown-source-view.mod-cm6:not(.is-live-preview) > .cm-editor.paraflow-source-view';
const content = `:is(${scope} > .cm-scroller > .cm-content,${scope} > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content)`;
const gutters = (suffix: string): string => `:is(${scope}${suffix} > .cm-scroller > .cm-gutters,${scope}${suffix} > .cm-scroller > .cm-sizer > .cm-gutters,${scope}${suffix} > .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-gutters)`;
// The fixed-size head and stop are right-aligned; short tab stops clip only the shaft.
const tabSymbol = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='12' viewBox='0 0 48 12'%3E%3Cpath d='M0 5.5H45.5M42 3.5L44 5.5L42 7.5M45.5 3V8' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E";
export const SOURCE_VIEW_CSS = `
${scope} > .cm-scroller { font-family:var(--paraflow-source-font,var(--paraflow-font-family,var(--font-text)))!important; font-size:var(--font-text-size,16px); line-height:var(--paraflow-line-height,1.6); }
${content} > .cm-line {
 min-height:0!important;height:auto!important;margin-block:0!important;padding-block:0!important;
 padding-inline-start:0!important;text-indent:0!important;
}
${content} > .cm-line:is(.HyperMD-header-1,.HyperMD-header-2) { font-family:inherit!important; }
${content} > .cm-line.HyperMD-header-1 { font-size:calc(var(--font-text-size,16px) * 2)!important; }
${content} > .cm-line.HyperMD-header-2 { font-size:calc(var(--font-text-size,16px) * 1.5)!important; }
${content} > .cm-line .cm-header-1,${content} > .cm-line .cm-header-2 { font-size:inherit!important; font-family:inherit!important; }
${content} > .cm-line :is(.cm-hmd-list-indent,.cm-indent,.cm-indent-spacing) { display:inline!important;width:auto!important;min-width:0!important; }
${content.replaceAll('.paraflow-source-view', '.paraflow-source-view.paraflow-source-indent-guides-off')} > .cm-line .cm-indent::before { display:none!important; }
${content} > .cm-line.paraflow-source-quote { color:var(--text-muted); }
${content} > .cm-line.paraflow-source-quote .cm-quote { color:var(--text-muted); }
${content} > .cm-line .cm-formatting { color:var(--paraflow-source-accent,var(--interactive-accent)); }
${content} > .cm-activeLine { background:#f5f5f5; }
.theme-dark ${content} > .cm-activeLine { background:var(--background-secondary); }
${gutters('')} > .cm-gutter > .cm-activeLineGutter { background:#f5f5f5; }
.theme-dark ${gutters('')} > .cm-gutter > .cm-activeLineGutter { background:var(--background-secondary); }
${gutters('.paraflow-source-gutter-body-left')} { transform:translateX(var(--paraflow-source-gutter-shift,0px)); }
/* The native gutter clips child paint at the line-number edge. */
${gutters('.paraflow-source-gutter-body-left')} > .cm-gutter:last-child { overflow:visible; }
${gutters('.paraflow-source-gutter-body-left')} > .cm-gutter:last-child > .cm-activeLineGutter { position:relative; }
${gutters('.paraflow-source-gutter-body-left')} > .cm-gutter:last-child > .cm-activeLineGutter::after { content:'';position:absolute;left:100%;top:0;bottom:0;width:var(--paraflow-source-gutter-gap,0px);background:inherit;pointer-events:none; }
${scope} :is(.cm-highlightSpace,.cm-highlightTab) { background-image:none!important; }
${scope} .cm-highlightSpace { position:relative; }
${scope} .cm-highlightSpace::before { content:'•';position:absolute;left:-.1em;font-family:LetterGothicStd,monospace;font-weight:400;font-style:normal;color:inherit;opacity:.2;pointer-events:none; }
${content} > .cm-line :is(.paraflow-source-space,.paraflow-source-tab,.paraflow-source-nbsp-metric) { font-family:var(--font-monospace,monospace)!important; }
${scope} .paraflow-source-tab { display:inline-block;width:calc(var(--paraflow-source-tab-columns) * 1ch);tab-size:var(--paraflow-source-tab-columns); }
${scope} .cm-highlightTab { position:relative; }
${scope} .cm-highlightTab::before { content:'';position:absolute;inset:0;background-color:currentColor;opacity:.28;mask-image:url("${tabSymbol}");mask-position:calc(100% - .1em) center;mask-repeat:no-repeat;pointer-events:none; }
${scope} .paraflow-source-nbsp { position:relative; }
${scope} .paraflow-source-nbsp::before { content:'⍽';position:absolute;inset-inline:0;color:var(--text-faint);pointer-events:none; }
${scope} .paraflow-source-zwsp { color:var(--paraflow-source-accent,var(--interactive-accent)); }
${gutters('.paraflow-source-line-numbers-off')} > .cm-lineNumbers { display:none!important; }
${content.replaceAll('.paraflow-source-view', '.paraflow-source-view.paraflow-source-active-line-off')} > .cm-activeLine { background:transparent!important; }
${gutters('.paraflow-source-active-line-off')} > .cm-gutter > .cm-activeLineGutter { background:transparent!important; }
${content.replaceAll('.paraflow-source-view', '.paraflow-source-view.paraflow-source-whitespace-off')} > .cm-line > :is(.cm-highlightSpace,.cm-highlightTab) { background-image:none!important; }
${scope} .paraflow-source-newline:not(.paraflow-source-hard-break) { color:var(--text-faint);font-size:inherit!important;pointer-events:none;user-select:none; }
${scope} .paraflow-source-hard-break { position:relative; }
${scope} .paraflow-source-hard-break::before { content:'↓';position:absolute;left:0;font-family:LetterGothicStd,monospace;font-weight:400;font-style:normal;color:inherit;opacity:.3;pointer-events:none; }
`;

class NewlineMarker extends WidgetType {
	eq(): boolean { return true; }
	ignoreEvent(): boolean { return true; }
	toDOM(view: EditorView): HTMLElement {
		const marker = view.dom.ownerDocument.createElement('span');
		marker.className = 'paraflow-source-newline';
		marker.textContent = '↵';
		marker.title = 'Source line break';
		marker.setAttribute('aria-hidden', 'true');
		return marker;
	}
}

const newlineMarker = new NewlineMarker();
const hardBreakMarker = Decoration.mark({ class: 'paraflow-source-newline paraflow-source-hard-break', attributes: { title: 'Source trailing-space break' } });

function hasSourceTrailingBreak(state: EditorState, position: number): boolean {
	const line = state.doc.lineAt(position);
	if (position === state.doc.length || !/\S.* {2}$/u.test(line.text)) return false;
	for (const tree of [contentSyntaxTree(state), syntaxTree(state)]) {
		for (let node: SyntaxNode | null = tree.resolveInner(position - 1, -1); node; node = node.parent) {
			if (/(?:InlineCode|FencedCode|CodeBlock|HTMLBlock|CommentBlock|CalloutNative|(?:^|[ _-])(?:code|math|comment|frontmatter|yaml)(?:$|[ _-]))/iu.test(node.name)) return false;
		}
	}
	return true;
}

const newlineMarkers = (showLineFeeds: boolean): Extension => ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = this.build(view); }
	update(update: ViewUpdate): void {
		if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = this.build(update.view);
	}
	build(view: EditorView): DecorationSet {
		const positions = new Set<number>();
		for (const range of view.visibleRanges) {
			for (let number = view.state.doc.lineAt(range.from).number; number <= view.state.doc.lineAt(range.to).number; number += 1) {
				const line = view.state.doc.line(number);
				if (number < view.state.doc.lines) positions.add(line.to);
			}
		}
		return Decoration.set([...positions].filter(position => showLineFeeds || hasSourceTrailingBreak(view.state, position))
			.map(position => hasSourceTrailingBreak(view.state, position) ? hardBreakMarker.range(position - 1, position)
				: Decoration.widget({ widget: newlineMarker, side: 1 }).range(position)), true);
	}
}, { decorations: plugin => plugin.decorations });

function renderSourceSpecialCharacter(code: number, description: string | null, placeholder: string): HTMLElement {
	const marker = createSpan();
	marker.className = `cm-specialChar${code === 0x200b ? ' paraflow-source-zwsp' : ''}`;
	marker.textContent = code === 0xa0 ? '⍽' : placeholder;
	marker.title = code === 0xa0 ? 'Non-breaking space' : description ?? '';
	marker.setAttribute('aria-label', marker.title);
	return marker;
}

const sourceLeadingWhitespace = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = this.build(view); }
	update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean; viewportChanged: boolean }): void {
		if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = this.build(update.view);
	}
	build(view: EditorView): DecorationSet {
		const rows = new Set(view.state.selection.ranges.map(range => view.state.doc.lineAt(range.head).number));
		return Decoration.set([...rows].flatMap(number => {
			const line = view.state.doc.line(number), leading = /^[ \t\u00a0]*/u.exec(line.text)![0];
			return [...leading].map((character, offset) => Decoration.mark({ class: sourceWhitespaceClass(character) }).range(line.from + offset, line.from + offset + 1));
		}), true);
	}
}, { decorations: plugin => plugin.decorations });

const sourceWhitespaceMetrics = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = this.build(view); }
	update(update: ViewUpdate): void {
		if (update.docChanged || update.viewportChanged || update.startState.tabSize !== update.state.tabSize) this.decorations = this.build(update.view);
	}
	build(view: EditorView): DecorationSet {
		const rows = new Set<number>();
		for (const range of view.visibleRanges) for (let number = view.state.doc.lineAt(range.from).number; number <= view.state.doc.lineAt(range.to).number; number++) rows.add(number);
		const ranges = [...rows].flatMap(number => {
			const line = view.state.doc.line(number);
			return [...line.text.matchAll(/ +|\u00a0+|\t/gu)].map(match => {
				const columns = match[0] === '\t' ? view.state.tabSize - countColumn(line.text, view.state.tabSize, match.index) % view.state.tabSize : 0;
				const mark = columns ? Decoration.mark({ class: 'paraflow-source-tab', attributes: { style: `--paraflow-source-tab-columns:${columns}` } })
					: Decoration.mark({ class: match[0][0] === '\u00a0' ? 'paraflow-source-nbsp-metric' : 'paraflow-source-space' });
				return mark.range(line.from + match.index, line.from + match.index + match[0].length);
			});
		});
		return Decoration.set(ranges, true);
	}
}, { decorations: plugin => plugin.decorations });

function sourceWhitespaceClass(character: string): string {
	return character === '\u00a0' ? 'paraflow-source-nbsp' : character === '\t' ? 'cm-highlightTab' : 'cm-highlightSpace';
}

const sourceLinePresentation = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = this.build(view); this.measure(view); }
	update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean; geometryChanged: boolean }): void {
		if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
		if (update.geometryChanged) this.measure(update.view);
	}
	build(view: EditorView): DecorationSet {
		const rows = new Set<number>();
		for (const range of view.visibleRanges) for (let number = view.state.doc.lineAt(range.from).number; number <= view.state.doc.lineAt(range.to).number; number++) rows.add(number);
		return Decoration.set([...rows].filter(number => /^ {0,3}>/u.test(view.state.doc.line(number).text))
			.map(number => Decoration.line({ class: 'paraflow-source-quote' }).range(view.state.doc.line(number).from)), true);
	}
	measure(view: EditorView): void {
		view.requestMeasure({ key: this, read: () => {
			const gutter = view.dom.querySelector<HTMLElement>('.cm-gutters'), line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
			if (!gutter || !line) return { shift: 0, gap: 0 };
			const lineLeft = line.getBoundingClientRect().left;
			const shift = Math.max(0, lineLeft - view.scrollDOM.getBoundingClientRect().left - gutter.offsetLeft - gutter.offsetWidth - 8);
			const previousShift = view.dom.classList.contains('paraflow-source-gutter-body-left')
				? parseFloat(view.dom.style.getPropertyValue('--paraflow-source-gutter-shift')) || 0 : 0;
			const gutterRight = gutter.lastElementChild!.getBoundingClientRect().right;
			return { shift, gap: Math.max(0, lineLeft - gutterRight + previousShift - shift) };
		}, write: ({ shift, gap }) => {
			view.dom.style.setProperty('--paraflow-source-gutter-shift', `${shift}px`);
			// Extend only the paint across the body-left gutter spacing, preserving hit geometry.
			view.dom.style.setProperty('--paraflow-source-gutter-gap', `${gap}px`);
		} });
	}
}, { decorations: plugin => plugin.decorations });

function sourceBackspace(view: EditorView, options: SourceViewExtensionOptions): boolean {
	if (!sourceKeyboardAllowed(view, options)) return false;
	const state = view.state;
	if (state.selection.ranges.every(range => range.empty && range.head === 0)) return true;
	view.dispatch(state.update(state.changeByRange(range => {
		const line = state.doc.lineAt(range.from);
		const from = !range.empty ? range.from : range.from === line.from ? Math.max(0, range.from - 1)
			: line.from + findClusterBreak(line.text, range.from - line.from, false);
		return { changes: { from, to: range.to }, range: EditorSelection.cursor(from) };
	}), { scrollIntoView: true, userEvent: 'delete.backward', annotations: isolateHistory.of('full') }));
	return true;
}

class CaretLineNumber extends GutterMarker {
	constructor(private readonly number: number) { super(); }
	eq(other: CaretLineNumber): boolean { return this.number === other.number; }
	toDOM(view: EditorView): HTMLElement {
		const element = view.dom.ownerDocument.createElement('span');
		element.textContent = String(this.number); return element;
	}
}

function sourceLineNumbers(options: SourceViewOptions): Extension {
	if (options.lineNumberStyle === 'full') return lineNumbers();
	return [lineNumbers({ formatNumber: number => number % 10 === 0 ? String(number) : '' }),
		lineNumberMarkers.compute(['doc', 'selection'], state => {
			const numbers = new Set(state.selection.ranges.map(range => state.doc.lineAt(range.head).number));
			return RangeSet.of([...numbers].map(number => new CaretLineNumber(number).range(state.doc.line(number).from)), true);
		})];
}

function sourceFeatures(options: SourceViewOptions): Extension {
	return [
		Prec.highest(EditorState.tabSize.of(options.tabSize)),
		options.lineNumbers ? Prec.highest(sourceLineNumbers(options)) : [],
		options.activeLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
		options.whitespace ? sourceLeadingWhitespace : [],
		highlightSpecialChars({
			addSpecialChars: /\u200b/gu, render: renderSourceSpecialCharacter,
		}), sourceLinePresentation,
		sourceWhitespaceMetrics, newlineMarkers(options.newlineMarkers),
	];
}

function sameOptions(left: SourceViewOptions | null, right: SourceViewOptions | null): boolean {
	return left === right || (left !== null && right !== null &&
		left.enabled === right.enabled && left.activeLine === right.activeLine &&
		left.whitespace === right.whitespace && left.lineNumbers === right.lineNumbers &&
		left.indentGuides === right.indentGuides &&
		left.lineNumberStyle === right.lineNumberStyle && left.lineNumberPosition === right.lineNumberPosition &&
		left.newlineMarkers === right.newlineMarkers && left.tabSize === right.tabSize);
}

function sourceKeyboardAllowed(view: EditorView, options: SourceViewExtensionOptions): boolean {
	return options.getOptions().enabled && options.isSourceView(view) && !view.state.readOnly &&
		!view.composing && !view.compositionStarted && !view.dom.closest('.cm-table-widget') &&
		!view.dom.parentElement?.closest('.cm-editor');
}

function sourceWhitespaceEnter(view: EditorView, options: SourceViewExtensionOptions): boolean {
	if (!sourceKeyboardAllowed(view, options) || view.state.selection.ranges.some(range =>
		!range.empty || !/^[ \t]*$/u.test(view.state.doc.lineAt(range.head).text))) return false;
	const state = view.state;
	view.dispatch(state.update(state.changeByRange(range => {
		const line = state.doc.lineAt(range.head);
		const insert = state.toText(state.lineBreak + (range.head === line.to ? line.text : ''));
		return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) };
	}), { scrollIntoView: true, userEvent: 'input', annotations: isolateHistory.of('full') }));
	return true;
}

function sourceKeyboard(options: SourceViewExtensionOptions): Extension {
	return Prec.highest(keymap.of([
		{ key: 'Tab', run: view => {
			if (!sourceKeyboardAllowed(view, options)) return false;
			view.dispatch(view.state.update(view.state.replaceSelection('\t'),
				{ scrollIntoView: true, userEvent: 'input', annotations: isolateHistory.of('full') }));
			return true;
		} },
		{ key: 'Enter', run: view => sourceWhitespaceEnter(view, options) },
		{ key: 'Backspace', run: view => sourceBackspace(view, options) },
	]));
}

export function createSourceViewExtension(options: SourceViewExtensionOptions): Extension {
	const features = new Compartment();
	const currentOptions = (view: EditorView): SourceViewOptions | null => {
		const current = options.getOptions();
		return current.enabled && options.isSourceView(view) ? current : null;
	};
	const lifecycle = ViewPlugin.fromClass(class {
		private applied: SourceViewOptions | null = null;
		private queued = false;
		private destroyed = false;
		constructor(private readonly view: EditorView) { this.refresh(true); }
		update(): void { this.refresh(); }
		destroy(): void { this.destroyed = true; }
		refresh(initial = false): void {
			if (this.queued || (!initial && sameOptions(this.applied, currentOptions(this.view)))) return;
			this.queued = true;
			queueMicrotask(() => {
				this.queued = false;
				if (this.destroyed) return;
				const next = currentOptions(this.view);
				if (sameOptions(this.applied, next)) return;
				this.applied = next ? { ...next } : null;
				this.view.dispatch({ effects: features.reconfigure(next ? sourceFeatures(next) : []) });
			});
		}
	});
	return [features.of([]), lifecycle, sourceKeyboard(options), EditorView.editorAttributes.of(view => {
		const current = currentOptions(view);
		return current ? { class: ['paraflow-source-view',
			!current.lineNumbers ? 'paraflow-source-line-numbers-off' : '',
			!current.activeLine ? 'paraflow-source-active-line-off' : '',
			!current.whitespace ? 'paraflow-source-whitespace-off' : '',
			!current.indentGuides ? 'paraflow-source-indent-guides-off' : '',
			current.lineNumberPosition !== 'editor-left' ? 'paraflow-source-gutter-body-left' : '',
		].filter(Boolean).join(' ') } : null;
	})];
}
