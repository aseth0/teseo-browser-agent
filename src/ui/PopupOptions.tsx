// Settings → Appearance → Popup: what the toolbar popup shows, grouped as in it, and whether it shows
// the keys and its titles. Settings (its gear) always shows; a line hidden here shows again while busy
// (entrypoints/popup). Next to it, the popup itself as the preview (AppearanceSettings).
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { PopupItem, PopupView } from '../storage/settings-types';
import { feature as featureOf, type FeatureId } from '../core/build';
import { FeatureRow } from './FeatureNotice';
import { popupShows } from '../storage/settings-select';
import { Switch } from './Collection';
import type { PatchSectionProps as Props } from './useSettings';

// `feature`: what the line needs, which a build may lack (core/build): a greyed row says why instead.
interface Item { item: PopupItem; name: string; about?: string; sub?: boolean; feature?: FeatureId }
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'This site', items: [
    { item: 'site-access', name: 'Site access', about: 'Says when this site is not enabled, with Enable it' },
  ] },
  { title: 'Open the chat', items: [
    { item: 'page', name: 'Page', about: 'The chat floating on this page' },
    { item: 'panel', name: 'Panel', about: 'The side panel' },
    { item: 'full-screen', name: 'Full screen', about: 'The chat in a tab of its own' },
  ] },
  { title: 'Into the chat', items: [
    { item: 'screenshot', name: 'Screenshot', about: 'Of this page, into the chat' },
    { item: 'section', name: 'Section', sub: true },
    { item: 'visible', name: 'Visible', sub: true },
    { item: 'full-page', name: 'Full page', sub: true },
    // Where the browser cannot capture a tab's audio (Firefox): greyed here with why, and in the popup until hidden.
    { item: 'audio', name: "Tab's audio", about: 'Shows again while it captures, or its audio waits', feature: 'tabAudio' },
    { item: 'requests', name: 'Requests', about: 'Shows again while it records, or a recording waits for review' },
  ] },
  { title: 'Agents', items: [{ item: 'agents', name: 'Agents Panel', about: 'Opens the agent manager' }] },
];
// The lines counted in the figure: the screenshots' own buttons go with Screenshot. One the build lacks
// counts too: the popup shows it greyed.
export const POPUP_LINES = GROUPS.flatMap((g) => g.items).filter((i) => !i.sub).map((i) => i.item);

export function PopupOptions({ settings, onChange }: Props) {
  const view = settings.popup ?? {};
  const set = (change: Partial<PopupView>) => onChange({ popup: { ...view, ...change } });
  const shows = (item: PopupItem) => popupShows(view, item);
  const show = (item: PopupItem, on: boolean) => {
    const hidden = (view.hidden ?? []).filter((i) => i !== item);
    set({ hidden: on ? hidden : [...hidden, item] });
  };
  return (
    <>
      <p className="hint">What the toolbar button&apos;s popup shows. Settings (its gear) always shows, so you can come back here.</p>
      {GROUPS.map((group) => (
        <div key={group.title}>
          <div className="section-subhead"><h4>{group.title}</h4></div>
          <ul className="switch-rows" aria-label={group.title}>
            {group.items.map(({ item, name, about, sub, feature }) => {
              if (feature && !featureOf(feature).available) {
                return <FeatureRow key={item} id={feature} name={name} about="Greyed in the popup, saying why. Hide it here" control={<Switch checked={shows(item)} label={name} onChange={(on) => show(item, on)} />} />;
              }
              const off = sub && !shows('screenshot');
              return (
                <li key={item} className={sub ? `sub${off ? ' off' : ''}` : undefined}>
                  <div><strong>{name}</strong>{about && <span className="hint">{about}</span>}</div>
                  <Switch checked={shows(item)} disabled={off} label={name} onChange={(on) => show(item, on)} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="section-subhead"><h4>Details</h4></div>
      <ul className="switch-rows" aria-label="Details">
        <li>
          <div><strong>Shortcuts</strong><span className="hint">The keys under the tiles and beside the names</span></div>
          <Switch checked={!view.noShortcuts} label="Shortcuts" onChange={(on) => set({ noShortcuts: !on })} />
        </li>
        <li>
          <div><strong>Block titles</strong><span className="hint">Open the chat, Into the chat, Agents. Off: a more compact popup</span></div>
          <Switch checked={!view.noTitles} label="Block titles" onChange={(on) => set({ noTitles: !on })} />
        </li>
      </ul>
      <p className="hint">What the popup gains later shows until you hide it here.</p>
    </>
  );
}

// The popup itself (popup.html?preview: an invented page, nothing clickable), as tall as it is: it follows
// the switches through the settings.
export function PopupPreview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  const [doc, setDoc] = useState<Document>();
  useEffect(() => {
    const popup = doc?.querySelector('.popup');
    if (!popup) return;
    const watch = new ResizeObserver(() => setHeight(Math.ceil(popup.getBoundingClientRect().height)));
    watch.observe(popup);
    return () => watch.disconnect();
  }, [doc]);
  // The popup renders once its settings load: wait for it.
  const onLoad = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    const seen = new MutationObserver(() => d.querySelector('.popup') && (seen.disconnect(), setDoc(d)));
    if (d.querySelector('.popup')) setDoc(d);
    else seen.observe(d.body, { childList: true, subtree: true });
  };
  return (
    <div className="popup-preview">
      <iframe ref={frame} src={browser.runtime.getURL('/popup.html?preview')} title="Popup preview" style={height ? { height } : undefined} onLoad={onLoad} />
    </div>
  );
}
