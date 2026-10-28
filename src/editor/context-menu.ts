import { createDetachedEl } from '../dom';
import { Modal, Notice, Platform, editorInfoField, editorLivePreviewField, getLanguage, type App, type Editor, type Plugin } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { calloutAtMenuPosition, calloutMenuTypes, calloutTypeChange, convertSelectionToCallout } from './context-menu-callout.js';
import { contentMenuActionPresentation, contentMenuItems, organizeContentMenu, type ContentMenu } from './context-menu-model.js';
import { editCalloutMetadata } from './callout/presentation.js';
import { decorateContextMenuItem } from './menu-shortcuts.js';
import { bindContextMenuPointerEvents, retargetNativeCellContextMenu } from './context-menu-target.js';
import { codeBodyAtMenuPosition } from './context-menu-code.js';
import { translateMenuText } from './menu-i18n.js';

const t = (label: string): string => translateMenuText(label, getLanguage());

class CalloutTypeDialog extends Modal {
	constructor(app: App, private readonly initial: string, private readonly apply: (value: string) => void) { super(app); }
	onOpen(): void {
		this.titleEl.textContent = t('Callout 类型');
		const doc = this.contentEl.ownerDocument;
		const input = createDetachedEl(doc, 'input'); input.type = 'text'; input.value = this.initial; input.setAttribute('aria-label', t('Callout 类型'));
		const error = createDetachedEl(doc, 'p'); error.setAttribute('aria-live', 'polite');
		const confirm = createDetachedEl(doc, 'button'); confirm.textContent = t('确定'); confirm.className = 'mod-cta';
		const submit = () => {
			const value = input.value.trim();
			if (!/^[\p{L}\p{N}_-]+$/u.test(value)) { error.textContent = t('请输入类型名称，可使用字母、数字、连字符或下划线。'); return; }
			this.apply(value); this.close();
		};
		confirm.onclick = submit;
		input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } };
		const cancel = createDetachedEl(doc, 'button'); cancel.textContent = t('取消'); cancel.onclick = () => this.close();
		this.contentEl.append(input, error, cancel, confirm); input.focus(); input.select();
	}
	onClose(): void { this.contentEl.replaceChildren(); }
}

