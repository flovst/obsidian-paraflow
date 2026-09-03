import type { ClipboardEventSink } from './editor/structured-list/operations.js';

export function createBrowserClipboardSink(): ClipboardEventSink {
	let activeEvent: ClipboardEvent | null = null;
	return {
		runWithClipboardEvent(event, write) {
			if (activeEvent) throw new Error('Clipboard event binding is already active');
			activeEvent = event;
			try {
				return write();
			} finally {
				activeEvent = null;
			}
		},
		writeText(text) {
			const clipboardData = activeEvent?.clipboardData;
			if (!clipboardData) {
				activeEvent?.preventDefault();
				throw new Error('Clipboard event data is unavailable');
			}
			try {
				clipboardData.setData('text/plain', text);
			} catch (error: unknown) {
				activeEvent?.preventDefault();
				throw error;
			}
			activeEvent?.preventDefault();
		},
	};
}
