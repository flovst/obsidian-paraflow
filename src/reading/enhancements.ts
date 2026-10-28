import type { EnhancementSettings } from '../enhancement-settings.js';
import { projectReadingListClasses } from './list-classes.js';
import { MediaTableDisplayController } from '../display/media-table.js';
import { createCodeBlockDisplay } from '../display/code-blocks.js';
import { normalizeReadingFootnoteLabels } from '../editor/footnotes/reading.js';
import { enhanceReadingShorthand } from '../editor/shorthand/reading.js';
import { enhanceReadingQuotes } from '../editor/callout/reading.js';
import { createReadingTabDisplay } from './tabs.js';
import { createReadingLineBreakDisplay } from './line-breaks.js';
import { enhanceReadingMermaid } from './mermaid.js';
import type { MermaidThemeRenderer } from '../display/mermaid-theme.js';
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
		(node as Element).matches('.paraflow-reading-math-section,.paraflow-reading-blank-paragraphs'));
}

function isTopLevelParagraph(paragraph: HTMLElement, root: HTMLElement): boolean {
	if (paragraph === root) return true;
	for (let parent = paragraph.parentElement; parent; parent = parent.parentElement) {
		if (!parent.matches(PARAGRAPH_WRAPPER)) return false;
		if (parent === root) return true;
	}
	return false;
}

