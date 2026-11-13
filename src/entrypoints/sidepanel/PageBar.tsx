// Under the conversation: the page the agent works on, what goes with it, and what the agent may do there.
import { Icon } from '../../ui/chat-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { agentStore, withSite, type AgentProfile } from '../../agents/profiles';
import { isHost } from '../../core/hosts';
import { hostOf } from '../../core/util';
import { POLICY_LABELS, type SitePolicy } from '../../core/site-policy';
import { siteSkillsFor } from '../../skills/prompt';
import { PolicySelect } from '../../ui/PolicySelect';
import { useSkills } from '../../ui/Skills';
import { useConversationPolicies, useSitePolicies } from '../../ui/useSitePolicies';
import type { PageTarget } from './usePageTarget';
import { Chip } from '../../ui/Chip';
import { FLOATING, FULL } from '../../ui/floating-frame';
import { Popover } from '../../ui/Popover';
import { faviconOf, openWindows, pickerWindows, showTab, type PickerWindow } from './tab-picker';
import { ownWindowIds } from '../../page/background-tab';

const NOT_GIVEN = 'not-given'; // the page bar's choice for a site that is not one of the agent's
// The chat floating on a page has no policy to choose: the page could lead a click to it (its frame
// made transparent) and the keyboard on to "Act without asking" for its own site. The side panel has.
const CHOOSES_POLICY = !FLOATING;

