// Settings → Bubble: the page widget's bubble on the pages, in tabs: what it looks like, how its actions unfold,
// where it shows (and the sites it was hidden on), where it opens the chat, and its shortcuts. The actions
// themselves are in Settings → Actions.
import { onPermissionsChanged } from '../permissions-changed';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Settings } from '../../storage/settings';
import { chatOpensIn } from '../../storage/settings-select';
import { feature } from '../../core/build';
import { FeatureMark, FeatureNote } from '../FeatureNotice';
import type { Appearance, ChatWindow } from '../../storage/settings-types';
import { forgetChatPlaces, loadPlaces, onPlacesChanged, updatePlace, type WidgetPlaces } from '../../widget/places';
import { WIDGET_COMMAND } from '../../widget/protocol';
import { shortcutOf, useShortcuts } from '../shortcuts';
import { ActionsLookOptions } from './ActionsLookOptions';
import { BubbleLookOptions } from './BubbleLookOptions';
import { FloatingDrawing, SidePanelDrawing, WINDOW_VIEW_BOX } from './ChatWindowDrawings';
import { DrawnChoice, type DrawnOption } from '../DrawnChoice';
import { GoTo } from '../text-pages';
import type { SettingsUpdate } from '../useSettings';
import { askOrigins } from '../ask-permission';
import { useLive } from '../useLive';
import { SectionTop } from '../SectionTop';
import { Switch } from '../Collection';
import { SectionHead, SectionTabs, StatStrip } from '../SectionParts';

interface Props {
  settings: Settings;
  onChange: SettingsUpdate;
}

export function BubbleSection({ settings, onChange }: Props) {
  const shown = settings.pageWidget?.enabled ?? true;
  const everywhere = shown && settings.pageWidget?.everywhere !== false;
  // On every website needs access to every site (<all_urls>), asked from the click (a user gesture).
  const allSites = useAllSites();
  const allowAll = () => askOrigins('<all_urls>');
  const setEverywhere = async (on: boolean) => {
    if (on && !allSites) await allowAll();
    onChange((s) => ({ ...s, pageWidget: { ...s.pageWidget, everywhere: on } }));
  };
  // On the look as it is when it applies: an SVG fetched meanwhile keeps what changed during the wait.
  const setLook = (patch: Partial<Appearance>) => onChange((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }));
  const look = settings.appearance ?? {};
  const hidden = useHiddenSites();
  const face = look.bubbleFace === 'shape' ? 'A shape' : look.bubbleFace === 'svg' ? 'Your SVG' : 'An icon';
  return (
    <section className="bubble-settings">
      <SectionHead title="Bubble" about={<>
        The page widget&apos;s bubble on the pages: where it shows, what it looks like and where it opens the chat. The buttons it unfolds are
        its <GoTo hash="actions" title="Actions" />.
      </>} toggle={{ label: 'Show the page widget', title: 'On the pages its actions match', on: shown, onChange: (enabled) => onChange({ pageWidget: { ...settings.pageWidget, enabled } }) }} />
      <StatStrip stats={[
        { label: 'Shows on', value: <span className="stat-text">{!shown ? 'Nowhere' : everywhere ? 'Every website' : 'Its actions’ pages'}</span>, sub: hidden.length ? `Hidden on ${hidden.length} ${hidden.length === 1 ? 'site' : 'sites'}` : 'Hidden on no site' },
        { label: 'Looks like', value: <span className="stat-text">{face}</span>, sub: look.bubbleColor ? 'In its own color' : 'In the theme’s accent' },
        opensStat(settings),
      ]} />
      <SectionTabs label="Bubble" tabs={[
        { id: 'look', label: 'Look', render: () => <BubbleLookOptions look={look} setLook={setLook} /> },
        { id: 'actions', label: 'Actions', render: () => <ActionsLookOptions look={look} setLook={setLook} /> },
        {
          id: 'where', label: 'Where it shows', render: () => (
            <>
              <ul className="switch-rows" aria-label="Where it shows">
                <li>
                  <div><strong>Show the page widget</strong><span className="hint">On the pages its actions match, open ones included</span></div>
                  <Switch checked={shown} label="Show the page widget on the pages its actions match" onChange={(enabled) => onChange({ pageWidget: { ...settings.pageWidget, enabled } })} />
                </li>
                <li className={shown ? undefined : 'off'}>
                  <div><strong>On every website</strong><span className="hint">Also without actions: there its bubble opens the chat</span></div>
                  <Switch checked={everywhere} disabled={!shown} label="Show its bubble on every website" onChange={(on) => void setEverywhere(on)} />
                </li>
                <li>
                  <div><strong>Shortcut</strong><span className="hint">Shows or hides it on the site you are on</span></div>
                  <Shortcut />
                </li>
              </ul>
              {everywhere && !allSites && (
                <div className="row bubble-allow">
                  <span className="status">The browser lets it show only where the extension has access: now, only on the sites in Website access.</span>
                  <button onClick={() => void allowAll()}>Allow every site</button>
                </div>
              )}
              <HiddenSites hidden={hidden} />
              <p className="hint">
                Point at the bubble to unfold the actions (their names show on hover); click it to open the chat, or, where the browser does not allow
                that, to keep the actions open. Drag it anywhere, or hide it on a site (✕ under the actions).
              </p>
            </>
          ),
        },
        { id: 'chat', label: 'Opening the chat', render: () => <ChatWindowOptions settings={settings} onChange={onChange} /> },
        { id: 'top', label: 'Shortcuts', render: () => <SectionTop page="bubble" /> },
      ]} />
    </section>
  );
}

