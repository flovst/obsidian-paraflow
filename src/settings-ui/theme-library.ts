import { ItemView, Menu, Modal, Platform, Setting, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type ParaFlowPlugin from '../main.js';
import type { ThemeManifest, ThemeSourceMetadata } from '../themes/model.js';
import { translate as t, type MessageKey } from './i18n.js';
import { exportTheme, importTheme, openThemeFolder, reloadThemes, showReport } from './theme-actions.js';
import { themeColumnDrag } from './theme-column-drag.js';
import { themeLibraryColumns as columns, themeSource as source, themeInstallation as installation, themeScheme as scheme, themeEntries, themeCell, entryCell, packageName, type ThemeLibraryColumn as Column, type ThemeLibraryEntry } from './theme-library-data.js';

export const THEME_LIBRARY_VIEW_TYPE = 'paraflow-theme-library';
export interface ThemeLibraryState {
	columns: Column[];
	sort: { column: Column; direction: 'ascending' | 'descending' };
	expandedPackages: string[];
}
export interface ThemeLibraryHost {
	themes(): readonly ThemeManifest[];
	activeId(): string | null;
	apply(id: string | null): Promise<void>;
	refresh(): Promise<void>;
	import(changed: () => void): void;
	export(id: string): Promise<void>;
	folder(id: string): Promise<void>;
	report(id: string): Promise<void>;
	info(id: string): void;
	packageInfo(id: string, themes: readonly ThemeManifest[]): void;
}
function libraryState(value: unknown): ThemeLibraryState {
	const input = value && typeof value === 'object' ? value as Partial<ThemeLibraryState> : {};
	return {
		columns: Array.isArray(input.columns) && input.columns.length === columns.length && new Set(input.columns).size === columns.length && input.columns.every(key => columns.includes(key)) ? [...input.columns] : [...columns],
		sort: input.sort && columns.includes(input.sort.column) && ['ascending', 'descending'].includes(input.sort.direction) ? { ...input.sort } : { column: 'libraryName', direction: 'ascending' },
		expandedPackages: Array.isArray(input.expandedPackages) ? [...new Set(input.expandedPackages.filter((id): id is string => typeof id === 'string'))] : [],
	};
}

let labelId = 0;
/** Obsidian turns aria-label into a tooltip; labelledby keeps names without hover text. */
function labelControl(control: HTMLElement, label: HTMLElement): void {
	label.id ||= `paraflow-theme-label-${++labelId}`;
	control.removeAttribute('aria-label'); control.removeAttribute('title');
	control.setAttribute('aria-labelledby', label.id);
}

/** Shared by the workspace view and DOM regressions. */
export function renderThemeLibrary(root: HTMLElement, host: ThemeLibraryHost, initialState?: unknown, changed: () => void = () => {}) {
	root.classList.add('paraflow-theme-library');
	let state = libraryState(initialState);
	let selected = host.activeId() ? `theme:${host.activeId()}` : null;
	let busy = false;
	const collapsedSearch = new Set<string>();
	let filtered = false;
	const filterChanged = () => { collapsedSearch.clear(); renderRows(); };
	const toolbar = root.createDiv({ cls: 'paraflow-theme-toolbar' });
	const search = toolbar.createDiv({ cls: 'search-input-container' }).createEl('input', { type: 'search', placeholder: t('searchThemes') });
	labelControl(search, toolbar.createSpan({ text: t('searchThemes'), cls: 'paraflow-theme-sr-only' }));
	const filters = toolbar.createDiv({ cls: 'paraflow-theme-filters' });
	const selects = new Map<string, HTMLSelectElement>();
	for (const [key, label] of [['variants', 'libraryScheme'], ['themePackage', 'libraryPackage'], ['sourceSoftware', 'librarySource'], ['themeOrigin', 'themeOrigin']] as const) {
		const setting = new Setting(filters).setName(t(label));
		setting.addDropdown(dropdown => {
			labelControl(dropdown.selectEl, setting.nameEl); selects.set(key, dropdown.selectEl);
			dropdown.onChange(filterChanged);
		});
	}
	const tools = toolbar.createDiv({ cls: 'paraflow-theme-tools' });
	const status = root.createDiv({ cls: 'paraflow-theme-status', attr: { role: 'status', 'aria-live': 'polite' } });
	const error = root.createDiv({ cls: 'paraflow-theme-error', attr: { role: 'alert' } });
	const scroller = root.createDiv({ cls: 'paraflow-theme-table-scroll' });
	const table = scroller.createEl('table', { cls: 'paraflow-theme-table', attr: { role: 'treegrid' } });
	labelControl(table, table.createEl('caption', { text: t('installedThemes'), cls: 'paraflow-theme-sr-only' }));
	const header = table.createEl('thead').createEl('tr');
	const drag = themeColumnDrag(header, root, (from, to, side) => insert(from as Column, to as Column, side), () => !busy);
	const rows = table.createEl('tbody');
	const empty = scroller.createEl('p', { text: t('noMatchingThemes') });
	const rowFor = (key: string | null) => [...rows.querySelectorAll<HTMLTableRowElement>('tr')].find(row => row.dataset.rowKey === key);
	async function run(action: () => Promise<void>): Promise<void> {
		if (busy) return;
		const focused = root.ownerDocument.activeElement as HTMLElement | null;
		const actionKey = focused?.dataset.themeAction;
		const focusId = focused?.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey ?? selected;
		busy = true; error.textContent = ''; root.setAttribute('aria-busy', 'true');
		root.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
		try { await action(); }
		catch (reason) { error.textContent = String(reason); }
		finally {
			busy = false; root.removeAttribute('aria-busy'); refresh();
			if (actionKey) tools.querySelector<HTMLButtonElement>(`[data-theme-action="${actionKey}"]`)?.focus();
			else rowFor(focusId)?.focus({ preventScroll: true });
		}
	}
	function button(key: MessageKey, action: () => Promise<void>, icon?: string): void {
		const control = tools.createEl('button', { text: icon ? '' : t(key), attr: { type: 'button' } });
		control.dataset.themeAction = key;
		if (icon) { setIcon(control, icon); labelControl(control, control.createSpan({ text: t(key), cls: 'paraflow-theme-sr-only' })); control.classList.add('clickable-icon'); }
		control.addEventListener('click', () => { void run(action); });
	}
	button('refreshThemes', () => host.refresh(), 'refresh-cw');
	button('importTheme', async () => { host.import(refresh); });
	button('followObsidian', () => host.apply(null));
	search.addEventListener('input', filterChanged);
	function options(key: string, values: Array<[string, string]>): void {
		const select = selects.get(key)!; const previous = select.value;
		select.empty(); select.createEl('option', { text: t('allThemes'), value: '' });
		for (const [value, text] of values) select.createEl('option', { text, value });
		select.value = values.some(([value]) => value === previous) ? previous : '';
	}
	function refresh(): void {
		const themes = host.themes();
		const unique = (key: 'sourceApp' | 'sourcePackage'): Array<[string, string]> => [...new Set(themes.map(theme => source(theme)[key] ?? ''))].sort().map(value => [value || '__unknown', value || '-']);
		options('sourceSoftware', unique('sourceApp')); options('themePackage', unique('sourcePackage'));
		options('variants', [['adaptive', t('libraryAdaptive')], ['light', t('light')], ['dark', t('dark')]]);
		options('themeOrigin', [['builtin', t('builtInTheme')], ['imported', t('importedTheme')]]);
		tools.querySelectorAll<HTMLButtonElement>('button').forEach(control => { control.disabled = busy; });
		renderHeader(); renderRows();
	}
	function insert(from: Column, to: Column, side: 'before' | 'after'): void {
		if (from === to) return;
		state.columns.splice(state.columns.indexOf(from), 1);
		state.columns.splice(state.columns.indexOf(to) + (side === 'after' ? 1 : 0), 0, from);
		renderHeader(); renderRows(); changed();
	}
	function renderHeader(): void {
		drag.cancel();
		header.empty();
		for (const column of state.columns) {
			const cell = header.createEl('th', { attr: { scope: 'col', 'data-column': column, 'aria-sort': state.sort.column === column ? state.sort.direction : 'none' } });
			const control = cell.createEl('button', { cls: 'paraflow-theme-column', attr: { type: 'button' } });
			control.createSpan({ text: t(column) });
			const icon = control.createSpan({ cls: 'paraflow-theme-sort-icon', attr: { 'aria-hidden': 'true' } });
			icon.classList.toggle('is-inactive', state.sort.column !== column);
			setIcon(icon, state.sort.column === column && state.sort.direction === 'descending' ? 'chevron-down' : 'chevron-up');
			control.disabled = busy;
			cell.addEventListener('click', () => {
				if (busy) return;
				state.sort = { column, direction: state.sort.column === column && state.sort.direction === 'ascending' ? 'descending' : 'ascending' };
				renderHeader(); renderRows(); changed(); header.querySelector<HTMLButtonElement>(`[data-column="${column}"] button`)?.focus();
			});
			control.addEventListener('keydown', event => {
				if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
				const other = state.columns[state.columns.indexOf(column) + (event.key === 'ArrowLeft' ? -1 : 1)];
				if (other) { event.preventDefault(); insert(column, other, event.key === 'ArrowLeft' ? 'before' : 'after'); header.querySelector<HTMLButtonElement>(`[data-column="${column}"] button`)?.focus(); }
			});
		}
	}
	function selectRow(key: string, focus = true): void {
		selected = key;
		for (const row of rows.querySelectorAll<HTMLTableRowElement>('tr')) {
			row.classList.toggle('is-selected', row.dataset.rowKey === selected);
			row.setAttribute('aria-selected', String(row.dataset.rowKey === selected)); row.tabIndex = row.dataset.rowKey === selected ? 0 : -1;
		}
		if (focus) rowFor(key)?.focus({ preventScroll: true });
	}
	function menuFor(): Menu {
		const menu = new Menu().setParentElement(root);
		// Same host runtime boundary and density as ParaFlow's editor menus.
		(menu as Menu & { dom: HTMLElement }).dom.classList.add('paraflow-context-menu');
		return menu;
	}
	function showMenu(menu: Menu, row: HTMLTableRowElement, event?: MouseEvent): void {
		if (event) menu.showAtMouseEvent(event);
		else { const rect = row.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }, root.ownerDocument); }
	}
	function context(theme: ThemeManifest, row: HTMLTableRowElement, event?: MouseEvent): void {
		if (busy) return;
		selectRow(`theme:${theme.id}`);
		const menu = menuFor();
		const action = (title: MessageKey, callback: () => Promise<void>, disabled = false) => menu.addItem(item => item.setTitle(t(title)).setDisabled(disabled).onClick(() => run(callback)));
		action('useTheme', () => host.apply(theme.id), host.activeId() === theme.id);
		action('openThemeFolder', () => host.folder(theme.id), !Platform.isDesktop);
		action('export', () => host.export(theme.id), theme.id === 'builtin-classic');
		action('report', () => host.report(theme.id));
		menu.addSeparator(); menu.addItem(item => item.setTitle(t('libraryInfo')).onClick(() => host.info(theme.id)));
		showMenu(menu, row, event);
	}
	function isExpanded(id: string): boolean { return filtered ? !collapsedSearch.has(id) : state.expandedPackages.includes(id); }
	function togglePackage(id: string): void {
		if (busy) return;
		if (filtered) { if (collapsedSearch.has(id)) collapsedSearch.delete(id); else collapsedSearch.add(id); }
		else { state.expandedPackages = isExpanded(id) ? state.expandedPackages.filter(value => value !== id) : [...state.expandedPackages, id]; changed(); }
		selected = `package:${id}`; renderRows(); rowFor(selected)?.focus({ preventScroll: true });
	}
	function packageContext(entry: ThemeLibraryEntry, row: HTMLTableRowElement, event?: MouseEvent): void {
		if (busy) return;
		selectRow(entry.key);
		const menu = menuFor();
		menu.addItem(item => item.setTitle(t(isExpanded(entry.packageId!) ? 'collapseThemePackage' : 'expandThemePackage')).onClick(() => togglePackage(entry.packageId!)));
		menu.addItem(item => item.setTitle(t('themePackageInfo')).onClick(() => host.packageInfo(entry.packageId!, host.themes().filter(theme => source(theme).packageId === entry.packageId))));
		showMenu(menu, row, event);
	}
	function renderRows(): void {
		const query = search.value.trim().toLocaleLowerCase(); const value = (key: string) => selects.get(key)!.value;
		filtered = !!query || [...selects.values()].some(select => !!select.value);
		const matches = host.themes().filter(theme => {
			const metadata = source(theme);
			return (!query || [theme.name, theme.id, metadata.sourceApp, metadata.sourcePackage, metadata.packageId].some(text => text?.toLocaleLowerCase().includes(query)))
				&& (!value('sourceSoftware') || (metadata.sourceApp || '__unknown') === value('sourceSoftware'))
				&& (!value('themePackage') || (metadata.sourcePackage || '__unknown') === value('themePackage'))
				&& (!value('variants') || scheme(theme) === value('variants'))
				&& (!value('themeOrigin') || installation(theme) === value('themeOrigin'));
		});
		const compare = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true }) * (state.sort.direction === 'ascending' ? 1 : -1);
		const entries = themeEntries(matches).sort((a, b) => compare(entryCell(a, state.sort.column), entryCell(b, state.sort.column)) || a.key.localeCompare(b.key));
		const visible: Array<{ key: string; entry: ThemeLibraryEntry; theme?: ThemeManifest }> = [];
		for (const entry of entries) {
			if (!entry.packageId) { visible.push({ key: entry.key, entry, theme: entry.themes[0]! }); continue; }
			visible.push({ key: entry.key, entry });
			if (isExpanded(entry.packageId)) for (const theme of [...entry.themes].sort((a, b) => compare(themeCell(a, state.sort.column), themeCell(b, state.sort.column)) || a.id.localeCompare(b.id))) visible.push({ key: `theme:${theme.id}`, entry, theme });
		}
		if (!visible.some(item => item.key === selected)) {
			const parent = entries.find(entry => entry.packageId && entry.themes.some(theme => `theme:${theme.id}` === selected));
			selected = parent?.key ?? visible[0]?.key ?? null;
		}
		rows.empty();
		for (const [index, item] of visible.entries()) {
			const { key, entry, theme } = item; const isPackage = !theme;
			const row = rows.createEl('tr', { attr: { 'data-row-key': key, role: 'row', 'aria-selected': String(selected === key), 'aria-level': String(theme && entry.packageId ? 2 : 1) } });
			if (theme) row.dataset.themeId = theme.id;
			else { row.dataset.packageId = entry.packageId!; row.setAttribute('aria-expanded', String(isExpanded(entry.packageId!))); row.classList.add('paraflow-theme-package'); }
			if (entry.packageId && isExpanded(entry.packageId)) {
				row.classList.add('paraflow-theme-package-group');
				if (isPackage) row.classList.add('is-package-start');
				if (visible[index + 1]?.entry !== entry) row.classList.add('is-package-end');
			}
			row.classList.toggle('is-selected', selected === key); row.tabIndex = selected === key ? 0 : -1;
			for (const column of state.columns) {
				const cell = row.createEl('td', { attr: { role: 'gridcell' } });
				if (column === 'libraryName') {
					const name = cell.createSpan({ cls: 'paraflow-theme-name' });
					name.classList.toggle('is-package-child', !!theme && !!entry.packageId);
					const icon = name.createSpan({ cls: 'paraflow-theme-disclosure', attr: { 'aria-hidden': 'true' } });
					if (isPackage) setIcon(icon, isExpanded(entry.packageId!) ? 'chevron-down' : 'chevron-right');
					name.createSpan({ text: theme ? theme.name : packageName(entry), cls: 'paraflow-theme-name-label' });
					if (isPackage) name.createSpan({ text: String(entry.themes.length), cls: 'paraflow-theme-package-count' });
					if (theme ? theme.id === host.activeId() : entry.themes.some(member => member.id === host.activeId())) name.createSpan({ text: t('activeTheme'), cls: 'paraflow-theme-badge' });
				} else cell.textContent = theme ? themeCell(theme, column) : entryCell(entry, column);
			}
			row.addEventListener('click', () => { if (isPackage) togglePackage(entry.packageId!); else selectRow(key); });
			const showContext = (event?: MouseEvent) => { if (theme) context(theme, row, event); else packageContext(entry, row, event); };
			row.addEventListener('contextmenu', event => { event.preventDefault(); showContext(event); });
			row.addEventListener('keydown', event => {
				if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); showContext(); }
				else if (isPackage && ['Enter', ' '].includes(event.key)) { event.preventDefault(); togglePackage(entry.packageId!); }
				else if (event.key === 'ArrowRight' && isPackage) { event.preventDefault(); if (!isExpanded(entry.packageId!)) togglePackage(entry.packageId!); else selectRow(visible[visible.indexOf(item) + 1]!.key); }
				else if (event.key === 'ArrowLeft' && entry.packageId) { event.preventDefault(); if (isPackage && isExpanded(entry.packageId)) togglePackage(entry.packageId); else if (theme) selectRow(entry.key); }
				else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
					event.preventDefault(); const index = visible.indexOf(item);
					const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
					selectRow(visible[next]!.key);
				}
			});
		}
		empty.hidden = matches.length > 0;
		status.textContent = t('themeCount').replace('{visible}', String(matches.length)).replace('{total}', String(host.themes().length)) + (host.activeId() === null ? ` · ${t('followObsidian')}` : '');
	}
	refresh();
	return { refresh, destroy: () => drag.destroy(), getState: (): ThemeLibraryState => libraryState(state), setState(value: unknown) { state = libraryState(value); renderHeader(); renderRows(); } };
}

