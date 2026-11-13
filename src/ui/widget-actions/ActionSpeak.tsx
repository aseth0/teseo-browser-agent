// An action's "Reading aloud" step (WidgetAction.speak): the voice its boxes of text are read with (its
// agent's unless it chooses a profile) and when (on a click of their speaker, or on their own as its card
// shows them). Not for an action that opens the chat: its answer is read as the chat's.
import type { AgentProfile } from '../../agents/profiles';
import { agentVoiceOf, canRead, defaultProfile, profileOr, profilesOf, speakOn } from '../../speech/settings';
import type { Settings } from '../../storage/settings';
import { actionSpeakOf, type ActionSpeak } from '../../widget/actions';

export function ActionSpeakFields({ speak, owner, loads, settings, onChange }: {
  speak: ActionSpeak | undefined;
  owner: AgentProfile | undefined; // none: Browser
  loads: boolean; // it runs on page load: its card shows what it found when it opens
  settings: Settings;
  onChange: (speak: ActionSpeak | undefined) => void;
}) {
  if (!speakOn(settings)) return <p className="hint">Speak is off in Settings → Speak.</p>;
  const profiles = profilesOf(settings);
  const set = (change: Partial<ActionSpeak>) => onChange(actionSpeakOf({ ...speak, ...change }));
  // Whose voice "as its agent" is: the agent's profile, else the default one, else the system's.
  const agentName = owner?.name ?? 'Browser';
  const agentProfile = profileOr(settings, agentVoiceOf(settings, owner).voiceProfileId);
  const agentVoice = !agentProfile
    ? 'the system voice'
    : agentProfile.id === agentVoiceOf(settings, owner).voiceProfileId ? agentProfile.name || 'Unnamed' : `${agentProfile.name || 'Unnamed'}, the default`;
  const byDefault = defaultProfile(settings)?.id;
  const chosen = speak?.profileId && profiles.some((p) => p.id === speak.profileId) ? speak.profileId : '';
  return (
    <>
      <label>Voice
        <select value={chosen} onChange={(e) => set({ profileId: e.target.value || undefined })}>
          <option value="">As its agent: {agentName} ({agentVoice})</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name || 'Unnamed'}{p.id === byDefault ? ' (default)' : ''}</option>)}
        </select>
      </label>
      <label>When its boxes are read
        <select value={speak?.when ?? 'click'} onChange={(e) => set({ when: e.target.value === 'shown' ? 'shown' : undefined })}>
          <option value="click">When you click 🔊 on a box</option>
          <option value="shown">{loads ? 'On their own, when you open its card' : 'On their own, as soon as they show in the card'}</option>
        </select>
      </label>
      <p className="hint">
        On their own, an answer written into one box is read as it streams; boxes of text are otherwise read one after another, in order, once its answer is complete. Lists of links are not read.
        {!canRead(settings) && ' Nothing reads yet: add a voice profile in Settings → Speak, or switch its system voice on.'}
      </p>
    </>
  );
}
