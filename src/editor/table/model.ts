/** Zero-based underlying grid coordinates, independent of visible merged cells. */
export interface CellPosition {
	readonly row: number;
	readonly column: number;
}

/** Inclusive bounds. A selection can only be applied after merged-cell closure. */
export interface CellRectangle {
	readonly top: number;
	readonly left: number;
	readonly bottom: number;
	readonly right: number;
}

export type CellRole = 'td' | 'th';
export type TableAxis = 'row' | 'column';

/**
 * HTML/attribute admission belongs to the serializer boundary. validateTable
 * enforces that attributes do not duplicate rowspan, colspan or style fields.
 * CSS keys are lower-case, except case-sensitive custom properties. The adapter
 * must losslessly expand font/background/all before admission: those shorthands
 * mix reset-owned properties with unrelated line-height, images and other styles.
 * text-decoration and its longhands are wholly owned by cell-format reset.
 */
export interface TableCell extends CellPosition {
	readonly rowSpan: number;
	readonly columnSpan: number;
	readonly role: CellRole;
	readonly html: string;
	readonly attributes: Readonly<Record<string, string>>;
	readonly style: Readonly<Record<string, string>>;
}

export interface TableModel {
	readonly rows: number;
	readonly columns: number;
	readonly cells: readonly TableCell[];
}
