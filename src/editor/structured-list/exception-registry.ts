import type { HandledOperationId } from './operations.js';

export type ExceptionId =
	| 'SLX-001'
	| 'SLX-002'
	| 'SLX-003'
	| 'SLX-004'
	| 'SLX-005'
	| 'SLX-006';

export interface ContractCitation {
	readonly sectionHeading: string;
	readonly evidenceHeading: string;
}

export interface ExceptionStrategy {
	readonly id: ExceptionId;
	readonly operations: readonly HandledOperationId[];
	readonly contractCitations: readonly ContractCitation[];
	readonly whySharedPrimitivesAreInsufficient: string;
	readonly currentStrategy: string;
	readonly simplificationTarget: string;
}

const entries = [
	{
		contractCitations: [
			{ sectionHeading: 'Tab', evidenceHeading: 'Fixture 1: first top-level unordered item fallback' },
			{ sectionHeading: 'Tab', evidenceHeading: 'Fixture 8: first ordered item content-middle fallback' },
			{ sectionHeading: 'Tab', evidenceHeading: 'Fixture 9: first checked task content-start fallback' },
			{ sectionHeading: 'Tab', evidenceHeading: 'Fixture 10: only empty unordered item fallback' },
		],
		currentStrategy: 'Insert the evidence-specific U+200B/U+0009 or U+0009 fallback at the normalized caret.',
		id: 'SLX-001',
		operations: ['tab'],
		simplificationTarget: 'Replace this entry when a normalized content-fallback insertion fact covers every confirmed caret zone.',
		whySharedPrimitivesAreInsufficient: 'Indentation primitives move structural source regions and cannot choose evidence-specific content characters.',
	},
	{
		contractCitations: [
			{ sectionHeading: 'Tab', evidenceHeading: 'Fixture 3: nested unordered item with a descendant' },
			{ sectionHeading: 'Shift+Tab', evidenceHeading: 'Fixture 2: nested unordered item with a descendant and later items' },
		],
		currentStrategy: 'Tab remaps only the target marker line while Shift+Tab remaps the target and normalized owned blocks.',
		id: 'SLX-002',
		operations: ['tab', 'shift-tab'],
		simplificationTarget: 'Delete the exception when topology exposes an operation-neutral explicit block-movement set.',
		whySharedPrimitivesAreInsufficient: 'One generic indentation transform cannot decide the deliberately asymmetric ownership set.',
	},
	{
		contractCitations: [
			{ sectionHeading: 'Enter on an empty nested item', evidenceHeading: 'Fixture 1: only empty nested unordered item' },
			{ sectionHeading: 'Backspace at nested item content start', evidenceHeading: 'Core fixture: empty item with descendants' },
			{ sectionHeading: 'Backspace at nested item content start', evidenceHeading: 'Test 9: empty nested item without child' },
			{ sectionHeading: 'Backspace on an empty nested item', evidenceHeading: 'Fixture 1: final empty unordered item after a same-level item' },
		],
		currentStrategy: 'Remove the empty nested marker and rewrite only the normalized whitespace boundaries named by the fixture topology.',
		id: 'SLX-003',
		operations: [
			'enter-empty-nested',
			'backspace-empty-nested',
			'backspace-nested-content-start',
		],
		simplificationTarget: 'Replace the exception with one normalized empty-item conversion fact that includes exact boundary replacements.',
		whySharedPrimitivesAreInsufficient: 'Marker removal composes with context-dependent whitespace-only lines that must not be normalized globally.',
	},
	{
		contractCitations: [
			{ sectionHeading: 'Enter on an empty top-level item', evidenceHeading: 'Fixture 1: only empty `-` item' },
			{ sectionHeading: 'Enter on an empty top-level item', evidenceHeading: 'Fixture 8: only empty `+` item' },
			{ sectionHeading: 'Enter on an empty top-level item', evidenceHeading: 'Fixture 9: only empty `*` item' },
		],
		currentStrategy: 'Preserve the sole empty top-level item and insert a second evidence-specific empty item in one edit plan.',
		id: 'SLX-004',
		operations: ['enter-empty-top-level'],
		simplificationTarget: 'Delete the exception when splitItem accepts a normalized empty-item duplication policy fact.',
		whySharedPrimitivesAreInsufficient: 'The ordinary empty-item conversion removes list structure, while this branch deliberately duplicates it.',
	},
	{
		contractCitations: [
			{ sectionHeading: 'Up/Down', evidenceHeading: 'Document-end Down' },
		],
		currentStrategy: 'Request only terminal-insertion:0 and append exactly one newline in one annotated source transaction.',
		id: 'SLX-005',
		operations: ['up-down'],
		simplificationTarget: 'Replace the exception when navigation exposes a normalized terminal insertion edit primitive.',
		whySharedPrimitivesAreInsufficient: 'Navigation is normally selection-only, and no shared structural transform owns document-end insertion.',
	},
	{
		contractCitations: [
			{ sectionHeading: 'Normal selection', evidenceHeading: 'Clipboard serialization' },
			{ sectionHeading: 'Normal selection', evidenceHeading: 'Fixture A: partial selection across nested unordered items' },
			{ sectionHeading: 'Normal selection', evidenceHeading: 'Fixture B: selection across ordered and task blocks' },
		],
		currentStrategy: 'Serialize normalized visible segments with synthesized prefixes; Cut separately edits selection-derived named regions.',
		id: 'SLX-006',
		operations: ['normal-selection'],
		simplificationTarget: 'Delete the exception when selection segments directly expose their complete serialized Markdown fragments.',
		whySharedPrimitivesAreInsufficient: 'Clipboard output must contain protected prefixes that are intentionally absent from visible endpoint ranges.',
	},
] as const satisfies readonly ExceptionStrategy[];

export const exceptionStrategies: ReadonlyMap<ExceptionId, ExceptionStrategy> = new Map(
	entries.map((entry) => [entry.id, Object.freeze(entry)]),
);
