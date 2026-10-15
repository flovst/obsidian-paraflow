import type { CellPosition, CellRectangle, TableCell, TableModel } from './model';

function positiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function validateCellProperties(cell: TableCell): void {
	for (const attribute of Object.keys(cell.attributes)) {
		if (['rowspan', 'colspan', 'style'].includes(attribute.toLowerCase())) {
			throw new Error(`Attribute ${attribute} duplicates a separate model field`);
		}
	}
	for (const property of Object.keys(cell.style)) {
		if (property !== property.trim() || (!property.startsWith('--') && property !== property.toLowerCase())) {
			throw new Error(`Style property ${property} must use its canonical name`);
		}
		if (['font', 'background', 'all'].includes(property)) {
			throw new Error(`Style shorthand ${property} must be expanded before model admission`);
		}
	}
}

/** Reject invalid topology and conflicting property representations before any edit. */
export function validateTable(table: TableModel): void {
	if (!positiveInteger(table.rows) || !positiveInteger(table.columns)
		|| !Number.isSafeInteger(table.rows * table.columns)) {
		throw new Error('Invalid table dimensions');
	}
	const occupied = new Set<number>();
	for (const cell of table.cells) {
		validateCellProperties(cell);
		if (!positiveInteger(cell.rowSpan) || !positiveInteger(cell.columnSpan)) {
			throw new Error('Invalid cell span');
		}
		assertPosition(table, cell);
		if (cell.rowSpan > table.rows - cell.row || cell.columnSpan > table.columns - cell.column) {
			throw new Error('Cell span out of range');
		}
		for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
			for (let column = cell.column; column < cell.column + cell.columnSpan; column++) {
				const position = row * table.columns + column;
				if (occupied.has(position)) throw new Error('Overlapping cells');
				occupied.add(position);
			}
		}
	}
	if (occupied.size !== table.rows * table.columns) throw new Error('Table contains a hole');
}

export function assertPosition(table: TableModel, position: CellPosition): void {
	if (!Number.isSafeInteger(position.row) || !Number.isSafeInteger(position.column)
		|| position.row < 0 || position.row >= table.rows
		|| position.column < 0 || position.column >= table.columns) {
		throw new Error('Cell position out of range');
	}
}

export function intersects(cell: TableCell, rectangle: CellRectangle): boolean {
	return cell.row <= rectangle.bottom && cell.row + cell.rowSpan > rectangle.top
		&& cell.column <= rectangle.right && cell.column + cell.columnSpan > rectangle.left;
}

/** Fixed-point closure also handles chains exposed only by earlier expansion. */
export function closeSelection(table: TableModel, start: CellPosition, end: CellPosition): CellRectangle {
	validateTable(table);
	assertPosition(table, start);
	assertPosition(table, end);
	let top = Math.min(start.row, end.row);
	let bottom = Math.max(start.row, end.row);
	let left = Math.min(start.column, end.column);
	let right = Math.max(start.column, end.column);
	let changed: boolean;
	do {
		changed = false;
		for (const cell of table.cells) {
			if (!intersects(cell, { top, bottom, left, right })) continue;
			const nextTop = Math.min(top, cell.row);
			const nextBottom = Math.max(bottom, cell.row + cell.rowSpan - 1);
			const nextLeft = Math.min(left, cell.column);
			const nextRight = Math.max(right, cell.column + cell.columnSpan - 1);
			changed ||= nextTop !== top || nextBottom !== bottom || nextLeft !== left || nextRight !== right;
			top = nextTop;
			bottom = nextBottom;
			left = nextLeft;
			right = nextRight;
		}
	} while (changed);
	return { top, left, bottom, right };
}
