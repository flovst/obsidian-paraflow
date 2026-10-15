import { TFile, type App } from 'obsidian';
import { adaptMetadataMathSource, installMathMetadataAdapter, type MathMetadataHost } from './math.js';

const disposal = Symbol.for('paraflow.mathMetadataDisposal');
export async function createMathMetadataIntegration(app: App, onError: (error: unknown) => void) {
	const host = app.metadataCache as unknown as MathMetadataHost & { [disposal]?: Promise<void>; computeFileMetadataAsync(file: TFile): Promise<void> | undefined };
	await host[disposal];
	if (typeof host.computeFileMetadataAsync !== 'function') throw new Error('This Obsidian metadata indexing interface is unsupported');
	const adapter = installMathMetadataAdapter(host, async paths => {
		for (const path of paths) { const file = app.vault.getAbstractFileByPath(path); if (file instanceof TFile) await host.computeFileMetadataAsync(file); }
	});
	return {
		async refreshExisting(): Promise<void> {
			// Background discovery only. The ordinary host cache remains valid for
			// every file whose dollar grammar needs no adaptation.
			for (const file of app.vault.getMarkdownFiles()) {
				if (!adapter.active) return;
				const mtime = file.stat.mtime, size = file.stat.size, record = host.fileCache[file.path];
				let source: string;
				try { source = await app.vault.cachedRead(file); }
				catch (error) {
					// Files can be removed while this background snapshot is being read.
					if (!adapter.active) return;
					if (app.vault.getAbstractFileByPath(file.path) !== file) continue;
					throw error;
				}
				if (!adapter.active) return;
				if (file.stat.mtime !== mtime || file.stat.size !== size || host.fileCache[file.path] !== record) continue;
				if (adaptMetadataMathSource(source)) {
					if (record?.hash) adapter.invalidate(record.hash);
					await host.computeFileMetadataAsync(file);
				}
				await new Promise<void>(resolve => window.setTimeout(resolve, 0));
			}
		},
		destroy(): void {
			const pending = adapter.destroy(); host[disposal] = pending;
			void pending.catch(onError).finally(() => { if (host[disposal] === pending) delete host[disposal]; });
		},
	};
}
