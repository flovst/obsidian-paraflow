import type {TableMenuItem} from './popup';

export type TableTextCommand='wiki'|'link'|'bold'|'italic'|'strikethrough'|'code'|'math'|'comment'|'clear'|'cut'|'copy'|'paste'|'pastePlain'|'selectAll'|`highlight:${string}`;
export type TableTextCommandState=Pick<TableMenuItem,'run'|'disabled'|'disabledReason'|'checked'>;

/** Both cell editors expose the same host-derived groups; capabilities supply behavior. */
export function tableTextMenu(command:(command:TableTextCommand)=>TableTextCommandState):TableMenuItem[] {
	const item=(key:TableTextCommand,label:string,icon:string):TableMenuItem=>({label,icon,...command(key)});
	return [item('wiki','新增链接','link'),item('link','新增外部链接','external-link'),
		{label:'文本格式',icon:'paintbrush',separatorBefore:true,children:[
			item('bold','加粗','bold'),item('italic','斜体','italic'),item('strikethrough','删除线','strikethrough'),
			{label:'高亮',icon:'highlighter',children:[['','默认'],['red','红色'],['orange','橙色'],['yellow','黄色'],['green','绿色'],['blue','蓝色'],['purple','紫色']].map(([color,label])=>item(`highlight:${color!}`,label!,'highlighter'))},
			{...item('code','行内代码','code'),separatorBefore:true},item('math','行内数学','sigma'),item('comment','注释','percent'),{...item('clear','清除格式','eraser'),separatorBefore:true},
		]},
		{label:'段落设置',icon:'pilcrow',disabled:true,disabledReason:'表格单元格内不支持段落操作'},
		{label:'插入',icon:'list-plus',disabled:true,disabledReason:'表格单元格内不支持块插入'},
		{...item('cut','剪切','scissors'),separatorBefore:true},item('copy','复制','copy'),item('paste','粘贴','clipboard-check'),item('pastePlain','以纯文本形式粘贴','clipboard-type'),item('selectAll','全选','box-select'),
	];
}
