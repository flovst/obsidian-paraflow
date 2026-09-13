import { PluginSettingTab, Setting } from 'obsidian';
import type ParaFlowPlugin from './main.js';

const STRUCTURED_LIST_DESCRIPTION = 'Affects recognized standard Markdown lists in Live Preview only.';
const PARAGRAPH_DESCRIPTION = 'Affects parser-confirmed ordinary paragraphs in Live Preview only.';
const LINE_BREAK_MARKERS_DESCRIPTION = 'Shows muted markers for Markdown hard line breaks and inline HTML breaks in Live Preview.';

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
	}
}
