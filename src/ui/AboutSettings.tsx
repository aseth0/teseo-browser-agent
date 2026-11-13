// Settings → About: the version installed, the project's links (core/links: set once at build time) and
// what this version leaves out (ui/FeatureNotice BuildSummary).
import { installedVersion, links } from '../core/links';
import { BuildSummary } from './FeatureNotice';
import { SectionHead } from './SectionParts';

export function AboutSection() {
  const l = links();
  const version = installedVersion();
  const out = { target: '_blank', rel: 'noreferrer' } as const;
  return (
    <section className="about-settings">
      <SectionHead title="About" about={<>Teseo{version ? ` ${version}` : ''}. Its documentation, releases and issues are on GitHub.</>} />
      <p className="about-links">
        <a href={l.docs('docs/README.md')} {...out}>Documentation</a>
        <a href={l.releases} {...out}>Releases</a>
        <a href={l.issues} {...out}>Report an issue</a>
      </p>
      <BuildSummary />
    </section>
  );
}
