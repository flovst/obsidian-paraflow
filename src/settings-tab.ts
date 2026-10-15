import { Notice, PluginSettingTab, Setting } from 'obsidian';
import { ImportTyporaThemeModal, showThemeReport } from './themes/import-modal.js';
import type ParaFlowPlugin from './main.js';
import type { ThemeOverrides } from './themes/appearance.js';
import { normalizeEnhancements, type EnhancementToggle } from './enhancement-settings.js';
import { isMathSourcePalette, MATH_SOURCE_PALETTES } from './themes/math-palette.js';

const STRUCTURED_LIST_DESCRIPTION = 'Affects recognized standard Markdown lists in Live Preview only.';
const PARAGRAPH_DESCRIPTION = 'Affects parser-confirmed ordinary paragraphs in Live Preview only.';
const HTML_BREAK_MARKERS_DESCRIPTION = 'Shows muted <br> markers in Live Preview while line break markers are enabled.';
const HARD_BREAK_MARKERS_DESCRIPTION = 'Shows muted markers for Markdown hard line breaks in Live Preview while line break markers are enabled.';
const LINK_CLICK_DESCRIPTION = 'Places the caret and reveals Markdown link source on a plain click. Use Ctrl/Cmd-click to open the link.';
const TEXT_DRAG_DESCRIPTION = 'Prevents dragging an existing text selection to move it in Source and Live Preview.';

export class ParaFlowSettingTab extends PluginSettingTab {
	private category = 'theme';
	constructor(private readonly paraFlow: ParaFlowPlugin) {
		super(paraFlow.app, paraFlow);
	}

	display(): void {
		this.containerEl.empty();
		const navigation = this.containerEl.createDiv({ cls: 'paraflow-settings-categories' });
		navigation.setAttribute('aria-label', '设置分类');
		for (const [key, label] of [['theme', '主题'], ['editing', '编辑'], ['source', '源码'], ['body', '正文'],
			['callout', 'Callout'], ['footnotes', '脚注'], ['images', '图片'], ['code', '代码'], ['math', '公式'], ['table', '表格'], ['clipboard', '复制粘贴']]) {
			const button = navigation.createEl('button', { text: label, attr: { type: 'button', 'aria-pressed': String(this.category === key) } });
			button.addEventListener('click', () => { this.category = key!; this.display(); });
		}
		if (this.category === 'theme') this.displayTheme();
		else if (this.category === 'editing') this.displayEditing();
		else if (this.category === 'source') this.displaySource();
		else if (this.category === 'body') this.displayBody();
		else this.displayModule();
	}

