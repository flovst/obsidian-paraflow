import { generate, ident, parse, walk } from 'css-tree';
import { validateTable } from './grid';
import type { TableCell, TableModel } from './model';

/** One-based locations; syntax errors use source cell indices before grid construction. */
export class TableSerializationError extends Error {
	constructor(readonly reason: string, readonly row = 1, readonly column = 1) {
		super(`Row ${row}, column ${column}: ${reason}`);
		this.name = 'TableSerializationError';
	}
}

export interface TableRowGroup {
	readonly kind: 'thead' | 'tbody' | 'tfoot';
	readonly startRow: number;
	readonly rowCount: number;
}

/** Group metadata stays outside the editing model: structural edits must reconcile it explicitly. */
export interface HtmlTable {
	readonly table: TableModel;
	readonly rowGroups: readonly TableRowGroup[];
}

function fail(reason: string, row = 0, column = 0): never {
	throw new TableSerializationError(reason, row + 1, column + 1);
}

export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const inlineTags = new Set(['br', 'strong', 'b', 'em', 'i', 's', 'del', 'strike', 'u', 'code', 'a', 'span', 'mark']);
const groupTags = new Set(['thead', 'tbody', 'tfoot']);

function permitsChild(parent: string | undefined, tag: string): boolean {
	if (!parent) return tag === 'table';
	if (parent === 'table') return groupTags.has(tag) || tag === 'tr';
	if (groupTags.has(parent)) return tag === 'tr';
	if (parent === 'tr') return tag === 'td' || tag === 'th';
	if (parent === 'td' || parent === 'th') return tag === 'p' || inlineTags.has(tag);
	if (parent === 'code' || parent === 'br') return false;
	return inlineTags.has(tag);
}

