import { Facet } from '@codemirror/state';

export const detailsParsingActive = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });
