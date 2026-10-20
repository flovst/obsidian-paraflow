interface Range { readonly from: number; readonly to: number }

/** Immutable endpoint snapshot. Matches are ordered by start, retaining input order for ties. */
export function createRangeQuery<T extends Range>(ranges: readonly T[]) {
	const ordered = ranges.map(range => ({ range, from: range.from, to: range.to })).sort((a, b) => a.from - b.from);
	const maximum: number[] = [];
	let size = 1;
	while (size < ordered.length) size *= 2;
	const tree = Array<number>(size * 2).fill(-Infinity);
	for (let index = 0; index < ordered.length; index++) {
		maximum.push(Math.max(maximum.at(-1) ?? -Infinity, ordered[index]!.to));
		tree[size + index] = ordered[index]!.to;
	}
	for (let index = size - 1; index > 0; index--) tree[index] = Math.max(tree[index * 2]!, tree[index * 2 + 1]!);
	function startsBefore(position: number, inclusive: boolean): number {
		let first = 0, last = ordered.length;
		while (first < last) {
			const middle = (first + last) >>> 1;
			if (ordered[middle]!.from < position || inclusive && ordered[middle]!.from === position) first = middle + 1;
			else last = middle;
		}
		return first;
	}
	function firstContainingPoint(position: number): T | undefined {
		const limit = startsBefore(position, true);
		let first = 0, last = limit;
		while (first < last) {
			const middle = (first + last) >>> 1;
			if (maximum[middle]! > position) last = middle;
			else first = middle + 1;
		}
		return first < limit ? ordered[first]!.range : undefined;
	}
	function lastContainingPoint(position: number): T | undefined {
		const limit = startsBefore(position, true);
		function find(node: number, from: number, to: number): T | undefined {
			if (from >= limit || tree[node]! <= position) return undefined;
			if (to - from === 1) return ordered[from]!.range;
			const middle = (from + to) >>> 1;
			return find(node * 2 + 1, middle, to) ?? find(node * 2, from, middle);
		}
		return find(1, 0, size);
	}
	return {
		contains: (from: number, to: number): boolean => (maximum[startsBefore(from, true) - 1] ?? -Infinity) >= to,
		overlaps: (from: number, to: number): boolean => (maximum[startsBefore(to, false) - 1] ?? -Infinity) > from,
		overlapsClosed: (from: number, to: number): boolean => (maximum[startsBefore(to, true) - 1] ?? -Infinity) >= from,
		containsPoint: (position: number): boolean => (maximum[startsBefore(position, true) - 1] ?? -Infinity) > position,
		containsEndPoint: (position: number): boolean => (maximum[startsBefore(position, false) - 1] ?? -Infinity) >= position,
		firstStartingBetween: (from: number, to: number): T | undefined => {
			const next = ordered[startsBefore(from, true)];
			return next && next.from < to ? next.range : undefined;
		},
		firstContainingPoint,
		lastContainingPoint,
	};
}
