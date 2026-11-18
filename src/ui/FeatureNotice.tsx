// What this version of Teseo leaves out, told the same way everywhere (core/build's features): the
// mark beside its name, a section's page in its place (FeaturePage), a note in a tab (FeatureNote), a
// greyed row whose mark opens the reason (FeatureRow), and Settings → About's summary (BuildSummary).
// Three texts, by the reason: the browser has no API for it, or Firefox's build leaves it out (each to the
// docs' page about it, which says why), or the Chrome Web Store's build leaves it out (to the releases, whose
// download has it). Nothing in the chat.
import { useId, useState, type ReactNode } from 'react';
import { missingFeatures, type Feature, type FeatureId, feature as featureOf } from '../core/build';
import { links } from '../core/links';
import { SectionHead } from './SectionParts';
import { GoTo } from './text-pages';

import { MARK, NOTICE, plainText } from './feature-texts';

const out = { target: '_blank', rel: 'noreferrer' } as const;

// The reason (ui/feature-texts), its link in it: the releases for the store's, the docs page for the others.
export function NoticeText({ feature }: { feature: Feature }) {
  const store = feature.reason === 'store';
  const { before, link, after } = NOTICE[feature.reason ?? 'browser'];
  return <>{before}<a href={store ? links().releases : links().docs(feature.docs)} {...out}>{link}</a>{after}</>;
}

// The mark alone: the settings menu, beside a name. Its tooltip, the reason.
export const FeatureMark = ({ feature }: { feature: Feature }) => <span className="badge feature-mark" title={plainText(feature)}>{MARK}</span>;


// (A) A section the build lacks: its name, what it does, why it is not here.
export function FeaturePage({ id, title, about }: { id: FeatureId; title: string; about?: ReactNode }) {
  const f = featureOf(id);
  return (
    <section className="feature-page">
      <SectionHead title={title} about={about ?? f.about} />
      <p className="feature-notice" role="note"><FeatureMark feature={f} /> <NoticeText feature={f} /></p>
    </section>
  );
}

// The same inside a page's tab.
export function FeatureNote({ id }: { id: FeatureId }) {
  const f = featureOf(id);
  return <p className="feature-notice" role="note"><FeatureMark feature={f} /> {f.about} <NoticeText feature={f} /></p>;
}

// (B) A single control the build lacks, in a list of working ones: greyed, no control. Its mark opens
// why as a line of the row itself, which grows and pushes the next rows down: nothing floats over them.
// `control`: what stays beside the mark (the popup's options: whether the popup shows the line greyed).
export function FeatureRow({ id, name, about, as = 'li', className = '', control }: { id: FeatureId; name: ReactNode; about?: ReactNode; as?: 'li' | 'div'; className?: string; control?: ReactNode }) {
  const f = featureOf(id);
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const Tag = as;
  return (
    <Tag className={`feature-row ${className}`.trim()}>
      <div className="feature-row-main" aria-disabled="true"><strong>{name}</strong><span className="hint">{about ?? f.about}</span></div>
      <span className="feature-row-end">
        <button type="button" className="badge feature-mark" title={`${f.name}: ${MARK}`} aria-expanded={open} aria-controls={reasonId} onClick={() => setOpen(!open)}>{MARK}</button>
        {control}
      </span>
      {open && <p className="feature-row-reason" id={reasonId}><NoticeText feature={f} /></p>}
    </Tag>
  );
}

// (C) Settings → About: what this version leaves out, or that it has everything.
export function BuildSummary({ missing = missingFeatures() }: { missing?: Feature[] }) {
  if (!missing.length) return <p className="hint build-summary">This version has every feature.</p>;
  return (
    <div className="build-summary">
      <div className="section-subhead"><h4>This version leaves out</h4></div>
      <ul className="switch-rows" aria-label="This version leaves out">
        {missing.map((f) => (
          <li key={f.id} className="feature-row">
            <div className="feature-row-main"><strong>{f.name}</strong><span className="hint">{f.about} <NoticeText feature={f} /></span></div>
            <FeatureMark feature={f} />
          </li>
        ))}
      </ul>
      <p className="hint">Your settings can move with you: export them in <GoTo hash="export-import" title="Export and import" /> and import them in the other version.</p>
    </div>
  );
}
