// Settings → Appearance: the side panel itself as a preview, next to tabs: Chat, Theme, Fonts and Layers;
// on Popup, the toolbar popup instead.
import { useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import type { Origin } from '../core/model-texts';
import type { Appearance, ChatView, CustomTheme } from '../storage/settings-types';
import { errorText } from '../core/errors';
import { downloadText } from './download';
import { ImportExport } from './ImportExport';
import { InlineConfirm } from './InlineConfirm';
import { ORIGIN_INFO, ORIGINS, originClass } from './origins';
import { exportTheme, exportThemes, importedThemes, importThemes, parseThemes, THEME_FILE_TYPE, THEME_FILE_VERSION } from './themes/theme-file';
import { deleteTheme, findTheme, isThemeOf, lookName, lookWithTheme, MAX_THEME_NAME, saveTheme, themeFromLook, themeNameProblem } from './themes/theme-model';
import { THEME_PRESETS } from './themes/presets';
import { useHashTarget } from './useHashTarget';
import type { PatchSectionProps as Props, SettingsPatch } from './useSettings';
import { Segmented } from './Segmented';
import { Switch } from './Collection';
import { SectionHead, SectionTabs, StatStrip } from './SectionParts';
import { POPUP_LINES, PopupOptions, PopupPreview } from './PopupOptions';
import { popupShows } from '../storage/settings-select';
import { useSystemDark } from './appearance';
import { isDarkMode, lookVars, TOKEN_ACCENT, TOKEN_BASE, TOKEN_TEXT } from '../look/palette';
import { CODE_FONTS, fontNameOk, MAX_FONT_NAME, TEXT_FONTS, type CodeFont, type TextFont } from '../look/fonts';

const TABS = ['chat', 'theme', 'fonts', 'layers', 'popup'] as const;
type Tab = (typeof TABS)[number];

// Settings → Appearance: the side panel itself as a preview (its own buttons set the view and the
// page), next to five tabs: Chat (how it shows its parts), Theme (mode, the themes, the accent and text
// colors over them), Fonts (text and code), Layers (how the Layers view starts, the colors of its
// highlights) and Popup (what the toolbar popup shows; the preview is the popup then, nothing in it clickable). The tab is in the hash: #appearance/theme. The page widget's bubble has its own page
// (BubbleSettings).
export function AppearanceSection({ settings, onChange }: Props) {
  const target = useHashTarget('appearance');
  const tab: Tab = TABS.find((t) => t === target) ?? 'chat';
  // The bubble's tab moved to its own page: an old link goes there.
  useEffect(() => {
    if (target === 'bubble') location.hash = 'bubble';
  }, [target]);
  const view = settings.chatView ?? {};
  return (
    <section className="appearance-settings">
      <SectionHead title="Appearance" about={<>
        How the chat looks. On the left, the side panel itself with an example conversation on an invented page: nothing is sent,
        and its buttons change your settings (its view menu, and the page button, the only one that changes what the model receives).
        On the Popup tab, the toolbar popup.
      </>} />
      <AppearanceStats settings={settings} />
      <div className="appearance-layout">
        {/* Reloaded when an option that sets how the Layers view starts changes. */}
        {tab === 'popup'
          ? <PopupPreview />
          : <iframe key={JSON.stringify([view.techCallsOpen, view.techOrigin])} className="panel-preview" src={browser.runtime.getURL('/sidepanel.html?preview')} title="Side panel preview" />}
        <div className="appearance-options">
          <SectionTabs label="Appearance" open={tab} onOpen={(t) => (location.hash = `appearance/${t}`)} tabs={[
            { id: 'chat', label: 'Chat', render: () => <ChatOptions settings={settings} onChange={onChange} /> },
            { id: 'theme', label: 'Theme', render: () => <ThemeOptions settings={settings} onChange={onChange} /> },
            { id: 'fonts', label: 'Fonts', render: () => <FontOptions settings={settings} onChange={onChange} /> },
            { id: 'layers', label: 'Layers', render: () => <LayersOptions settings={settings} onChange={onChange} /> },
            { id: 'popup', label: 'Popup', render: () => <PopupOptions settings={settings} onChange={onChange} /> },
          ]} />
        </div>
      </div>
    </section>
  );
}

const STEPS = { grouped: 'Grouped', inline: 'Inline' } as const;
const REASONING = { collapsed: 'Collapsed', expanded: 'Expanded', hidden: 'Hidden' } as const;
const TOOL_CALLS = { collapsed: 'Collapsed', expanded: 'Expanded', compact: 'Compact' } as const;
const AUTO_SCROLL = { always: 'Always', 'at-bottom': 'Only at the end' } as const;
// How big the messages and the message box are shown, as a percent of the default.
const TEXT_SIZES = [90, 100, 110, 125, 150, 175];

const optionsOf = <T extends string>(names: Record<T, string>) => (Object.keys(names) as T[]).map((value) => ({ value, label: names[value] }));

// The figures over the tabs: the theme and its mode, the text size, how the steps show, how Layers starts,
// what the popup shows.
function AppearanceStats({ settings }: Pick<Props, 'settings'>) {
  const look = settings.appearance ?? {};
  const view = settings.chatView ?? {};
  const dark = isDarkMode(look, useSystemDark());
  const theme = THEME_PRESETS.find((t) => isThemeOf(look, t))?.name ?? lookName(look, settings.customThemes);
  const mode = look.mode ?? 'system';
  const fontScopeNote = look.fontScope === 'messages' ? ', in messages' : '';
  const popup = settings.popup;
  const shown = POPUP_LINES.filter((i) => popupShows(popup, i)).length;
  const details = [!popup?.noShortcuts && 'shortcuts', !popup?.noTitles && 'titles'].filter(Boolean);
  const popupDetails = details.length ? `, with ${details.join(' and ')}` : ', compact';
  return (
    <StatStrip stats={[
      { label: 'Theme', value: <span className="stat-text">{theme}</span>, sub: `Mode: ${mode === 'system' ? `System (${dark ? 'dark' : 'light'} now)` : mode === 'dark' ? 'Dark' : 'Light'} · ${look.accent ? 'your accent' : 'its own accent'}` },
      { label: 'Text', value: <>{view.textSize ?? 100}% <span className="stat-of">· {TEXT_FONTS[look.fontText ?? 'system'][0]}</span></>, sub: `${look.fontTextName ? `${look.fontTextName} first` : 'Size and font'}${fontScopeNote}` },
      { label: 'Steps', value: <span className="stat-text">{STEPS[view.steps ?? 'grouped']}</span>, sub: `Reasoning ${REASONING[view.reasoning ?? 'collapsed'].toLowerCase()} · tool calls ${TOOL_CALLS[view.toolCalls ?? 'collapsed'].toLowerCase()}` },
      { label: 'Layers', value: <span className="stat-text">Highlights {view.techOrigin ?? true ? 'on' : 'off'}</span>, sub: `Each message's layers start ${view.techCallsOpen ? 'shown' : 'folded'}` },
      { label: 'Popup', value: <>{shown} <span className="stat-of">/ {POPUP_LINES.length} shown</span></>, sub: `${shown === POPUP_LINES.length ? 'Everything' : `${POPUP_LINES.length - shown} hidden`}${popupDetails}` },
    ]} />
  );
}

// A row of options: its name and a line on it, its control on the right.
const OptionRow = ({ title, about, children }: { title: string; about: ReactNode; children: ReactNode }) => (
  <li>
    <div><strong>{title}</strong><span className="hint">{about}</span></div>
    {children}
  </li>
);

// How the chat shows its text, reasoning and tool calls, and how it scrolls.
function ChatOptions({ settings, onChange }: Props) {
  const view = settings.chatView ?? {};
  const set = (change: Partial<ChatView>) => onChange({ chatView: { ...view, ...change } });
  return (
    <>
      <ul className="switch-rows" aria-label="How the chat shows">
        <OptionRow title="Text size" about="Messages and the message box">
          <Segmented label="Text size" className="compact" value={String(view.textSize ?? 100)} onChange={(n) => set({ textSize: Number(n) })}
            options={TEXT_SIZES.map((n) => ({ value: String(n), label: `${n}%` }))} />
        </OptionRow>
        <OptionRow title="Steps between your message and the answer" about="Grouped: reasoning and tool calls in collapsible blocks; what the model writes stays in view">
          <Segmented label="Steps" className="compact" value={view.steps ?? 'grouped'} onChange={(steps) => set({ steps })} options={optionsOf(STEPS)} />
        </OptionRow>
        <OptionRow title="Reasoning" about="Collapsed opens while the model thinks">
          <Segmented label="Reasoning" className="compact" value={view.reasoning ?? 'collapsed'} onChange={(reasoning) => set({ reasoning })} options={optionsOf(REASONING)} />
        </OptionRow>
        <OptionRow title="Tool calls" about="Expanded shows their result; Compact, one line each">
          <Segmented label="Tool calls" className="compact" value={view.toolCalls ?? 'collapsed'} onChange={(toolCalls) => set({ toolCalls })} options={optionsOf(TOOL_CALLS)} />
        </OptionRow>
        <OptionRow title="Auto-scroll" about="Only at the end: not while you read above. Not shown in the preview">
          <Segmented label="Auto-scroll" className="compact" value={view.autoScroll ?? 'always'} onChange={(autoScroll) => set({ autoScroll })} options={optionsOf(AUTO_SCROLL)} />
        </OptionRow>
      </ul>
      <p className="hint">
        What each tool call and answer shows (arguments as fields, the screenshot thumbnail, the tab chip, the tokens line…):
        {' '}<a href="#display">Display</a>. Which tools and groups the tools menu (the wrench) shows: the eye in <a href="#tools">Tools</a>. Which mentions
        work in the message box: <a href="#auto-inject">Auto-inject → Mentions</a>.
      </p>
    </>
  );
}

const MODES = { system: 'System', light: 'Light', dark: 'Dark' } as const;

// A theme as a card: a small chat in its colors, light on the left and dark on the right, its bold,
// italic and code in them, and some of its Layers highlights under its name.
function ThemeCard({ theme, chosen, onChoose }: { theme: Appearance & { name: string }; chosen: boolean; onChoose: () => void }) {
  const half = (mode: 'light' | 'dark') => {
    const own = theme.palette?.[mode];
    const base = TOKEN_BASE[mode];
    const vars = lookVars(theme, mode === 'dark');
    const bg = own?.bg ?? base.bg;
    const accent = vars['--accent'] ?? TOKEN_ACCENT[mode];
    const color = (key: TextColor) => textColorOf(vars, mode, key);
    return (
      <span className="theme-mini-half" style={{ background: bg, color: own?.fg ?? base.fg }}>
        <i className="theme-mini-user" style={{ background: own?.user ?? `color-mix(in srgb, ${accent} ${mode === 'light' ? 18 : 30}%, ${bg})` }} />
        <span className="theme-mini-text">
          <b style={{ color: color('strong') }}>Bold</b> <em style={{ color: color('em') }}>italic</em>
        </span>
        <code className="theme-mini-text" style={{ color: color('code') }}>code()</code>
        <i className="theme-mini-button" style={{ background: accent }} />
      </span>
    );
  };
  return (
    <button type="button" role="radio" aria-checked={chosen} className="theme-card" onClick={onChoose}>
      <span className="theme-mini" aria-hidden="true">{half('light')}{half('dark')}</span>
      <span className="theme-card-foot">
        <span className="theme-name">{theme.name}</span>
        <span className="theme-dots" aria-hidden="true">
          {ORIGINS.slice(0, 6).map((o) => <i key={o.origin} style={{ background: theme.highlights?.[o.origin] ?? o.color }} />)}
        </span>
      </span>
    </button>
  );
}

// Bold, italic and code: how each is shown by its color input.
const TEXT_COLORS = [['strong', 'Bold', <b>Bold</b>], ['em', 'Italic', <em>Italic</em>], ['code', 'Code', <code>Code</code>]] as const;
type TextColor = (typeof TEXT_COLORS)[number][0];
// The color a look's variables give one of them in a mode (none set: the tokens' own).
const textColorOf = (vars: Record<string, string | undefined>, mode: 'light' | 'dark', key: TextColor) => vars[`--md-${key}`] ?? TOKEN_TEXT[mode][key];

// The mode, the themes (built-in and yours: saved, imported, exported), and what you change over the
// theme: its accent and its text colors.
function ThemeOptions({ settings, onChange }: Props) {
  const look = settings.appearance ?? {};
  const custom = settings.customThemes ?? [];
  const setLook = (change: Partial<Appearance>) => onChange({ appearance: { ...look, ...change } });
  // The colors the current theme shows in the mode shown (its own when none is chosen), from the look
  // itself: the page takes them on only after this renders.
  const dark = isDarkMode(look, useSystemDark());
  const vars = lookVars(look, dark);
  const mode = dark ? 'dark' : 'light';
  const accent = vars['--accent'] ?? TOKEN_ACCENT[mode];
  const card = (t: Appearance & { name: string }) => <ThemeCard theme={t} chosen={isThemeOf(look, t)} onChoose={() => onChange({ appearance: lookWithTheme(look, t) })} />;
  return (
    <>
      <ul className="switch-rows" aria-label="Mode">
        <OptionRow title="Mode" about="System follows the computer's setting">
          <Segmented label="Mode" className="compact" value={look.mode ?? 'system'} onChange={(m) => setLook({ mode: m })} options={optionsOf(MODES)} />
        </OptionRow>
      </ul>
      <div className="section-subhead">
        <h4>Themes</h4>
        <ThemeFiles look={look} custom={custom} onChange={onChange} />
      </div>
      <div className="theme-cards" role="radiogroup" aria-label="Themes">
        {THEME_PRESETS.map((p) => <div key={p.name}>{card(p)}</div>)}
      </div>
      {THEME_PRESETS.filter((p) => p.credit && isThemeOf(look, p)).map((p) => <p key={p.name} className="hint">{p.credit}</p>)}
      {custom.length > 0 && (
        <>
          <p className="hint">Yours: they also set the mode, the fonts and the bubble's look they were saved with.</p>
          <div className="theme-cards" role="radiogroup" aria-label="Your themes">
            {custom.map((t) => (
              <div key={t.name} className="theme-custom">
                {card(t)}
                <InlineConfirm question={`Delete "${t.name}"?`} label={`Confirm: delete the theme ${t.name}`} onConfirm={() => onChange({ customThemes: deleteTheme(custom, t.name) })}>
                  {(ask) => <button className="icon-button theme-delete" title={`Delete "${t.name}"`} aria-label={`Delete the theme ${t.name}`} onClick={ask}>×</button>}
                </InlineConfirm>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-subhead">
        <h4>Your changes</h4>
        <span className="hint">Over the theme; saved with your themes</span>
      </div>
      <ul className="switch-rows" aria-label="Your changes">
        <OptionRow title="Accent" about="Buttons, headings, list markers. Each theme has its own">
          <span className="color-row">
            <input type="color" aria-label="Accent color" value={accent} onChange={(e) => setLook({ accent: e.target.value })} />
            <button disabled={!look.accent} onClick={() => setLook({ accent: undefined })}>Reset</button>
          </span>
        </OptionRow>
        <OptionRow title="Text colors" about="Each theme has its own; bold follows the accent unless set here">
          <span className="color-row text-colors">
            {TEXT_COLORS.map(([key, label, sample]) => (
              <label key={key}>
                <input type="color" aria-label={`${label} color`} value={look[key] ?? textColorOf(vars, mode, key)} onChange={(e) => setLook({ [key]: e.target.value })} />
                {sample}
              </label>
            ))}
            <button disabled={!TEXT_COLORS.some(([k]) => look[k])} onClick={() => setLook({ strong: undefined, em: undefined, code: undefined })}>Reset</button>
          </span>
        </OptionRow>
      </ul>
    </>
  );
}

// A font as a card: a sample in it and its name.
function FontCard({ name, family, sample, chosen, onChoose }: { name: string; family: string; sample: string; chosen: boolean; onChoose: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={chosen} className="font-card" onClick={onChoose}>
      <span className="font-card-sample" style={{ fontFamily: family }} aria-hidden="true">{sample}</span>
      <span className="font-card-name">{name}</span>
    </button>
  );
}

// The text and code fonts (from a list, or one installed by name), everywhere or only in messages.
function FontOptions({ settings, onChange }: Props) {
  const look = settings.appearance ?? {};
  const setLook = (change: Partial<Appearance>) => onChange({ appearance: { ...look, ...change } });
  const badName = (name: string | undefined) => name !== undefined && !fontNameOk(name.trim());
  return (
    <>
      <div className="section-subhead">
        <h4>Text</h4>
        <span className="hint">Installed on this computer: nothing is downloaded</span>
      </div>
      <div className="font-cards" role="radiogroup" aria-label="Text font">
        {(Object.keys(TEXT_FONTS) as TextFont[]).map((k) => (
          <FontCard key={k} name={TEXT_FONTS[k][0]} family={TEXT_FONTS[k][1]} sample="Aa Bb" chosen={(look.fontText ?? 'system') === k}
            onChoose={() => setLook({ fontText: k === 'system' ? undefined : k })} />
        ))}
      </div>
      <div className="section-subhead"><h4>Code</h4></div>
      <div className="font-cards" role="radiogroup" aria-label="Code font">
        {(Object.keys(CODE_FONTS) as CodeFont[]).map((k) => (
          <FontCard key={k} name={CODE_FONTS[k][0]} family={CODE_FONTS[k][1]} sample="{0O1l}" chosen={(look.fontCode ?? 'system') === k}
            onChoose={() => setLook({ fontCode: k === 'system' ? undefined : k })} />
        ))}
      </div>
      <ul className="switch-rows" aria-label="More about fonts">
        <OptionRow title="Another installed font" about="Its name, as your computer lists it. One that is missing falls back to the choice above">
          <span className="font-names">
            <input aria-label="Text font name" placeholder="Text, e.g. Avenir" maxLength={MAX_FONT_NAME} value={look.fontTextName ?? ''}
              onChange={(e) => setLook({ fontTextName: e.target.value || undefined })} />
            <input aria-label="Code font name" placeholder="Code, e.g. Fira Code" maxLength={MAX_FONT_NAME} value={look.fontCodeName ?? ''}
              onChange={(e) => setLook({ fontCodeName: e.target.value || undefined })} />
          </span>
        </OptionRow>
        <OptionRow title="Where" about="Everywhere: the side panel, Settings and the chat floating on a page">
          <Segmented label="Where the fonts apply" className="compact" value={look.fontScope ?? 'all'} onChange={(fontScope) => setLook({ fontScope: fontScope === 'all' ? undefined : fontScope })}
            options={[{ value: 'all', label: 'Everywhere' }, { value: 'messages', label: 'Only the messages' }]} />
        </OptionRow>
      </ul>
      {(badName(look.fontTextName) || badName(look.fontCodeName)) && (
        <p className="error-text">A font's name has only letters, digits, spaces, dots and dashes: this one is not used.</p>
      )}
      <p className="hint">A theme you save keeps the fonts too. The built-in themes leave them as you chose.</p>
    </>
  );
}

// How the Layers view starts, and the color of each highlight.
function LayersOptions({ settings, onChange }: Props) {
  const view = settings.chatView ?? {};
  const look = settings.appearance ?? {};
  const setView = (change: Partial<ChatView>) => onChange({ chatView: { ...view, ...change } });
  const setHighlights = (highlights: Appearance['highlights']) => onChange({ appearance: { ...look, highlights } });
  const setHighlight = (origin: Origin, color: string | undefined) => {
    const { [origin]: _old, ...rest } = look.highlights ?? {};
    setHighlights(color ? { ...rest, [origin]: color } : rest);
  };
  const changed = Object.keys(look.highlights ?? {}).length;
  return (
    <>
      <p className="hint">Layers, in the chat's view menu, shows where each part of a request comes from, each source in its own color.</p>
      <ul className="switch-rows" aria-label="How Layers starts">
        <OptionRow title="Every message's layers start shown" about="Off: each opens with a click">
          <Switch checked={view.techCallsOpen ?? false} label="Every message's layers start shown" onChange={(techCallsOpen) => setView({ techCallsOpen })} />
        </OptionRow>
        <OptionRow title="Start with the highlights on" about="The colors below, over the text">
          <Switch checked={view.techOrigin ?? true} label="Start with the highlights on" onChange={(techOrigin) => setView({ techOrigin })} />
        </OptionRow>
      </ul>
      <div className="section-subhead">
        <h4>Highlight colors</h4>
        <button disabled={!changed} onClick={() => setHighlights(undefined)}>Reset all</button>
      </div>
      {(['web', 'extension'] as const).map((group) => (
        <div key={group}>
          <p className="hint">{group === 'web' ? 'From the web' : 'From the extension'}</p>
          <div className="highlight-grid">
            {ORIGINS.filter((o) => o.group === group).map((o) => (
              <div key={o.origin} className="color-row">
                <input type="color" aria-label={`${o.label} color`} value={look.highlights?.[o.origin] ?? ORIGIN_INFO[o.origin].color} onChange={(e) => setHighlight(o.origin, e.target.value)} />
                <mark className={originClass(o.origin)} title={o.about}>{o.label}</mark>
                {look.highlights?.[o.origin] && <button className="highlight-reset" onClick={() => setHighlight(o.origin, undefined)}>Reset</button>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="hint">Shown with transparency, in light and in dark. A theme can set them too.</p>
    </>
  );
}

// Save as theme… (a name for the current appearance, asking before replacing a saved theme of that
// name), Import ▾ (themes, saved, not applied) and Export ▾ (the current appearance, or all saved themes).
function ThemeFiles({ look, custom, onChange }: { look: Appearance; custom: CustomTheme[]; onChange: SettingsPatch }) {
  const [saving, setSaving] = useState(false);
  const name = lookName(look, custom);
  const importJson = async (json: string) => {
    const { themes, names, skipped } = importThemes(custom, parseThemes(json));
    if (names.length) onChange({ customThemes: themes });
    return importedThemes(names, skipped);
  };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
  return (
    <div className="theme-files">
      <ImportExport noun="theme" fileName={`theme-${slug}.json`} count={1} exportJson={() => exportTheme(themeFromLook(name, look))} importJson={importJson}
        placeholder={`{ "type": "${THEME_FILE_TYPE}", "version": ${THEME_FILE_VERSION}, "name": "Dusk", "accent": "#7c3aed" }`}
        exportItems={custom.length ? [{ label: 'All your themes to file…', onSelect: () => downloadText('themes.json', exportThemes(custom)) }] : []}>
        {!saving && <button onClick={() => setSaving(true)}>Save as theme…</button>}
      </ImportExport>
      {saving && <SaveTheme look={look} custom={custom} onSave={(customThemes) => onChange({ customThemes })} onClose={() => setSaving(false)} />}
    </div>
  );
}

// The name to save the current appearance under; a saved theme of that name is replaced once confirmed.
function SaveTheme({ look, custom, onSave, onClose }: { look: Appearance; custom: CustomTheme[]; onSave: (themes: CustomTheme[]) => void; onClose: () => void }) {
  const [name, setName] = useState(() => custom.find((t) => isThemeOf(look, t))?.name ?? '');
  const [error, setError] = useState('');
  const problem = name.trim() ? themeNameProblem(name) : undefined;
  const existing = findTheme(custom, name);
  const save = () => {
    try {
      onSave(saveTheme(custom, themeFromLook(name, look)));
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <InlineConfirm question={`Replace your theme "${existing?.name ?? name.trim()}"?`} action="Replace" label={`Confirm: replace the theme ${existing?.name ?? ''}`} onConfirm={save}>
        {(ask) => (
          <form className="row theme-save" onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || problem) return;
            if (existing) ask();
            else save();
          }}>
            <input aria-label="Theme name" placeholder="Theme name" maxLength={MAX_THEME_NAME} value={name} autoFocus onChange={(e) => { setName(e.target.value); setError(''); }} />
            <button type="submit" className="primary" disabled={!name.trim() || !!problem}>Save</button>
            <button type="button" onClick={onClose}>Cancel</button>
          </form>
        )}
      </InlineConfirm>
      {(problem ?? error) && <p className="error-text">{problem ?? error}</p>}
      {!problem && existing && <p className="muted">A theme named "{existing.name}" is saved: saving replaces it.</p>}
    </>
  );
}
