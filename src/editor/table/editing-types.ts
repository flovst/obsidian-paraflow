import type {EditorView} from '@codemirror/view';
import type {TableConversionLoss} from './markdown-serialization';
import type {TableMenuPresenter} from './popup';
import type {NativeCellEditor,NativeClipboardAction} from './native-text-actions';

export interface TableValueRequest {
	readonly title: string;
	readonly initial: string;
	readonly kind: 'font' | 'size' | 'color' | 'link';
	readonly preview: (value: string) => void;
	readonly clearPreview: () => void;
}

export interface TableClipboardContent {readonly text:string;readonly html?:string;}

export interface TableEditingOptions {
	/** The host owns menu DOM, keyboard navigation and viewport placement. */
	showMenu?:TableMenuPresenter;
	renderMenuIcon?: (element:HTMLElement,name:string)=>void;
	getAutoWrap?: () => boolean;
	setAutoWrap?: (enabled: boolean) => Promise<void>;
	/** Hidden by default; external controls never consume cell editing width. */
	getHideAddControls?: () => boolean;
	/** Body-level controls belong only to the current workspace leaf. */
	isActiveView?: (view: EditorView) => boolean;
	/** Source-mode focus handoff must not activate a hidden Reading editor. */
	isSourceMode?: (view: EditorView) => boolean;
	/** Captured before native cells stop bubbling; augments their existing menu. */
	onNativeContextMenu?: (view: EditorView, event: MouseEvent) => void;
	/** Public host scope must see Mod+Enter before the global shortcut stops DOM propagation. */
	registerKeyScope?: (view: EditorView, handler: (event: KeyboardEvent) => void) => () => void;
	isActive: (view: EditorView) => boolean;
	notify: (message: string) => void;
	getMergeWarning: () => boolean;
	setMergeWarning: (enabled: boolean) => Promise<void>;
	confirmMerge: () => Promise<{confirmed:boolean;suppressWarning:boolean}>;
	confirmConversion?: (losses:readonly TableConversionLoss[]) => Promise<boolean>;
	requestValue: (request: TableValueRequest) => Promise<string|null>;
	requestDimensions: () => Promise<{rows:number;columns:number}|null>;
	writeClipboard: (text: string) => Promise<void>;
	writeClipboardContent?: (content:TableClipboardContent) => Promise<void>;
	readClipboard?: () => Promise<TableClipboardContent>;
	getNativeCellEditor?: (view:EditorView,cell:HTMLElement) => NativeCellEditor|null;
	openWikiLink?: (view:EditorView,target:string,newLeaf:boolean)=>void|Promise<void>;
	nativeClipboard?: (view:EditorView,action:NativeClipboardAction) => void;
}
