/** Obsidian 1.14 Menu runtime boundary; sorting creates section submenus lazily. */
export interface ContentMenuItem {
	dom: HTMLElement;
	titleEl: HTMLElement;
	iconEl: HTMLElement;
	section: string;
	submenu: ContentMenu | null;
	disabled: boolean;
	setTitle(title: string): this;
	setSection(section: string): this;
	setIcon(icon: string): this;
	setDisabled(disabled: boolean): this;
	setChecked(checked: boolean): this;
	setSubmenu(): ContentMenu;
	onClick(callback: () => void): this;
}
export interface ContentMenu {
	items: Array<ContentMenuItem | { dom: HTMLElement }>;
	sections: string[];
	submenuConfigs: Record<string, unknown>;
	dom: HTMLElement;
	sort(): void;
	addItem(callback: (item: ContentMenuItem) => void): this;
	setUseNativeMenu(native: boolean): this;
}

export function contentMenuItems(menu: ContentMenu): ContentMenuItem[] {
	return menu.items.filter((item): item is ContentMenuItem => 'setSection' in item);
}
export function contentMenuIcon(item: ContentMenuItem): string {
	return Array.from(item.iconEl.querySelector('svg')?.classList ?? []).find(name => name.startsWith('lucide-'))?.slice(7) ?? '';
}

const commandsByIcon: Readonly<Record<string, string>> = {
	bold: 'editor:toggle-bold', italic: 'editor:toggle-italics', strikethrough: 'editor:toggle-strikethrough',
	highlighter: 'editor:toggle-highlight', 'code-2': 'editor:toggle-code', percent: 'editor:toggle-comments',
	sigma: 'editor:toggle-inline-math', eraser: 'editor:clear-formatting',
	link: 'editor:insert-wikilink', 'external-link': 'editor:insert-link',
	text: 'editor:set-heading-0', 'heading-1': 'editor:set-heading-1', 'heading-2': 'editor:set-heading-2',
	'heading-3': 'editor:set-heading-3', 'heading-4': 'editor:set-heading-4', 'heading-5': 'editor:set-heading-5', 'heading-6': 'editor:set-heading-6',
	list: 'editor:toggle-bullet-list', 'list-ordered': 'editor:toggle-numbered-list', quote: 'editor:toggle-blockquote',
};

export function contentMenuActionPresentation(icon: string, section: string, color?: string): {
	title?: string; commandId?: string; systemShortcut?: 'cut' | 'copy' | 'paste' | 'selectAll';
} | null {
	if (section === 'clipboard') {
		const systems: Record<string, 'cut' | 'copy' | 'paste' | 'selectAll'> = { scissors: 'cut', copy: 'copy', 'clipboard-check': 'paste', 'box-select': 'selectAll' };
		return { systemShortcut: systems[icon], ...(icon === 'clipboard-type' ? { title: '粘贴为纯文本' } : {}) };
	}
	if (section === 'selection-link') return { commandId: commandsByIcon[icon] };
	if (/(?:^|\.)insert(?:\.|$)/u.test(section)) {
		const commands: Record<string, string> = { code: 'editor:insert-codeblock', 'sigma-square': 'editor:insert-mathblock', table: 'editor:insert-table',
			'file-signature': 'editor:insert-footnote', minus: 'editor:insert-horizontal-rule', quote: 'editor:insert-callout' };
		return { commandId: commands[icon], ...(icon === 'quote' ? { title: 'Callout' } : icon === 'sigma-square' ? { title: '公式块' } : {}) };
	}
	if (!/(?:^|\.)(?:format|paragraph)(?:\.|$)/u.test(section)) return null;
	const titles: Record<string, string> = { eraser: '清除文本格式', 'code-2': '行内代码', sigma: '行内公式', italic: '斜体' };
	return { commandId: color ? `editor:toggle-highlight-${color}` : commandsByIcon[icon], title: titles[icon] };
}
function assignSections(menu: ContentMenu, groups: Array<{ section: string; items: ContentMenuItem[] }>): void {
	menu.sections = groups.map(group => group.section);
	menu.submenuConfigs = {};
	menu.items = groups.flatMap(group => group.items.map(item => item.setSection(group.section)));
}

