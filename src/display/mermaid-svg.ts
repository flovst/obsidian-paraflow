import createDOMPurify from 'dompurify';
import * as css from 'css-tree';
import type { MermaidThemeRenderer, MermaidThemeResult } from './mermaid-theme.js';

export interface NativeMermaidRenderer {
	render(id: string, source: string): Promise<{ svg: string; bindFunctions?: (element: HTMLElement) => void }>;
}

function cleanDeclarations(block: css.Block | css.DeclarationList): void {
	block.children.forEach((node, item, list) => {
		if (node.type !== 'Declaration') { list.remove(item); return; }
		let safe = true;
		css.walk(node.value, value => {
			if (value.type === 'Raw' || value.type === 'Url' && !/^#[A-Za-z_][\w:.-]*$/u.test(value.value)) safe = false;
			if (value.type === 'Function' && ['expression', 'url', 'image', 'image-set', '-webkit-image-set', 'src'].includes(css.ident.decode(value.name).toLowerCase())) safe = false;
		});
		if (!safe || ['-moz-binding', 'behavior'].includes(css.ident.decode(node.property).toLowerCase())) list.remove(item);
	});
}

function scopedStyles(source: string, id: string): string {
	const ast = css.parse(source, { parseCustomProperty: true });
	if (ast.type !== 'StyleSheet') throw new Error('Invalid Mermaid stylesheet');
	ast.children.forEach((node, item, list) => {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') { list.remove(item); return; }
		const safe = node.prelude.children.toArray().every(selector => {
			if (selector.type !== 'Selector') return false;
			const first = selector.children.first;
			if (first?.type !== 'IdSelector' || css.ident.decode(first.name) !== id) return false;
			let descendant = false;
			for (const part of selector.children) if (part.type === 'Combinator') {
				if (part.name === ' ' || part.name === '>') descendant = true;
				else if (!descendant) return false;
			}
			return true;
		});
		if (!safe) { list.remove(item); return; }
		cleanDeclarations(node.block);
	});
	return css.generate(ast);
}

/** Preserve diagram CSS and HTML labels while sanitizing their executable content. */
export function sanitizeMermaidSvg(svg: string, owner: Document): DocumentFragment {
	const purifier = createDOMPurify(owner.defaultView!);
	const content = purifier.sanitize(svg, {
		RETURN_DOM_FRAGMENT: true,
		ADD_TAGS: ['foreignObject'],
		HTML_INTEGRATION_POINTS: { foreignobject: true },
		FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'audio', 'video'],
	});
	const root = content.firstElementChild;
	if (content.children.length !== 1 || root?.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || !root.id) {
		throw new Error('Mermaid renderer returned an invalid SVG document');
	}
	for (const style of root.querySelectorAll('style')) style.textContent = scopedStyles(style.textContent ?? '', root.id);
	for (const element of [root, ...root.querySelectorAll('[style]')]) {
		const value = element.getAttribute('style');
		if (!value) continue;
		const declarations = css.parse(value, { context: 'declarationList', parseCustomProperty: true });
		if (declarations.type !== 'DeclarationList') throw new Error('Invalid Mermaid inline style');
		cleanDeclarations(declarations);
		element.setAttribute('style', css.generate(declarations));
	}
	return owner.importNode(content, true);
}

export function createMermaidThemeRenderer(load: () => Promise<NativeMermaidRenderer>, document: Document): MermaidThemeRenderer {
	return async (source, owner = document): Promise<MermaidThemeResult> => {
		const mermaid = await load();
		const result = await mermaid.render(`paraflow-mermaid-${owner.defaultView!.crypto.randomUUID()}`, source);
		return { content: sanitizeMermaidSvg(result.svg, owner), bindFunctions: result.bindFunctions };
	};
}
