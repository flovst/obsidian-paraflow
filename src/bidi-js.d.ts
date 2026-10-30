declare module 'bidi-js' {
	interface EmbeddingLevels { readonly levels: Uint8Array; }
	interface Bidi { getEmbeddingLevels(text: string, direction: 'ltr' | 'rtl'): EmbeddingLevels; }
	export default function bidiFactory(): Bidi;
}