// `skillsOff`: why the site skills do not go now (the auto-inject menu, Settings → Auto-inject).
// `blacklist`: the word blacklist's chip (BlacklistChip).
export function PageBar({ page, pageTools, conversationId, templates, selection, blacklist, profile, skillsOff, children }: { page: PageTarget; pageTools: string[]; conversationId: string; templates: ReactNode; selection: ReactNode; blacklist?: ReactNode; profile?: AgentProfile; skillsOff?: string; children: ReactNode }) {
  const host = page.url ? hostOf(page.url) || page.url : '';
  const [policies, setPolicy] = useSitePolicies();
  // Allowed to act without asking in this conversation (the card's "In this conversation"): a chip
  // over the site's policy, with × to ask again.
  const [inConversation, setInConversation] = useConversationPolicies(conversationId);
  const skills = useSkills();
  const activeSkills = useMemo(() => siteSkillsFor(skills, page.url), [skills, page.url]);
  return (
    <div className="pagebar">
      {children}
      {page.bindTo ? <TabPicker page={page} host={host} bindTo={page.bindTo} /> : <span className="host" title={page.title}>{host || 'no tab'}</span>}
      {selection}
      {activeSkills.map((s) => (
        <span key={s.id} className={`skill-chip${skillsOff ? ' muted' : ''}`} title={skillsOff ? `Not sent: ${skillsOff}. ${s.description}` : `Site skill active: ${s.description}`}>
          <Icon name={skillsOff ? 'withheld' : 'skill'} size={12} /> {s.name}
        </span>
      ))}
      {templates}
      {blacklist}
      {pageTools.length > 0 && (
        <span className="skill-chip" title={`Tools this page offers (WebMCP), each call run as the site's policy says:\n${pageTools.join('\n')}`}>
          <Icon name="pageTools" size={12} /> {pageTools.length} page {pageTools.length === 1 ? 'tool' : 'tools'}
        </span>
      )}
      {CHOOSES_POLICY && page.access === 'ok' && !profile && (
        <PolicySelect label={`Policy on ${host}`} title="What the agent may do on this site" value={policies[host]} onChange={(p) => setPolicy(host, p)} />
      )}
      {CHOOSES_POLICY && page.access === 'ok' && profile && isHost(host) && (
        // This site made one of the agent's (with its policy: the chat opens with it here), or not.
        <select aria-label={`${profile.name} on ${host}`} title={`What ${profile.name} may do on this site; with a policy of its own, the chat opens with it here`} value={profile.sites[host] ?? NOT_GIVEN}
          onChange={(e) => {
            const policy = e.target.value === NOT_GIVEN ? undefined : (e.target.value as SitePolicy);
            void agentStore.update(profile.id, (a) => withSite(a, host, policy));
          }}>
          <option value={NOT_GIVEN}>{profile.onlyItsSites ? `Not given to ${profile.name}` : `Not ${profile.name}'s: the site's policy`}</option>
          {Object.entries(POLICY_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      )}
      {inConversation[host] && (
        <Chip className="skill-chip" icon="ok" title="Acts without asking on this site in this conversation"
          remove={{ label: 'Ask again on this site in this conversation', onClick: () => setInConversation(host, 'ask') }}>
          this conversation
        </Chip>
      )}
      {page.access === 'restricted' && <span className="muted">not accessible</span>}
      {page.access === 'needs-permission' && <button onClick={page.grant}>Allow</button>}
    </div>
  );
}

// The tab the chat works on, and the choice of another: any open tab, the one you are on ("Use this
// tab"), or its own brought to the front ("Go to it"). The window's side panel and the full-screen chat
// only: the floating chat and a tab's own panel (the agent manager's chats among them) keep their tab.
function TabPicker({ page, host, bindTo }: { page: PageTarget; host: string; bindTo: (tabId: number) => void }) {
  const label = page.elsewhere ? `Working on: ${page.title || host}` : host || 'no tab';
  const title = page.elsewhere ? label : `Working on: ${page.title || host || 'no tab'}. Choose another tab`;
  return (
    <span className="host tab-picker">
      <Popover className={`chip-button${page.elsewhere ? '' : ' plain'}`} title={title} label={label}>
        {(close) => (
          <div className="menu tab-picker-menu" role="menu" aria-label="Tab the chat works on">
            {page.elsewhere && (
              <button role="menuitem" className="menu-option" title={page.elsewhere.title} onClick={() => { bindTo(page.elsewhere!.tabId); close(); }}>Use this tab</button>
            )}
            {page.tabId !== undefined && (page.elsewhere || FULL) && (
              <button role="menuitem" className="menu-option" title={`Bring ${page.title || host} to the front of its window`} onClick={() => { void showTab(page.tabId!).catch(() => undefined); close(); }}>Go to it</button>
            )}
            <OpenTabs chat={page.tabId} user={page.elsewhere?.tabId ?? page.tabId} onPick={(id) => { bindTo(id); close(); }} />
          </div>
        )}
      </Popover>
    </span>
  );
}

// Full screen, you are on the chat's own tab.
const userTab = async (user?: number) => (FULL ? (await browser.tabs.getCurrent())?.id : user);

// The open tabs, by window, read as the menu opens. Once there, the focus goes to the chat's tab when
// nothing in the menu has it yet.
function OpenTabs({ chat, user, onPick }: { chat?: number; user?: number; onPick: (tabId: number) => void }) {
  const [windows, setWindows] = useState<PickerWindow[]>();
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let on = true;
    const read = async () => {
      const [open, own, you] = await Promise.all([openWindows(), ownWindowIds(), userTab(user)]);
      return pickerWindows(open, { chat, user: you, skip: (id) => own.includes(id) });
    };
    read().then((w) => on && setWindows(w), () => on && setWindows([]));
    return () => { on = false; };
  }, [chat, user]);
  useEffect(() => {
    const menu = first.current?.closest<HTMLElement>('[role="menu"]');
    if (!windows || !menu || menu.contains(document.activeElement)) return;
    (menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
  }, [windows]);
  if (!windows) return <div className="menu-heading" role="presentation">Loading tabs…</div>;
  if (!windows.length) return <div className="menu-heading" role="presentation">No open tabs</div>;
  return windows.map((w, i) => (
    <div key={w.windowId} ref={i === 0 ? first : undefined} role="group" aria-label={w.label} className="tab-picker-window">
      <div className="menu-heading" role="presentation">{w.label}</div>
      {w.tabs.map((t) => {
        const marks = [t.workingOn && 'working on', t.userOn && 'you are here', t.restricted && 'not accessible'].filter(Boolean).join(', ');
        return (
          <button key={t.tabId} role="menuitemradio" aria-checked={t.workingOn} className="menu-option tab-picker-tab"
            aria-label={marks ? `${t.title} (${marks})` : t.title} title={t.url} onClick={() => onPick(t.tabId)}>
            {t.url ? <img className="tab-favicon" src={faviconOf(t.url)} alt="" width={16} height={16} /> : <span className="tab-favicon" />}
            <span className="tab-picker-title">{t.title}</span>
            {marks && <span className="tab-mark">{marks}</span>}
          </button>
        );
      })}
    </div>
  ));
}