	private displayTheme(): void {
		new Setting(this.containerEl).setName('Theme').setHeading();
		new Setting(this.containerEl).setName('Content theme')
			.setDesc('Styles Markdown content in live preview and reading view. Imported Typora themes may be partially adapted.')
			.addDropdown(dropdown => {
				dropdown.addOption('', 'Follow Obsidian');
				for (const theme of this.paraFlow.contentThemes) {
					const duplicate = this.paraFlow.contentThemes.filter(item => item.name === theme.name).length > 1;
					dropdown.addOption(theme.id, duplicate ? theme.name + ' (' + theme.id.slice(-8) + ')' : theme.name);
				}
				dropdown.setValue(this.paraFlow.contentThemeId ?? '').onChange(async id => {
					try { await this.paraFlow.setContentTheme(id || null); this.display(); }
					catch (error) { dropdown.setValue(this.paraFlow.contentThemeId ?? ''); new Notice(String(error)); }
				});
			});
		new Setting(this.containerEl).setName('Import Typora theme')
			.setDesc('Convert a local CSS file or a theme package with its resources.')
			.addButton(button => button.setButtonText('Import Typora theme').onClick(() => {
				new ImportTyporaThemeModal(this.app, async (theme, overrides) => {
					await this.paraFlow.importContentTheme(theme, overrides); this.display();
				}).open();
			}));
		new Setting(this.containerEl).setName('Theme files')
			.setDesc('Reload applies local overrides.css edits. Export includes sources, resources, overrides, and the conversion report.')
			.addButton(button => button.setButtonText('View report').onClick(async () => {
				try { showThemeReport(this.app, await this.paraFlow.contentThemeReport()); }
				catch (error) { new Notice(String(error)); }
			}))
			.addButton(button => button.setButtonText('Reload').onClick(async () => {
				try { await this.paraFlow.setContentTheme(this.paraFlow.contentThemeId, true); new Notice('Content theme reloaded'); }
				catch (error) { new Notice(String(error)); }
			}))
			.addButton(button => {
				button.buttonEl.disabled = this.paraFlow.contentThemeId === null || this.paraFlow.contentThemeId === 'builtin-classic';
				button.setButtonText('Export').onClick(async () => {
					try {
						const bytes = await this.paraFlow.exportContentTheme();
						const document = this.containerEl.ownerDocument;
						const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }));
						const link = document.createElement('a'); link.href = url; link.download = this.paraFlow.contentThemeId + '.zip'; link.click();
						document.defaultView?.setTimeout(() => URL.revokeObjectURL(url), 1000);
					} catch (error) { new Notice(String(error)); }
				});
			});
		this.displayAppearance();
	}

	private displaySource(): void {
		new Setting(this.containerEl).setName('源码视图').setHeading();
		this.enhancementToggle('sourceView', '源码检查辅助', '使用主题正文字体，保留标题大小和语法配色，忠实显示实际源码。关闭后恢复原生显示。');
		this.enhancementToggle('sourceActiveLine', '高亮当前行', '高亮光标所在的源码行。', 'sourceView');
		this.enhancementToggle('sourceWhitespace', '显示前导空白', '仅标记光标所在行前导空格和 Tab；零宽空格始终可见，标记不会写入文件。', 'sourceView');
		this.enhancementToggle('sourceIndentGuides', '显示缩进参考线', '仅控制源码模式的原生缩进参考线，不改变空白字符或实时预览。', 'sourceView');
		this.enhancementToggle('sourceLineNumbers', '显示行号', '按源码的物理行编号；折行不增加行号。', 'sourceView');
		this.enhancementToggle('sourceNewlineMarkers', '显示换行标记', '普通源码换行为 ↵，两尾空格的 Markdown 硬换行为 ↴；视觉折行和无换行的文件末尾不加标记。', 'sourceView');
		for (const [key, name, choices] of [
			['sourceLineNumberStyle', '行号显示', { full: '完整', compact: '精简（每10行及光标行）' }],
			['sourceLineNumberPosition', '行号位置', { 'editor-left': '编辑器左边', 'body-left': '正文左边' }],
		] as const) new Setting(this.containerEl).setName(name).addDropdown(dropdown => {
			for (const [value, label] of Object.entries(choices)) dropdown.addOption(value, label);
			dropdown.selectEl.disabled = !this.paraFlow.enhancements.sourceView || !this.paraFlow.enhancements.sourceLineNumbers;
			dropdown.setValue(this.paraFlow.enhancements[key]).onChange(async value => {
				try { await this.paraFlow.setEnhancement(key, normalizeEnhancements({ [key]: value })[key]); }
				catch (error) { dropdown.setValue(this.paraFlow.enhancements[key]); new Notice(String(error)); }
			});
		});
		new Setting(this.containerEl).setName('源码制表符宽度')
			.setDesc('按等宽字符列对齐到制表位，仅影响源码显示；不修改实际字符或实时预览的宽度。')
			.addDropdown(dropdown => {
				for (let size = 1; size <= 8; size++) dropdown.addOption(String(size), `${size} 列`);
				dropdown.selectEl.disabled = !this.paraFlow.enhancements.sourceView;
				dropdown.setValue(String(this.paraFlow.enhancements.sourceTabSize)).onChange(async value => {
						try { await this.paraFlow.setEnhancement('sourceTabSize', Number(value)); }
						catch (error) { dropdown.setValue(String(this.paraFlow.enhancements.sourceTabSize)); new Notice(String(error)); }
					});
			});
	}

	private displayEditing(): void {
		new Setting(this.containerEl).setName('Editing').setHeading();
		this.enhancementToggle('maintainListIndentOnSave', '保存时修复列表缩进', '在主编辑器按 Ctrl/Cmd + S 时，补足已确认列表续行缺少的结构缩进。保留正文、列表符号和编号；自动保存不触发，可单独撤销。');
		this.enhancementToggle('maintainListIndentOnModeChange', '切换模式时修复列表缩进', '在同一文件切换实时预览、源码或阅读模式时补足列表续行的结构缩进，可单独撤销。默认关闭。');
		for (const [key, label, example] of [['subscript', '下标', 'H~2~O'], ['superscript', '上标', 'x^2^']] as const) {
			new Setting(this.containerEl).setName(label).setDesc(`显示 ${example} 这样的简写；不改写笔记源码。`)
				.addToggle(toggle => toggle.setValue(this.paraFlow.enhancements[key]).onChange(async value => {
					try { await this.paraFlow.setEnhancement(key, value); }
					catch (error) { toggle.setValue(this.paraFlow.enhancements[key]); new Notice(String(error)); }
				}));
		}
		new Setting(this.containerEl).setName('实时预览中的注释显示方式')
			.setDesc('只影响实时预览；源码模式始终显示，阅读视图始终隐藏。')
			.addDropdown(dropdown => dropdown.addOptions({ always: '始终淡显', editing: '仅编辑时显示' })
				.setValue(this.paraFlow.enhancements.commentDisplay).onChange(async value => {
					if (value !== 'always' && value !== 'editing') return;
					try { await this.paraFlow.setEnhancement('commentDisplay', value); }
					catch (error) { dropdown.setValue(this.paraFlow.enhancements.commentDisplay); new Notice(String(error)); }
				}));
		new Setting(this.containerEl)
			.setName('Paragraph editing')
			.setDesc(PARAGRAPH_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.paragraphEditingEnabled)
				.onChange(async (enabled) => {
					await this.paraFlow.setParagraphEditingEnabled(enabled);
				}));
		new Setting(this.containerEl)
			.setName('Structured list editing')
			.setDesc(STRUCTURED_LIST_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.structuredListEditingEnabled)
				.onChange(async (enabled) => {
					await this.paraFlow.setStructuredListEditingEnabled(enabled);
				}));
		new Setting(this.containerEl)
			.setName('Edit links on plain click')
			.setDesc(LINK_CLICK_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.editLinksOnPlainClick)
				.onChange(async (enabled) => {
					await this.paraFlow.setEditLinksOnPlainClick(enabled);
				}));
		new Setting(this.containerEl)
			.setName('Disable selected text dragging')
			.setDesc(TEXT_DRAG_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.disableSelectedTextDrag)
				.onChange(async (enabled) => {
					try { await this.paraFlow.setDisableSelectedTextDrag(enabled); }
					catch (error) { toggle.setValue(this.paraFlow.disableSelectedTextDrag); new Notice(String(error)); }
				}));
		new Setting(this.containerEl)
			.setName('Hide caret while drag-selecting')
			.setDesc('Hides the blinking caret while creating a text selection with the mouse in source and live preview.')
			.addToggle(toggle => toggle.setValue(this.paraFlow.hideCaretWhileDragSelecting).onChange(async enabled => {
				try { await this.paraFlow.setHideCaretWhileDragSelecting(enabled); }
				catch (error) { toggle.setValue(this.paraFlow.hideCaretWhileDragSelecting); new Notice(String(error)); }
			}));
	}

	private enhancementToggle(key: EnhancementToggle, name: string, description: string, parent?: EnhancementToggle): void {
		new Setting(this.containerEl).setName(name).setDesc(description + (parent && !this.paraFlow.enhancements[parent] ? ' 模块已关闭，选项仍会保存。' : '')).addToggle(toggle => toggle
			.setValue(this.paraFlow.enhancements[key])
			.onChange(async value => {
				try { await this.paraFlow.setEnhancement(key, value); this.display(); }
				catch (error) { toggle.setValue(this.paraFlow.enhancements[key]); new Notice(String(error)); }
			}));
	}

	private displayBody(): void {
		new Setting(this.containerEl).setName('正文排版').setHeading();
		this.enhancementToggle('bodyLayout', '正文排版增强', '控制正文缩进和段间距；关闭后保留以下选项。');
		this.enhancementToggle('paragraphIndent', '首行缩进', '顶层普通段落首行缩进 2em，不修改源码。', 'bodyLayout');
		new Setting(this.containerEl).setName('正文制表符显示').setDesc('固定宽度使每个制表符等宽；制表位按当前行的位置对齐。保留源码中的制表符。')
			.addDropdown(dropdown => dropdown.addOption('fixed', '固定宽度').addOption('tab-stops', '制表位')
				.setValue(this.paraFlow.enhancements.bodyTabMode).onChange(async value => {
					if (value !== 'fixed' && value !== 'tab-stops') return;
					try { await this.paraFlow.setEnhancement('bodyTabMode', value); }
					catch (error) { new Notice(String(error)); }
				}));
		new Setting(this.containerEl).setName('正文制表符宽度').setDesc('使用当前内容字体的空格宽度，默认 8；可设 1–32。')
			.addText(text => text.setValue(String(this.paraFlow.enhancements.bodyTabSize)).onChange(async input => {
				const value = Number(input);
				if (!Number.isInteger(value) || value < 1 || value > 32) return;
				try { await this.paraFlow.setEnhancement('bodyTabSize', value); }
				catch (error) { new Notice(String(error)); }
			}));
		new Setting(this.containerEl).setName('段间距').setDesc('单位 em；留空跟随内容主题。不会增删源码空行。')
			.addText(text => text.setPlaceholder('跟随主题').setValue(this.paraFlow.enhancements.paragraphSpacingEm?.toString() ?? '')
				.onChange(async input => {
					const value = input.trim() ? Number(input) : null;
					if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10)) return;
					try { await this.paraFlow.setEnhancement('paragraphSpacingEm', value); }
					catch (error) { new Notice(String(error)); }
				}));
		new Setting(this.containerEl).setName('换行标记').setHeading();
		new Setting(this.containerEl)
			.setName('Enable line break markers')
			.setDesc('Show markers in ordinary live preview paragraphs independently of paragraph editing. Turning off retains the options below.')
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.breakMarkersEnabled)
				.onChange(async (enabled) => {
						try { await this.paraFlow.setBreakMarkersEnabled(enabled); }
					catch (error) { toggle.setValue(this.paraFlow.breakMarkersEnabled); new Notice(String(error)); }
				}));
		new Setting(this.containerEl)
			.setName('HTML break markers')
			.setDesc(HTML_BREAK_MARKERS_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.htmlBreakMarkersEnabled)
				.onChange(async (enabled) => {
					try { await this.paraFlow.setLineBreakMarkersEnabled('html', enabled); }
					catch (error) { toggle.setValue(this.paraFlow.htmlBreakMarkersEnabled); new Notice(String(error)); }
				}));
		new Setting(this.containerEl)
			.setName('Hard line break markers')
			.setDesc(HARD_BREAK_MARKERS_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.hardBreakMarkersEnabled)
				.onChange(async (enabled) => {
					try { await this.paraFlow.setLineBreakMarkersEnabled('hard', enabled); }
					catch (error) { toggle.setValue(this.paraFlow.hardBreakMarkersEnabled); new Notice(String(error)); }
				}));
	}

	private displayModule(): void {
		switch (this.category) {
			case 'clipboard':
				new Setting(this.containerEl).setName('粘贴处理').setHeading();
				for (const [key, name] of [['sourcePasteMode', '源码模式 / Source'], ['livePreviewPasteMode', '实时预览 / Live Preview']] as const) {
					new Setting(this.containerEl).setName(name)
						.setDesc('精确文本保留可表示的原文；智能粘贴使用 Obsidian 的富文本和附件处理。单次命令可临时覆盖此设置。')
						.addDropdown(dropdown => dropdown.addOptions({ exact: '精确文本 / Exact text', smart: '智能粘贴 / Smart paste' })
							.setValue(this.paraFlow.enhancements[key]).onChange(async value => {
								if (value !== 'exact' && value !== 'smart') return;
								try { await this.paraFlow.setEnhancement(key, value); }
								catch (error) { dropdown.setValue(this.paraFlow.enhancements[key]); new Notice(String(error)); }
							}));
				}
				this.enhancementToggle('pasteCloseCodeFences', '智能粘贴时闭合代码块', '仅智能粘贴补齐新粘入的未闭合代码围栏；已有代码、公式和原始 HTML 内部保持原样。复制与精确粘贴不受影响。Ctrl/Cmd + Shift + V 本次使用精确文本。');
				break;
			case 'math':
				new Setting(this.containerEl).setName('公式源码配色')
					.setDesc('设置公式编辑时的高亮颜色；不改变公式内容和渲染字形。')
					.addDropdown(dropdown => dropdown.addOptions(MATH_SOURCE_PALETTES)
						.setValue(this.paraFlow.enhancements.mathSourcePalette).onChange(async value => {
							if (!isMathSourcePalette(value)) return;
							try { await this.paraFlow.setEnhancement('mathSourcePalette', value); }
							catch (error) { dropdown.setValue(this.paraFlow.enhancements.mathSourcePalette); new Notice(String(error)); }
						}));
				break;
			case 'callout':
				this.enhancementToggle('callout', 'Callout 增强', '保留原生类型、折叠及混排；内部列表编辑还需要开启列表编辑。');
				break;
			case 'footnotes':
				this.enhancementToggle('footnotes', '脚注增强', '显示原始脚注名称，定义保留在源码原位置。Ctrl/Cmd 点击引用或返回入口进行导航。');
				this.enhancementToggle('footnoteHideDefinitionMarkers', '仅编辑时显示定义符号', '平时保留脚注名称和定义文字，进入定义标记时显示完整源码。', 'footnotes');
				break;
			case 'images':
				this.enhancementToggle('images', '图片增强', '改善独立图片布局，保留原生编辑和明确的尺寸、对齐。');
				this.enhancementToggle('imageCenter', '独立图片居中', '不把行内图片强制变为独立块。', 'images');
				break;
			case 'code':
				this.enhancementToggle('code', '代码块增强', '普通代码块的显示与复制；特殊渲染块仍由 Obsidian 处理。');
				this.enhancementToggle('codeWordWrap', '自动换行', '只做视觉折行；关闭后整个代码块统一横向滚动。打印时始终折行。', 'code');
				this.enhancementToggle('codeLineNumbers', '逻辑行号', '按真实代码行编号，视觉续行不增加编号，复制不带行号。', 'code');
				new Setting(this.containerEl).setName('语言控件位置').setDesc('右下角在编辑代码块时显示；右上角标签悬停展开。关闭仅隐藏语言控件。')
					.addDropdown(dropdown => dropdown.addOptions({off:'关闭','top-right':'右上角','bottom-right':'右下角'})
						.setValue(this.paraFlow.enhancements.codeLanguagePosition).onChange(async value => {
							if(value !== 'off' && value !== 'top-right' && value !== 'bottom-right') return;
							try { await this.paraFlow.setEnhancement('codeLanguagePosition', value); }
							catch(error) { dropdown.setValue(this.paraFlow.enhancements.codeLanguagePosition); new Notice(String(error)); }
						}));
				break;
			case 'table':
				this.enhancementToggle('tableDisplay', '表格显示增强', '自动布局、条纹和溢出处理；关闭后仍可单独使用表格编辑。');
				this.enhancementToggle('tableEditing', '表格编辑增强', '保留原生 Markdown 表格操作，扩展合并、取消合并、格式和标准 HTML 转换。');
				this.enhancementToggle('tableAutoWrap', '表格自动折行', '默认开启，仅影响表格。关闭后保持单元格不自动折行，宽表格可横向滚动。');
				this.enhancementToggle('tableHideAddControls', '隐藏新增行列控件', '默认隐藏。关闭后，悬停表格时在下方和右侧显示新增控件。', 'tableEditing');
				this.enhancementToggle('mergeWarning', '合并丢弃内容时提示', '合并只保留左上角内容；此选项可重新开启已隐藏的提示。', 'tableEditing');
				break;
		}
	}

	private displayAppearance(): void {
		const current = this.paraFlow.contentThemeOverrides;
		const preset = this.paraFlow.contentThemes.find(theme => theme.id === this.paraFlow.contentThemeId);
		const save = async (key: keyof ThemeOverrides, value: string | number | undefined) => {
			const next = { ...this.paraFlow.contentThemeOverrides, [key]: value };
			if (value === undefined) delete next[key];
			try { await this.paraFlow.setContentThemeOverrides(next); }
			catch (error) { new Notice(String(error)); }
		};
		new Setting(this.containerEl).setName('Content palette')
			.setDesc(preset?.colorScheme === 'light' || preset?.colorScheme === 'dark'
				? `This preset has a fixed ${preset.colorScheme} palette. Changes below correct fallback colors; they do not recolor the original theme.`
				: 'Choose fallback colors for Markdown content. Obsidian appearance is unchanged.')
			.addDropdown(dropdown => {
				dropdown.addOptions({ '': 'Preset', host: 'Follow Obsidian', light: 'Light', dark: 'Dark' })
					.setValue(current.colorScheme ?? '').onChange(value => save('colorScheme', value || undefined));
			});
		const fields = [
			['fontFamily', 'Text font', 'Georgia, serif', undefined, undefined],
			['fontSize', 'Text size', '16', 10, 48],
			['width', 'Content width', '800', 320, 1600],
			['lineHeight', 'Line height', '1.6', 1, 2.5],
			['accentColor', 'Accent color', '#428bca', undefined, undefined],
		] as const;
		for (const [key, name, placeholder, min, max] of fields) {
			const value = current[key];
			const mode = value === undefined ? '' : value === 'host' ? 'host' : 'custom';
			const setting = new Setting(this.containerEl).setName(name).setDesc(key === 'width'
				? 'Maximum content width in pixels. Follow Obsidian respects readable line length.'
				: key === 'lineHeight' ? 'Line-height multiplier; paragraph spacing is unchanged.'
					: key === 'accentColor' ? 'Links and accent elements; syntax colors are unchanged.'
						: key === 'fontSize' ? 'Body text size in pixels. Headings and code keep any sizes explicitly defined by the preset.'
							: 'Use the preset, follow Obsidian, or set a local value.');
			setting.addDropdown(dropdown => dropdown.addOptions({ '': 'Preset', host: 'Follow Obsidian', custom: 'Custom' })
				.setValue(mode).onChange(async source => {
					await save(key, source === '' ? undefined : source === 'host' ? 'host' : min === undefined ? placeholder : Number(placeholder));
					this.display();
				}));
			if (mode === 'custom') setting.addText(text => text.setPlaceholder(placeholder).setValue(String(value)).onChange(async input => {
				const parsed = min === undefined ? input.trim() : Number(input);
				if (min !== undefined && (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < min || parsed > max)) return;
				if (key === 'accentColor' && !/^#[a-f\d]{6}$/iu.test(input)) return;
				await save(key, parsed);
			}));
		}
		new Setting(this.containerEl).setName('Text weight').addDropdown(dropdown => dropdown
			.addOptions({ '': 'Preset', '300': 'Light (300)', '400': 'Regular (400)', '500': 'Medium (500)' })
			.setValue(current.fontWeight?.toString() ?? '').onChange(value => save('fontWeight', value ? Number(value) : undefined)));
		new Setting(this.containerEl).setName('Unordered list markers').addDropdown(dropdown => dropdown
			.addOptions({ '': 'Preset', layered: 'By nesting level', disc: 'Disc', circle: 'Circle', square: 'Square' })
			.setValue(current.marker ?? '').onChange(value => save('marker', value || undefined)));
		new Setting(this.containerEl).setName('Properties layout')
			.setDesc('Align the property panel with the body column; property names and values remain left aligned. Visibility and source display are controlled in Obsidian → editor → properties in document.')
			.addDropdown(dropdown => dropdown.addOptions({content:'Center with body',native:'Obsidian layout'})
				.setValue(current.metadataLayout ?? 'content').onChange(value => save('metadataLayout',value)));
		for (const [key,name,max] of [['metadataPadding','Properties horizontal padding',100],['metadataGap','Space below properties',300]] as const) {
			new Setting(this.containerEl).setName(name).setDesc(`Pixels (0–${max}). Leave blank to use Obsidian spacing.`)
				.addText(text => text.setPlaceholder('Obsidian').setValue(current[key]?.toString() ?? '').onChange(async input => {
					if (!input.trim()) { await save(key,undefined); return; }
					const value=Number(input);
					if (Number.isFinite(value) && value>=0 && value<=max) await save(key,value);
				}));
		}
		new Setting(this.containerEl).setName('Reset preset adjustments')
			.setDesc('Remove local adjustments for this preset. Theme files and editor behavior are unchanged.')
			.addButton(button => button.setButtonText('Reset').onClick(async () => {
				await this.paraFlow.setContentThemeOverrides({}); this.display();
			}));
	}
}