/** Reject HTML repairs and duplicate attributes before the browser can discard them. */
function validateSource(source: string): void {
	if (source.includes('\0')) fail('Null characters cannot be preserved by the HTML parser');
	const stack: string[] = [];
	let offset = 0;
	let row = -1;
	let column = -1;
	let tables = 0;
	const location = (reason: string): never => fail(reason, Math.max(0, row), Math.max(0, column));
	while (offset < source.length) {
		if (source[offset] !== '<') {
			const end = source.indexOf('<', offset);
			const text = source.slice(offset, end < 0 ? source.length : end);
			if (!stack.some(tag => tag === 'td' || tag === 'th') && text.trim()) location('Text outside a cell cannot be preserved');
			offset += text.length;
			continue;
		}
		const closing = /^<\/([A-Za-z][\w-]*)\s*>/.exec(source.slice(offset));
		if (closing) {
			if (stack.pop() !== closing[1]!.toLowerCase()) location('Mismatched or omitted closing tag');
			offset += closing[0].length;
			continue;
		}
		const opening = /^<([A-Za-z][\w-]*)\b/.exec(source.slice(offset));
		if (!opening) return location('Unsupported HTML declaration, comment or malformed tag');
		const tag = opening[1]!.toLowerCase();
		if (tag === 'tr') { row++; column = -1; }
		if (tag === 'td' || tag === 'th') column++;
		if (!permitsChild(stack[stack.length - 1], tag)) location(`Unsupported or misplaced <${tag}>`);
		if (tag === 'table' && ++tables !== 1) location('Expected one complete table');
		if (tag === 'a' && stack.includes('a')) location('Nested links cannot be preserved');
		offset += opening[0].length;
		const attributes = new Set<string>();
		while (offset < source.length) {
			const end = /^\s*(\/?)>/.exec(source.slice(offset));
			if (end) {
				if (end[1] && tag !== 'br') location('Only br may use a self-closing tag');
				offset += end[0].length;
				break;
			}
			const attribute = /^\s+([A-Za-z_:][\w.:-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/.exec(source.slice(offset));
			if (!attribute) return location('Malformed or unclosed HTML attribute');
			const name = attribute[1]!.toLowerCase();
			if (attributes.has(name)) location(`Duplicate attribute ${name}`);
			attributes.add(name);
			offset += attribute[0].length;
		}
		if (source[offset - 1] !== '>') location('Unclosed HTML tag');
		if (tag !== 'br') stack.push(tag);
	}
	if (stack.length || tables !== 1) location('Expected one complete table with explicit closing tags');
}

export function parseStyle(source: string, row: number, column: number): Record<string, string> {
	const style: Record<string, string> = {};
	try {
		const ast = parse(source, { context: 'declarationList', parseCustomProperty: true });
		walk(ast, node => {
			if (node.type === 'Raw' || node.type === 'Atrule' || node.type === 'Url') fail('Unrepresentable or resource-loading CSS', row, column);
			if (node.type === 'Function' && ['url', 'image', 'image-set', '-webkit-image-set', 'src'].includes(ident.decode(node.name).toLowerCase())) fail('Resource-loading CSS function', row, column);
			if (node.type !== 'Declaration') return;
			const decodedProperty = ident.decode(node.property);
			const property = decodedProperty.startsWith('--') ? decodedProperty : decodedProperty.toLowerCase();
			if (['font', 'background', 'all'].includes(property)) fail(`CSS shorthand ${property} requires lossless expansion`, row, column);
			if (Object.prototype.hasOwnProperty.call(style, property)) fail(`Duplicate CSS declaration ${property}`, row, column);
			const value = generate(node.value);
			if (!value) fail(`Empty CSS declaration ${property}`, row, column);
			Object.defineProperty(style, property, { value: value + (node.important ? ' !important' : ''), enumerable: true });
		});
	} catch (error) {
		if (error instanceof TableSerializationError) throw error;
		fail('Invalid CSS declaration', row, column);
	}
	return style;
}

function validateAttributes(element: Element, row: number, column: number): void {
	for (const attribute of Array.from(element.attributes)) {
		if (/^on/i.test(attribute.name) || ['src', 'srcset', 'srcdoc', 'is', 'background', 'ping', 'attributionsrc'].includes(attribute.name)) fail(`Unsafe attribute ${attribute.name}`, row, column);
		if (attribute.name === 'href') {
			const compact = Array.from(attribute.value).filter(character => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127).join('');
			if (/^[\w+.-]+:/.test(compact) && !/^(https?|mailto|tel|obsidian):/i.test(compact)) fail('Unsupported link protocol', row, column);
		}
		if (attribute.name === 'style') parseStyle(attribute.value, row, column);
	}
}

function validateContent(cell: Element, row: number, column: number): void {
	validateAttributes(cell, row, column);
	for (const descendant of Array.from(cell.querySelectorAll('*'))) validateAttributes(descendant, row, column);
}

function spanValue(cell: Element, name: string, row: number, column: number): number {
	const value = cell.getAttribute(name);
	if (value === null) return 1;
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail(`${name} must be a positive integer`, row, column);
	return Number(value);
}

function noAttributes(element: Element, row: number): void {
	if (element.attributes.length) fail(`Attributes on ${element.localName} cannot be preserved`, row);
}

/** Uses only an inert parser document; never injects user HTML into an active DOM. */
export function htmlToGrid(source: string): HtmlTable {
	validateSource(source);
	const document = new window.DOMParser().parseFromString(source, 'text/html');
	const element = document.body.firstElementChild as HTMLTableElement;
	if (element?.localName !== 'table' || document.body.children.length !== 1) fail('Expected exactly one table');
	noAttributes(element, 0);
	const rowGroups: TableRowGroup[] = [];
	const rows: HTMLTableRowElement[] = [];
	let previousKind = '';
	for (const group of Array.from(element.children)) {
		if (!groupTags.has(group.localName)) fail('Unsupported table child');
		noAttributes(group, rows.length);
		const kind = group.localName as TableRowGroup['kind'];
		if ((kind === 'thead' && rows.length > 0) || previousKind === 'tfoot') fail('Noncanonical row-group order cannot be preserved', rows.length);
		if (kind !== 'tbody' && rowGroups.some(item => item.kind === kind)) fail(`Duplicate ${kind}`, rows.length);
		previousKind = kind;
		const children = Array.from(group.children) as HTMLTableRowElement[];
		if (!children.length) fail('Empty row group cannot be preserved', rows.length);
		rowGroups.push({ kind, startRow: rows.length, rowCount: children.length });
		rows.push(...children);
	}
	if (!rows.length) fail('Table must contain rows');
	const occupied = rows.map(() => new Set<number>());
	const cells: TableCell[] = [];
	let columns = 0;
	for (const [row, tr] of rows.entries()) {
		noAttributes(tr, row);
		let column = 0;
		for (const cell of Array.from(tr.children)) {
			while (occupied[row]!.has(column)) column++;
			validateContent(cell, row, column);
			const rowSpan = spanValue(cell, 'rowspan', row, column);
			const columnSpan = spanValue(cell, 'colspan', row, column);
			const group = rowGroups.find(item => row >= item.startRow && row < item.startRow + item.rowCount)!;
			if (row + rowSpan > group.startRow + group.rowCount) fail('Row span crosses a row-group boundary', row, column);
			// HTML limits spans; admitting larger values would change layout on serialization.
			if (columnSpan > 1000 || rowSpan > 65534) fail('Span exceeds HTML limits', row, column);
			for (let r = row; r < row + rowSpan; r++) {
				for (let c = column; c < column + columnSpan; c++) {
					if (occupied[r]!.has(c)) fail('Overlapping cell spans', row, column);
					occupied[r]!.add(c);
				}
			}
			cells.push({ row, column, rowSpan, columnSpan, role: cell.localName as 'th' | 'td', html: cell.innerHTML,
				attributes: Object.fromEntries(Array.from(cell.attributes).filter(attr => !['rowspan', 'colspan', 'style'].includes(attr.name)).map(attr => [attr.name, attr.value])),
				style: parseStyle(cell.getAttribute('style') ?? '', row, column) });
			column += columnSpan;
			columns = Math.max(columns, column);
		}
	}
	for (const [row, slots] of occupied.entries()) {
		for (let column = 0; column < columns; column++) if (!slots.has(column)) fail('Irregular table contains a missing cell', row, column);
	}
	const table: TableModel = { rows: rows.length, columns, cells };
	try { validateTable(table); } catch (error) { fail(error instanceof Error ? error.message : 'Invalid table'); }
	return { table, rowGroups };
}

export function createTable(rows: number, columns: number): TableModel {
	if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || !Number.isSafeInteger(rows * columns) || rows < 1 || columns < 1) fail('Invalid table dimensions');
	const cells: TableCell[] = [];
	for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
		cells.push({ row, column, rowSpan: 1, columnSpan: 1, role: row === 0 ? 'th' : 'td', html: '', attributes: {}, style: {} });
	}
	return { rows, columns, cells };
}