/** Reuses host items so edit callbacks, disabled states and plugin entries keep their target. */
export function organizeContentMenu(menu: ContentMenu, options: {
	convertCallout: () => void;
	calloutDisabled: boolean;
	inTable: boolean;
	decorate: (item: ContentMenuItem, icon: string, section: string) => void;
	addObjectItems: (menu: ContentMenu) => void;
	translate?: (label: string) => string;
}): void {
	const translate = options.translate ?? (label => label);
	const items = contentMenuItems(menu);
	const decorateOriginal = (level: ContentMenu, parentSection = ''): void => {
		for (const item of contentMenuItems(level)) {
			const section = item.section || parentSection;
			options.decorate(item, contentMenuIcon(item), section);
			if (item.submenu) decorateOriginal(item.submenu, section);
		}
	};
	decorateOriginal(menu);
	const links = items.filter(item => item.section === 'selection-link' && ['link', 'external-link'].includes(contentMenuIcon(item)));
	for (const item of links) item.setTitle(translate(contentMenuIcon(item) === 'link' ? '插入 Wiki 链接' : '插入链接'));
	const paragraph = items.find(item => item.submenu && contentMenuIcon(item) === 'pilcrow');
	const insert = items.find(item => item.submenu && contentMenuIcon(item) === 'list-plus');
	const format = items.find(item => item.submenu && contentMenuIcon(item) === 'paintbrush');
	if (paragraph?.submenu && !options.inTable) {
		paragraph.setTitle(translate('段落格式'));
		const child = paragraph.submenu;
		child.sort();
		const actions = contentMenuItems(child);
		const heading = actions.filter(item => /^(?:heading-[1-6]|text)$/u.test(contentMenuIcon(item)));
		heading.sort((a, b) => (contentMenuIcon(a) === 'text' ? 0 : Number(contentMenuIcon(a).slice(-1))) - (contentMenuIcon(b) === 'text' ? 0 : Number(contentMenuIcon(b).slice(-1))));
		const lists = actions.filter(item => ['list', 'list-ordered', 'check-square', 'square-check'].includes(contentMenuIcon(item)));
		const rest = actions.filter(item => !heading.includes(item) && !lists.includes(item));
		child.addItem(item => { item.setTitle('Callout').setIcon('message-square').setDisabled(options.calloutDisabled).onClick(options.convertCallout); rest.push(item); });
		assignSections(child, [{ section: 'heading', items: heading }, { section: 'list', items: lists }, { section: 'block', items: rest }]);
	}
	if (insert?.submenu) {
		const child = insert.submenu;
		child.sort();
		const actions = contentMenuItems(child);
		const advanced = actions.filter(item => ['code', 'sigma-square'].includes(contentMenuIcon(item)));
		const basic = actions.filter(item => !advanced.includes(item));
		assignSections(child, [{ section: 'links', items: links }, ...options.inTable ? [] : [{ section: 'basic', items: basic }, { section: 'advanced', items: advanced }]]);
		insert.setDisabled(false);
	}
	const clipboard = items.filter(item => item.section === 'clipboard');
	const common = [format, ...(options.inTable ? [] : [paragraph]), insert].filter((item): item is ContentMenuItem => !!item);
	const objects = items.filter(item => !clipboard.includes(item) && !common.includes(item) && !links.includes(item) && item !== paragraph);
	options.addObjectItems(menu);
	objects.push(...contentMenuItems(menu).filter(item => !items.includes(item)));
	assignSections(menu, [{ section: 'clipboard', items: clipboard }, { section: 'selection', items: common }, { section: 'object', items: objects }]);
	const styleChildren = (level: ContentMenu): void => {
		level.dom.classList.add('paraflow-context-menu');
		for (const item of contentMenuItems(level)) {
			if (item.submenu) styleChildren(item.submenu);
		}
	};
	styleChildren(menu);
}
