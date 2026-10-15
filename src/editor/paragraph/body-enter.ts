export function bodyEnterText(operation: 'enter' | 'shift-enter', linePrefix = ''): string {
	// The paragraph separator stays bare; only the following content carries list indentation.
	return operation === 'enter' ? `\n\n${linePrefix}` : `\n${linePrefix}`;
}
