// An agent's voice (Settings → Speak's profiles): the one its answers are read with, and its switch to
// read a text aloud on its own (speech.say), off unless switched on here. Where Speak is not available
// (core/build), a greyed row that says why (ui/FeatureNotice).
import { speakAvailable } from '../../core/build';
import { defaultProfile, profilesOf, systemVoiceOn, type AgentVoice as Voice } from '../../speech/settings';
import type { Settings } from '../../storage/settings';
import { FeatureRow } from '../FeatureNotice';
import { GoTo, PageSection } from '../text-pages';

export function AgentVoice({ settings, voice, onChange }: { settings: Settings; voice: Voice; onChange: (change: Voice) => void }) {
  if (!speakAvailable()) return (
    <PageSection page="speak" title="Voice">
      <FeatureRow as="div" id="speak" name="Its voice" about="Its answers read aloud with a voice of its own, and reading a text aloud on its own (speech.say)." />
    </PageSection>
  );
  const profiles = profilesOf(settings);
  const byDefault = defaultProfile(settings);
  const chosen = profiles.find((p) => p.id === voice.voiceProfileId);
  return (
    <PageSection page="speak" title="Voice">
      {profiles.length ? (
        <label>Its answers are read with
          <select aria-label="Voice" value={chosen?.id ?? ''} onChange={(e) => onChange({ ...voice, voiceProfileId: e.target.value || undefined })}>
            <option value="">The default ({byDefault?.name})</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      ) : (
        <p className="hint">No voice profiles yet: add one in <GoTo hash="speak" title="Speak" />.{systemVoiceOn(settings) && ' Meanwhile, the system voice reads its answers.'}</p>
      )}
      <label className="check">
        <input type="checkbox" checked={!!voice.canSpeak} onChange={(e) => onChange({ ...voice, canSpeak: e.target.checked || undefined })} />
        Speaks on its own: it may read a text aloud with its voice when it chooses to (speech.say)
      </label>
    </PageSection>
  );
}
