// Settings → About: the version installed, the project's links (core/links: set once at build time), in
// the downloadable build whether a newer version is out and the switch for that check (core/update-check:
// what the popup's check last found; About itself asks nothing), and what this version leaves out
// (ui/FeatureNotice BuildSummary).
import { installedVersion, links } from '../core/links';
import { Switch } from './Collection';
import { BuildSummary } from './FeatureNotice';
import { SectionHead } from './SectionParts';
import { updateCheckOn } from '../core/update-check';
import { updateCheckHere, useUpdateNotice } from './useUpdateNotice';
import type { SectionProps } from './useSettings';

const out = { target: '_blank', rel: 'noreferrer' } as const;

export function AboutSection({ settings, onChange }: Partial<SectionProps>) {
  const l = links();
  const version = installedVersion();
  const update = useUpdateNotice(settings);
  return (
    <section className="about-settings">
      <SectionHead title="About" about={<>Teseo{version ? ` ${version}` : ''}. Its documentation, releases and issues are on GitHub.</>} />
      {update.about && (
        <p className="feature-notice update-notice" role="note">
          <span>Teseo {update.about.latest} is out; you have {update.about.installed}. This version does not update itself: <a href={l.releases} {...out}>download it from the releases</a>.</span>
        </p>
      )}
      <p className="about-links">
        <a href={l.docs('docs/README.md')} {...out}>Documentation</a>
        <a href={l.releases} {...out}>Releases</a>
        <a href={l.issues} {...out}>Report an issue</a>
      </p>
      {updateCheckHere() && settings && onChange && (
        <ul className="switch-rows" aria-label="Updates">
          <li>
            <div><strong>Check for a new version</strong><span className="hint">One request to GitHub when the popup first opens after the browser starts. It sends nothing about you.</span></div>
            <Switch checked={updateCheckOn(settings)} label="Check for a new version" onChange={(on) => onChange({ updateCheck: on ? undefined : false })} />
          </li>
        </ul>
      )}
      <BuildSummary />
    </section>
  );
}
