import { type Range } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
const geometrySets = new WeakSet<DecorationSet>();
export function geometryOnlyDecorations(set: DecorationSet): DecorationSet { geometrySets.add(set); return set; }
export function isGeometryOnly(set: DecorationSet): boolean { return geometrySets.has(set); }

/** Publish line geometry separately from higher-priority syntax/replacement decorations. */
export function projectLineLayout(decorations: DecorationSet, className: string, style: string): DecorationSet {
	const lines: Range<Decoration>[] = [];
	for (const cursor = decorations.iter(); cursor.value; cursor.next()) {
		const classes = (cursor.value.spec as { class?: string }).class;
		if (classes?.split(' ').includes(className)) lines.push(Decoration.line({ attributes: { style } }).range(cursor.from));
	}
	return geometryOnlyDecorations(Decoration.set(lines, true));
}