export function registerContentMenus(plugin: Plugin): void {
	const events = new WeakMap<Document, MouseEvent>();
	const documents = new WeakSet<Document>();
	const observe = (doc: Document) => {
		if (documents.has(doc)) return;
		documents.add(doc);
		plugin.register(bindContextMenuPointerEvents(doc, event => {
			const target = event.target as Element | null;
			if (!target?.closest) return;
			const editorDOM = target.closest<HTMLElement>('.cm-editor');
			if (!editorDOM) return;
			const view = EditorView.findFromDOM(editorDOM);
			if (!view) return;
			const owner = view.state.field(editorInfoField, false)?.editor as unknown as { editorComponent?: { tableCell?: unknown } } | undefined;
			retargetNativeCellContextMenu(view, target, { x: event.clientX, y: event.clientY }, !!owner?.editorComponent?.tableCell);
		}, event => events.set(doc, event)));
		plugin.registerDomEvent(doc, 'keydown', () => events.delete(doc), true);
	};
	observe(document);
	const observeLeaves = () => plugin.app.workspace.iterateAllLeaves(leaf => observe(leaf.view.containerEl.ownerDocument));
	observeLeaves();
	plugin.registerEvent(plugin.app.workspace.on('layout-change', observeLeaves));
	plugin.registerEvent(plugin.app.workspace.on('window-open', (_workspaceWindow, win) => observe(win.document)));
	plugin.registerEvent(plugin.app.workspace.on('editor-menu', (nativeMenu, editor: Editor) => {
		const cm = (editor as Editor & { cm?: EditorView; inTableCell?: boolean }).cm;
		if (!cm) return;
		const menu = nativeMenu as unknown as ContentMenu;
		const state = cm.state, doc = cm.dom.ownerDocument;
		const event = events.get(doc); events.delete(doc);
		const target = event?.target as Element | null;
		const onEditor = target && cm.contentDOM.contains(target);
		const position = onEditor && event ? cm.posAtCoords({ x: event.clientX, y: event.clientY }) ?? state.selection.main.head : state.selection.main.head;
		const codeElement = onEditor ? target.closest<HTMLElement>('[data-paraflow-code-block],[data-paraflow-rendered-from]') : null;
		const codePosition = codeElement ? Number(codeElement.dataset.paraflowCodeBlock ?? codeElement.dataset.paraflowRenderedFrom) : position;
		const code = codeBodyAtMenuPosition(state, codePosition);
		const objectTarget = target?.closest('a,img,.internal-embed,.paraflow-table,.cm-hmd-internal-link,.cm-link,.cm-url');
		const card = !objectTarget && state.field(editorLivePreviewField, false) ? calloutAtMenuPosition(state, position) : null;
		const activeDocument = () => {
			if (cm.state.doc === state.doc) return true;
			new Notice(t('文档内容已更改，请重新打开菜单。')); return false;
		};
		const changeType = (type: string) => { if (activeDocument() && card) { cm.dispatch(calloutTypeChange(cm.state, card, type)); cm.focus(); } };
		const originalSort = menu.sort.bind(menu);
		menu.sort = function () {
			menu.sort = originalSort;
			originalSort();
			const hasObjectAction = contentMenuItems(menu).some(item => ['selection', 'open'].includes(item.section));
			organizeContentMenu(menu, {
				translate: t,
				inTable: !!(editor as Editor & { inTableCell?: boolean }).inTableCell,
				calloutDisabled: state.readOnly || !!calloutAtMenuPosition(state, state.selection.main.head),
				convertCallout: () => { if (activeDocument()) { const change = convertSelectionToCallout(state); if (change) cm.dispatch(change); cm.focus(); } },
				decorate: (item, icon, section) => {
					if (item.submenu) return;
					const color = item.iconEl.querySelector<HTMLElement>('[data-highlight]')?.dataset.highlight;
					const presentation = contentMenuActionPresentation(icon, section, color);
					if (!presentation) return;
					if (presentation.title) item.setTitle(t(presentation.title));
					decorateContextMenuItem(item.dom, presentation, plugin.app, Platform.isMacOS);
				},
				addObjectItems: level => {
					if (code) {
						level.addItem(item => item.setTitle(t('选中代码块')).setIcon('text-select').onClick(() => {
							if (activeDocument()) { cm.dispatch({ selection: { anchor: code.from, head: code.to }, userEvent: 'select', scrollIntoView: true }); cm.focus(); }
						}));
						level.addItem(item => item.setTitle(t('复制代码块')).setIcon('copy').onClick(() => {
							if (activeDocument()) void doc.defaultView!.navigator.clipboard.writeText(code.text).catch(() => new Notice(t('复制代码失败。')));
						}));
						return;
					}
					if (!card || hasObjectAction) return;
					level.addItem(item => item.setTitle(t('编辑 Callout')).setIcon('text-cursor-input').setDisabled(state.readOnly).onClick(() => { if (activeDocument()) editCalloutMetadata(cm, card); }));
					level.addItem(item => {
						item.setTitle(t('Callout 类型')).setIcon('tags').setDisabled(state.readOnly);
						const submenu = item.setSubmenu();
						for (const type of calloutMenuTypes) submenu.addItem(choice => choice.setTitle(t(type.title)).setIcon(type.icon).setChecked(card.type === type.type).onClick(() => changeType(type.type)));
						submenu.addItem(choice => choice.setTitle(t('其他…')).setIcon('pencil').setChecked(!calloutMenuTypes.some(type => type.type === card.type)).onClick(() => new CalloutTypeDialog(plugin.app, card.type, changeType).open()));
						submenu.addItem(choice => choice.setTitle(t('无（转为普通引用）')).setIcon('text-quote').onClick(() => changeType('')));
					});
				},
			});
			originalSort();
		};
		menu.setUseNativeMenu(false);
	}));
}
