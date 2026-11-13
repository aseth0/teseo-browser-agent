// The words of a feature's notice: one sentence per reason (core/build), its link inside it. ui/FeatureNotice
// builds its links from these parts; the toolbar popup, which does not load those components, shows the
// sentence without the part that is only its link.
import type { Feature, MissingReason } from '../core/build';

export const MARK = 'unavailable';

// `link` is the words of the link: to the docs page about the feature, or to the releases.
export const NOTICE: Record<MissingReason, { before: string; link: string; after: string }> = {
  browser: { before: 'This feature is not available in your browser. ', link: 'See the documentation.', after: '' },
  store: { before: 'This feature is in the ', link: 'downloadable version of Teseo', after: '.' },
};

const partsOf = (f: Feature) => NOTICE[f.reason ?? 'browser'];
// The whole sentence, as plain text (a mark's title).
export const plainText = (f: Feature) => {
  const { before, link, after } = partsOf(f);
  return before + link + after;
};
// Without a link: the browser's reason drops "See the documentation.", a sentence of its own; the store's
// keeps its words, the link being inside its sentence.
export const unlinkedText = (f: Feature) => {
  const { before, link, after } = partsOf(f);
  return after === '' && /\.\s*$/.test(before) ? before.trim() : before + link + after;
};
