import { Annotation, StateEffect } from '@codemirror/state';

export interface ExpectedNumber {
	readonly from: number;
	readonly before: string;
	readonly number: string;
	readonly after: string;
}

export const numberingIntent = StateEffect.define<readonly ExpectedNumber[]>({
	map: (numbers, changes) => numbers.map(number => ({ ...number, from: changes.mapPos(number.from, 1) })),
});

/** Validated opaque-block replacements cannot introduce list markers. */
export const preservesListOwnership = Annotation.define<{ readonly from: number; readonly to: number; readonly insert: string }>();

export function isNumberingIntentEffect(effect: StateEffect<unknown>): boolean {
	return effect.is(numberingIntent);
}
