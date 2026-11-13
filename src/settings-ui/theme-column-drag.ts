/** Pointer gestures work in both the main workspace and Obsidian popout windows. */
export function themeColumnDrag(header: HTMLTableRowElement, root: HTMLElement, insert: (from: string, to: string, side: 'before' | 'after') => void, enabled: () => boolean) {
	let document = root.ownerDocument;
	let window = document.defaultView!;
	let gesture: { source: HTMLTableCellElement; pointer: number; x: number; y: number; preview?: HTMLElement; target?: HTMLTableCellElement } | undefined;
	let suppressClick = false;
	function clear(): void {
		gesture?.source.classList.remove('is-dragging');
		gesture?.target?.classList.remove('is-drop-target');
		gesture?.target?.removeAttribute('data-drop-side');
		gesture?.preview?.remove(); gesture = undefined;
		root.classList.remove('is-column-dragging');
		document.removeEventListener('pointermove', move, true);
		document.removeEventListener('pointerup', up, true);
		document.removeEventListener('pointercancel', cancel, true);
		document.removeEventListener('keydown', key, true);
		window.removeEventListener('blur', cancel);
	}
	function cancel(): void { if (gesture) suppressClick = !!gesture.preview; clear(); }
	function cellAt(event: PointerEvent): HTMLTableCellElement | undefined {
		const cell = (event.target as Element).closest?.<HTMLTableCellElement>('th[data-column]');
		return cell?.parentElement === header ? cell : undefined;
	}
	function down(event: PointerEvent): void {
		if (event.button !== 0 || !enabled()) return;
		const source = cellAt(event); if (!source) return;
		clear(); suppressClick = false;
		// Obsidian can adopt this view into another document without reopening it.
		document = root.ownerDocument; window = document.defaultView!;
		gesture = { source, pointer: event.pointerId, x: event.clientX, y: event.clientY };
		document.addEventListener('pointermove', move, true);
		document.addEventListener('pointerup', up, true);
		document.addEventListener('pointercancel', cancel, true);
		document.addEventListener('keydown', key, true);
		window.addEventListener('blur', cancel);
	}
	function move(event: PointerEvent): void {
		if (!gesture || gesture.pointer !== event.pointerId) return;
		if (!gesture.preview) {
			if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
			gesture.preview = document.createElement('div');
			gesture.preview.className = 'paraflow-theme-column-preview';
			gesture.preview.textContent = gesture.source.querySelector('button')!.textContent;
			gesture.preview.setAttribute('aria-hidden', 'true'); document.body.append(gesture.preview);
			gesture.preview.style.width = `${gesture.source.getBoundingClientRect().width}px`;
			gesture.source.classList.add('is-dragging'); root.classList.add('is-column-dragging');
		}
		event.preventDefault();
		gesture.preview.style.left = `${Math.max(4, Math.min(event.clientX + 12, window.innerWidth - gesture.preview.offsetWidth - 4))}px`;
		gesture.preview.style.top = `${Math.min(event.clientY + 12, window.innerHeight - gesture.preview.offsetHeight - 4)}px`;
		gesture.target?.classList.remove('is-drop-target');
		gesture.target?.removeAttribute('data-drop-side');
		const target = cellAt(event);
		gesture.target = target !== gesture.source ? target : undefined;
		gesture.target?.classList.add('is-drop-target');
		if (gesture.target) gesture.target.dataset.dropSide = sideAt(gesture.target, event.clientX);
	}
	function sideAt(cell: HTMLTableCellElement, x: number): 'before' | 'after' {
		const rect = cell.getBoundingClientRect();
		return x < rect.left + rect.width / 2 ? 'before' : 'after';
	}
	function up(event: PointerEvent): void {
		if (!gesture || gesture.pointer !== event.pointerId) return;
		const from = gesture.source.dataset.column!;
		const target = cellAt(event);
		const to = gesture.preview && target !== gesture.source ? target?.dataset.column : undefined;
		const side = target ? sideAt(target, event.clientX) : 'before';
		suppressClick = !!gesture.preview; clear();
		if (to) insert(from, to, side);
	}
	function key(event: KeyboardEvent): void { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }
	function click(event: MouseEvent): void {
		if (!suppressClick || event.detail === 0) return;
		suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
	}
	header.addEventListener('pointerdown', down);
	header.addEventListener('click', click, true);
	return { cancel, destroy() { clear(); header.removeEventListener('pointerdown', down); header.removeEventListener('click', click, true); } };
}
