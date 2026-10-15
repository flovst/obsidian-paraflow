import type {TableEditingOptions} from './editing-types';
import type {TableMenuItem} from './popup';

/** The same six enhancement entries are appended to both primary menus. */
export function tableEnhancementItems(options:TableEditingOptions,merge:readonly TableMenuItem[],source:readonly TableMenuItem[],advanced:()=>void):TableMenuItem[] {
	return [
		...(options.getAutoWrap&&options.setAutoWrap?[{label:'表格自动换行',icon:'wrap-text' as const,checked:options.getAutoWrap()?'on' as const:'off' as const,run:()=>{void options.setAutoWrap!(!options.getAutoWrap!()).catch(error=>options.notify(String(error)));}}]:[]),
		...merge,...source,{label:'表格操作与格式…',icon:'table',run:advanced},
	];
}
