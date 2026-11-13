// Settings → Speak: text read aloud by a text-to-speech model (background/speech-host). The voice
// profiles (add, edit, duplicate, delete asked first, the default one, exported and imported on their
// own: speech/profile-io), then the feature's own settings:
// on or off, the pieces' sizes, whose reading rules apply to a profile that sets none, the user's "written = said" pairs and the
// button beside a selection on pages; at the top, its shortcut.
import { useId, useState, type ReactNode } from 'react';
import { exportProfiles, PROFILES_FILE, readProfiles, withImported, withTarget, type ProfileRead } from '../../speech/profile-io';
import { languageName, RULED_LANGUAGES } from '../../speech/languages';
import { FIRST_PIECE, PIECE_SIZE } from '../../speech/pieces';
import { copyOfProfile, newProfile, withoutProfile, withProfile } from '../../speech/profiles';
import { defaultProfile, profilesOf, selectionButtonOn, speakLanguage, speakOf, speakOn, systemVoiceOn } from '../../speech/settings';
import { pairsText, parsePairs } from '../../speech/spoken';
import type { Settings } from '../../storage/settings';
import type { AutoRead, SpeakSettings, VoiceProfile } from '../../storage/settings-types';
import { CollectionIO } from '../collection/CollectionIO';
import { useSelection } from '../collection/selection';
import { Switch } from '../Collection';
import { InlineConfirm } from '../InlineConfirm';
import { NumberField } from '../NumberField';
import { SectionHead, SectionTabs, StatStrip } from '../SectionParts';
import { SectionTop } from '../SectionTop';
import { useProviderModels } from '../useProviderModels';
import type { SectionProps as Props } from '../useSettings';
import { ProfileEditor, rankSpeechModels } from './ProfileEditor';

// A profile's own reading rules as its row in the list says them; none set: nothing.
const ownRules = (language: string | undefined) => {
  const own = language?.trim();
  return !own ? undefined : own === 'none' ? 'no rules' : `${languageName(own)} rules`;
};
// What an import of profiles says once done: they have no on or off to review.
const importedSaid = (names: string[], leftOut: string[], notes: string[]) =>
  [names.length ? `Imported ${names.join(', ')}.` : 'No voice profiles imported.', ...notes, ...leftOut.map((s) => `Left out ${s}`)].join('\n');