function serializeCell(cell: TableCell): string {
	if (cell.role !== 'th' && cell.role !== 'td') fail('Invalid cell role', cell.row, cell.column);
	let attributes = '';
	for (const [name, value] of Object.entries(cell.attributes)) {
		if (!/^[a-z_:][\w.:-]*$/.test(name)) fail('Invalid attribute name', cell.row, cell.column);
		attributes += ` ${name}="${escapeHtml(value)}"`;
	}
	if (cell.rowSpan !== 1) attributes += ` rowspan="${cell.rowSpan}"`;
	if (cell.columnSpan !== 1) attributes += ` colspan="${cell.columnSpan}"`;
	const style = Object.entries(cell.style).map(([name, value]) => {
		const declaration = `${ident.encode(name)}: ${value}`;
		const parsed = parseStyle(declaration, cell.row, cell.column);
		if (Object.keys(parsed).length !== 1 || !Object.prototype.hasOwnProperty.call(parsed, name)) fail('Style value escapes its model property', cell.row, cell.column);
		return declaration;
	}).join('; ');
	if (style) attributes += ` style="${escapeHtml(style)}"`;
	return `<${cell.role}${attributes}>${cell.html}</${cell.role}>`;
}

/** A bare model explicitly uses one tbody, permitting arbitrary th positions and merges. */
export function gridToHtml(input: TableModel | HtmlTable): string {
	const { table, rowGroups } = 'table' in input ? input : { table: input, rowGroups: [{ kind: 'tbody', startRow: 0, rowCount: input.rows }] };
	try { validateTable(table); } catch (error) { fail(error instanceof Error ? error.message : 'Invalid table'); }
	let nextRow = 0;
	const groups: string[] = [];
	for (const group of rowGroups) {
		if (!groupTags.has(group.kind) || group.startRow !== nextRow || !Number.isSafeInteger(group.rowCount) || group.rowCount < 1) fail('Invalid row-group metadata', nextRow);
		const end = group.startRow + group.rowCount;
		if (end > table.rows) fail('Row group exceeds table dimensions', nextRow);
		const rows: string[] = [];
		for (let row = group.startRow; row < end; row++) {
			const cells = table.cells.filter(cell => cell.row === row).sort((a, b) => a.column - b.column);
			rows.push(`<tr>${cells.map(serializeCell).join('')}</tr>`);
		}
		groups.push(`<${group.kind}>${rows.join('')}</${group.kind}>`);
		nextRow = end;
	}
	if (nextRow !== table.rows) fail('Row-group metadata does not cover the table', nextRow);
	const html = `<table>${groups.join('')}</table>`;
	const parsed = htmlToGrid(html).table;
	if (parsed.rows !== table.rows || parsed.columns !== table.columns || parsed.cells.length !== table.cells.length) fail('Cell HTML escapes its model boundary');
	for (const cell of table.cells) {
		const result = parsed.cells.find(candidate => candidate.row === cell.row && candidate.column === cell.column);
		if (!result || result.role !== cell.role || result.rowSpan !== cell.rowSpan || result.columnSpan !== cell.columnSpan) fail('Cell HTML escapes its model boundary', cell.row, cell.column);
	}
	return html;
}
