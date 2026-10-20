import type { EnhancementSettings } from '../enhancement-settings.js';
import { MediaTableDisplayController } from '../display/media-table.js';
import { createCodeBlockDisplay } from '../display/code-blocks.js';
import { normalizeReadingFootnoteLabels } from '../editor/footnotes/reading.js';
import { enhanceReadingShorthand } from '../editor/shorthand/reading.js';
import { enhanceReadingQuotes } from '../editor/callout/reading.js';
import { createReadingTabDisplay } from './tabs.js';
import { createReadingLineBreakDisplay } from './line-breaks.js';
import { enhanceReadingMermaid } from './mermaid.js';
import { createReadingSectionRhythm, type ReadingSectionSource } from './section-rhythm.js';

export interface ReadingEnhancements {
	register(root: HTMLElement, getSource?: () => string | null, getSectionSource?: () => string | null, getSection?: () => ReadingSectionSource | null): () => void;
	refresh(): void;
	destroy(): void;
}

const PARAGRAPH_WRAPPER = 'div.el-p, div.markdown-preview-section, div.markdown-preview-sizer, div.markdown-rendered';

/** The section adapter replaces native children with independently rendered owners. */
function delegatesToNestedRenderer(root:HTMLElement):boolean {
	return root.childNodes.length>0&&[...root.childNodes].every(node=>node.nodeType===1&&
		(node as Element).classList.contains('paraflow-reading-math-section'));
}

function isTopLevelParagraph(paragraph: HTMLElement, root: HTMLElement): boolean {
	if (paragraph === root) return true;
	for (let parent = paragraph.parentElement; parent; parent = parent.parentElement) {
		if (!parent.matches(PARAGRAPH_WRAPPER)) return false;
		if (parent === root) return true;
	}
	return false;
}

export function createReadingEnhancements(getSettings: () => Readonly<EnhancementSettings>): ReadingEnhancements {
	const displayTabs = createReadingTabDisplay();
	const displayLineBreaks = createReadingLineBreakDisplay();
	const roots = new Map<HTMLElement, { refresh(): void; destroy(): void }>();
	const sectionRhythm = createReadingSectionRhythm();
	function apply(root: HTMLElement, getSource: () => string | null, getSectionSource: () => string | null, getSection: () => ReadingSectionSource | null): () => void {
		const sourceSection = getSection();
		const releaseRhythm = sectionRhythm(root, sourceSection);
		if (delegatesToNestedRenderer(root) && sourceSection === null) return releaseRhythm;
		const settings = getSettings();
		const restore: Array<() => void> = [releaseRhythm];
		if (settings.bodyLayout && settings.paragraphSpacingEm !== null && root.hasAttribute('data-paraflow-reading-before')) {
			style(root, '--paraflow-body-paragraph-gap', `${settings.paragraphSpacingEm}em`);
		}
		if(delegatesToNestedRenderer(root))return () => { for (const undo of restore.reverse()) undo(); };
		if (settings.bodyLayout) restore.push(displayLineBreaks(root, getSectionSource()));
		if (settings.callout) restore.push(enhanceReadingQuotes(root));
		if (settings.mermaid) restore.push(enhanceReadingMermaid(root));
		if (settings.inline && (settings.subscript || settings.superscript)) restore.push(enhanceReadingShorthand(root, settings, getSectionSource()));
		const media=new MediaTableDisplayController(root, true);
		media.update({ ...settings, tableDisplay: settings.table && settings.tableDisplay, tableEditing: settings.table && settings.tableEditing });restore.push(()=>media.destroy());
		if(settings.code)restore.push(createCodeBlockDisplay(root,settings));
		if(settings.footnotes)restore.push(normalizeReadingFootnoteLabels(root,
			root.matches('.footnotes') || root.querySelector('.footnotes') ? getSource() : null));
		function style(element: HTMLElement, property: string, value: string): void {
			const previous = element.style.getPropertyValue(property);
			const priority = element.style.getPropertyPriority(property);
			element.style.setProperty(property, value, 'important');
			restore.push(() => {
				if (element.style.getPropertyValue(property) !== value) return;
				if (previous) element.style.setProperty(property, previous, priority);
				else element.style.removeProperty(property);
			});
		}
		if (settings.bodyLayout) {
			restore.push(displayTabs(root, settings));
			for (const paragraph of [...(root.matches('p') ? [root] : []), ...root.querySelectorAll<HTMLElement>('p')]) {
				if (!isTopLevelParagraph(paragraph, root) ||
					paragraph.closest('li, blockquote, .callout, td, th, .footnotes, .footnote, .markdown-embed, details') ||
					(!paragraph.textContent?.trim() && paragraph.querySelector('img, .image-embed'))) continue;
				if (settings.paragraphIndent) style(paragraph, 'text-indent', '2em');
				if (settings.paragraphSpacingEm !== null) {
					const spacing = `${settings.paragraphSpacingEm}em`;
					const section = paragraph.parentElement;
					if (!section?.hasAttribute('data-paraflow-reading-before')) style(paragraph, 'margin-block', spacing);
				}
			}
		}
		return () => { for (const undo of restore.reverse()) undo(); };
	}
	return {
		register(root, getSource = () => null, getSectionSource = getSource, getSection = () => null) {
			roots.get(root)?.destroy();
			const ownerWindow = root.ownerDocument.defaultView!;
			let undo = () => {};
			let pendingRefresh: object | null = null;
			let destroyed = false;
			const observer = new ownerWindow.MutationObserver(records => {
				if (!records.some(record => record.type !== 'attributes' || ((record.target as Element).matches('.callout') &&
					(record.oldValue ?? '').split(/\s+/u).includes('is-collapsed') !== (record.target as Element).classList.contains('is-collapsed')))) return;
				if (pendingRefresh !== null) return;
				const token = pendingRefresh = {};
				// Native PDF rendering uses a hidden window whose animation frames may never run.
				ownerWindow.queueMicrotask(() => {
					if (pendingRefresh !== token) return;
					pendingRefresh = null;
					registration.refresh();
				});
			});
			const registration = {
				refresh() {
					if (destroyed) return;
					pendingRefresh = null;
					// Cleanup and enhancement writes must not schedule another refresh.
					observer.disconnect();
					undo();
					undo = apply(root, getSource, getSectionSource, getSection);
					observer.observe(root, { childList: true, subtree: !delegatesToNestedRenderer(root), characterData: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
				},
				destroy() {
					if (destroyed) return;
					destroyed = true;
					pendingRefresh = null;
					observer.disconnect();
					undo();
				},
			};
			roots.set(root, registration);
			registration.refresh();
			return () => {
				if (roots.get(root) !== registration) return;
				registration.destroy();
				roots.delete(root);
			};
		},
		refresh() { for (const registration of roots.values()) registration.refresh(); },
		destroy() { for (const registration of roots.values()) registration.destroy(); roots.clear(); },
	};
}
