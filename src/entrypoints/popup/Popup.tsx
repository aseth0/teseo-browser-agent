// The toolbar button's popup, in three blocks under a line saying when the extension may not work on this
// site (SiteAccessLine: Enable it asks for it). Open the chat: floating on this page, in the side panel or
// full screen in a tab, each with its key, the bubble's place marked. Into the chat: a screenshot of the
// page (background/capture-host), each with its shortcut in its name; the tab's audio (AudioLine, greyed
// where the browser cannot capture it); a recording of the page's requests
// (RecordLine); while something is read aloud, its Stop (SpeakLine); then the agent manager, and Settings. Each closes the popup once
// done. Page on a site not enabled asks for it, then floats the chat; where it cannot float, it says the
// bubble is off there. Settings → Appearance → Popup hides some of it (shows()); a busy line shows anyway.
// Loaded with ?preview (that page's preview): for an invented page, and nothing in it can be clicked.
import { useEffect, useState } from 'react';
import type { Browser } from 'wxt/browser';
import { CAPTURE_COMMANDS, type CaptureKind } from '../../capture/protocol';
import { CAPTURE, PANEL_SHOWN } from '../../core/protocol';
import { sendRuntime } from '../../core/runtime';
import { isRestrictedUrl } from '../../page/permissions';
import { chatOpensIn, panelFollowsOn, popupShows } from '../../storage/settings-select';
import type { PopupItem } from '../../storage/settings-types';
import { useAppearance } from '../../ui/appearance';
import { Icon, type ChatIconName } from '../../ui/chat-icons';
import { openFullChat, openManager } from '../../browser/open-manager';
import { activeTab } from '../../ui/active-tab';
import { enableAndFloat, floatChat, whyNoFloat } from '../../ui/popup-actions';
import { askOrigins } from '../../ui/ask-permission';
import { originPattern } from '../../page/permissions';
import { openOptions } from '../../ui/open-options';
import { shortcutOf, useShortcuts, withShortcut } from '../../ui/shortcuts';
import { useSettings } from '../../ui/useSettings';
import { AudioLine } from './AudioLine';
import { feature, type Feature } from '../../core/build';
import { MARK, plainText, unlinkedText } from '../../ui/feature-texts';
import { RecordLine } from './RecordLine';
import { SpeakLine } from './SpeakLine';
import { SiteAccessLine, useSiteAccess } from './SiteAccessLine';
import { PopupRow } from './Row';
import { openSidePanel, PANEL_COMMAND } from '../../core/side-panel';
import { FLOAT_COMMAND } from '../../widget/protocol';

const report = (e: unknown) => console.error('[popup]', e);
const PREVIEW = new URLSearchParams(location.search).has('preview');
const PREVIEW_TAB = { id: 0, windowId: 0, url: 'https://shop.example.com/' } as Browser.tabs.Tab;
// The preview's frame is as tall as the popup: no scroll bars in it.
if (PREVIEW) document.documentElement.style.overflow = 'hidden';

