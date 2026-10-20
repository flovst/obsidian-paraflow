import { EditorView, ViewPlugin } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { standaloneMediaKind } from './paragraph/media.js';
import { MediaTableDisplayController } from '../display/media-table.js';
import { parser } from '@lezer/markdown';

const SOURCE_PREVIEW_GAP = 8;

function standaloneImageSource(text: string): boolean {
	const body = text.replace(/^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])(?: \[[ xX]\])?\s+)?/u, '').trimEnd();
	const image = parser.parse(body).topNode.firstChild?.firstChild;
	return body.startsWith('![') && standaloneMediaKind(body) === 'image' && image?.name === 'Image' && !image.nextSibling;
}

/** Adapt the native source action, retaining the host's preview/edit lifecycle. */
export function createImageSourceActivation(isActive: (view: EditorView) => boolean, imageCenter: () => boolean = () => true) {
	return [EditorView.baseTheme({
		'& > .paraflow-image-source-preview': {
			top: 'var(--paraflow-image-reveal-top) !important',
			left: 'var(--paraflow-image-reveal-left) !important',
			width: 'var(--paraflow-image-reveal-width) !important',
			maxWidth: 'var(--paraflow-image-reveal-width) !important',
		},
		'& .paraflow-image-source-gap': { height: 'var(--paraflow-image-reveal-height) !important' },
		'& > .paraflow-image-source-preview > .image-embed': { display: 'block', width: '100%', maxWidth: '100%' },
	}), ViewPlugin.define(view => {
		const win = view.dom.ownerDocument.defaultView!;
		let frame: number | null = null;
		let layoutFrame: number | null = null;
		let reveal: { tooltip: HTMLElement; gap: HTMLElement; controller: MediaTableDisplayController; line: HTMLElement; image: HTMLImageElement; center: boolean | null } | null = null;
		const resize = win.ResizeObserver ? new win.ResizeObserver(scheduleLayout) : null;
		function clearReveal(): void {
			resize?.disconnect();
			if (!reveal) return;
			reveal.controller.destroy();
			reveal.tooltip.classList.remove('paraflow-image-source-preview');
			for (const part of ['top', 'left', 'width']) reveal.tooltip.style.removeProperty(`--paraflow-image-reveal-${part}`);
			reveal.gap.classList.remove('paraflow-image-source-gap');
			reveal.gap.style.removeProperty('--paraflow-image-reveal-height');
			reveal = null;
		}
		function layout(): void {
			if (!isActive(view)) { clearReveal(); return; }
			const tooltip = view.dom.querySelector<HTMLElement>(':scope > .cm-image-reveal-tooltip');
			const gaps = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-image-reveal-gap')];
			// A standalone reveal has one native gap at the source range's end.
			const gap = gaps.find(node => {
				const source = view.state.doc.lineAt(view.posAtDOM(node));
				return standaloneImageSource(source.text);
			});
			if (!tooltip || !gap || gaps.length !== 1) { clearReveal(); return; }
			const source = view.state.doc.lineAt(view.posAtDOM(gap));
			const point = view.domAtPos(source.to);
			const node = point.node === view.contentDOM ? point.node.childNodes[Math.max(0, point.offset - 1)]! : point.node;
			const line = (node.nodeType === 1 ? node as HTMLElement : node.parentElement)?.closest<HTMLElement>('.cm-line');
			const embed = tooltip.querySelector<HTMLElement>('.image-embed');
			const image = embed?.querySelector<HTMLImageElement>('img');
			if (!line || !embed || !image || tooltip.querySelectorAll('img').length !== 1) { clearReveal(); return; }
			if (!reveal || reveal.tooltip !== tooltip || reveal.gap !== gap || reveal.image !== image || reveal.line !== line) {
				clearReveal();
				reveal = { tooltip, gap, line, image, controller: new MediaTableDisplayController(embed), center: null };
				for (const node of [line, image, view.contentDOM]) resize?.observe(node);
			}
			tooltip.classList.add('paraflow-image-source-preview');
			gap.classList.add('paraflow-image-source-gap');
			const row = line.getBoundingClientRect();
			const rowStyle = win.getComputedStyle(line);
			const leftPadding = Number.parseFloat(rowStyle.paddingLeft) || 0;
			const rightPadding = Number.parseFloat(rowStyle.paddingRight) || 0;
			const parent = tooltip.offsetParent as HTMLElement | null;
			const fixed = win.getComputedStyle(tooltip).position === 'fixed';
			const origin = fixed ? { left: 0, top: 0 } : (parent ?? view.dom).getBoundingClientRect();
			tooltip.style.setProperty('--paraflow-image-reveal-width', `${row.width - leftPadding - rightPadding}px`);
			tooltip.style.setProperty('--paraflow-image-reveal-left', `${row.left + leftPadding - origin.left + (fixed ? 0 : parent?.scrollLeft ?? 0)}px`);
			tooltip.style.setProperty('--paraflow-image-reveal-top', `${row.bottom + SOURCE_PREVIEW_GAP - origin.top + (fixed ? 0 : parent?.scrollTop ?? 0)}px`);
			if (reveal.center !== imageCenter()) {
				reveal.center = imageCenter();
				reveal.controller.update({ images: true, imageCenter: reveal.center, tableDisplay: false });
			}
			if (!image.classList.contains('paraflow-display-image')) { clearReveal(); return; }
			gap.style.setProperty('--paraflow-image-reveal-height', `${image.getBoundingClientRect().height + SOURCE_PREVIEW_GAP}px`);
		}
		function scheduleLayout(): void {
			if (layoutFrame === null) layoutFrame = win.requestAnimationFrame(() => { layoutFrame = null; layout(); });
		}
		const observer = new win.MutationObserver(records => {
			if (reveal && records.some(record => record.type === 'attributes' && record.target === reveal!.image)) reveal.center = null;
			scheduleLayout();
		});
		observer.observe(view.dom, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height', 'src'] });
		view.dom.addEventListener('load', scheduleLayout, true);
		view.dom.addEventListener('scroll', scheduleLayout, true);
		win.addEventListener('resize', scheduleLayout);
		scheduleLayout();
		let pointer: { x: number; y: number; dragged: boolean } | null = null;
		let keyStart: { key: string; state: EditorState } | null = null;
		function sourceButton(embed: HTMLElement): HTMLElement | null {
			if (!view.contentDOM.contains(embed) || embed.closest('.cm-editor') !== view.dom) return null;
			const from = view.posAtDOM(embed), line = view.state.doc.lineAt(from);
			const prefix = line.text.slice(0, from - line.from);
			const body = line.text.slice(from - line.from).trimEnd();
			if (!/^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])(?: \[[ xX]\])?\s+)?$/u.test(prefix) ||
				!body.startsWith('![') || standaloneMediaKind(body) !== 'image') return null;
			const lineDOM = embed.closest('.cm-line');
			if (!lineDOM || lineDOM.querySelectorAll('.image-embed').length !== 1) return null;
			return embed.querySelector<HTMLElement>('.edit-block-button');
		}
		function schedule(embed: HTMLElement): void {
			if (frame !== null) win.cancelAnimationFrame(frame);
			const { doc, selection } = view.state;
			frame = win.requestAnimationFrame(() => {
				frame = null;
				if (isActive(view) && view.state.doc === doc && view.state.selection.eq(selection)) sourceButton(embed)?.click();
			});
		}
		function pointerDown(event: PointerEvent): void {
			pointer = { x: event.clientX, y: event.clientY, dragged: false };
		}
		function pointerMove(event: PointerEvent): void {
			if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) pointer.dragged = true;
		}
		function dragStart(): void { if (pointer) pointer.dragged = true; }
		function click(event: MouseEvent): void {
			const dragged = pointer?.dragged; pointer = null;
			if (dragged || event.defaultPrevented || event.button !== 0 || event.detail > 1 ||
				event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !isActive(view)) return;
			const target = event.target as HTMLElement;
			if (!target.closest('.image-wrapper') || target.closest('.image-resize-corner, .embed-actions, a')) return;
			const embed = target.closest<HTMLElement>('.image-embed');
			if (embed) schedule(embed);
		}
		function keyDown(event: KeyboardEvent): void {
			keyStart = /^Arrow(?:Left|Right|Up|Down)$/u.test(event.key) ? { key: event.key, state: view.state } : null;
		}
		function keyUp(event: KeyboardEvent): void {
			const start = keyStart; keyStart = null;
			if (!/^Arrow(?:Left|Right|Up|Down)$/u.test(event.key) || event.ctrlKey || event.metaKey ||
				event.altKey || event.shiftKey || !isActive(view) || !view.state.selection.main.empty) return;
			const embed = view.contentDOM.querySelector<HTMLElement>('.image-embed.is-selected');
			if (embed) { schedule(embed); return; }
			// Vertical movement reaches the replacement's source boundary without
			// entering the native horizontal selected-image state.
			if (!start || start.key !== event.key || start.state.doc !== view.state.doc || !start.state.selection.main.empty) return;
			const before = start.state.selection.main.head, after = view.state.selection.main.head;
			for (const image of view.contentDOM.querySelectorAll<HTMLElement>('.image-embed')) {
				const from = view.posAtDOM(image), to = view.state.doc.lineAt(from).to;
				if (after >= from && after <= to && (before < from || before > to) && sourceButton(image)) {
					schedule(image); break;
				}
			}
		}
		view.contentDOM.addEventListener('pointerdown', pointerDown, true);
		view.contentDOM.addEventListener('pointermove', pointerMove, true);
		view.contentDOM.addEventListener('dragstart', dragStart, true);
		view.contentDOM.addEventListener('click', click);
		view.contentDOM.addEventListener('keydown', keyDown, true);
		view.contentDOM.addEventListener('keyup', keyUp);
		return { update: scheduleLayout, destroy() {
			observer.disconnect();
			if (layoutFrame !== null) win.cancelAnimationFrame(layoutFrame);
			clearReveal();
			view.dom.removeEventListener('load', scheduleLayout, true);
			view.dom.removeEventListener('scroll', scheduleLayout, true);
			win.removeEventListener('resize', scheduleLayout);
			if (frame !== null) win.cancelAnimationFrame(frame);
			view.contentDOM.removeEventListener('pointerdown', pointerDown, true);
			view.contentDOM.removeEventListener('pointermove', pointerMove, true);
			view.contentDOM.removeEventListener('dragstart', dragStart, true);
			view.contentDOM.removeEventListener('click', click);
			view.contentDOM.removeEventListener('keydown', keyDown, true);
			view.contentDOM.removeEventListener('keyup', keyUp);
		} };
	})];
}
