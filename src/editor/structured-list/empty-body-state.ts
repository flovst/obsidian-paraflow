import type { EditorState } from '@codemirror/state';
import {emptyBodies} from '../runtime/empty-body-state.js';
export {emptyBodyState as listEmptyBodyState, createEmptyBodies as createListEmptyBodyState} from '../runtime/empty-body-state.js';

export function isCreatedListEmptyBody(state:EditorState,position:number):boolean {
 return emptyBodies(state).includes(position);
}