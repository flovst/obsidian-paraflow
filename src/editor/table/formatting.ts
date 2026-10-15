import { assertPosition, validateTable } from './grid';
import type { CellPosition, TableCell, TableModel } from './model';
import {isHighlightColor,type HighlightColor} from './highlight';

export type CellFormatProperty = 'font-weight' | 'font-style' | 'text-decoration' | 'font-family'
	| 'font-size' | 'color' | 'background-color' | 'text-align' | 'vertical-align';
export type ToggleFormat = 'bold' | 'italic' | 'strikethrough' | 'underline';
export type TextToggleFormat=ToggleFormat|'highlight';
export type FormatState = 'on' | 'off' | 'mixed';
export type TextFormatAction = { type: 'toggle'; format: TextToggleFormat; color?:HighlightColor }
	| { type: 'style'; property: CellFormatProperty; value: string } | { type: 'reset'; includeCode?:boolean };

const ownedProperties = new Set(['font-weight', 'font-style', 'text-decoration', 'font-family', 'font-size', 'color', 'background-color']);
const inlineEmphasis = new Set(['STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'STRIKE', 'U', 'MARK']);
const blockTags = new Set(['P', 'DIV']);

function propertyFor(format: TextToggleFormat): CellFormatProperty {
	if(format==='highlight')return 'background-color';
	return format === 'bold' ? 'font-weight' : format === 'italic' ? 'font-style' : 'text-decoration';
}

function decorationToken(format: TextToggleFormat): string {
	return format === 'underline' ? 'underline' : 'line-through';
}

function hasDecoration(value: string, token: string): boolean { return value.split(/\s+/u).includes(token); }

function bold(value: string): boolean {
	const keyword = value.replace(/\s*!important\s*$/iu, '').trim().toLowerCase();
	return keyword === 'bold' || keyword === 'bolder' || Number.parseInt(keyword, 10) >= 600;
}

function cellHasFormat(cell: TableCell, format: ToggleFormat): boolean {
	if (format === 'bold') return bold(cell.style['font-weight'] ?? (cell.role === 'th' ? 'bold' : 'normal'));
	if (format === 'italic') return /^(?:italic|oblique)(?:\s|$)/u.test(cell.style['font-style'] ?? 'normal');
	return hasDecoration(cell.style['text-decoration-line'] ?? cell.style['text-decoration'] ?? '', decorationToken(format));
}

function state(values: readonly boolean[]): FormatState {
	return values.length > 0 && values.every(Boolean) ? 'on' : values.some(Boolean) ? 'mixed' : 'off';
}

export function getCellToggleState(cells: readonly TableCell[], format: ToggleFormat): FormatState {
	return state(cells.map(cell => cellHasFormat(cell, format)));
}

function targets(table: TableModel, positions: readonly CellPosition[]): Set<TableCell> {
	validateTable(table);
	return new Set(positions.map(position => {
		assertPosition(table, position);
		const cell = table.cells.find(candidate => position.row >= candidate.row && position.row < candidate.row + candidate.rowSpan
			&& position.column >= candidate.column && position.column < candidate.column + candidate.columnSpan);
		if (!cell) throw new Error('Table contains a hole');
		return cell;
	}));
}

function toggleDecoration(value: string, token: string, enabled: boolean): string {
	const tokens = value.split(/\s+/u).filter(part => part && part !== token && part !== 'none');
	if (enabled) tokens.unshift(token);
	// A decoration without a line paints nothing, while retaining its color/style.
	return tokens.length ? tokens.join(' ') : 'none';
}

export function applyCellToggle(table: TableModel, positions: readonly CellPosition[], format: ToggleFormat): TableModel {
	const selected = targets(table, positions);
	const enabled = getCellToggleState([...selected], format) !== 'on';
	return { ...table, cells: table.cells.map(cell => {
		if (!selected.has(cell)) return cell;
		const style = { ...cell.style };
		if (format === 'bold') style['font-weight'] = enabled ? 'bold' : 'normal';
		else if (format === 'italic') style['font-style'] = enabled ? 'italic' : 'normal';
		else {
			const property = 'text-decoration-line' in style ? 'text-decoration-line' : 'text-decoration';
			style[property] = toggleDecoration(style[property] ?? '', decorationToken(format), enabled);
		}
		return { ...cell, style };
	}) };
}

/** User input is admitted here before a preview or source mutation. */
export function validateCellStyle(property: CellFormatProperty, value: string, ownerDocument: Document = document): string {
	const candidate = value.trim();
	const probe = ownerDocument.createElement('span').style;
	probe.setProperty(property, candidate);
	const normalized = probe.getPropertyValue(property);
	if (!candidate || !normalized || /[;{}]/u.test(candidate)) throw new Error('无效的格式值');
	return normalized;
}

export function applyCellStyle(table: TableModel, positions: readonly CellPosition[], property: CellFormatProperty, value: string): TableModel {
	const normalized = validateCellStyle(property, value);
	const selected = targets(table, positions);
	return { ...table, cells: table.cells.map(cell => selected.has(cell)
		? { ...cell, style: { ...cell.style, [property]: normalized } } : cell) };
}

export function toggleVerticalAlignment(table:TableModel,positions:readonly CellPosition[],value:'top'|'middle'|'bottom'):TableModel {return toggleCellAlignment(table,positions,'vertical-align',value);}

export function toggleCellAlignment(table:TableModel,positions:readonly CellPosition[],property:'text-align'|'vertical-align',value:string):TableModel {
	const selected=targets(table,positions);
	const clear=[...selected].every(cell=>cell.style[property]?.replace(/\s*!important\s*$/iu,'').trim().toLowerCase()===value);
	if(!clear)return applyCellStyle(table,positions,property,value);
	return {...table,cells:table.cells.map(cell=>{if(!selected.has(cell))return cell;const style={...cell.style};delete style[property];return {...cell,style};})};
}

interface TextSlice { node: Text; from: number; to: number }

function selectedOffsets(cell: HTMLElement, range: Range): { from: number; to: number } {
	if (range.collapsed || !cell.contains(range.startContainer) || !cell.contains(range.endContainer)) {
		throw new Error('文字格式需要同一单元格中的非空文字选区');
	}
	const prefix = cell.ownerDocument.createRange();
	prefix.selectNodeContents(cell); prefix.setEnd(range.startContainer, range.startOffset);
	const from = prefix.toString().length;
	prefix.setEnd(range.endContainer, range.endOffset);
	const to = prefix.toString().length;
	if (from === to) throw new Error('文字选区不包含文字');
	return { from, to };
}

function textSlices(cell: HTMLElement, from: number, to: number): TextSlice[] {
	const walker = cell.ownerDocument.createTreeWalker(cell, 4);
	const result: TextSlice[] = [];
	let offset = 0;
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		if (offset < to && offset + node.length > from) result.push({ node, from: Math.max(0, from - offset), to: Math.min(node.length, to - offset) });
		offset += node.length;
	}
	return result;
}

function textHasFormat(node: Text, cell: HTMLElement, format: TextToggleFormat,color:HighlightColor=''): boolean {
	for (let element = node.parentElement; element; element = element.parentElement) {
		if(format==='highlight'){if(element.tagName==='MARK')return (element.getAttribute('data-highlight')??'')===color;if(element===cell)return false;continue;}
		const value = element.style.getPropertyValue(propertyFor(format));
		if (format === 'bold') {
			if (value) return bold(value);
			if (element.tagName === 'B' || element.tagName === 'STRONG') return true;
		} else if (format === 'italic') {
			if (value) return /^(?:italic|oblique)(?:\s|$)/u.test(value);
			if (element.tagName === 'I' || element.tagName === 'EM') return true;
		} else if (hasDecoration(element.style.textDecorationLine || value, decorationToken(format))
			|| (format === 'underline' ? element.tagName === 'U' : ['DEL', 'S', 'STRIKE'].includes(element.tagName))) return true;
		if (element === cell) return format === 'bold' && cell.tagName === 'TH';
	}
	return false;
}

export function getTextToggleState(cell: HTMLElement, range: Range, format: TextToggleFormat,color:HighlightColor=''): FormatState {
	const { from, to } = selectedOffsets(cell, range);
	return state(textSlices(cell, from, to).map(slice => textHasFormat(slice.node, cell, format,color)));
}

function removeOwnedStyles(element: HTMLElement): void {
	for (const property of Array.from(element.style)) {
		if (ownedProperties.has(property) || property.startsWith('text-decoration-')) element.style.removeProperty(property);
	}
	if (!element.style.length) element.removeAttribute('style');
}

function clearSelectedElement(element: HTMLElement, action: TextFormatAction): boolean {
	if (action.type === 'reset') {
		removeOwnedStyles(element);
		if(element.tagName==='MARK'&&isHighlightColor(element.getAttribute('data-highlight')??''))element.removeAttribute('data-highlight');
		return inlineEmphasis.has(element.tagName) || !!action.includeCode && element.tagName === 'CODE';
	}
	if(action.type==='toggle'&&action.format==='highlight'){if(element.tagName==='MARK'&&isHighlightColor(element.getAttribute('data-highlight')??''))element.removeAttribute('data-highlight');return element.tagName==='MARK';}
	const property = action.type === 'toggle' ? propertyFor(action.format) : action.property;
	if (property === 'text-decoration' && action.type === 'toggle') {
		for (const candidate of ['text-decoration', 'text-decoration-line']) {
			const value = element.style.getPropertyValue(candidate);
			if (value) {const next=toggleDecoration(value, decorationToken(action.format), false);if(next==='none')element.style.removeProperty(candidate);else element.style.setProperty(candidate,next);}
		}
		if(!element.style.length)element.removeAttribute('style');
		return action.format === 'underline' ? element.tagName === 'U' : ['DEL', 'S', 'STRIKE'].includes(element.tagName);
	}
	element.style.removeProperty(property);
	if (!element.style.length) element.removeAttribute('style');
	return property === 'font-weight' ? ['STRONG', 'B'].includes(element.tagName)
		: property === 'font-style' && ['EM', 'I'].includes(element.tagName);
}

/** CSS decorations propagate through descendants even when a child says none. */
function distributeCellDecoration(cell: HTMLElement): void {
	const properties = Array.from(cell.style).filter(property => property === 'text-decoration' || property.startsWith('text-decoration-'));
	if (!properties.length) return;
	const texts = textSlices(cell, 0, cell.textContent?.length ?? 0);
	for (const { node } of texts) {
		const span = cell.ownerDocument.createElement('span');
		for (const property of properties) span.style.setProperty(property, cell.style.getPropertyValue(property), cell.style.getPropertyPriority(property));
		node.replaceWith(span); span.append(node);
	}
	for (const property of properties) cell.style.removeProperty(property);
	if (!cell.style.length) cell.removeAttribute('style');
}

interface Piece { selected: boolean; node: Node }

/** Splits inline ancestors at selection boundaries; paragraph elements stay blocks. */
export function formatTextRange(cell: HTMLElement, range: Range, action: TextFormatAction): void {
	const { from, to } = selectedOffsets(cell, range);
	if (action.type === 'style' && (action.property === 'background-color' || action.property === 'text-align' || action.property === 'vertical-align')) {
		throw new Error('背景颜色与对齐应作用于单元格');
	}
	const enabled = action.type === 'toggle' && getTextToggleState(cell, range, action.format,action.color) !== 'on';
	const value = action.type === 'style' ? validateCellStyle(action.property, action.value)
		: action.type === 'toggle' ? action.format === 'bold' ? enabled ? 'bold' : 'normal'
			: action.format === 'italic' ? enabled ? 'italic' : 'normal' : enabled ? decorationToken(action.format) : 'none' : '';
	if (action.type === 'reset' || (action.type === 'toggle' && propertyFor(action.format) === 'text-decoration')) distributeCellDecoration(cell);
	let offset = 0;
	const wrap=(node:Node):Node=>{
		if(action.type==='reset')return node;
		if(action.type==='toggle'){
			if(enabled){const tag={bold:'strong',italic:'em',strikethrough:'s',underline:'u',highlight:'mark'}[action.format],element=cell.ownerDocument.createElement(tag);if(action.format==='highlight'&&action.color)element.setAttribute('data-highlight',action.color);element.append(node);return element;}
			const inherited=action.format==='bold'?bold(cell.style.fontWeight||(cell.tagName==='TH'?'bold':'normal')):action.format==='italic'&&/^(?:italic|oblique)(?:\s|$)/u.test(cell.style.fontStyle);
			if(!inherited)return node;
		}
		const span=cell.ownerDocument.createElement('span');span.style.setProperty(action.type==='toggle'?propertyFor(action.format):action.property,value);span.append(node);return span;
	};
	const visit = (node: Node,insideCode=false): Piece[] => {
		if (node.nodeType === 3) {
			const text = node as Text;
			const start = offset; offset += text.length;
			const cuts = [...new Set([0, Math.max(0, Math.min(text.length, from - start)), Math.max(0, Math.min(text.length, to - start)), text.length])].sort((a, b) => a - b);
			const result: Piece[] = [];
			for (let index = 1; index < cuts.length; index++) {
				const left = cuts[index - 1]!; const right = cuts[index]!;
				const selected = start + left >= from && start + right <= to;
				let output: Node = cell.ownerDocument.createTextNode(text.data.slice(left, right));
				if (selected && action.type !== 'reset'&&!insideCode) output=wrap(output);
				result.push({ selected, node: output });
			}
			return result;
		}
		if (node.nodeType !== 1) return [{ selected: false, node: node.cloneNode(true) }];
		const element = node as HTMLElement;
		const children = Array.from(element.childNodes).flatMap(child=>visit(child,insideCode||element.tagName==='CODE'));
		if (!children.length) return [{ selected: offset >= from && offset < to, node: element.cloneNode(true) }];
		if (blockTags.has(element.tagName)) {
			const clone = element.cloneNode(false) as HTMLElement;
			// Move block-owned formatting to inline children so a partial selection can clear it.
			if (children.some(piece => piece.selected)) {
				const cleaned = element.cloneNode(false) as HTMLElement;
				clearSelectedElement(cleaned, action);
				for (const property of Array.from(element.style)) {
					if (element.style.getPropertyValue(property) === cleaned.style.getPropertyValue(property)) continue;
					clone.style.removeProperty(property);
					for (const piece of children) {
						const source = piece.selected ? cleaned.style : element.style;
						if (!source.getPropertyValue(property)) continue;
						const span = cell.ownerDocument.createElement('span');
						span.style.setProperty(property, source.getPropertyValue(property), source.getPropertyPriority(property));
						span.append(piece.node); piece.node = span;
					}
				}
			}
			clone.append(...children.map(piece => piece.node));
			return [{ selected: false, node: clone }];
		}
		const result: Piece[] = [];
		for (let index = 0; index < children.length;) {
			const selected = children[index]!.selected;
			const clone = element.cloneNode(false) as HTMLElement;
			while (index < children.length && children[index]!.selected === selected) clone.append(children[index++]!.node);
			if (selected && clearSelectedElement(clone, action)) {
				// Keep unrelated attributes while removing the formatting semantics.
				if (clone.attributes.length) {
					const span = cell.ownerDocument.createElement('span');
					for (const attribute of Array.from(clone.attributes)) span.setAttribute(attribute.name, attribute.value);
					span.append(...Array.from(clone.childNodes)); result.push({ selected, node: span });
				} else result.push(...Array.from(clone.childNodes).map(child => ({ selected, node: child })));
			} else result.push({ selected, node: selected&&element.tagName==='CODE'?wrap(clone):clone });
		}
		return result;
	};
	const replacement = Array.from(cell.childNodes).flatMap(node=>visit(node));
	cell.replaceChildren(...replacement.map(piece => piece.node));
	const slices = textSlices(cell, from, to);
	range.setStart(slices[0]!.node, slices[0]!.from);
	range.setEnd(slices[slices.length - 1]!.node, slices[slices.length - 1]!.to);
}
