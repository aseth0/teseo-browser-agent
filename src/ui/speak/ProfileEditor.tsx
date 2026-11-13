// One voice profile in Settings → Speak: its name, provider and model (the provider's /models listed,
// the speech-looking ones first; any name can be typed), its voice (free text: there is no voices
// endpoint, and a server may take a blend such as "a+b"), its speed, its reading rules (none chosen: Speak's
// default); and Test, which reads a sample
// with it and shows what the server said when it refuses (a 400 for an unknown voice lists its voices).
import { useId, useState } from 'react';
import type { Settings } from '../../storage/settings';
import type { VoiceProfile } from '../../storage/settings-types';
import { languageName, RULED_LANGUAGES } from '../../speech/languages';
import { clampSpeed, providerUrlOf, speakLanguage, SPEED } from '../../speech/settings';
import { useProviderModels } from '../useProviderModels';
import { useSpeak } from '../useSpeak';

const SPEECH_LOOKING = /tts|speech|voice|audio/i;
export const rankSpeechModels = (ids: string[]): string[] => [...ids.filter((id) => SPEECH_LOOKING.test(id)), ...ids.filter((id) => !SPEECH_LOOKING.test(id))];
export const SAMPLE = 'Hello! This is how this voice sounds.';

export function ProfileEditor({ settings, profile, onSave }: { settings: Settings; profile: VoiceProfile; onSave: (p: VoiceProfile) => void }) {
  const set = (change: Partial<VoiceProfile>) => onSave({ ...profile, ...change });
  const provider = settings.providers.find((p) => p.id === profile.providerId);
  const models = useProviderModels(provider, rankSpeechModels);
  const listId = useId();
  const [sample, setSample] = useState(SAMPLE);
  const [speed, setSpeed] = useState<string>();
  const { speaking, toggle, failed } = useSpeak();
  const key = `test:${profile.id}`;
  const fallback = speakLanguage(settings);
  const defaultRules = fallback ? languageName(fallback) : 'none';
  return (
    <>
      <ul className="switch-rows speak-rows" aria-label={`${profile.name}: its voice`}>
        <li className="stack">
          <div><strong>Provider and model</strong><span className="hint">An OpenAI-compatible server with POST /audio/speech. Models that look like text to speech are listed first</span></div>
          <div className="row voice-model">
            <select aria-label="Provider" value={provider?.id ?? ''} onChange={(e) => set({ providerId: e.target.value || undefined })}>
              <option value="">Choose a provider…</option>
              {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input aria-label="Model" className="mono" list={listId} placeholder="tts-1" value={profile.model ?? ''} onChange={(e) => set({ model: e.target.value || undefined })} />
            <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
        </li>
        <li>
          <div><strong>Voice</strong><span className="hint">As the server names it; some take a blend, such as a+b</span></div>
          <input aria-label="Voice" className="mono" placeholder="alloy" value={profile.voice ?? ''} onChange={(e) => set({ voice: e.target.value || undefined })} />
        </li>
        <li>
          <div><strong>Speed</strong><span className="hint">{SPEED.min} to {SPEED.max}; 1 is the voice&apos;s own</span></div>
          <input aria-label="Speed" className="narrow-input" type="number" min={SPEED.min} max={SPEED.max} step={SPEED.step} placeholder={String(SPEED.default)}
            value={speed ?? profile.speed ?? ''}
            // As typed ("1." on the way to 1.25); what was kept shows once the field is left.
            onChange={(e) => {
              setSpeed(e.target.value);
              set({ speed: e.target.value ? clampSpeed(Number(e.target.value)) : undefined });
            }}
            onBlur={() => setSpeed(undefined)} />
        </li>
        <li>
          <div><strong>Reading rules</strong><span className="hint">How this voice says numbers and units: &quot;0,26 s&quot; as words in Spanish. None: read as written</span></div>
          <select aria-label="Reading rules" value={profile.language ?? ''} onChange={(e) => set({ language: e.target.value || undefined })}>
            <option value="">As Speak&apos;s default ({defaultRules})</option>
            <option value="none">None</option>
            {RULED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </li>
        <li className="stack">
          <div><strong>Test</strong><span className="hint">Reads this sample with the voice and its reading rules, as set above</span></div>
          <div className="row speak-test">
            <input aria-label="Sample text" value={sample} onChange={(e) => setSample(e.target.value)} />
            <button className={speaking(key) ? 'danger' : 'primary'} disabled={!sample.trim()}
              onClick={() => toggle(key, { text: sample, profile }, providerUrlOf(settings, profile))}>{speaking(key) ? 'Stop' : 'Test'}</button>
          </div>
          {failed && <p className="msg error" role="alert">{failed}</p>}
        </li>
      </ul>
    </>
  );
}
