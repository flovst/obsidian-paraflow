import { assertPosition, closeSelection, intersects, validateTable } from './grid';
import type { CellPosition, CellRectangle, CellRole, TableAxis, TableCell, TableModel } from './model';

export interface MergeResult {
	readonly table: TableModel;
	/** Nonblank HTML is conservatively treated as content; the core does not parse HTML. */
	readonly discardedCells: readonly TableCell[];
}

function ordered(table: TableModel, cells: readonly TableCell[]): TableModel {
	return { ...table, cells: [...cells].sort((a, b) => a.row - b.row || a.column - b.column) };
}

function emptyCell(row: number, column: number): TableCell {
	return { row, column, rowSpan: 1, columnSpan: 1, role: 'td', html: '', attributes: {}, style: {} };
}

function cellAt(table: TableModel, position: CellPosition): TableCell {
	assertPosition(table, position);
	const cell = table.cells.find((candidate) => candidate.row <= position.row
		&& position.row < candidate.row + candidate.rowSpan
		&& candidate.column <= position.column && position.column < candidate.column + candidate.columnSpan);
	if (!cell) throw new Error('Table contains a hole');
	return cell;
}

/** Requires the rectangle already shown by the editor; never expands it silently. */
export function mergeCells(table: TableModel, rectangle: CellRectangle): MergeResult {
	const closed = closeSelection(table,
		{ row: rectangle.top, column: rectangle.left },
		{ row: rectangle.bottom, column: rectangle.right });
	if (closed.top !== rectangle.top || closed.left !== rectangle.left
		|| closed.bottom !== rectangle.bottom || closed.right !== rectangle.right) {
		throw new Error('Merge requires a closed selection rectangle');
	}
	const selected = table.cells.filter((cell) => intersects(cell, closed));
	if (selected.length === 1) return { table, discardedCells: [] };
	const anchor = cellAt(table, { row: closed.top, column: closed.left });
	const merged: TableCell = {
		...anchor, rowSpan: closed.bottom - closed.top + 1, columnSpan: closed.right - closed.left + 1,
	};
	return {
		table: ordered(table, [...table.cells.filter((cell) => !intersects(cell, closed)), merged]),
		discardedCells: selected.filter((cell) => cell !== anchor && cell.html.trim() !== ''),
	};
}

export function unmergeCell(table: TableModel, position: CellPosition): TableModel {
	validateTable(table);
	const anchor = cellAt(table, position);
	if (anchor.rowSpan === 1 && anchor.columnSpan === 1) return table;
	const cells = table.cells.filter((cell) => cell !== anchor);
	for (let row = anchor.row; row < anchor.row + anchor.rowSpan; row++) {
		for (let column = anchor.column; column < anchor.column + anchor.columnSpan; column++) {
			cells.push(row === anchor.row && column === anchor.column
				? { ...anchor, rowSpan: 1, columnSpan: 1 }
				: emptyCell(row, column));
		}
	}
	return ordered(table, cells);
}

function trackCount(table: TableModel, axis: TableAxis): number {
	return axis === 'row' ? table.rows : table.columns;
}

function assertTrack(table: TableModel, axis: TableAxis, index: number, insertion = false): void {
	const limit = trackCount(table, axis) + (insertion ? 1 : 0);
	if (!Number.isSafeInteger(index) || index < 0 || index >= limit) throw new Error('Track index out of range');
}

/** Index is a boundary before the indexed track; count appends at the end. */
export function insertTrack(table: TableModel, axis: TableAxis, index: number): TableModel {
	validateTable(table);
	assertTrack(table, axis, index, true);
	const coordinate = axis;
	const span = axis === 'row' ? 'rowSpan' : 'columnSpan';
	const cells = table.cells.map((cell) => {
		if (cell[coordinate] >= index) return { ...cell, [coordinate]: cell[coordinate] + 1 };
		if (cell[coordinate] + cell[span] > index) return { ...cell, [span]: cell[span] + 1 };
		return cell;
	});
	const across = trackCount(table, axis === 'row' ? 'column' : 'row');
	for (let offset = 0; offset < across; offset++) {
		const row = axis === 'row' ? index : offset;
		const column = axis === 'column' ? index : offset;
		if (!cells.some((cell) => intersects(cell, { top: row, bottom: row, left: column, right: column }))) {
			cells.push(emptyCell(row, column));
		}
	}
	return ordered({ ...table, [axis === 'row' ? 'rows' : 'columns']: trackCount(table, axis) + 1 }, cells);
}

/** Null means the final underlying track was removed and the table must be deleted. */
export function deleteTrack(table: TableModel, axis: TableAxis, index: number): TableModel | null {
	validateTable(table);
	assertTrack(table, axis, index);
	if (trackCount(table, axis) === 1) return null;
	const coordinate = axis;
	const span = axis === 'row' ? 'rowSpan' : 'columnSpan';
	const cells: TableCell[] = [];
	for (const cell of table.cells) {
		if (cell[coordinate] > index) {
			cells.push({ ...cell, [coordinate]: cell[coordinate] - 1 });
		} else if (cell[coordinate] + cell[span] > index) {
			// When the anchor is deleted its next covered position assumes its coordinate.
			if (cell[span] > 1) cells.push({ ...cell, [span]: cell[span] - 1 });
		} else {
			cells.push(cell);
		}
	}
	return ordered({ ...table, [axis === 'row' ? 'rows' : 'columns']: trackCount(table, axis) - 1 }, cells);
}

const ownedStyleProperties = new Set([
	'font-weight', 'font-style', 'text-decoration', 'font-family', 'font-size', 'color', 'background-color',
]);

function clearOwnedStyle(cell: TableCell): TableCell {
	return { ...cell, style: Object.fromEntries(Object.entries(cell.style).filter(([property]) =>
		!ownedStyleProperties.has(property) && !property.startsWith('text-decoration-'))) };
}

/** Format targets intersecting tracks directly, without merged-selection closure. */
export function formatTracks(table: TableModel, axis: TableAxis, first: number, last: number, role: CellRole): TableModel {
	validateTable(table);
	assertTrack(table, axis, first);
	assertTrack(table, axis, last);
	if (first > last) throw new Error('Track range must be ordered');
	const span = axis === 'row' ? 'rowSpan' : 'columnSpan';
	return { ...table, cells: table.cells.map((cell) => cell[axis] <= last && cell[axis] + cell[span] > first
		? { ...clearOwnedStyle(cell), role } : cell) };
}

/** Positions may lie anywhere inside a merged cell; duplicate hits are harmless. */
export function resetCellStyles(table: TableModel, positions: readonly CellPosition[]): TableModel {
	validateTable(table);
	const targets = new Set(positions.map((position) => cellAt(table, position)));
	return { ...table, cells: table.cells.map((cell) => targets.has(cell) ? clearOwnedStyle(cell) : cell) };
}
