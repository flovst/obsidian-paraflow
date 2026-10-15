import { EditorState, StateEffect, StateField, type ChangeSpec, type Extension, type Transaction } from '@codemirror/state';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { acceptedMath, discoverParsedMath, mathRangeIndex, type MathExpression } from './syntax.js';
import { mathCandidatesActive, pendingMath, type PendingMathRange } from './candidate-ranges.js';
import { createSharedMathParser } from './shared-parser.js';
export { pendingMathRanges } from './candidate-ranges.js';

interface MathCandidates { readonly active: boolean; readonly dirty: boolean; readonly ranges: readonly PendingMathRange[]; readonly accepted: readonly MathExpression[] }
const restorePending = StateEffect.define<Pick<MathCandidates, 'ranges' | 'accepted'>>({ map: (value, changes) => ({
    ranges: value.ranges.map(range => ({ from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) })),
    accepted: value.accepted.map(math => ({ ...math, from: changes.mapPos(math.from, 1), to: changes.mapPos(math.to, -1), contentFrom: changes.mapPos(math.contentFrom, -1), contentTo: changes.mapPos(math.contentTo, 1) })),
}) });
export const confirmMath = StateEffect.define<number | null>({ map: (from, changes) => from === null ? null : changes.mapPos(from, 1) });
function candidates(state: EditorState): readonly PendingMathRange[] { return mathRangeIndex(state).candidates; }
function independentParagraphs(state: EditorState, range: PendingMathRange): boolean {
    const first = state.doc.lineAt(range.from).number, last = state.doc.lineAt(range.to).number;
    for (let number = first + 1; number < last; number++)
        if (/^[ \t]*(?:>[ \t]*)*$/u.test(state.doc.line(number).text))
            return true;
    return false;
}
function editedDelimiter(tr: Transaction, range: PendingMathRange): boolean {
    let edited = false;
    tr.changes.iterChangedRanges((from, to, fromB, toB) => {
        const line = tr.newDoc.lineAt(fromB);
        if (toB <= line.to && fromB >= range.from && toB <= range.to && /^[ \t]*(?:>[ \t]*)*\$\$$/u.test(line.text) && tr.startState.doc.lineAt(from).number === tr.startState.doc.lineAt(to).number)
            edited = true;
    });
    return edited;
}

function dollarTokenIdentity(state: EditorState, from: number, to: number): string {
    let start = from, end = to;
    while (start > 0 && state.sliceDoc(start - 1, start) === '$') start--;
    while (end < state.doc.length && state.sliceDoc(end, end + 1) === '$') end++;
    return `${from - start}:${end - start}`;
}

