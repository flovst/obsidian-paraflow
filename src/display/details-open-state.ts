import { ChangeSet, MapMode, type ChangeDesc } from '@codemirror/state';
import { detailsContainers } from '../editor/rendered-blocks/details-source.js';

interface DocumentState { source: string; opened: ReadonlyMap<number, boolean>; }

/** Explicit disclosure choices belong to a document for the current plugin session. */
export class DetailsOpenState {
	private documents = new Map<string, DocumentState>();
	private listeners = new Map<string, Set<() => void>>();

	initialize(path: string, source: string): void {
		if (!this.documents.has(path)) this.documents.set(path, { source, opened: new Map() });
	}
	source(path: string): string | undefined { return this.documents.get(path)?.source; }
	opened(path: string, source: string): ReadonlyMap<number, boolean> {
		const document = this.documents.get(path);
		return document?.source === source ? document.opened : new Map();
	}
	set(path: string, source: string, from: number, open: boolean): void {
		const document = this.documents.get(path);
		if (!document || document.source !== source || document.opened.get(from) === open) return;
		if (!detailsContainers(source).some(block => block.from === from)) return;
		document.opened = new Map([...document.opened, [from, open]]);
		this.notify(path);
	}
	update(path: string, before: string, after: string, changes?: ChangeDesc): void {
		const document = this.documents.get(path);
		if (!document || document.source !== before || before === after) return;
		const mapping = changes ?? sourceChange(before, after);
		const starts = new Set(detailsContainers(after).map(block => block.from));
		const opened = new Map<number, boolean>();
		for (const [from, open] of document.opened) {
			const mapped = mapping.mapPos(from, 1, MapMode.TrackAfter);
			if (mapped !== null && starts.has(mapped)) opened.set(mapped, open);
		}
		this.documents.set(path, { source: after, opened });
		this.notify(path);
	}
	subscribe(path: string, listener: () => void): () => void {
		let listeners = this.listeners.get(path);
		if (!listeners) this.listeners.set(path, listeners = new Set());
		listeners.add(listener);
		return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(path); };
	}
	rename(previous: string, next: string): void {
		for (const [path, document] of [...this.documents]) {
			if (path !== previous && !path.startsWith(previous + '/')) continue;
			const renamed = next + path.slice(previous.length);
			this.documents.delete(path); this.documents.set(renamed, document);
			this.notify(path); this.notify(renamed);
		}
	}
	remove(path: string): void {
		for (const candidate of [...this.documents.keys()]) {
			if (candidate !== path && !candidate.startsWith(path + '/')) continue;
			this.documents.delete(candidate); this.notify(candidate);
		}
	}
	clear(): void { this.documents.clear(); this.listeners.clear(); }
	private notify(path: string): void { for (const listener of this.listeners.get(path) ?? []) listener(); }
}

/** External replacement has one conservative changed region; deleted anchors expire. */
function sourceChange(before: string, after: string): ChangeDesc {
	let from = 0, oldEnd = before.length, newEnd = after.length;
	while (from < oldEnd && from < newEnd && before[from] === after[from]) from++;
	while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
	return ChangeSet.of({ from, to: oldEnd, insert: after.slice(from, newEnd) }, before.length);
}
