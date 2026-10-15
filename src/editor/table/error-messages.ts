const reasons:Readonly<Record<string,string>>={
	'Markdown requires a complete header row followed by body cells':'Markdown 表格要求首行全部为表头，其余行全部为正文。',
	'Merged cells cannot be expressed in Markdown':'Markdown 表格无法保留合并单元格，请先取消合并。',
	'Row-group semantics cannot be expressed in Markdown':'Markdown 表格无法保留当前的表头、正文或表尾分组。',
	'Cell attributes cannot be expressed in Markdown':'Markdown 表格无法保留此单元格的附加属性。',
	'Cell styles cannot be expressed in Markdown':'Markdown 表格无法保留此单元格的手动样式。',
	'Inline attributes cannot be expressed in Markdown':'Markdown 无法保留格内文字的附加属性或样式。',
	'Inline content has no lossless Markdown representation':'格内内容无法无损转换为 Markdown。',
	'Column alignment differs between cells':'同一列中的对齐方式不同，Markdown 表格无法保留。',
	'Unsupported alignment':'当前对齐方式无法转换为 Markdown。',
	'Empty or multiline code cannot be expressed losslessly':'空代码或多行行内代码无法无损转换。',
	'Link destination cannot be expressed losslessly':'链接地址无法无损转换。',
	'Multiline link title cannot be expressed losslessly':'多行链接标题无法无损转换。',
	'Wiki links and embeds are not supported':'暂不支持转换 Wiki 链接或嵌入内容。',
	'Only inline links with explicit destinations are supported':'目前仅支持直接写出地址的普通链接。',
	'Math cannot be converted losslessly':'数学内容暂时无法无损转换。',
	'Obsidian comments and highlights cannot be converted losslessly':'Obsidian 注释或高亮暂时无法无损转换。',
	'Expected exactly one complete Markdown pipe table':'请选择一张完整的 Markdown 表格。',
	'Invalid alignment separator':'Markdown 表格的表头分隔行或对齐标记不合法。',
	'Row width differs from the header':'此行的单元格数量与表头不同。',
	'Unsupported inline node':'暂不支持此格内内容。',
	'Null characters cannot be preserved by the HTML parser':'HTML 无法保留内容中的空字符。',
	'Text outside a cell cannot be preserved':'表格结构中存在单元格外的文字，无法无损编辑。',
	'Mismatched or omitted closing tag':'HTML 标签没有正确配对或缺少结束标签。',
	'Unsupported HTML declaration, comment or malformed tag':'暂不支持 HTML 声明、注释或不完整的标签。',
	'Expected one complete table':'请选择一张完整的 HTML 表格。',
	'Expected exactly one table':'请选择一张完整的 HTML 表格。',
	'Expected one complete table with explicit closing tags':'请选择一张结束标签完整的 HTML 表格。',
	'Nested links cannot be preserved':'嵌套链接无法无损保留。',
	'Only br may use a self-closing tag':'此处只有 br 可以使用自闭合标签。',
	'Malformed or unclosed HTML attribute':'HTML 属性格式不合法或未闭合。',
	'Unclosed HTML tag':'HTML 标签未闭合。',
	'Unrepresentable or resource-loading CSS':'此样式无法无损保留，或包含外部资源加载。',
	'Resource-loading CSS function':'暂不支持会加载外部资源的样式。',
	'Invalid CSS declaration':'样式声明不合法。',
	'Unsupported link protocol':'暂不支持此链接协议。',
	'Unsupported table child':'表格中包含暂不支持的结构。',
	'Noncanonical row-group order cannot be preserved':'表头、正文和表尾分组的顺序无法无损保留。',
	'Empty row group cannot be preserved':'空的行分组无法无损保留。',
	'Table must contain rows':'表格必须至少包含一行。',
	'Row span crosses a row-group boundary':'单元格跨越了表头、正文或表尾的分组边界。',
	'Span exceeds HTML limits':'单元格的跨行或跨列数量超过 HTML 限制。',
	'Overlapping cell spans':'合并单元格的覆盖范围发生重叠。',
	'Irregular table contains a missing cell':'表格网格不完整，存在缺失的单元格。',
	'Invalid table dimensions':'表格行列数必须为合法的正整数。',
};

function translateReason(reason:string):string|undefined {
	if(reasons[reason])return reasons[reason];
	let match:RegExpExecArray|null;
	if((match=/^Unsupported or misplaced <([^>]+)>$/u.exec(reason)))return `暂不支持 <${match[1]}> 元素，或其所在位置不合法。`;
	if((match=/^Inline (\S+) cannot be expressed in Markdown$/u.exec(reason)))return `Markdown 无法保留格内的 <${match[1]}> 内容。`;
	if((match=/^Unsupported Markdown (\S+)$/u.exec(reason)))return `暂不支持无损转换此 Markdown 内容（${match[1]}）。`;
	if((match=/^CSS shorthand (\S+) requires lossless expansion$/u.exec(reason)))return `暂时无法无损保留 ${match[1]} 简写样式。`;
	if((match=/^Duplicate CSS declaration (.+)$/u.exec(reason)))return `样式 ${match[1]} 重复声明，无法无损保留。`;
	if((match=/^Empty CSS declaration (.+)$/u.exec(reason)))return `样式 ${match[1]} 缺少值。`;
	if((match=/^Unsafe attribute (.+)$/u.exec(reason)))return `暂不支持编辑包含 ${match[1]} 属性的表格。`;
	if((match=/^Duplicate attribute (.+)$/u.exec(reason)))return `HTML 属性 ${match[1]} 重复，无法无损保留。`;
	if((match=/^Attributes on (\S+) cannot be preserved$/u.exec(reason)))return `暂时无法无损保留 <${match[1]}> 上的附加属性。`;
	if((match=/^(rowspan|colspan) must be a positive integer$/u.exec(reason)))return `${match[1]==='rowspan'?'跨行':'跨列'}数量必须为正整数。`;
	if((match=/^Duplicate (thead|tfoot)$/u.exec(reason)))return `表格包含重复的${match[1]==='thead'?'表头':'表尾'}分组。`;
	return undefined;
}

/** Present known boundary failures; never replace an unknown invariant with a generic refusal. */
export function tableErrorMessage(message:string):string {
	if(message==='The table changed while the operation was open. Please select it again.')return '表格内容已变化，请重新选择后再操作。';
	const match=/^Row (\d+), column (\d+): ([\s\S]+)$/u.exec(message);
	if(!match)return message;
	const translated=translateReason(match[3]!);
	return translated?`第 ${match[1]} 行，第 ${match[2]} 列：${translated}`:message;
}
