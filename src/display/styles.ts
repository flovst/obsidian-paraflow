import { MEDIA_TABLE_LAYOUT_CSS } from './media-table-css.js';
import { BLOCK_SOURCE_RESET_CSS } from '../editor/block-source-reset-css.js';
import { codeBlockLayoutStyles } from '../editor/code-blocks/styles.js';
import { FOOTNOTE_CSS } from '../editor/footnotes/styles.js';
import { COMMENT_CSS } from '../editor/comments-css.js';
import { SHORTHAND_CSS } from '../editor/shorthand/styles.js';
import { TABLE_EDITING_CSS } from '../editor/table/editing-css.js';
import { mathLayoutStyles } from '../editor/math/styles.js';
import { renderedBlockLayoutStyles } from '../editor/rendered-blocks/styles.js';
import { semanticBlockRhythmCss } from '../editor/paragraph/rhythm-css.js';
import { LIST_RHYTHM_CSS } from '../editor/structured-list/rhythm-css.js';
import { LIST_LAYOUT_CSS } from '../editor/structured-list/layout-css.js';
import { READING_TAB_CSS } from '../reading/tabs-css.js';
import { READING_BLANK_PARAGRAPH_CSS } from '../reading/blank-paragraphs-css.js';
import { READING_DETAILS_CSS } from '../reading/details-css.js';
import { SOURCE_VIEW_LAYOUT_CSS } from '../editor/source-view-css.js';
import { CALLOUT_STYLE_CSS } from '../editor/callout/style.js';
import { INLINE_PROJECTION_CSS } from '../editor/paragraph/inline-styles.js';

/** Build-time stylesheet order follows the editor/display cascade. */
export const enhancementCss = [
 LIST_LAYOUT_CSS, INLINE_PROJECTION_CSS, MEDIA_TABLE_LAYOUT_CSS, BLOCK_SOURCE_RESET_CSS, codeBlockLayoutStyles, FOOTNOTE_CSS, TABLE_EDITING_CSS, COMMENT_CSS, SHORTHAND_CSS,
 mathLayoutStyles, LIST_RHYTHM_CSS,
 semanticBlockRhythmCss('.markdown-source-view.mod-cm6.is-live-preview > .cm-editor:is(.paraflow-paragraph-editing-active,.paraflow-callout-active)'),
 renderedBlockLayoutStyles, READING_TAB_CSS, READING_BLANK_PARAGRAPH_CSS, READING_DETAILS_CSS, SOURCE_VIEW_LAYOUT_CSS, CALLOUT_STYLE_CSS,
].join('\n');
