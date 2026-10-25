import { createCreationHistory } from '../runtime/creation-history.js';
import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { classifyCurrentSelectionMode, compositionStateField, selectionModeAnnotation } from '../runtime/input-state.js';
import { planCalloutInput, planCalloutKey, planContainerStartEnter, planEmptyCalloutBackspace, type CalloutKey } from './editing.js';
import { calloutHeaderStart, isCalloutMetadataEditing } from './presentation.js';
import { planCalloutClipboard } from './selection.js';
import { projectCallout, projectQuoteContent, quoteContentReuse } from './projection.js';
import { quoteContainers } from './presentation-model.js';
import { enumerateListItems } from '../structured-list/syntax.js';
import { mathCandidatesActive } from '../math/candidate-ranges.js';
import { mathDraftRanges } from '../math/native-ownership.js';
import { deleteAdjacentMath } from '../math/operations.js';
import { deleteAdjacentCode } from '../code-blocks/operations.js';
import { discoverCodeBlocks } from '../code-blocks/model.js';
import { codeDraft } from '../code-blocks/draft-state.js';
import { discoverSetextHeadings } from '../paragraph/setext.js';
import { discoverAtxHeadings, discoverParagraphAuthority } from '../paragraph/syntax.js';
import { moveAcrossCalloutGap } from './gaps.js';
import { requireGoalXStore } from '../runtime/navigation-core.js';
import { insertBodyTab } from '../body-tabs.js';
import { bodyTabDelimiterOffset } from '../literal-tab.js';

export interface CalloutEditingOptions {
	readonly headingEditing?: (view: EditorView) => boolean;
	readonly listEditing?: (view: EditorView) => boolean;
	readonly paragraphEditing?: (view: EditorView) => boolean;
}

