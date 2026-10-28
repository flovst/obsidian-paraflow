import { Scope, requireApiVersion, type App, type View } from 'obsidian';
import { bindBlockMoveScope, type RegisterBlockMoveScope } from './block-move-scope.js';
import { isPrimarySourceEditor } from './surface.js';

export function createBlockMoveScopeRegistration(app: App): RegisterBlockMoveScope {
	return (view, handle) => requireApiVersion('1.5.7') ? bindBlockMoveScope(view, () => {
		if (!isPrimarySourceEditor(view)) return null;
		let owner: View | null = null;
		app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view.getViewType() === 'markdown' && leaf.view.containerEl.contains(view.dom)) owner = leaf.view;
		});
		if (!owner) return null;
		const target = owner as View;
		return { owner: target, scope: new Scope(target.scope ?? app.scope) };
	}, handle) : () => {};
}
