import { PluginSettingTab, Setting } from 'obsidian';
import type ParaFlowPlugin from './main.js';

const STRUCTURED_LIST_DESCRIPTION = 'Affects recognized standard Markdown lists in Live Preview only.';
const PARAGRAPH_DESCRIPTION = 'Affects parser-confirmed ordinary paragraphs in Live Preview only.';
const LINE_BREAK_MARKERS_DESCRIPTION = 'Shows muted markers for Markdown hard line breaks and inline HTML breaks in Live Preview.';
const LINK_CLICK_DESCRIPTION = 'Places the caret and reveals Markdown link source on a plain click. Use Ctrl/Cmd-click to open the link.';
const TEXT_DRAG_DESCRIPTION = 'Prevents dragging an existing text selection to move it within the editor.';

export class ParaFlowSettingTab extends PluginSettingTab {
	constructor(private readonly paraFlow: ParaFlowPlugin) {
		super(paraFlow.app, paraFlow);
	}

	display(): void {
		this.containerEl.empty();
		new Setting(this.containerEl)
			.setName('Paragraph editing')
			.setDesc(PARAGRAPH_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.paragraphEditingEnabled)
				.onChange(async (enabled) => {
					await this.paraFlow.setParagraphEditingEnabled(enabled);
				}));
		new Setting(this.containerEl)
			.setName('Line break markers')
			.setDesc(LINE_BREAK_MARKERS_DESCRIPTION)
			.addToggle((toggle) => toggle
				.setValue(this.paraFlow.lineBreakMarkersEnabled)
				.onChange(async (enabled) => {
					await this.paraFlow.setLineBreakMarkersEnabled(enabled);
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
					await this.paraFlow.setDisableSelectedTextDrag(enabled);
				}));
	}
}
