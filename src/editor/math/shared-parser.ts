import { Language, language, ParseContext } from '@codemirror/language';
import { Compartment, Prec, type Extension, type Range } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { Parser, TreeFragment, type Input, type PartialParse, type Tree } from '@lezer/common';
import { mathCandidatesActive, pendingMath, type PendingMathRange } from './candidate-ranges.js';
import { maskMathSource } from './source-mask.js';
import { baseMathLanguage, mathParserMasks, acceptedParserMath, projectMathTree } from './semantic-tree.js';
import { codeParserSource, maskCodeSource, type CodeParserSource } from '../code-blocks/parser-source.js';
import { quoteDraftMasks, maskQuoteDraftSource } from '../callout/quote-draft.js';
import { acceptedMath, discoverMath, type MathExpression } from './syntax.js';

function sameMasks(left: readonly PendingMathRange[], right: readonly PendingMathRange[]): boolean {
	return left.length === right.length && left.every((range, index) => range.from === right[index]!.from && range.to === right[index]!.to);
}

/** Obsidian's custom highlighter need not recognize standard Lezer math tags. */
function sourceMathStyles(view: EditorView): DecorationSet {
	if (view.state.facet(mathCandidatesActive)) return Decoration.none;
	const marks: Range<Decoration>[] = [];
	for (const math of discoverMath(view.state)) {
		marks.push(Decoration.mark({ class: 'cm-math paraflow-owned-math-source' }).range(math.from, math.to));
		for (const [from, to] of [[math.from, math.contentFrom], [math.contentTo, math.to]] as const)
			marks.push(Decoration.mark({ class: 'cm-formatting cm-formatting-math' }).range(from, to));
	}
	return Decoration.set(marks, true);
}

/** Native syntax highlighting and block consumers share the accepted delimiter input. */
function sharedParser(): Extension {
	const compartment = new Compartment();
	const sourceStyles = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = sourceMathStyles(view); }
		update(update: ViewUpdate): void {
			if (update.docChanged || update.startState.facet(mathCandidatesActive) !== update.state.facet(mathCandidatesActive)) this.decorations = sourceMathStyles(update.view);
		}
	}, { decorations: value => value.decorations });
	const plugin = ViewPlugin.fromClass(class {
		private disposed = false;
		constructor(readonly view: EditorView) {
			// CM finishes constructing all native plugins before it accepts configuration dispatches.
			queueMicrotask(() => { if (!this.disposed) this.install(); });
		}
		private install(): void {
			const native = this.view.state.facet(language);
			if (!native) return;
			let previous: { masks: readonly PendingMathRange[]; expressions: readonly MathExpression[]; code: CodeParserSource; quotes: readonly PendingMathRange[]; language: Language } | null = null;
			this.view.dispatch({ effects: compartment.reconfigure([
				baseMathLanguage.of(native),
				Prec.highest(language.computeN(['doc', pendingMath, acceptedMath, mathCandidatesActive, codeParserSource, quoteDraftMasks], state => {
					// Only draft acceptance differs between editor modes; dollar grammar is shared.
					const pending = state.facet(mathCandidatesActive) ? state.facet(pendingMath) : [];
					const expressions = acceptedParserMath(state, pending), masks = mathParserMasks(state, pending, expressions), code = state.facet(codeParserSource), quotes = state.facet(quoteDraftMasks);
					if (previous && sameMasks(previous.quotes, quotes) && sameMasks(previous.code.masks, code.masks) && sameMasks(previous.code.opaque, code.opaque) && sameMasks(previous.masks, masks) && sameMasks(previous.expressions, expressions) &&
						previous.expressions.every((math, index) => math.display === expressions[index]!.display)) return [previous.language];
					const parser = new class extends Parser {
						private readonly nativeTrees = new WeakMap<Tree, Tree>();
						createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]) {
							const source = maskQuoteDraftSource(maskCodeSource(maskMathSource(input.read(0, input.length), masks), code.masks), quotes);
							const nativeTrees = this.nativeTrees;
							const nativeFragments = fragments.flatMap(fragment => {
								const tree = nativeTrees.get(fragment.tree);
								return tree ? [new TreeFragment(fragment.from, fragment.to, tree, fragment.offset, fragment.openStart, fragment.openEnd)] : [];
							});
							const context = ParseContext.get(), viewport = context?.viewport;
							let parsing: PartialParse;
							try {
								// A far viewport must not restart stream state inside a fence. Keep
								// saved context at construction; advance retains normal viewport/time limits.
								if (context && viewport) context.viewport = { from: Math.min(viewport.from, ranges[0]!.from), to: viewport.to };
								parsing = native.parser.startParse({ length: input.length, lineChunks: false,
									chunk: pos => source.slice(pos), read: (start, end) => source.slice(start, end) }, nativeFragments, ranges);
							} finally {
								if (context && viewport) context.viewport = viewport;
							}
							return {
								advance() {
									const tree = parsing.advance();
									if (!tree) return null;
									const projected = projectMathTree(tree, expressions.filter(math => math.to <= tree.length), code.opaque.filter(range => range.to <= tree.length));
									nativeTrees.set(projected, tree);
									return projected;
								},
								get parsedPos() { return parsing.parsedPos; },
								get stoppedAt() { return parsing.stoppedAt; },
								stopAt(pos: number) { parsing.stopAt(pos); },
							};
						}
					}();
					const adapted = new class extends Language { get allowsNesting(): boolean { return native.allowsNesting; } }(native.data, parser, [], native.name);
					previous = { masks, expressions, code, quotes, language: adapted };
					return [adapted];
				})),
			]) });
		}
		destroy(): void { this.disposed = true; }
	});
	return [compartment.of([]), plugin, sourceStyles];
}


// Both independently enabled features install the same compartment and view plugin.
const shared = sharedParser();
export function createSharedMathParser(): Extension { return shared; }
