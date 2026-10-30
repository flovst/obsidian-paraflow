import { createDetachedEl, createOwnedFragment } from '../dom';
import type { CodeBlockOptions } from '../editor/code-blocks/model.js';
import { isRenderedCodeLanguage } from '../editor/code-blocks/source-scan.js';

function hasNativeCopy(pre: HTMLElement): boolean {
	if(pre.querySelector('.copy-code-button'))return true;
	return [...pre.querySelectorAll('.code-block-flair')].some(flair=>
		/copy|复制|複製/iu.test(`${flair.getAttribute('aria-label') ?? ''} ${flair.getAttribute('title') ?? ''}`));
}

/** The display surface owns normal inline layout; explicit author priorities remain authoritative. */
function ownCodeLayout(element: HTMLElement, properties: readonly string[]): () => void {
	const original = element.getAttribute('style');
	const captured = properties.flatMap(property => {
		const value = element.style.getPropertyValue(property);
		return value && !element.style.getPropertyPriority(property) ? [{ property, value }] : [];
	});
	for (const { property } of captured) element.style.removeProperty(property);
	const owned = element.getAttribute('style');
	return () => {
		if (element.getAttribute('style') === owned) {
			if (original === null) element.removeAttribute('style');
			else element.setAttribute('style', original);
		} else {
			for (const { property, value } of captured) {
				if (element.style.getPropertyValue(property)) continue;
				if (property === 'padding') {
					const updatedEdges = ['top', 'right', 'bottom', 'left'].flatMap(edge => {
						const name = `padding-${edge}`, current = element.style.getPropertyValue(name);
						return current ? [{ name, current, priority: element.style.getPropertyPriority(name) }] : [];
					});
					element.style.setProperty(property, value);
					for (const { name, current, priority } of updatedEdges) element.style.setProperty(name, current, priority);
				} else element.style.setProperty(property, value);
			}
		}
	};
}

function wrapLogicalLines(code: HTMLElement): HTMLElement[] {
	const doc=code.ownerDocument;
	const source=code.textContent ?? '';
	const walker=doc.createTreeWalker(code,4);
	const texts: Array<{node: Node; from: number; to: number}>=[];
	let offset=0;
	for(let node=walker.nextNode();node;node=walker.nextNode()) {
		const length=node.textContent!.length;
		texts.push({node,from:offset,to:offset+length});offset+=length;
	}
	const rows=source.split('\n');
	if(rows[rows.length-1]==='')rows.pop();
	if(!source)return [];
	const output=createOwnedFragment(doc);
	const ownedRows: HTMLElement[]=[];
	let start=0;
	for(const [index,row] of rows.entries()) {
		const end=start+row.length+(start+row.length<source.length ? 1 : 0);
		const first=texts.find(text=>text.to>start)!;
		const last=texts.find(text=>text.to>=end)!;
		const range=doc.createRange();
		range.setStart(first.node,start-first.from);range.setEnd(last.node,end-last.from);
		const line=createDetachedEl(doc, 'span');
		line.className='paraflow-code-row';
		line.setAttribute('data-paraflow-line',String(index+1));
		line.style.setProperty('--paraflow-code-number-digits',String(String(rows.length).length));
		let fragment: Node=range.cloneContents();
		let ancestor=range.commonAncestorContainer;
		if(ancestor.nodeType===3)ancestor=ancestor.parentNode!;
		while(ancestor!==code) {
			const wrapper=ancestor.cloneNode(false);wrapper.appendChild(fragment);fragment=wrapper;ancestor=ancestor.parentNode!;
		}
		line.append(fragment);output.append(line);ownedRows.push(line);start=end;
	}
	code.replaceChildren(output);
	return ownedRows;
}

export function createCodeBlockDisplay(root: HTMLElement, options: CodeBlockOptions, owns: (element: Element) => boolean = () => true): () => void {
	const {codeLineNumbers,codeWordWrap}=options;
	const cleanups: Array<()=>void>=[];
	const pres=[...(root.matches('pre') ? [root] : []),...root.querySelectorAll<HTMLElement>('pre')];
	for(const pre of pres) {
		if (!owns(pre)) continue;
		const code=pre.querySelector<HTMLElement>(':scope > code');
		if(!code || pre.classList.contains('paraflow-code-display') || pre.closest('.frontmatter,.mod-frontmatter,.mermaid,.math,.block-language-mermaid,.block-language-math'))continue;
		const language=[...code.classList].find(name=>name.startsWith('language-'))?.slice(9) ?? '';
		if(isRenderedCodeLanguage(language))continue;
		const hadClass=pre.hasAttribute('class');
		const restorePreLayout = ownCodeLayout(pre, ['white-space', 'line-height', 'overflow-x', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
		const restoreCodeLayout = ownCodeLayout(code, ['white-space', 'word-break', 'overflow-wrap']);
		const classes=['paraflow-code-display',...(codeWordWrap ? ['paraflow-code-wrap'] : []),...(codeLineNumbers ? ['paraflow-code-numbers'] : [])];
		pre.classList.add(...classes);
		const original=[...code.childNodes];
		const ownedRows=codeLineNumbers ? wrapLogicalLines(code) : [];
		if(ownedRows.length) { classes.push('paraflow-code-numbered-lines');pre.classList.add('paraflow-code-numbered-lines'); }
		const ownedMarkup=code.innerHTML;
		let label: HTMLElement | null=null;
		let frame: HTMLElement | null=null;
		let restoreFrameMargin: (() => void) | null = null;
		if(language && language!=='none' && !pre.querySelector('.code-block-flair,.code-block-language')) {
			restoreFrameMargin = ownCodeLayout(pre, ['margin-top', 'margin-bottom', 'margin-block-start', 'margin-block-end']);
			frame=createDetachedEl(pre.ownerDocument, 'div');frame.className='paraflow-code-display-frame';
			pre.before(frame);frame.append(pre);
			label=createDetachedEl(pre.ownerDocument, 'span');label.className='paraflow-code-language';label.textContent=language;frame.append(label);
		}
		let button: HTMLButtonElement | null=null;
		if(!hasNativeCopy(pre)) {
			button=createDetachedEl(pre.ownerDocument, 'button');button.className='paraflow-code-copy';button.type='button';button.textContent='复制';
			button.setAttribute('aria-label','复制代码');
			button.addEventListener('click',copy);
			pre.append(button);
		}
		function copy(): void {
			void pre.ownerDocument.defaultView!.navigator.clipboard.writeText(code!.textContent ?? '').then(()=>{
				if(button)button.textContent='已复制';
			},()=>{if(button)button.textContent='复制失败';});
		}
		cleanups.push(()=>{
			restoreFrameMargin?.();restorePreLayout();restoreCodeLayout();
			pre.classList.remove(...classes);
			if(!hadClass && !pre.className)pre.removeAttribute('class');
			// Preserve host replacements and edits inside our wrappers during asynchronous highlighting.
			if(codeLineNumbers) {
				if(code.innerHTML===ownedMarkup && code.childNodes.length===ownedRows.length && ownedRows.every((row,index)=>code.childNodes[index]===row))code.replaceChildren(...original);
				else for(const row of ownedRows)if(code.contains(row))row.replaceWith(...row.childNodes);
			}
			button?.removeEventListener('click',copy);button?.remove();
			label?.remove();
			if(frame) {
				frame.replaceWith(...frame.childNodes);
				if(pre.parentElement===frame) pre.remove();
			}
		});
	}
	return ()=>{for(const cleanup of cleanups)cleanup();};
}
