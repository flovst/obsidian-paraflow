import { MEDIA_TABLE_CSS } from './media-table.js';
import { CODE_BLOCK_CSS } from '../editor/code-blocks/index.js';
import { FOOTNOTE_CSS } from '../editor/footnotes/extension.js';
import { COMMENT_CSS } from '../editor/comments.js';
import { SHORTHAND_CSS } from '../editor/shorthand/extension.js';
import { TABLE_EDITING_CSS } from '../editor/table/editing-css.js';
import { mathEditorStyles } from '../editor/math/styles.js';
import { renderedBlockEditorStyles } from '../editor/rendered-blocks/styles.js';
import { semanticBlockRhythmCss } from '../editor/paragraph/rhythm-css.js';
import { LIST_RHYTHM_CSS } from '../editor/structured-list/rhythm-css.js';
import { READING_TAB_CSS } from '../reading/tabs.js';
import { READING_BLANK_PARAGRAPH_CSS } from '../reading/blank-paragraphs.js';
import { READING_DETAILS_CSS } from '../reading/details.js';
import { SOURCE_VIEW_CSS } from '../editor/source-view.js';
import { CALLOUT_STYLE_CSS } from '../editor/callout/style.js';

export class EnhancementStyles {
	private readonly styles=new Map<Document,HTMLStyleElement>();

	syncDocuments(documents: Iterable<Document>): void {
		const next=new Set(documents);
		for(const [document,style] of this.styles) {
			if(!next.has(document)) {style.remove();this.styles.delete(document);}
		}
		for(const document of next) {
			if(this.styles.has(document))continue;
			// Module-owned CSS follows each window and is removed when it closes or the plugin unloads.
			const style=document.createElement('style');
			style.setAttribute('data-paraflow-enhancements','');
			style.textContent=MEDIA_TABLE_CSS+'\n'+CODE_BLOCK_CSS+'\n'+FOOTNOTE_CSS+'\n'+TABLE_EDITING_CSS+'\n'+COMMENT_CSS+'\n'+SHORTHAND_CSS+'\n'+mathEditorStyles+'\n'+LIST_RHYTHM_CSS+'\n'+semanticBlockRhythmCss('.markdown-source-view.mod-cm6.is-live-preview > .cm-editor:is(.paraflow-paragraph-editing-active,.paraflow-callout-active)');
			style.textContent += '\n' + renderedBlockEditorStyles;
			style.textContent += '\n' + READING_TAB_CSS;
			style.textContent += '\n' + READING_BLANK_PARAGRAPH_CSS;
			style.textContent += '\n' + READING_DETAILS_CSS;
			style.textContent += '\n' + SOURCE_VIEW_CSS;
			style.textContent += '\n' + CALLOUT_STYLE_CSS;
			document.head.append(style);this.styles.set(document,style);
		}
	}

	destroy(): void {this.syncDocuments([]);}
}
