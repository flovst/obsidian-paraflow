import type { EnhancementSettings } from '../enhancement-settings.js';
import { MediaTableDisplayController } from '../display/media-table.js';
import { createCodeBlockDisplay } from '../display/code-blocks.js';
import { normalizeReadingFootnoteLabels } from '../editor/footnotes/reading.js';
import { enhanceReadingShorthand } from '../editor/shorthand/reading.js';
import { enhanceReadingQuotes } from '../editor/callout/reading.js';
import { createReadingTabDisplay } from './tabs.js';

export interface ReadingEnhancements {
	register(root: HTMLElement, getSource?: () => string | null, getSectionSource?: () => string | null): () => void;
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
	const roots = new Map<HTMLElement, { refresh(): void; destroy(): void }>();
	const gapStyles = new Map<HTMLElement, Map<string, { owners: number; previous: string; priority: string; value: string }>>();
	const paragraphEdges = new Map<Element, Set<() => void>>();
	const incomingEdges = new Map<Element, Set<() => void>>();
	function rebindEdge(section: Element | null): void {
		if (section) for (const rebind of paragraphEdges.get(section) ?? []) rebind();
	}
	function rebindIncoming(section: Element | null): void {
		if (section) for (const rebind of incomingEdges.get(section) ?? []) rebind();
	}
	function ownGap(element: HTMLElement, property: '--paraflow-gap-before' | '--paraflow-gap-after', value: string): () => void {
		let properties = gapStyles.get(element);
		if (!properties) { properties = new Map(); gapStyles.set(element, properties); }
		let owned = properties.get(property);
		if (!owned) {
			owned = {owners:0,previous:element.style.getPropertyValue(property),priority:element.style.getPropertyPriority(property),value};
			properties.set(property, owned);
		}
		owned.owners++; owned.value = value;
		element.style.setProperty(property, value, 'important');
		return () => {
			if (--owned.owners) return;
			if (element.style.getPropertyValue(property) === owned.value) {
				if (owned.previous) element.style.setProperty(property, owned.previous, owned.priority);
				else element.style.removeProperty(property);
			}
			properties.delete(property);
			if (!properties.size) gapStyles.delete(element);
		};
	}
	function apply(root: HTMLElement, getSource: () => string | null, getSectionSource: () => string | null): () => void {
		if(delegatesToNestedRenderer(root))return ()=>{};
		const settings = getSettings();
		const restore: Array<() => void> = [];
		if (settings.callout) restore.push(enhanceReadingQuotes(root));
		if (settings.subscript || settings.superscript) restore.push(enhanceReadingShorthand(root, settings, getSectionSource()));
		const media=new MediaTableDisplayController(root);
		media.update(settings);restore.push(()=>media.destroy());
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
					if (section?.matches('body[data-paraflow-theme] .markdown-reading-view > .markdown-preview-view > .markdown-preview-sizer > .el-p')) {
						// The section gap consumes both paragraph edges; p has no second margin owner.
						restore.push(ownGap(section, '--paraflow-gap-after', spacing));
						let following: Element | null = null;
						let releaseFollowing = () => {};
						const rebind = () => {
							const next = section.nextElementSibling;
							if (next === following) return;
							releaseFollowing(); following = next;
							if (!next) { releaseFollowing = () => {}; return; }
							const release = ownGap(next as HTMLElement, '--paraflow-gap-before', spacing);
							let incoming = incomingEdges.get(next);
							if (!incoming) { incoming = new Set(); incomingEdges.set(next, incoming); }
							incoming.add(rebind);
							releaseFollowing = () => {
								release(); incoming.delete(rebind);
								if (!incoming.size) incomingEdges.delete(next);
							};
						};
						let edges = paragraphEdges.get(section);
						if (!edges) { edges = new Set(); paragraphEdges.set(section, edges); }
						edges.add(rebind); rebind();
						restore.push(() => {
							releaseFollowing(); edges.delete(rebind);
							if (!edges.size) paragraphEdges.delete(section);
						});
					} else style(paragraph, 'margin-block', spacing);
				}
			}
		}
		return () => { for (const undo of restore.reverse()) undo(); };
	}
	return {
		register(root, getSource = () => null, getSectionSource = getSource) {
			roots.get(root)?.destroy();
			const ownerWindow = root.ownerDocument.defaultView!;
			const section = root.closest('.markdown-preview-sizer > *');
			const previousSection = section?.previousElementSibling ?? null;
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
					undo = apply(root, getSource, getSectionSource);
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
			rebindEdge(previousSection);
			return () => {
				if (roots.get(root) !== registration) return;
				registration.destroy();
				roots.delete(root);
				rebindIncoming(section);
				// Render-child unload may precede the host's DOM removal in the same turn.
				ownerWindow.queueMicrotask(() => rebindIncoming(section));
			};
		},
		refresh() { for (const registration of roots.values()) registration.refresh(); },
		destroy() { for (const registration of roots.values()) registration.destroy(); roots.clear(); },
	};
}
