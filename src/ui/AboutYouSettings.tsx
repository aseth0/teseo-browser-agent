// Settings → About you: what the agents should know about the user (context/about-user), put where
// {{about_user}} is in your system prompt and in the agents' instructions; and, in its own tab, what
// they are told of the date and time of each message (context/date-time).
import { agentStore } from '../agents/profiles';
import { ABOUT_USER_VAR, usesAboutUser } from '../context/about-user';
import { limitFrom } from '../core/limits';
import type { Settings } from '../storage/settings';
import { CopyIconButton } from './icons';
import { useCollection } from './useCollection';
import type { SettingsPatch } from './useSettings';
import { SectionTop } from './SectionTop';
import { SectionHead, SectionTabs } from './SectionParts';
import { DateTimeTab } from './DateTimeSettings';

export function AboutYouSection({ settings, onChange }: { settings: Settings; onChange: SettingsPatch }) {
  const agents = useCollection(agentStore);
  const text = settings.aboutUser ?? '';
  const length = text.trim().length; // as it is cut (context/about-user)
  const max = limitFrom('aboutUser', settings.limits?.aboutUser);
  const used = usesAboutUser([settings.systemPrompt, settings.browserAgent?.instructions, ...agents.map((a) => a.instructions)]);
  const about = (
    <>
      <p className="hint">
        What the agents should know about you: your name, your role, your language, how you like things done. It reaches the model only
        where you put <code>{ABOUT_USER_VAR}</code>: in your system prompt (Prompt preview), every agent gets it; in an agent's instructions
        (Agents), that agent alone.
      </p>
      <SectionTop page="about-you" />
      <label>About you
        <textarea rows={8} value={text} placeholder="e.g. I am Alex, a front-end developer. Answer in English, briefly; show code before explaining it."
          onChange={(e) => onChange({ aboutUser: e.target.value || undefined })} />
      </label>
      <div className="row">
        <code>{ABOUT_USER_VAR}</code>
        <CopyIconButton label={`Copy ${ABOUT_USER_VAR}`} text={ABOUT_USER_VAR} />
        <span className={`muted${length > max ? ' over-limit' : ''}`}>{length.toLocaleString('en-US')} / {max.toLocaleString('en-US')} characters</span>
      </div>
      {length > max && <p className="hint over-limit">Over the limit: the end is cut when sent.</p>}
      {text.trim() && !used && <p className="hint">No prompt uses {ABOUT_USER_VAR} yet, so the model does not get this text.</p>}
    </>
  );
  return (
    <section className="about-you-settings">
      <SectionHead title="About you" about="What the model knows about you, and about when you write to it." />
      <SectionTabs label="About you" tabs={[
        { id: 'about', label: 'About you', render: () => about },
        { id: 'date-time', label: 'Date & time', render: () => <DateTimeTab settings={settings} onChange={onChange} /> },
      ]} />
    </section>
  );
}
