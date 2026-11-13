import { isExternalLink, type LinkOpenIntent } from './intent.js';

export interface LinkOrigin<Leaf = unknown> {
	leaf: Leaf;
	sourcePath: string;
	window: Window;
}

export interface LinkNavigationHost<Leaf, File> {
	preventImplicitCreation: () => boolean;
	parseLinktext: (destination: string) => { path: string; subpath: string };
	resolveFile: (path: string, sourcePath: string) => File | null;
	openInternal: (destination: string, origin: LinkOrigin<Leaf>, intent: LinkOpenIntent, file: File | null, subpath: string) => void | Promise<void>;
	notifyMissing: () => void;
}

/** Resolve the file separately from its heading/block: missing subpaths never create notes. */
export function createLinkNavigation<Leaf, File>(host: LinkNavigationHost<Leaf, File>) {
	const resolve = (destination: string, sourcePath: string) => {
		const { path, subpath } = host.parseLinktext(destination);
		return { file: host.resolveFile(path || sourcePath, sourcePath), subpath };
	};
	const canOpen = (destination: string, sourcePath: string): boolean => {
		if (isExternalLink(destination) || !host.preventImplicitCreation()) return true;
		if (resolve(destination, sourcePath).file) return true;
		host.notifyMissing();
		return false;
	};
	const open = (destination: string, origin: LinkOrigin<Leaf>, intent: LinkOpenIntent): void => {
			if (/^(?:javascript|data|vbscript):/iu.test(destination.trim())) return;
			if (isExternalLink(destination)) { origin.window.open(destination, '_external'); return; }
			const { file, subpath } = resolve(destination, origin.sourcePath);
			if (!file && host.preventImplicitCreation()) { host.notifyMissing(); return; }
			void host.openInternal(destination, origin, intent, file, subpath);
	};
	return {
		canOpen,
		open,
		openAutomatic(destination: string, origin: LinkOrigin<Leaf>, intent: LinkOpenIntent): void {
			const local = !isExternalLink(destination) && host.parseLinktext(destination);
			open(destination, origin, local && !local.path && local.subpath ? 'current' : intent);
		},
	};
}