export function renderThemeInfo(root: HTMLElement, theme: ThemeManifest, save: (values: ThemeSourceMetadata) => Promise<void>): void {
	root.classList.add('paraflow-theme-info');
	for (const [key, value] of [['themeId', theme.id], ['themeSourceEntry', theme.sourceEntry || '-'], ['themeSourceVersion', theme.sourceVersion || '-']] as const) new Setting(root).setName(t(key)).setDesc(value);
	const form = root.createEl('form');
	new Setting(form).setName(t('themeProvenance')).setDesc(t('themeProvenanceHelp')).setHeading();
	const fields = new Map<keyof ThemeSourceMetadata, HTMLInputElement>();
	for (const [key, label] of [['sourceApp', 'sourceSoftware'], ['sourcePackage', 'themePackage'], ['packageId', 'themePackageId']] as const) {
		const setting = new Setting(form).setName(t(label));
		if (key === 'packageId') setting.setDesc(t('themePackageIdHelp'));
		setting.addText(text => {
			text.setPlaceholder('-').setValue(source(theme)[key] ?? ''); text.inputEl.maxLength = key === 'packageId' ? 80 : 160;
			labelControl(text.inputEl, setting.nameEl); fields.set(key, text.inputEl);
		});
	}
	const error = form.createDiv({ cls: 'paraflow-theme-error', attr: { role: 'alert' } });
	const status = form.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
	const control = new Setting(form).controlEl.createEl('button', { text: t('saveThemeMetadata'), attr: { type: 'submit' } });
	let busy = false;
	form.addEventListener('submit', event => {
		event.preventDefault(); if (busy) return;
		busy = true; control.disabled = true; fields.forEach(input => { input.disabled = true; }); error.textContent = ''; status.textContent = ''; root.setAttribute('aria-busy', 'true');
		const values = { sourceApp: fields.get('sourceApp')!.value.trim() || undefined, sourcePackage: fields.get('sourcePackage')!.value.trim() || undefined, packageId: fields.get('packageId')!.value.trim() || null };
		void (async () => {
			try { await save(values); for (const [key, input] of fields) input.value = values[key] ?? ''; status.textContent = t('saveThemeMetadata'); }
			catch (reason) { error.textContent = String(reason); }
			finally { busy = false; control.disabled = false; fields.forEach(input => { input.disabled = false; }); root.removeAttribute('aria-busy'); control.focus(); }
		})();
	});
}
export class ThemeInfoModal extends Modal {
	constructor(private readonly plugin: ParaFlowPlugin, private readonly theme: ThemeManifest, private readonly changed: () => void) { super(plugin.app); }
	onOpen(): void {
		this.setTitle(`${t('libraryInfo')}: ${this.theme.name}`);
		renderThemeInfo(this.contentEl, this.theme, async values => { await this.plugin.updateContentThemeMetadata(this.theme.id, values); this.changed(); });
	}
	onClose(): void { this.contentEl.empty(); }
}
export class ThemeLibraryView extends ItemView {
	private state = libraryState(undefined);
	private library: ReturnType<typeof renderThemeLibrary> | undefined;
	constructor(leaf: WorkspaceLeaf, private readonly plugin: ParaFlowPlugin) { super(leaf); this.navigation = false; }
	getViewType(): string { return THEME_LIBRARY_VIEW_TYPE; }
	getDisplayText(): string { return t('themeLibrary'); }
	getIcon(): string { return 'palette'; }
	getState(): Record<string, unknown> { return { ...(this.library?.getState() ?? this.state) }; }
	async setState(state: unknown, _result: ViewStateResult): Promise<void> { this.state = libraryState(state); this.library?.setState(this.state); }
	async onOpen(): Promise<void> {
		this.contentEl.empty(); this.contentEl.classList.add('paraflow-theme-view');
		this.library = renderThemeLibrary(this.contentEl, {
			themes: () => this.plugin.contentThemes, activeId: () => this.plugin.contentThemeId,
			apply: id => this.plugin.setContentTheme(id), refresh: () => reloadThemes(this.plugin),
			import: refresh => importTheme(this.plugin, refresh),
			export: id => exportTheme(this.plugin, this.contentEl.ownerDocument, id),
			folder: id => openThemeFolder(this.plugin, id), report: id => showReport(this.plugin, id),
			info: id => new ThemeInfoModal(this.plugin, this.plugin.contentThemes.find(theme => theme.id === id)!, () => this.library?.refresh()).open(),
			packageInfo: (id, themes) => {
				const modal = new Modal(this.app);
				modal.setTitle(`${t('themePackageInfo')}: ${packageName({ key: `package:${id}`, packageId: id, themes })}`);
				new Setting(modal.contentEl).setName(t('themePackageId')).setDesc(id);
				new Setting(modal.contentEl).setName(t('librarySource')).setDesc([...new Set(themes.map(theme => source(theme).sourceApp || '-'))].join(', '));
				new Setting(modal.contentEl).setName(t('installedThemes')).setDesc(themes.map(theme => theme.name).join(', '));
				modal.open();
			},
		}, this.state, () => { void this.app.workspace.requestSaveLayout(); });
	}
	async onClose(): Promise<void> { this.state = this.library?.getState() ?? this.state; this.library?.destroy(); this.library = undefined; this.contentEl.empty(); }
}
const opening = new WeakMap<ParaFlowPlugin, Promise<void>>();
export async function openThemeLibrary(plugin: ParaFlowPlugin): Promise<void> {
	const pending = opening.get(plugin); if (pending) return pending;
	const task = (async () => {
		const workspace = plugin.app.workspace;
		let leaf = workspace.getLeavesOfType(THEME_LIBRARY_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = Platform.isDesktop ? workspace.openPopoutLeaf({ size: { width: 1180, height: 760 } }) : workspace.getLeaf('tab');
			try { await leaf.setViewState({ type: THEME_LIBRARY_VIEW_TYPE, active: true }); }
			catch (reason) { leaf.detach(); throw reason; }
		} else if (Platform.isDesktop && leaf.getContainer() === workspace.rootSplit) workspace.moveLeafToPopout(leaf, { size: { width: 1180, height: 760 } });
		await workspace.revealLeaf(leaf);
	})();
	opening.set(plugin, task);
	try { await task; } finally { opening.delete(plugin); }
}
