// Settings → Chromium DevTools: the browser.* tools on the DevTools engine or not (off by default), what the debugger
// permission could reach and what these tools do with it, and more fields their screenshots mask.
import { feature } from '../core/build';
import { FeaturePage } from './FeatureNotice';
import { devtoolsOn } from '../storage/settings-select';
import { SectionHead, StatStrip } from './SectionParts';
import { toolPage } from './text-pages';
import type { PatchSectionProps as Props } from './useSettings';

// The fields added to mask, one per line: "host selector".
const maskLines = (text: string | undefined) => (text ?? '').split('\n').filter((l) => l.trim()).length;

export function DevtoolsSection({ settings, onChange }: Props) {
  if (!feature('devtools').available) return <NotHere />;
  const on = devtoolsOn(settings);
  const added = maskLines(settings.devtoolsMask);
  return (
    <section className="devtools-settings">
      <SectionHead title="Chromium DevTools" about={<>
        The browser tools run on DevTools: real clicks, keys and typing for sites that ignore the usual ones, hover, drag, and screenshots of
        any tab. The page&apos;s dialogs (alert, confirm) stay yours to answer. The tools are under Browser in {toolPage('browser')}.
      </>} toggle={{ label: 'Run the browser tools on DevTools', title: 'Real input, any-tab screenshots', on, onChange: (to) => onChange({ devtoolsTools: to || undefined }) }} />
      <StatStrip stats={[
        { label: 'Engine', value: <span className="stat-text">{on ? 'DevTools' : 'The page’s own events'}</span>, sub: on ? 'Attached for each call, then let go' : 'Switch it on above' },
        { label: 'While attached', value: <span className="stat-text">A chip and DBG</span>, sub: 'In the chat, and on the extension’s icon' },
        { label: 'Masked in screenshots', value: <>{added} <span className="stat-of">fields of yours</span></>, sub: 'Besides passwords, cards, one-time codes and secrets' },
      ]} />
      <ul className="switch-rows" aria-label="What the permission reaches">
        <li>
          <div>
            <strong>What the debugger permission could reach</strong>
            <span className="hint">
              Any tab: its page, its traffic and its cookies. These tools use it only to act as you would and take screenshots, on sites the
              extension already has access to, attached for each call.
            </span>
          </div>
        </li>
      </ul>
      <div className="section-subhead"><h4>Masked in screenshots</h4></div>
      <p className="hint">
        Screenshots mask password, card and one-time-code fields, fields named like secrets, frames from other sites and the selectors below. Fields
        inside closed shadow roots cannot be masked.
      </p>
      <label className="devtools-mask">
        More fields to mask, one per line: host selector
        <textarea className="mono" rows={4} value={settings.devtoolsMask ?? ''} placeholder="example.com #card-number"
          onChange={(e) => onChange({ devtoolsMask: e.target.value.trim() ? e.target.value : undefined })} />
      </label>
    </section>
  );
}

// The engine where this build lacks it (core/build: Firefox has no debugger API).
function NotHere() {
  return (
    <FeaturePage id="devtools" title="Chromium DevTools" about={<>
      The browser tools can run on DevTools: real clicks, keys and typing, hover, drag, and screenshots of any tab. Without it they use
      the page&apos;s own events, and full-page screenshots scroll through the page.
    </>} />
  );
}
