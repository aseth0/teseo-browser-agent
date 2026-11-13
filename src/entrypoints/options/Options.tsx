// Options page: a menu of sections on the left, only the selected one on the right.
// The selected section lives in the URL hash (options.html#tools) so it can be linked.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { SETTINGS_SECTIONS } from '../../ui/Settings';
import { feature } from '../../core/build';
import { FeatureMark } from '../../ui/FeatureNotice';
import { pageIcon } from '../../ui/text-pages';
import { useAppearance } from '../../ui/appearance';
import { SettingsContext } from '../../ui/settings-context';
import { useSettings } from '../../ui/useSettings';

// The hash may point inside a section: #tools/browser.click.
const sectionFromHash = () => SETTINGS_SECTIONS.find((s) => `#${s.id}` === location.hash.split('/')[0]) ?? SETTINGS_SECTIONS[0]!;

export function Options() {
  const [settings, update, settingsError, save] = useSettings();
  const [section, setSection] = useState(sectionFromHash);
  useAppearance(settings?.appearance);
  const value = useMemo(() => settings && { settings, update, save }, [settings, update, save]);

  useEffect(() => {
    // To the top only when another section opens: not for a tab or an editor inside the same one.
    let shown = sectionFromHash();
    const onHash = () => {
      const next = sectionFromHash();
      setSection(next);
      if (next !== shown) window.scrollTo(0, 0);
      shown = next;
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!value) return settingsError ? <div className="msg error" role="alert">{settingsError}</div> : null;
  const page = (
    <div className="options">
      <nav className="options-nav" aria-label="Settings sections">
        <div className="options-title">Teseo</div>
        {SETTINGS_SECTIONS.map((s) => (
          <Fragment key={s.id}>
            {s.group && <div className="options-nav-group" role="separator">{s.group}</div>}
            <a href={`#${s.id}`} aria-current={s.id === section.id ? 'page' : undefined}>
              {/* The icon its things carry in the chat (none: a blank, so the names line up). */}
              <span className="options-nav-icon" aria-hidden="true">{pageIcon(s.id)}</span>
              {s.title}
              {/* Not in this build (core/build): its mark. */}
              {s.feature && !feature(s.feature).available && <FeatureMark feature={feature(s.feature)} />}
            </a>
          </Fragment>
        ))}
        <p className="hint">Changes are saved automatically and apply to the side panel right away.</p>
      </nav>
      <main className="options-main settings">
        {settingsError && <div className="msg error" role="alert">{settingsError}</div>}
        {section.render({ settings: value.settings, onChange: update })}
      </main>
    </div>
  );
  return <SettingsContext.Provider value={value}>{page}</SettingsContext.Provider>;
}