export function SpeakSection({ settings, onChange }: Props) {
  const speak = speakOf(settings);
  const set = (change: Partial<SpeakSettings>) => onChange({ speak: { ...speak, ...change } });
  const all = profilesOf(settings);
  const byDefault = defaultProfile(settings);
  const [editing, setEditing] = useState<string>();
  const shown = all.find((p) => p.id === editing) ?? byDefault;
  const selection = useSelection(all.map((p) => p.id));
  // The provider and model a pasted list's profiles take (chosen in its preview).
  const [target, setTarget] = useState<{ providerId?: string; model?: string }>({});
  const hasProvider = (p: VoiceProfile) => settings.providers.some((x) => x.id === p.providerId);

  const add = () => {
    const p = newProfile(settings);
    onChange({ speak: withProfile(settings, p) });
    setEditing(p.id);
  };
  const duplicate = () => {
    if (!shown) return;
    const p = copyOfProfile(shown, settings);
    onChange({ speak: withProfile(settings, p) });
    setEditing(p.id);
  };
  const io = (
    <CollectionIO<VoiceProfile> noun={['voice profile', 'voice profiles']} label="Voice profiles" fileName={PROFILES_FILE} items={all} shown={all} id={(p) => p.id}
      exportJson={exportProfiles} read={(json) => readProfiles(json, settings)} selection={selection}
      save={async (picked, read) => {
        const taken = (read as ProfileRead).plain ? withTarget(picked, target) : picked;
        onChange((prev: Settings) => ({ ...prev, speak: withImported(prev, taken) }));
      }}
      said={importedSaid} previewHint="They are added to yours; one of the same name is replaced. The default profile stays as it is."
      previewExtra={(read) => ((read as ProfileRead).plain ? <ListTarget settings={settings} target={target} onChange={setTarget} /> : null)}
      pasteLabel="Voice profiles: JSON as exported here, or Name=voice@speed entries"
      placeholder={'{ "voiceProfiles": [ … ] }  or  Reader=voice_a@1.15, Blend=voice_a+voice_b@1.2'} />
  );
  const profiles = (
    <>
    {io}
    <div className="tools-layout recording-layout">
      <nav className="tool-groups" aria-label="Voice profiles">
        {all.map((p) => (
          <div key={p.id} className={selection.selecting ? 'speak-profile-pick' : 'speak-profile-row'}>
            {selection.selecting && (
              <input type="checkbox" aria-label={`Select ${p.name || 'Unnamed'}`} checked={selection.selected.has(p.id)} onChange={(e) => selection.toggle(p.id, e.target.checked)} />
            )}
            <button type="button" className={`tool-group-item${p.id === shown?.id ? ' on' : ''}`} aria-current={p.id === shown?.id ? 'true' : undefined} onClick={() => setEditing(p.id)}>
              <span>{p.name || 'Unnamed'}</span>
              <span className="tool-group-count">{[p.id === byDefault?.id ? 'default' : p.voice ?? '', ownRules(p.language), hasProvider(p) ? undefined : 'choose its provider'].filter((x) => x !== undefined).join(' · ')}</span>
            </button>
          </div>
        ))}
        <button type="button" className="recording-new" onClick={add}>＋ New profile</button>
      </nav>
      {shown ? (
        <div className="tool-pane recording-pane">
          <div className="tool-pane-head">
            <input aria-label="Profile name" className="recording-name" value={shown.name} onChange={(e) => onChange({ speak: withProfile(settings, { ...shown, name: e.target.value }) })} />
            {shown.id === byDefault?.id ? <span className="badge">default</span> : <button onClick={() => set({ defaultProfileId: shown.id })}>Use by default</button>}
            <button onClick={duplicate}>Duplicate</button>
            <InlineConfirm question={`Delete "${shown.name}"?`} label={`Confirm: delete the voice profile ${shown.name}`}
              onConfirm={() => {
                setEditing(undefined);
                onChange({ speak: withoutProfile(settings, shown.id) });
              }}>
              {(ask) => <button className="danger" onClick={ask}>Delete</button>}
            </InlineConfirm>
          </div>
          <ProfileEditor key={shown.id} settings={settings} profile={shown} onSave={(p) => onChange({ speak: withProfile(settings, p) })} />
        </div>
      ) : (
        <div className="tool-pane recording-pane">
          <p className="hint speak-empty">No voice profile yet. A profile is a provider&apos;s text-to-speech model, one of its voices and a speed: add one to read aloud{systemVoiceOn(settings) ? ' with it. Meanwhile, the system voice reads' : ''}.</p>
        </div>
      )}
    </div>
    </>
  );

  const autoRead = speak.autoRead ?? {};
  // Only what is on is kept: none at all, no key.
  const setAuto = (change: Partial<AutoRead>) => {
    const next = Object.fromEntries(Object.entries({ ...autoRead, ...change }).filter(([, v]) => v !== undefined)) as AutoRead;
    set({ autoRead: Object.keys(next).length ? next : undefined });
  };
  const dictation = settings.voice?.language?.trim();
  const reading = (
    <ul className="switch-rows speak-rows" aria-label="Reading">
      <li>
        <div><strong>First piece</strong><span className="hint">Characters asked for first: shorter, the voice starts sooner ({FIRST_PIECE.min} to {FIRST_PIECE.max})</span></div>
        <label className="recording-number"><NumberField label="First piece, in characters" value={speak.firstPiece} placeholder={String(FIRST_PIECE.default)} min={FIRST_PIECE.min} max={FIRST_PIECE.max} step={10} onSave={(firstPiece) => set({ firstPiece })} /></label>
      </li>
      <li>
        <div><strong>Other pieces</strong><span className="hint">Characters asked for each time after it: longer reads better and asks the server less often ({PIECE_SIZE.min} to {PIECE_SIZE.max})</span></div>
        <label className="recording-number"><NumberField label="Other pieces, in characters" value={speak.pieceSize} placeholder={String(PIECE_SIZE.default)} min={PIECE_SIZE.min} max={PIECE_SIZE.max} step={10} onSave={(pieceSize) => set({ pieceSize })} /></label>
      </li>
      <li>
        <div><strong>Default reading rules</strong><span className="hint">For the profiles that choose none: how numbers and units are said, &quot;0,26 s&quot; as words. Languages without rules are read as written</span></div>
        <select aria-label="Default reading rules" value={speak.language ?? ''} onChange={(e) => set({ language: e.target.value || undefined })}>
          <option value="">As dictation ({dictation ? languageName(dictation) : 'none set'})</option>
          <option value="none">None</option>
          {RULED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </li>
      <li className="stack">
        <div><strong>Pronunciations</strong><span className="hint">One per line, written = said, replaced before anything else: <code>example.test = example dot test</code></span></div>
        <Pairs saved={pairsText(speak.pairs ?? [])} onSave={(text) => set({ pairs: parsePairs(text) })} />
      </li>
      <li>
        <div><strong>Button beside a selection</strong><span className="hint">On pages where the bubble shows: select text, and a speaker button reads it</span></div>
        <Switch checked={speak.selectionButton !== false} label="Button beside a selection" onChange={(on) => set({ selectionButton: on ? undefined : false })} />
      </li>
      <li>
        <div><strong>Button on action boxes</strong><span className="hint">On a page widget action&apos;s card: a speaker on each box of text reads it, with the voice of the action&apos;s agent</span></div>
        <Switch checked={speak.actionBoxesButton !== false} label="Button on action boxes" onChange={(on) => set({ actionBoxesButton: on ? undefined : false })} />
      </li>
      <li>
        <div><strong>System voice</strong><span className="hint">Without a voice profile, the voice of your operating system or browser reads, with no provider: plainer, and the same for every agent</span></div>
        <Switch checked={systemVoiceOn(settings)} label="System voice" onChange={(on) => set({ systemVoice: on ? undefined : false })} />
      </li>
      <li className="speak-rows-group">Answers read on their own</li>
      <li>
        <div><strong>Floating chat on a page</strong><span className="hint">Each answer is read as it is written, from its first piece, with the voice of the agent that gave it, after what is read before it</span></div>
        <Switch checked={autoRead.floating === true} label="Floating chat on a page" onChange={(on) => setAuto({ floating: on || undefined })} />
      </li>
      <li>
        <div><strong>Side panel</strong><span className="hint">The same, in the side panel and in the chat open in a tab</span></div>
        <Switch checked={autoRead.panel === true} label="Side panel" onChange={(on) => setAuto({ panel: on || undefined })} />
      </li>
      <li>
        <div><strong>Agents Panel</strong><span className="hint">Whose answers: only those of the chat shown, or every chat&apos;s, one after another</span></div>
        <select aria-label="Agents Panel" value={autoRead.manager ?? ''} onChange={(e) => setAuto({ manager: e.target.value === 'shown' || e.target.value === 'all' ? e.target.value : undefined })}>
          <option value="">Off</option>
          <option value="shown">The chat shown</option>
          <option value="all">Every chat, one after another</option>
        </select>
      </li>
    </ul>
  );
  const language = speakLanguage(settings);
  return (
    <section className="speak-settings">
      <SectionHead title="Speak" about={<>
        Reads text aloud: an answer in the chat, your selection on a page, a box of an action&apos;s card. The text read goes to the provider of the
        voice profile, a piece at a time, and plays in the background while you change tab or close the panel. Without a profile, the system&apos;s
        voice reads it (Reading → System voice).
      </>} toggle={{ label: 'On', on: speakOn(settings), onChange: (on) => set({ enabled: on ? undefined : false }) }} />
      <StatStrip stats={[
        { label: 'Profiles', value: all.length, sub: byDefault ? `Default: ${byDefault.name}` : systemVoiceOn(settings) ? 'The system voice reads meanwhile' : 'Add one to read aloud' },
        { label: 'Default reading rules', value: <span className="stat-text">{languageName(language)}</span>, sub: speak.language ? 'Unless a profile chooses its own' : 'As dictation (Voice), unless a profile chooses its own' },
        { label: 'Selection button', value: <span className="stat-text">{selectionButtonOn(settings) ? 'On' : 'Off'}</span>, sub: 'Where the bubble shows' },
      ]} />
      <SectionTabs label="Speak" tabs={[
        { id: 'profiles', label: 'Voice profiles', render: () => profiles },
        { id: 'reading', label: 'Reading', render: () => reading },
        { id: 'top', label: 'Shortcut', render: () => <SectionTop page="speak" /> },
      ]} />
    </section>
  );
}

// A pasted list's profiles name no provider nor model: one of each, for all of them, chosen here.
function ListTarget({ settings, target, onChange }: { settings: Settings; target: { providerId?: string; model?: string }; onChange: (t: { providerId?: string; model?: string }) => void }): ReactNode {
  const provider = settings.providers.find((p) => p.id === target.providerId);
  const models = useProviderModels(provider, rankSpeechModels);
  const listId = useId();
  return (
    <div className="stack speak-list-target">
      <p className="hint">A list names no provider nor model: choose them here, for all of its profiles. Without a provider, they come in to choose it later.</p>
      <div className="row voice-model">
        <select aria-label="Provider for the list" value={provider?.id ?? ''} onChange={(e) => onChange({ ...target, providerId: e.target.value || undefined })}>
          <option value="">No provider yet</option>
          {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input aria-label="Model for the list" className="mono" list={listId} placeholder="tts-1" value={target.model ?? ''} onChange={(e) => onChange({ ...target, model: e.target.value })} />
        <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      </div>
    </div>
  );
}

// The pairs as typed (a line on its way), saved as they are typed, shown as saved once left.
function Pairs({ saved, onSave }: { saved: string; onSave: (text: string) => void }): ReactNode {
  const [draft, setDraft] = useState<string>();
  return (
    <textarea className="mono" rows={4} aria-label="Pronunciations" placeholder="example.test = example dot test" value={draft ?? saved}
      onChange={(e) => {
        setDraft(e.target.value);
        onSave(e.target.value);
      }}
      onBlur={() => setDraft(undefined)} />
  );
}
