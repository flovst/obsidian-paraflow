import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { discoverCodeBlocks } from './model.js';
import { isRenderedCodeLanguage } from './source-scan.js';
import { planIndentedCodeLanguage } from './language-plan.js';

export interface CodeLanguagePopup {
	close(): void;
	focus(): void;
	containsFocus(): boolean;
}

/** The language token is the only editable part of the info string. */
export function openCodeLanguagePopup(view: EditorView, from: number, anchor: HTMLElement, options: {
	position: 'top-right' | 'bottom-right';
	focus: boolean;
	onClose: (dismissed: boolean) => void;
}): CodeLanguagePopup {
	const doc = view.state.doc;
	const block = discoverCodeBlocks(view.state).find(candidate => candidate.from === from)!;
	const opening = doc.lineAt(block.from);
	const match = block.indented ? null : /(?:`{3,}|~{3,})([ \t]*)(\S*)/u.exec(opening.text)!;
	const language = match?.[2] ?? '';
	const start = match ? opening.from + match.index + match[0].length - language.length : opening.from;
	const end = start + language.length;
	const suffix = block.indented ? '' : doc.sliceString(end, opening.to);
	const validToken = (value: string) => !/[\s`~{}<>="'\\\p{Cc}]/u.test(value) && !isRenderedCodeLanguage(value);
	const owner = view.dom.ownerDocument;
	const popup = owner.createElement('div');
	popup.className = 'paraflow-code-language-popup';
	popup.dataset.position = options.position;
	const input = owner.createElement('input'); input.type = 'text'; input.value = language;
	input.setAttribute('aria-label', '代码语言'); input.placeholder = '代码语言'; input.autocomplete = 'off'; input.spellcheck = false;
	popup.append(input); owner.body.append(popup);
	function position(): void {
		const rect = anchor.getBoundingClientRect();
		const viewport = owner.defaultView!;
		// The body-mounted field must retain tokens scoped to the editor's code block.
		const appearance = viewport.getComputedStyle(anchor.closest('.paraflow-code-heading') ?? anchor);
		popup.style.fontFamily = appearance.fontFamily;
		popup.style.fontSize = viewport.getComputedStyle(view.contentDOM).fontSize;
		popup.style.backgroundColor = appearance.backgroundColor;
		const availableWidth = Math.max(0, Math.min(rect.right, viewport.innerWidth - 8) - Math.max(rect.left, 8));
		if (options.position === 'bottom-right') popup.style.maxWidth = `${availableWidth}px`;
		popup.style.left = `${Math.max(8, Math.min(rect.right - popup.offsetWidth, viewport.innerWidth - popup.offsetWidth - 8))}px`;
		const edge = options.position === 'top-right' ? anchor.closest('.paraflow-code-heading')!.getBoundingClientRect().bottom : rect.bottom;
		const height = popup.getBoundingClientRect().height;
		const top = options.position === 'bottom-right' ? edge + Number.parseFloat(popup.style.fontSize) * 0.1875 : edge - height;
		popup.style.top = `${top}px`;
		// Bottom controls stay outside the border; top controls end before source rows.
		popup.style.visibility = (options.position === 'bottom-right' && !availableWidth) || top < 8 || top + height > viewport.innerHeight - 8 ? 'hidden' : '';
	}
	position();
	let closed = false;
	let leaveTimer: number | undefined;
	function enter(): void { owner.defaultView!.clearTimeout(leaveTimer); }
	function leave(): void {
		enter();
		leaveTimer = owner.defaultView!.setTimeout(() => {
			if(!popup.contains(owner.activeElement))close(true);
		}, 120);
	}
	function close(dismissed = false): void {
		if (closed) return;
		closed = true;
		enter();
		anchor.removeEventListener('pointerenter', enter);
		anchor.removeEventListener('pointerleave', leave);
		owner.removeEventListener('pointerdown', outside, true);
		owner.removeEventListener('scroll', position, true);
		owner.defaultView!.removeEventListener('resize', position);
		popup.remove(); options.onClose(dismissed);
	}
	function apply(dismissed: boolean, focus = false): void {
		if (closed || view.state.doc !== doc) { close(); return; }
		const value = input.value.trim();
		if (!validToken(language) || !validToken(value) || (!value && suffix.trim())) {
			input.setAttribute('aria-invalid', 'true');
			input.setAttribute('aria-description', '请输入普通代码语言名称，并保留附加信息的含义。');
			if (dismissed) close(true);
			return;
		}
		close(dismissed);
		if (value !== language) {
			const changes = view.state.changes(block.indented ? planIndentedCodeLanguage(view.state, block, value) : { from: start, to: end, insert: value });
			view.dispatch({ changes, selection: view.state.selection.map(changes), userEvent: 'input.code-language', annotations: isolateHistory.of('full') });
		}
		if (focus) view.focus();
	}
	function outside(event: Event): void {
		if (!popup.contains(event.target as Node) && !anchor.contains(event.target as Node)) apply(true);
	}
	owner.addEventListener('pointerdown', outside, true);
	owner.addEventListener('scroll', position, true);
	owner.defaultView!.addEventListener('resize', position);
	if(options.position === 'top-right') {
		anchor.addEventListener('pointerenter', enter);anchor.addEventListener('pointerleave', leave);
		popup.addEventListener('pointerenter', enter);popup.addEventListener('pointerleave', leave);
	}
	input.addEventListener('blur', () => apply(true));
	input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-description'); });
	popup.addEventListener('keydown', event => {
		if (event.isComposing) return;
		if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply(options.position === 'top-right', true); }
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); view.focus(); }
	});
	const focus = () => { input.focus(); input.select(); };
	if (options.focus) focus();
	return { close: () => close(), focus, containsFocus: () => popup.contains(owner.activeElement) };
}
