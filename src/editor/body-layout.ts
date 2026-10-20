import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { EnhancementSettings } from '../enhancement-settings.js';
import { discoverParagraphAuthority } from './paragraph/syntax.js';
import { standaloneMediaKind } from './paragraph/media.js';
import { createParagraphEndpointIndex, paragraphGapTags } from './paragraph/model.js';
import { blockBoundarySpacingActive } from './paragraph/boundary-spacing.js';
import { createBodyTabExtension, type BodyTabOptions } from './body-tabs.js';

export type BodyLayoutOptions = Pick<EnhancementSettings, 'paragraphIndent' | 'paragraphSpacingEm'> & Partial<BodyTabOptions>;

export function createBodyLayoutExtension(
	isActive: (view: EditorView) => boolean,
	getOptions: () => BodyLayoutOptions,
): Extension {
	function build(state: EditorState) {
		const options = getOptions();
		const tree = syntaxTree(state);
		const authority = discoverParagraphAuthority(state);
		const decorations: Range<Decoration>[] = [];
		const listBoundaries: Range<Decoration>[] = [];
		if (authority.complete) {
			for (let index = 1; index < authority.blocks.length; index += 1) {
				const before = authority.blocks[index - 1]!;
				const after = authority.blocks[index]!;
				if (before.kind !== 'list-item' || after.kind === 'list-item' || state.sliceDoc(before.to, after.from) !== '\n') continue;
				const followingGap = after.kind === 'paragraph' && options.paragraphSpacingEm !== null
					? `${options.paragraphSpacingEm}em` : 'var(--paraflow-block-gap, .8em)';
				listBoundaries.push(Decoration.line({ class: 'paraflow-list-block-boundary', attributes: {
					style: `padding-block-end:calc(var(--paraflow-list-row-padding, .3em) + max(var(--paraflow-block-gap, .8em), ${followingGap}))!important`,
				} }).range(state.doc.lineAt(before.to).from));
			}
			const paragraphs = authority.paragraphs.filter(p => {
				const source = state.sliceDoc(p.from, p.to);
				return !/^\s*\[\^[^\]]+\]:/u.test(source) && standaloneMediaKind(source) === null;
			});
			for (const paragraph of paragraphs) {
				decorations.push(Decoration.line({class: 'paraflow-body-paragraph' + (options.paragraphIndent ? ' paraflow-body-indent' : '')}).range(state.doc.lineAt(paragraph.from).from));
			}
			if (options.paragraphSpacingEm !== null) {
				const endpoints = createParagraphEndpointIndex(authority.blocks);
				for (const run of authority.runs) {
					const tags = paragraphGapTags(authority.blocks, run, endpoints);
					const spacing=`${options.paragraphSpacingEm}em`;
					for(const row of run.rows.filter(row=>row.kind==='gap-head')) {
						const neighbors = tags(row.at), before = neighbors.before === 'p', after = neighbors.after === 'p';
						if (!before && !after) continue;
						// Override only the ordinary paragraph's side of this gap.
						const height=before && after ? spacing : 'max(0px,calc(max(var(--paraflow-gap-before,var(--paraflow-block-gap,0.8em)),var(--paraflow-gap-after,var(--paraflow-block-gap,0.8em))) - var(--paraflow-occupied-gap,0px)))';
						const style=`${before ? `--paraflow-gap-before:${spacing};` : ''}${after ? `--paraflow-gap-after:${spacing};` : ''}min-height:${height}!important;line-height:${height}!important`;
						decorations.push(Decoration.line({class:'paraflow-body-gap',attributes:{style,'data-paraflow-before':neighbors.before,'data-paraflow-after':neighbors.after}}).range(row.at));
					}
				}
			}
		}
		return {tree, options: {...options}, decorations: Decoration.set(decorations,true), listBoundaries: Decoration.set(listBoundaries,true)};
	}
	const field=StateField.define({create:build,update(value,tr) {
		const next=getOptions();
		return tr.docChanged || tr.reconfigured || value.tree !== syntaxTree(tr.state) ||
			next.paragraphIndent !== value.options.paragraphIndent || next.paragraphSpacingEm !== value.options.paragraphSpacingEm
			? build(tr.state) : value;
	}});
	return [createBodyTabExtension(isActive, () => ({bodyTabMode:getOptions().bodyTabMode ?? 'fixed',bodyTabSize:getOptions().bodyTabSize ?? 8})), field, EditorView.decorations.of(view=>isActive(view) ? view.state.field(field).decorations : Decoration.none),
		// Body layout remains independent; the paragraph module takes boundary ownership when active.
		EditorView.decorations.of(view => isActive(view) && !view.state.facet(blockBoundarySpacingActive)
			? view.state.field(field).listBoundaries : Decoration.none),
		EditorView.editorAttributes.of((view): Record<string, string> => {
			const spacing = view.state.field(field).options.paragraphSpacingEm;
			return isActive(view) && spacing !== null ? { style: `--paraflow-body-paragraph-gap:${spacing}em` } : {};
		}),
		ViewPlugin.define(view=>{
			const initial=isActive(view); let destroyed=false;
			queueMicrotask(()=>{if(!destroyed && initial!==isActive(view))view.dispatch({});});
			return {destroy(){destroyed=true;}};
		})];
}