export function createCalloutExtension(isActive: (view: EditorView) => boolean, options: CalloutEditingOptions = {}): Extension {
	function bodyHome(view: EditorView, extend: boolean): boolean {
		if (!isActive(view) || !(options.paragraphEditing?.(view) ?? true) || view.composing ||
			view.state.field(compositionStateField, false) || view.state.selection.ranges.length !== 1 ||
			!['caret', 'continuous', 'unknown'].includes(classifyCurrentSelectionMode(view.state))) return false;
		const range = view.state.selection.main;
		const card = quoteContainers(view.state).filter(card => card.from <= range.head && range.head <= card.to).sort((a,b) => b.depth-a.depth)[0];
		if (!card) return false;
		const projection = projectQuoteContent(view.state, card.kind==='callout' ? card.headerTo+1 : card.from, card.to, card.depth);
		if (!projection) return false;
		const mapped = projection.lines.find(line => line.from+line.prefix.length <= range.head && range.head <= line.from+line.prefix.length+line.text.length);
		if (!mapped) return false;
		const position = mapped.virtualFrom+range.head-mapped.from-mapped.prefix.length;
		const line = projection.state.doc.lineAt(position);
		const paragraph = discoverParagraphAuthority(projection.state).paragraphs.find(block => block.from <= position && position <= block.to);
		// Indented source still shares the container's hidden quote prefix.
		const indented = !paragraph && discoverCodeBlocks(projection.state).some(block => block.indented && block.from <= line.to && line.from <= block.to);
		if (!paragraph && !indented) return false;
		const body = projection.toSource(line.from + (bodyTabDelimiterOffset(line.text)===0 ? 1 : 0));
		const head = Math.max(body, view.moveToLineBoundary(range, false, true).head);
		view.dispatch({selection: extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head, 1),
			userEvent: 'select', scrollIntoView: true});
		requireGoalXStore(view).write(null);
		return true;
	}
	function eligible(view: EditorView): boolean {
		if (!isActive(view) || view.composing) return false;
		const mode = classifyCurrentSelectionMode(view.state);
		if (mode !== 'caret' && mode !== 'continuous') return false;
		const projection = projectCallout(view.state);
		if (!projection) return false;
		const selection = projection.state.selection.main;
		const list = enumerateListItems(projection.state).some(item => item.itemNode.from <= selection.to && item.itemNode.to >= selection.from);
		const heading = [...discoverSetextHeadings(projection.state), ...discoverAtxHeadings(projection.state)].some(item => item.from <= selection.head && selection.head <= item.to);
		return (list ? options.listEditing?.(view) : heading ? options.headingEditing?.(view) : options.paragraphEditing?.(view)) ?? true;
	}
	function run(view: EditorView, key: CalloutKey): boolean {
		if (key === 'Enter' && isActive(view) && !view.composing && !view.state.field(compositionStateField, false) &&
			classifyCurrentSelectionMode(view.state) === 'caret' && (options.paragraphEditing?.(view) ?? true) &&
			!isCalloutMetadataEditing(view.state, view.state.doc.lineAt(view.state.selection.main.head).from)) {
			const start = planContainerStartEnter(view.state);
			if (start) { view.dispatch(start, {annotations:selectionModeAnnotation.of('normal')}); return true; }
		}
		if (key === 'Backspace' && isActive(view) && !view.composing && !view.state.field(compositionStateField, false) &&
			classifyCurrentSelectionMode(view.state) === 'caret' && (options.paragraphEditing?.(view) ?? true)) {
			const empty = planEmptyCalloutBackspace(view.state);
			if (empty) { view.dispatch(empty, {annotations:selectionModeAnnotation.of('normal')}); return true; }
		}
		if ((key === 'Backspace' || key === 'Delete') && isActive(view) && deleteAdjacentCode(view, key === 'Delete')) return true;
		if ((key === 'Backspace' || key === 'Delete') && isActive(view) && view.state.facet(mathCandidatesActive) &&
			deleteAdjacentMath(view, key === 'Delete', () => true)) return true;
		if (!eligible(view)) return false;
		if (key === 'Enter' && view.state.selection.main.empty && view.state.facet(codeDraft)?.to === view.state.selection.main.head) return false;
		if (key === 'Tab' && (options.paragraphEditing?.(view) ?? true) && insertBodyTab(view)) return true;
		if (key === 'Enter' && view.state.facet(mathCandidatesActive) && view.state.selection.ranges.length === 1 &&
			view.state.selection.main.empty && mathDraftRanges(view.state).some(range => range.to === view.state.selection.main.head && range.to - range.from === 2)) return false;
		const plan = !view.state.selection.main.empty && (key === 'Backspace' || key === 'Delete')
			? planCalloutClipboard(view.state, 'cut')?.transaction
			: planCalloutKey(view.state, key, options.headingEditing?.(view) ?? true);
		if (!plan) return false;
		view.dispatch(plan, { annotations: selectionModeAnnotation.of('normal') });
		return true;
	}
	function clipboard(event: ClipboardEvent, view: EditorView, action: 'copy' | 'cut'): boolean {
		if (!eligible(view) || !event.clipboardData) return false;
		const plan = planCalloutClipboard(view.state, action);
		if (!plan) return false;
		event.clipboardData.setData('text/plain', plan.text);
		if (plan.transaction) view.dispatch(plan.transaction, { annotations: selectionModeAnnotation.of('normal') });
		return true;
	}
	const keys: readonly CalloutKey[] = ['Enter', 'Shift-Enter', 'Tab', 'Shift-Tab', 'Backspace', 'Delete'];
	return [quoteContentReuse, createCreationHistory('container', (_state, view) => isActive(view) && (options.paragraphEditing?.(view) ?? true)),
		Prec.highest(keymap.of([
			{key:'Home',run:view=>bodyHome(view,false),shift:view=>bodyHome(view,true)},
			{key:'ArrowDown',run:view=>isActive(view) && moveAcrossCalloutGap(view,true)},
			{key:'ArrowUp',run:view=>isActive(view) && moveAcrossCalloutGap(view,false)},
			...(['Home','ArrowLeft'] as const).map(key=>({key,run:(view:EditorView)=>{
			if (!isActive(view) || view.composing || view.state.field(compositionStateField, false) || classifyCurrentSelectionMode(view.state) !== 'caret') return false;
			const start = calloutHeaderStart(view.state,key==='ArrowLeft');
			if (start === null) return false;
			view.dispatch({selection:{anchor:start},userEvent:key==='Home'?'move.line':'move.character'}); return true;
		}})), ...keys.map((key) => ({ key, run: (view: EditorView) => run(view, key) }))])),
		EditorView.inputHandler.of((view, from, to, text) => {
			if (!eligible(view)) return false;
			const plan = planCalloutInput(view.state, from, to, text);
			if (!plan) return false;
			view.dispatch(plan, { annotations: selectionModeAnnotation.of('normal') });
			return true;
		}),
		EditorView.domEventHandlers({ copy: (event, view) => clipboard(event, view, 'copy'),
			cut: (event, view) => clipboard(event, view, 'cut') })];
}