function mappedAccepted(value: MathCandidates, tr: Transaction): readonly MathExpression[] {
    return value.accepted.flatMap(math => {
        let touched = false;
        tr.changes.iterChangedRanges((from, to) => {
            if (from < math.contentFrom && to > math.from || from < math.to && to > math.contentTo ||
                from === to && (math.from < from && from < math.contentFrom || math.contentTo < from && from < math.to)) touched = true;
        });
        if (touched) return [];
        const next = { ...math, from: tr.changes.mapPos(math.from, 1), to: tr.changes.mapPos(math.to, -1),
            contentFrom: tr.changes.mapPos(math.contentFrom, -1), contentTo: tr.changes.mapPos(math.contentTo, 1) };
        const parsed = discoverParsedMath(tr.state).find(item => item.from === next.from && item.to === next.to);
        if (parsed) next.display = parsed.display;
        if (next.from >= next.to || tr.state.sliceDoc(next.from, next.contentFrom) !== '$$' || tr.state.sliceDoc(next.contentTo, next.to) !== '$$') return [];
        // A preserved two-byte slice must still occupy the same complete dollar run.
        // This also retains legal adjacent close/open pairs inside a four-dollar run.
        return dollarTokenIdentity(tr.startState, math.from, math.contentFrom) === dollarTokenIdentity(tr.state, next.from, next.contentFrom) &&
            dollarTokenIdentity(tr.startState, math.contentTo, math.to) === dollarTokenIdentity(tr.state, next.contentTo, next.to) ? [next] : [];
    });
}
/** Typora-inspired conversion cleanup: change this rule here, never trim on save/body edits. */
export function mathConversionChanges(state: EditorState, expressions: readonly MathExpression[]): readonly ChangeSpec[] {
    const changes: ChangeSpec[] = [];
    for (const math of expressions) {
        const first = state.doc.lineAt(math.from), last = state.doc.lineAt(math.to);
        if (!math.display || first.number === last.number || state.sliceDoc(math.contentFrom, first.to).trim() || state.sliceDoc(last.from, math.contentTo).replace(/^[ \t]*(?:>[ \t]*)*/u, '').trim())
            continue;
        const prefix = state.sliceDoc(first.from, math.from);
        const depth = (prefix.match(/>/gu) ?? []).length;
        const body = Array.from({ length: last.number - first.number - 1 }, (_, i) => state.doc.line(first.number + i + 1));
        const nonblank = body.filter(line => {
            let text = line.text;
            for (let quote = 0; quote < depth; quote++) text = text.replace(/^[ \t]*>[ \t]?/u, '');
            return text.trim();
        });
        if (!nonblank.length) {
            const insert = prefix + '\n';
            if (state.sliceDoc(first.to + 1, last.from) !== insert)
                changes.push({ from: first.to + 1, to: last.from, insert });
            continue;
        }
        const begin = nonblank[0]!.from, end = nonblank.at(-1)!.to + 1;
        if (begin > first.to + 1)
            changes.push({ from: first.to + 1, to: begin, insert: '' });
        if (end < last.from)
            changes.push({ from: end, to: last.from, insert: '' });
    }
    return changes;
}
export function createMathCandidateExtension(isActive: (state: EditorState) => boolean): Extension {
    // Typora parses LP paragraph nodes locally; only Enter or a dirty Source return commits independent $$ paragraphs.
    const field = StateField.define<MathCandidates>({
        create(state) { const ranges = candidates(state), closed = discoverParsedMath(state); return { active: isActive(state), dirty: false, accepted: closed.filter(math => math.display), ranges: ranges.filter(range => !closed.some(math => math.from === range.from && math.to === range.to)) }; },
        update(value, tr) {
            const active = isActive(tr.state), dirty = !active && (value.dirty || tr.docChanged);
            if (!tr.docChanged && active === value.active && !tr.effects.some(effect => effect.is(confirmMath) || effect.is(restorePending)))
                return value;
            const found = candidates(tr.state), closed = discoverParsedMath(tr.state);
            const restored = tr.effects.find(effect => effect.is(restorePending));
            const mapped = (restored?.value.ranges ?? value.ranges.map(range => ({ from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, -1) })));
            const confirmed = tr.effects.find(effect => effect.is(confirmMath));
            const confirmAll = confirmed?.value === null || active && !value.active && value.dirty;
            const preserved = restored?.value.accepted ?? mappedAccepted(value, tr);
            const accepted = [...preserved];
            const ranges = found.filter(range => {
                const formula = closed.find(math => math.from === range.from && math.to === range.to);
                if (!formula)
                    return true;
                let created = false;
                if (tr.isUserEvent('input.math-create')) tr.changes.iterChangedRanges((_from, _to, from, to) => {
                    if (range.from <= from && to <= range.to) created = true;
                });
                if (confirmAll || confirmed?.value === range.from || created) {
                    accepted.splice(0, accepted.length, ...accepted.filter(old => old.to <= range.from || old.from >= range.to), formula);
                    return false;
                }
                if (restored)
                    return mapped.some(old => old.from === range.from);
                if (!active)
                    return mapped.some(old => old.from === range.from);
                const wasPairedPending = value.ranges.some(old => tr.changes.mapPos(old.from, 1) === range.from &&
                    discoverParsedMath(tr.startState).some(math => math.display && math.from === old.from));
                if (mapped.some(old => old.from === range.from) && (independentParagraphs(tr.state, range) || wasPairedPending))
                    return true;
                const wasConfirmed = preserved.some(math => math.from === range.from && math.to === range.to);
                const overlapsAccepted = preserved.some(math => math.from < range.to && range.from < math.to);
                const pending = !wasConfirmed && (overlapsAccepted || editedDelimiter(tr, range) &&
                    (independentParagraphs(tr.state, range) || !tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose')));
                if (!pending && !wasConfirmed) accepted.push(formula);
                return pending;
            }).flatMap(range => {
                if (accepted.some(math => math.from <= range.from && range.from < math.to)) return [];
                const next = accepted.filter(math => range.from < math.from && math.from < range.to).sort((a, b) => a.from - b.from)[0];
                return [{ from: range.from, to: next ? Math.max(range.from + 2, tr.state.doc.lineAt(next.from).from - 1) : range.to }];
            });
            const finalAccepted = confirmAll ? closed.filter(math => math.display) : accepted;
            return { active, dirty, ranges, accepted: finalAccepted };
        },
        provide: field => [pendingMath.from(field, value => value.active ? value.ranges : []), acceptedMath.from(field, value => value.active ? value.accepted : []), mathCandidatesActive.from(field, value => value.active)],
    });
    return [field, createSharedMathParser(), invertedEffects.of(tr => {
        if (!tr.docChanged && !tr.effects.some(effect => effect.is(confirmMath) || effect.is(restorePending))) return [];
        const before = tr.startState.field(field), after = tr.state.field(field);
        // Coordinate-only mapping needs no history snapshot. In particular, cancelling an
        // edge composition must remove its empty history event rather than retain this effect.
        const ranges = before.ranges.map(range => ({from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, -1)}));
        const accepted = before.accepted.map(math => ({...math, from: tr.changes.mapPos(math.from, 1), to: tr.changes.mapPos(math.to, -1),
            contentFrom: tr.changes.mapPos(math.contentFrom, -1), contentTo: tr.changes.mapPos(math.contentTo, 1)}));
        const sameRanges = ranges.length === after.ranges.length && ranges.every((range, index) => range.from === after.ranges[index]!.from && range.to === after.ranges[index]!.to);
        const sameAccepted = accepted.length === after.accepted.length && accepted.every((math, index) => {
            const item = after.accepted[index]!;
            return math.from === item.from && math.to === item.to && math.contentFrom === item.contentFrom && math.contentTo === item.contentTo && math.display === item.display;
        });
        return sameRanges && sameAccepted ? [] : [restorePending.of(before)];
    }),
        EditorState.transactionFilter.of(tr => {
            const before = tr.startState.field(field);
            if (!isActive(tr.state) || tr.state.readOnly || before.active || !before.dirty)
                return tr;
            const changes = mathConversionChanges(tr.state, discoverParsedMath(tr.state));
            return [tr, { changes, effects: confirmMath.of(null), annotations: isolateHistory.of('full'), sequential: true }];
        })];
}