export function Popup() {
  const [settings, update] = useSettings();
  useAppearance(settings?.appearance);
  // The tab the chat opens for, known before any click: the side panel opens only inside it.
  const [tab, setTab] = useState<Browser.tabs.Tab>();
  useEffect(() => {
    if (PREVIEW) setTab(PREVIEW_TAB);
    else activeTab().then(setTab, report);
  }, []);
  // Whether the window's side panel shows already, where opening it would close it (Vivaldi:
  // background/panel-windows): Panel leaves it open.
  const [panelShown, setPanelShown] = useState(false);
  useEffect(() => {
    if (tab && !PREVIEW) sendRuntime({ type: PANEL_SHOWN, windowId: tab.windowId }).then((r) => setPanelShown(r?.shown === true), report);
  }, [tab]);
  // Whether the extension may work on this tab's site (the preview: an invented site not enabled yet).
  const [access, refreshAccess] = useSiteAccess(tab?.url, PREVIEW ? 'needs-permission' : undefined);
  // The chat could not float on this page, the site granted: the bubble is off there.
  const [bubbleOff, setBubbleOff] = useState(false);
  const [recordNote, setRecordNote] = useState('');
  const [audioNote, setAudioNote] = useState<{ text: string; settings?: 'voice' }>();
  const done = (p: Promise<unknown>) => void p.then(() => window.close(), report);
  // Asks for the site at once, inside the click: nothing awaited before it.
  const enableAndFloatHere = async () => {
    if (tab?.id === undefined || !tab.url) return;
    const result = await enableAndFloat(tab.id, tab.url);
    if (result === 'floated') return window.close();
    if (result === 'bubble') setBubbleOff(true);
  };
  const floatHere = async () => {
    if (tab?.id === undefined || !tab.url) return;
    if (access === 'needs-permission') return enableAndFloatHere();
    if (await floatChat(tab.id)) return window.close();
    if ((await whyNoFloat(tab.url)) === 'bubble') setBubbleOff(true);
    else refreshAccess(); // taken away meanwhile: the site line says so
  };
  // This site only (Settings → Website access grants every site); the line goes once it is granted.
  const enableSite = () => {
    if (tab?.url) void askOrigins(originPattern(tab.url)).then(refreshAccess, report);
  };
  const settingsAt = (section?: string) => () => done(openOptions(section));
  const shortcuts = useShortcuts();
  // Started by the background, inside this click (the side panel may open first): the popup closes once
  // it has, out of the way of the page (a section is dragged there).
  const capture = (kind: CaptureKind) => tab?.id !== undefined && done(sendRuntime({ type: CAPTURE, kind, tabId: tab.id, windowId: tab.windowId }));
  const noCapture = !tab || isRestrictedUrl(tab.url);
  // The place the bubble opens the chat in (Settings → Bubble → Opening the chat), marked. Where the chat
  // cannot float (Firefox: core/build), the page opens it full screen, whatever was saved; its Page tile
  // greyed, saying why.
  const floating = feature('floatingChat');
  const opens = floating.available ? chatOpensIn(settings ?? undefined) : 'full';
  const view = settings?.popup;
  // Where the browser cannot capture a tab's audio (Firefox): its line greyed, saying why, until hidden
  // in Settings → Appearance → Popup.
  const audio = feature('tabAudio');
  const shows = (item: PopupItem) => popupShows(view, item);
  const captures = shows('screenshot') ? CAPTURES.filter(({ kind }) => shows(kind)) : [];
  const tiles = [
    shows('page') && (floating.available
      ? <Tile key="page" icon="float" label="Page" title="Chat on this page" shortcut={shortcutOf(shortcuts, FLOAT_COMMAND)} isDefault={opens === 'floating'}
        disabled={isRestrictedUrl(tab?.url)} onClick={() => void floatHere().catch(report)} />
      : <Tile key="page" icon="float" label="Page" title="Chat on this page" lacks={floating} onClick={() => {}} />),
    shows('panel') && <Tile key="panel" icon="panel" label="Panel" title="Chat in the side panel" shortcut={shortcutOf(shortcuts, PANEL_COMMAND)} isDefault={opens === 'panel'} disabled={!tab}
      onClick={() => tab && done(openSidePanel(tab, settings ? panelFollowsOn(settings) : true, panelShown))} />,
    shows('full-screen') && <Tile key="full" icon="fullChat" label="Full screen" title="Chat full screen in a tab" isDefault={opens === 'full'} onClick={() => done(openFullChat())} />,
  ].filter(Boolean);
  const classes = ['popup', view?.noShortcuts && 'no-shortcuts', view?.noTitles && 'no-titles'].filter(Boolean).join(' ');
  return (
    <div className={classes} inert={PREVIEW}>
      <div className="popup-menu" role="menu" aria-label="Teseo">
        <div className="popup-head" role="none">
          <span className="popup-title">Teseo</span>
          <button className="icon-button" role="menuitem" onClick={settingsAt()} title="Settings" aria-label="Settings">
            <Icon name="settings" size={16} />
          </button>
        </div>
        {shows('site-access') && <SiteAccessLine access={access} url={tab?.url} onEnable={enableSite} />}
        {tiles.length > 0 && <>
          <div className="popup-label" id="popup-open" role="none">Open the chat</div>
          <div className="popup-tiles" role="group" aria-labelledby="popup-open">{tiles}</div>
        </>}
        {/* Its title hides with the rows when none shows (CSS). */}
        <div className="popup-label" role="none">Into the chat</div>
        <div className="popup-rows" role="none">
          {captures.length > 0 && <PopupRow label="Screenshot" icon="capture" name="Screenshot" actions={captures.map(({ kind, icon, name }) => {
            const title = withShortcut(name, shortcutOf(shortcuts, CAPTURE_COMMANDS[kind]));
            return (
              <button key={kind} className="icon-button" role="menuitem" title={title} aria-label={title} disabled={noCapture} onClick={() => capture(kind)}>
                <Icon name={icon} size={16} />
              </button>
            );
          })}>
            <span className="popup-row-sub">{captureSub(captures)}</span>
          </PopupRow>}
          {audio.available ? <AudioLine hidden={!shows('audio')} tab={tab} settings={settings ?? undefined} update={settings ? update : undefined} shortcuts={shortcuts} onDone={done} onError={(text, settings) => setAudioNote({ text, settings })} />
            : shows('audio') && <MissingLine label="Audio" icon="audio" name="Tab's audio" lacks={audio} />}
          <SpeakLine shortcuts={shortcuts} />
          <RecordLine hidden={!shows('requests')} tab={tab} settings={settings ?? undefined} shortcuts={shortcuts} onDone={done} onError={setRecordNote} />
        </div>
        {shows('agents') && <>
          <div className="popup-label" role="none">Agents</div>
          <button className="popup-choice" role="menuitem" onClick={() => done(openManager())}>
            <Icon name="agents" size={16} />
            <span className="popup-choice-label">Agents Panel</span>
            <Icon name="chevron" size={14} />
          </button>
        </>}
      </div>
      {audioNote && (
        <div className="popup-note" role="status">
          <p className="small">{audioNote.text}</p>
          {audioNote.settings && <button onClick={settingsAt(audioNote.settings)}>Settings</button>}
        </div>
      )}
      {recordNote && (
        <div className="popup-note" role="status">
          <p className="small">{recordNote}</p>
          <button onClick={settingsAt('web-access')}>Settings</button>
        </div>
      )}
      {bubbleOff && (
        <div className="popup-note" role="status">
          <p className="small">The bubble is off on this site.</p>
          <button onClick={settingsAt('web-access')}>Settings</button>
        </div>
      )}
    </div>
  );
}

