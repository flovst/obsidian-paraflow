import { PluginSettingTab, Setting } from 'obsidian';
import type ParaFlowPlugin from './main.js';

const STRUCTURED_LIST_DESCRIPTION = 'Affects Live Preview only; '
	+ 'third-party list/task plugin compatibility is deferred.';

export class ParaFlowSettingTab extends PluginSettingTab {
	constructor(private readonly paraFlow: ParaFlowPlugin) {
		super(paraFlow.app, paraFlow);
	}

	display(): void {
		this.containerEl.empty();
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
