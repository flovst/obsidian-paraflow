import { type EditorState, type Extension } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { createNativeDecorationOwnership, nativeBlockOwnership } from '../runtime/native-decoration-ownership.js';
import { calloutCards } from './presentation-model.js';

function isNativeCallout(widget: unknown): boolean {
 if (!widget || typeof widget !== 'object') return false;
 const candidate = widget as { clazz?: string; getTypePos?: unknown; updateType?: unknown };
 return candidate.clazz === 'cm-callout' && typeof candidate.getTypePos === 'function' && typeof candidate.updateType === 'function';
}

export function createCalloutNativeOwnership(options: {
 readonly isActive: (view: EditorView) => boolean;
 readonly isActiveState?: (state: EditorState) => boolean;
 readonly isViewSupported?: (view: EditorView) => boolean;
}): Extension {
 return [createNativeDecorationOwnership(), nativeBlockOwnership.of((state, view) => {
  if (!(options.isViewSupported?.(view) ?? options.isActive(view)) || options.isActiveState?.(state) === false) return null;
  const cards = calloutCards(state);
  return (from, to, decoration) => {
   const spec = decoration.spec as { block?: boolean; widget?: unknown };
   return !!spec.block && isNativeCallout(spec.widget) && cards.some(card => card.from === from && card.to === to);
  };
 })];
}