// Where the page widget opens the chat, and how the floating chat first shows on a site.
const FLOAT_DEFAULTS = { width: 380, height: 560 };
// The figure: where the bubble opens the chat. Where the chat cannot float (Firefox: core/build), full
// screen in a tab, whatever was saved (background/widget-host).
function opensStat(settings: Settings) {
  const win = settings.chatWindow ?? {};
  if (!feature('floatingChat').available) return { label: 'Opens the chat', value: <span className="stat-text">Full screen</span>, sub: 'In a tab: this browser has no floating chat' };
  const floating = chatOpensIn(settings) === 'floating';
  return { label: 'Opens the chat', value: <span className="stat-text">{floating ? 'Floating' : 'In the side panel'}</span>, sub: floating ? `${win.side === 'left' ? 'Left' : 'Right'}, ${win.width ?? FLOAT_DEFAULTS.width} px wide` : 'Its bubble and its actions' };
}
const OPENS: DrawnOption<NonNullable<ChatWindow['opens']>>[] = [
  { id: 'panel', label: 'In the side panel', drawing: <SidePanelDrawing /> },
  { id: 'floating', label: 'Floating on the page', drawing: <FloatingDrawing /> },
];
const SIDES: DrawnOption<NonNullable<ChatWindow['side']>>[] = [
  { id: 'right', label: 'Right', drawing: <FloatingDrawing /> },
  { id: 'left', label: 'Left', drawing: <FloatingDrawing side="left" /> },
];
const HEIGHTS: DrawnOption<'px' | 'full'>[] = [
  { id: 'px', label: 'Fixed', drawing: <FloatingDrawing /> },
  { id: 'full', label: 'Whole window', drawing: <FloatingDrawing full /> },
];
export function ChatWindowOptions({ settings, onChange }: Props) {
  const win = settings.chatWindow ?? {};
  const set = (change: Partial<ChatWindow>) => onChange({ chatWindow: { ...win, ...change } });
  const [forgotten, setForgotten] = useState(false);
  const full = win.height === 'full';
  // Where the chat cannot float (Firefox): its option greyed with the mark, the reason under the choice, and
  // nothing about its size; the page opens the chat full screen in a tab (the side panel cannot open from it).
  const floating = feature('floatingChat');
  if (!floating.available) {
    const options = OPENS.map((o) => (o.id === 'floating' ? { ...o, off: <FeatureMark feature={floating} /> } : o));
    return (
      <div className="bubble-chat">
        <DrawnChoice legend={'Its bubble, its actions that open the chat, and a card\'s "Open in the chat" open it'} name="chat-opens" size="small" viewBox={WINDOW_VIEW_BOX} options={options} value={chatOpensIn(settings)} onChange={(opens) => set({ opens })} />
        <FeatureNote id="floatingChat" />
        <p className="hint">In this browser they open the chat full screen in a tab: its sidebar opens only from the toolbar button.</p>
      </div>
    );
  }
  return (
    <div className="bubble-chat">
      <DrawnChoice legend={'Its bubble, its actions that open the chat, and a card\'s "Open in the chat" open it'} name="chat-opens" size="small" viewBox={WINDOW_VIEW_BOX} options={OPENS} value={win.opens ?? 'panel'} onChange={(opens) => set({ opens })} />
      <p className="hint">The toolbar button asks where to open the chat each time; the shortcuts at the top of this page always open the side panel or the floating chat.</p>
      <p className="hint">The floating chat, the first time on a site:</p>
      <div className="drawn-choices">
        <DrawnChoice legend="Side" name="chat-side" size="small" viewBox={WINDOW_VIEW_BOX} options={SIDES} value={win.side ?? 'right'} onChange={(side) => set({ side })} />
        <DrawnChoice legend="Height" name="chat-height" size="small" viewBox={WINDOW_VIEW_BOX} options={HEIGHTS} value={full ? 'full' : 'px'} onChange={(height) => set({ height: height === 'full' ? 'full' : undefined })} />
      </div>
      <div className="row">
        <label>Width, px
          <input type="number" min={300} step={10} value={win.width ?? FLOAT_DEFAULTS.width} onChange={(e) => set({ width: Number(e.target.value) || undefined })} />
        </label>
        {!full && (
          <label>Height, px
            <input type="number" min={320} step={10} value={typeof win.height === 'number' ? win.height : FLOAT_DEFAULTS.height} onChange={(e) => set({ height: Number(e.target.value) || undefined })} />
          </label>
        )}
      </div>
      <p className="hint">Moved or resized on a site, it stays so there.</p>
      <div className="row">
        <button onClick={() => void forgetChatPlaces().then(() => setForgotten(true))}>Start it like this on every site again</button>
        {forgotten && <span className="hint">Done</span>}
      </div>
    </div>
  );
}

