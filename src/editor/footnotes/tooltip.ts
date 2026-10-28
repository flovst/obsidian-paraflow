import type { TooltipView } from '@codemirror/view';

const HOST_CLASS = 'paraflow-footnote-tooltip-host';
const owners = new WeakMap<HTMLElement, { count: number; hadClass: boolean }>();

/** CodeMirror shares a hover host with other providers; release only our own class. */
export function footnoteTooltipView(dom: HTMLElement): TooltipView {
	let host: HTMLElement;
	return {
		dom,
		mount() {
			host = dom.parentElement!;
			const ownership = owners.get(host) ?? { count: 0, hadClass: host.classList.contains(HOST_CLASS) };
			ownership.count++;
			owners.set(host, ownership);
			host.classList.add(HOST_CLASS);
		},
		destroy() {
			const ownership = owners.get(host)!;
			if (--ownership.count) return;
			if (!ownership.hadClass) host.classList.remove(HOST_CLASS);
			owners.delete(host);
		},
	};
}
