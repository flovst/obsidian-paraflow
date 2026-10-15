import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { MediaTableDisplayController, type MediaTableDisplayOptions } from '../display/media-table.js';
import { isPrimaryLivePreviewEditor } from './surface.js';

export function createMediaTableDisplayExtension(
	isActive: (view: EditorView) => boolean,
	getOptions: () => MediaTableDisplayOptions,
): Extension {
	const classes=(view:EditorView):string=>{
		const active=view.dom.parentElement?.matches('.markdown-source-view.mod-cm6.is-live-preview')===true&&!view.dom.closest('.cm-table-widget')&&isActive(view),options=getOptions();
		return [active&&options.tableDisplay?'paraflow-table-display-active':'',
			active&&(options.tableDisplay||options.tableEditing)?options.tableAutoWrap===false?'paraflow-table-nowrap-active':'paraflow-table-wrap-active':''].filter(Boolean).join(' ');
	};
	return [EditorView.editorAttributes.of(view=>({class:classes(view)})),ViewPlugin.define(view => {
		const ownerWindow = view.dom.ownerDocument.defaultView!;
		const controller = new MediaTableDisplayController(view.contentDOM);
		let frame: number | null = null;
		function ownership(): void {
			const enabled=classes(view).split(' ');
			for(const name of ['paraflow-table-display-active','paraflow-table-wrap-active','paraflow-table-nowrap-active'])view.dom.classList.toggle(name,enabled.includes(name));
		}
		function schedule(): void {
			ownership();
			if (frame !== null) return;
			frame = ownerWindow.requestAnimationFrame(() => {
				frame = null;
				if (isPrimaryLivePreviewEditor(view) && isActive(view)) controller.update(getOptions());
				else controller.destroy();
			});
		}
		const observer = new ownerWindow.MutationObserver(schedule);
		observer.observe(view.contentDOM, { childList: true, subtree: true });
		schedule();
		return {
			update: schedule,
			destroy() {
				observer.disconnect();
				if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
				controller.destroy();
				view.dom.classList.remove('paraflow-table-display-active','paraflow-table-wrap-active','paraflow-table-nowrap-active');
			},
		};
	})];
}