// The browser's shortcut for the widget, or where to set one (or a key of its own).
function Shortcut() {
  const key = shortcutOf(useShortcuts(), WIDGET_COMMAND);
  return key ? <kbd>{key}</kbd> : <span className="hint">Not set: <GoTo hash="shortcuts" title="Shortcuts" /></span>;
}

// The sites where the widget was hidden with its ✕.
const NO_PLACES: WidgetPlaces = {};
function useHiddenSites(): string[] {
  const places = useLive(loadPlaces, onPlacesChanged, NO_PLACES, '[widget places]');
  return Object.keys(places).filter((site) => places[site]?.hidden).sort();
}

// Those sites, each with Show to show it there again.
export function HiddenSites({ hidden }: { hidden: string[] }) {
  if (!hidden.length) return null;
  const show = (site: string) => updatePlace(site, { hidden: false });
  return (
    <>
      <div className="section-subhead"><h4>Hidden on</h4></div>
      <p className="hint">On these sites nothing of the bubble runs, not even its actions on page load, until you show it again.</p>
      <ul className="switch-rows" aria-label="Hidden on">
        {hidden.map((site) => (
          <li key={site}>
            <span className="host-name">{site}</span>
            <button onClick={() => void show(site)}>Show</button>
          </li>
        ))}
      </ul>
    </>
  );
}

// Whether the extension may read every site (Website access → all sites), kept up to date.
function useAllSites(): boolean {
  const [all, setAll] = useState(false);
  useEffect(() => {
    const check = () => void browser.permissions.contains({ origins: ['<all_urls>'] }).then(setAll, () => setAll(false));
    check();
    return onPermissionsChanged(check);
  }, []);
  return all;
}