// A line this build lacks: greyed, no buttons, why under its name (the notice's sentence, without its link:
// ui/feature-texts) and in its mark's title.
const MissingLine = ({ label, icon, name, lacks }: { label: string; icon: ChatIconName; name: string; lacks: Feature }) => (
  <PopupRow label={label} icon={icon} name={name} off actions={<span className="badge feature-mark" title={plainText(lacks)}>{MARK}</span>}>
    <span className="popup-row-sub wraps">{unlinkedText(lacks)}</span>
  </PopupRow>
);

// The screenshots, in the popup's order.
const CAPTURES: { kind: CaptureKind & PopupItem; icon: ChatIconName; name: string }[] = [
  { kind: 'section', icon: 'section', name: 'Section' },
  { kind: 'visible', icon: 'visible', name: 'Visible' },
  { kind: 'full-page', icon: 'fullPage', name: 'Full page' },
];
// The screenshots shown, as the row's second line: "Section, visible, full page".
const captureSub = (shown: typeof CAPTURES) => {
  const text = shown.map((c) => c.name.toLowerCase()).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// One of the places the chat opens in: an icon over a short label and its key, the full meaning in its
// title; the default one (where the bubble opens it) marked. `lacks`: the build lacks it (core/build):
// greyed and inert (aria-disabled, no click: a disabled button shows no title in some browsers), its mark
// in place of the key and why in its title (the notice without its link).
const Tile = ({ icon, label, title, shortcut, isDefault, disabled, lacks, onClick }: { icon: ChatIconName; label: string; title: string; shortcut?: string; isDefault?: boolean; disabled?: boolean; lacks?: Feature; onClick: () => void }) => (
  <button className={`popup-tile${isDefault ? ' default' : ''}${lacks ? ' off' : ''}`} role="menuitem" title={lacks ? `${title}: ${plainText(lacks)}` : isDefault ? `${title} (where the bubble opens it)` : title}
    aria-label={lacks ? `${title}: ${unlinkedText(lacks)}` : title} disabled={disabled} aria-disabled={lacks ? true : undefined} onClick={lacks ? undefined : onClick}>
    <Icon name={icon} size={20} />
    {label}
    {lacks ? <span className="badge feature-mark">{MARK}</span> : shortcut && <kbd>{shortcut}</kbd>}
  </button>
);