export function createReadingEnhancements(getSettings: () => Readonly<EnhancementSettings>, renderMermaid?: MermaidThemeRenderer): ReadingEnhancements {
	const displayTabs = createReadingTabDisplay();
	const displayLineBreaks = createReadingLineBreakDisplay();
	const roots = new Map<HTMLElement, { hasSource: boolean; clear(): void; render(): void; refresh(): void; destroy(): void; pause(): void; observe(): void }>();
	let writing = false;
	// Preserve pending native changes while isolating synchronous enhancement writes.
	function withWrites(root: HTMLElement, write: () => void): void {
		if (writing) { write(); return; }
		const overlapping = [...roots].filter(([element]) => element.contains(root) || root.contains(element)).map(([, registration]) => registration);
		for (const registration of overlapping) registration.pause();
		writing = true;
		try { write(); } finally { writing = false; for (const registration of overlapping) registration.observe(); }
	}
	function owns(root: HTMLElement, element: Element): boolean {
		let nearest: Element | null = null;
		for (let current: Element | null = element; current; current = current.parentElement) {
			const registration = roots.get(current as HTMLElement);
			if (!registration || delegatesToNestedRenderer(current as HTMLElement)) continue;
			nearest ??= current;
			// Rendered container bodies supply source missing from native child postprocessors.
			if (registration.hasSource) return current === root;
		}
		return nearest === root;
	}
	function rebuild(root: HTMLElement, remove = false): void {
		const overlapping = [...roots].filter(([element]) => element.contains(root) || root.contains(element));
		withWrites(root, () => {
			for (const [, registration] of overlapping) registration.clear();
			if (remove) { roots.get(root)!.destroy(); roots.delete(root); }
			for (const [element, registration] of overlapping) if (roots.get(element) === registration) registration.render();
		});
	}
	const sectionRhythm = createReadingSectionRhythm();
	function apply(root: HTMLElement, getSource: () => string | null, getSectionSource: () => string | null, getSection: () => ReadingSectionSource | null): () => void {
		const ownsElement = (element: Element) => owns(root, element);
		const sourceSection = getSection();
		if (delegatesToNestedRenderer(root) && sourceSection === null) return () => {};
		const settings = getSettings();
		const releaseRhythm = sectionRhythm(root, sourceSection);
		const restore: Array<() => void> = [releaseRhythm];
		if (settings.bodyLayout && settings.paragraphSpacingEm !== null && root.hasAttribute('data-paraflow-reading-before')) {
			style(root, '--paraflow-body-paragraph-gap', `${settings.paragraphSpacingEm}em`);
		}
		if(delegatesToNestedRenderer(root)) {
			if (settings.bodyLayout && settings.readingBlankParagraphs) restore.push(sectionRhythm(root, sourceSection, true));
			return () => { for (const undo of restore.reverse()) undo(); };
		}
		restore.push(projectReadingListClasses(root, ownsElement));
		if (settings.bodyLayout) restore.push(displayLineBreaks(root, getSectionSource(), ownsElement));
		if (settings.callout) restore.push(enhanceReadingQuotes(root, settings.calloutStyle, ownsElement));
		if (settings.mermaid) restore.push(enhanceReadingMermaid(root, getSectionSource(), renderMermaid, ownsElement));
		if (settings.inline && (settings.subscript || settings.superscript)) restore.push(enhanceReadingShorthand(root, settings, getSectionSource(), ownsElement));
		const media=new MediaTableDisplayController(root, true, ownsElement);
		media.update({ ...settings, tableDisplay: settings.table && settings.tableDisplay, tableEditing: settings.table && settings.tableEditing });restore.push(()=>media.destroy());
		if(settings.code)restore.push(createCodeBlockDisplay(root,settings,ownsElement));
		if(settings.footnotes)restore.push(normalizeReadingFootnoteLabels(root,
			root.matches('.footnotes') || root.querySelector('.footnotes') ? getSource() : null, ownsElement));
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
			restore.push(displayTabs(root, settings, ownsElement));
			for (const paragraph of [...(root.matches('p') ? [root] : []), ...root.querySelectorAll<HTMLElement>('p')]) {
				if (!ownsElement(paragraph) || !isTopLevelParagraph(paragraph, root) ||
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
		// Project gaps after code/table display has established the final block owners.
		if (settings.bodyLayout && settings.readingBlankParagraphs) restore.push(sectionRhythm(root, sourceSection, true));
		return () => { for (const undo of restore.reverse()) undo(); };
	}
	return {
		register(root, getSource = () => null, getSectionSource = getSource, getSection = () => null) {
			roots.get(root)?.destroy();
			const ownerWindow = root.ownerDocument.defaultView!;
			let undo = () => {};
			let pendingRefresh: object | null = null;
			let destroyed = false;
			const changed = (records: MutationRecord[]) => {
				if (!records.some(record => record.type === 'attributes'
					? ((record.target as Element).matches('li') || (record.target as Element).parentElement?.matches('li') ||
						(record.target as Element).matches('.callout') &&
						(record.oldValue ?? '').split(/\s+/u).includes('is-collapsed') !== (record.target as Element).classList.contains('is-collapsed'))
					: owns(root, record.target.nodeType === 1 ? record.target as Element : record.target.parentElement!))) return;
				if (pendingRefresh !== null) return;
				const token = pendingRefresh = {};
				// Native PDF rendering uses a hidden window whose animation frames may never run.
				ownerWindow.queueMicrotask(() => {
					if (pendingRefresh !== token) return;
					pendingRefresh = null;
					registration.refresh();
				});
			};
			const observer = new ownerWindow.MutationObserver(changed);
			const registration = {
				hasSource: getSectionSource() !== null,
				clear() { pendingRefresh = null; undo(); undo = () => {}; },
				render() { undo = apply(root, getSource, getSectionSource, getSection); },
				pause() { changed(observer.takeRecords()); observer.disconnect(); },
				observe() {
					if (!destroyed) observer.observe(root, { childList: true, subtree: !delegatesToNestedRenderer(root), characterData: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
				},
				refresh() {
					if (destroyed) return;
					const hasSource = getSectionSource() !== null;
					if (registration.hasSource !== hasSource) { registration.hasSource = hasSource; rebuild(root); }
					else withWrites(root, () => { registration.clear(); registration.render(); });
				},
				destroy() {
					if (destroyed) return;
					destroyed = true;
					pendingRefresh = null;
					observer.disconnect();
					withWrites(root, () => undo());
				},
			};
			roots.set(root, registration);
			if (delegatesToNestedRenderer(root)) registration.refresh();
			else rebuild(root);
			return () => {
				if (roots.get(root) !== registration) return;
				if (delegatesToNestedRenderer(root)) { registration.destroy(); roots.delete(root); }
				else rebuild(root, true);
			};
		},
		refresh() { for (const registration of roots.values()) registration.refresh(); },
		destroy() { for (const registration of roots.values()) registration.destroy(); roots.clear(); },
	};
}
