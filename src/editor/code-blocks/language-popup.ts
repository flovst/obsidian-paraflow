import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { discoverCodeBlocks } from './model.js';
import { codeBlocksIn, isRenderedCodeLanguage } from './source-scan.js';
import { planIndentedCodeLanguage } from './language-plan.js';
import { codeLanguageIcon, codeLanguageSuggestions } from './language-suggestions.js';

export interface CodeLanguagePopup {
	close(): void;
	focus(): void;
	containsFocus(): boolean;
}

/** The language token is the only editable part of the info string. */
export function openCodeLanguagePopup(view: EditorView, from: number, anchor: HTMLElement, options: {
	position: 'top-right' | 'bottom-right';
	focus: boolean;
	dismissOnPointerLeave?: boolean;
	onClose: (dismissed: boolean) => void;
}): CodeLanguagePopup {
	const doc = view.state.doc;
	const block = discoverCodeBlocks(view.state).find(candidate => candidate.from === from) ?? codeBlocksIn(doc, true).find(candidate => candidate.from === from)!;
	const opening = doc.lineAt(block.from);
	const match = block.indented ? null : /(?:`{3,}|~{3,})([ \t]*)(\S*)/u.exec(opening.text)!;
	const language = match?.[2] ?? '';
	const start = match ? opening.from + match.index + match[0].length - language.length : opening.from;
	const end = start + language.length;
	const suffix = block.indented ? '' : doc.sliceString(end, opening.to);
	const validToken = (value: string) => !/[\s`~{}<>="'\\\p{Cc}]/u.test(value) && (value.toLowerCase() === 'mermaid' || !isRenderedCodeLanguage(value));
	const owner = view.dom.ownerDocument;
	const popup = owner.createElement('div');
	popup.className = 'paraflow-code-language-popup';
	popup.dataset.position = options.position;
	const input = owner.createElement('input'); input.type = 'text'; input.value = language;
	input.setAttribute('aria-label', '代码语言'); input.placeholder = '代码语言'; input.autocomplete = 'off'; input.spellcheck = false;
	const suggestions = owner.createElement('div'); suggestions.className = 'paraflow-code-language-suggestions';
	suggestions.setAttribute('role', 'listbox'); suggestions.setAttribute('aria-label', '代码语言推荐'); suggestions.hidden = true;
	let selected = -1;
	popup.append(input, suggestions); owner.body.append(popup);
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
		const edge = options.position === 'top-right' ? (anchor.closest('.paraflow-code-heading') ?? anchor).getBoundingClientRect().bottom : rect.bottom;
		const height = popup.getBoundingClientRect().height;
		const top = options.position === 'bottom-right' ? edge + Number.parseFloat(popup.style.fontSize) * 0.1875 : edge - height;
		popup.style.top = `${top}px`;
		// Bottom controls stay outside the border; top controls end before source rows.
		popup.style.visibility = (options.position === 'bottom-right' && !availableWidth) || top < 8 || top + height > viewport.innerHeight - 8 ? 'hidden' : '';
		suggestions.classList.toggle('is-above', top + height + suggestions.scrollHeight > viewport.innerHeight - 8);
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
			input.setAttribute('aria-description', '请输入代码语言名称，并保留附加信息的含义。');
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
	if(options.position === 'top-right' && options.dismissOnPointerLeave !== false) {
		anchor.addEventListener('pointerenter', enter);anchor.addEventListener('pointerleave', leave);
		popup.addEventListener('pointerenter', enter);popup.addEventListener('pointerleave', leave);
	}
	// Keep blur and focus within one call before host focus-loss updates can remove this input.
	input.addEventListener('mousedown', event => { if (event.button === 0) input.focus(); });
	input.addEventListener('blur', () => apply(true));
	function recommend(): void {
		selected = -1;
		suggestions.replaceChildren(...codeLanguageSuggestions(input.value).map(language => {
			const option = owner.createElement('button'); option.type = 'button'; option.textContent = language;
			const { category, path } = codeLanguageIcon(language);
			const icon = owner.createElementNS('http://www.w3.org/2000/svg', 'svg');
			icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('class', 'paraflow-code-language-icon');
			icon.setAttribute('data-category', category); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
			const shape = owner.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', path);
			icon.append(shape); option.prepend(icon);
			option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
			option.addEventListener('mousedown', event => event.preventDefault());
			option.addEventListener('click', () => { input.value = language; apply(options.position === 'top-right', true); });
			return option;
		}));
		suggestions.hidden = !suggestions.childElementCount; position();
	}
	input.addEventListener('focus', recommend);
	input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-description'); recommend(); });
	popup.addEventListener('keydown', event => {
		if (event.isComposing) return;
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.childElementCount) {
			event.preventDefault(); event.stopPropagation();
			selected = selected < 0 ? event.key === 'ArrowDown' ? 0 : suggestions.childElementCount - 1
				: (selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.childElementCount) % suggestions.childElementCount;
			Array.from(suggestions.children).forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
			const option = suggestions.children[selected] as HTMLElement;
			if (option.offsetTop < suggestions.scrollTop) suggestions.scrollTop = option.offsetTop;
			else if (option.offsetTop + option.offsetHeight > suggestions.scrollTop + suggestions.clientHeight)
				suggestions.scrollTop = option.offsetTop + option.offsetHeight - suggestions.clientHeight;
		}
		if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation();
			if (selected >= 0) input.value = suggestions.children[selected]!.textContent!;
			apply(options.position === 'top-right', true);
		}
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); view.focus(); }
	});
	const focus = () => { input.focus(); input.select(); };
	if (options.focus) focus();
	return { close: () => close(), focus, containsFocus: () => popup.contains(owner.activeElement) };
}
