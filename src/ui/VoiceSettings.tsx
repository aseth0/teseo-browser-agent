// Settings → Voice: dictation in the message box (sidepanel/useDictation), and a tab's audio
// (background/audio-host), which its model transcribes too. The provider and model that transcribe
// (its /models listed with the speech-to-text looking ones first; any name can be typed, for a server
// that lists none), the microphone, the language spoken, dictation's chunk length, the vocabulary and
// temperature sent with both, silence, and Test (ui/VoiceTest); for a tab's audio, what its pill on the
// page shows, its language and its own chunk length; at the top, its shortcut and limits.
import { useEffect, useId, useState } from 'react';
import type { VoiceSettings } from '../storage/settings-types';
import { rankAudioModels } from '../voice/models';
import {
  CHUNK_SECONDS,
  SILENCE_LEVELS,
  SILENCE_STOP_SECONDS,
  TAB_CHUNK_SECONDS,
  TEMPERATURE,
  VOCABULARY_CHARS,
  clampChunk,
  clampSilenceLevel,
  clampSilenceStop,
  clampTabChunk,
  clampTemperature,
  languageOf,
  tabAudioView,
} from '../voice/settings';
import { AudioViewPicker } from './AudioViewPicker';
import { SectionTop } from './SectionTop';
import { SectionHead, SectionTabs, StatStrip } from './SectionParts';
import { tabAudioAvailable } from '../core/build';
import { FeatureNote } from './FeatureNotice';
import { useProviderModels } from './useProviderModels';
import { VoiceTest } from './VoiceTest';
import type { PatchSectionProps as Props } from './useSettings';

export function VoiceSection({ settings, onChange }: Props) {
  const voice = settings.voice ?? {};
  const set = (change: Partial<VoiceSettings>) => onChange({ voice: { ...voice, ...change } });
  const provider = settings.providers.find((p) => p.id === voice.providerId);
  const models = useProviderModels(provider, rankAudioModels);
  const listId = useId();
  const mics = useMicrophones();
  // One chosen that is not plugged in now: still shown (dictation then takes the default).
  const chosenGone = !!voice.deviceId && !mics.some((m) => m.deviceId === voice.deviceId);
  const chosenMic = mics.find((m) => m.deviceId === voice.deviceId);
  // As stored; an imported file may hold something else than text.
  const vocabulary = typeof voice.vocabulary === 'string' ? voice.vocabulary : '';
  const tabLanguage = typeof voice.tabLanguage === 'string' ? voice.tabLanguage : '';
  // Where the browser cannot capture a tab's audio (core/build), nothing here names it but its tab's notice.
  const tab = tabAudioAvailable();
  const dictation = (
    <ul className="switch-rows voice-rows" aria-label="Dictation">
      <li className="stack">
        <div><strong>Audio model</strong><span className="hint">Models that look like speech-to-text are listed first.{tab && <> It also transcribes a tab&apos;s audio</>}</span></div>
        <div className="row voice-model">
          <select aria-label="Audio model" value={provider?.id ?? ''} onChange={(e) => set({ providerId: e.target.value || undefined, model: undefined })}>
            <option value="">Choose a provider…</option>
            {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {provider && (
            <>
              <input aria-label="Model" className="mono" list={listId} placeholder="whisper-1" value={voice.model ?? ''} onChange={(e) => set({ model: e.target.value.trim() || undefined })} />
              <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
            </>
          )}
        </div>
      </li>
      <li>
        <div><strong>Microphone</strong><span className="hint">The names show once the microphone is allowed</span></div>
        <select aria-label="Microphone" value={voice.deviceId ?? ''} onChange={(e) => set({ deviceId: e.target.value || undefined })}>
          <option value="">The browser&apos;s default</option>
          {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || m.deviceId}</option>)}
          {chosenGone && <option value={voice.deviceId}>{voice.deviceId}</option>}
        </select>
      </li>
      <li>
        <div><strong>Language</strong><span className="hint">Empty: detected from the speech. A code such as es or en</span></div>
        <input aria-label="Language" className="narrow-input" placeholder="auto" value={voice.language ?? ''} onChange={(e) => set({ language: e.target.value.trim() || undefined })} />
      </li>
      <li>
        <div><strong>Chunk length</strong><span className="hint">Seconds. Shorter: the text shows sooner, with more cuts and more requests</span></div>
        <input aria-label="Chunk length (seconds)" className="narrow-input" type="number" min={CHUNK_SECONDS.min} max={CHUNK_SECONDS.max} step={CHUNK_SECONDS.step} defaultValue={voice.chunkSeconds ?? ''} placeholder={String(CHUNK_SECONDS.default)}
          // As typed ("2." on the way to 2.5); what was kept shows once the field is left.
          onChange={(e) => set({ chunkSeconds: e.target.value ? clampChunk(Number(e.target.value)) : undefined })}
          onBlur={(e) => (e.target.value = e.target.value ? String(clampChunk(Number(e.target.value))) : '')} />
      </li>
      <li className="stack">
        <div><strong>Vocabulary</strong><span className="hint">Names, acronyms and terms the model should spell right, separated by commas. Sent as its prompt, before the last words dictated{tab && <>; also with a tab&apos;s audio</>}. {vocabulary.length}/{VOCABULARY_CHARS}</span></div>
        <textarea aria-label="Vocabulary" rows={2} maxLength={VOCABULARY_CHARS} placeholder="e.g. Teseo, WXT, kubectl" value={vocabulary}
          onChange={(e) => set({ vocabulary: e.target.value || undefined })} />
      </li>
      <li>
        <div><strong>Temperature</strong><span className="hint">{TEMPERATURE.min} to {TEMPERATURE.max}. Empty: not sent (the server&apos;s default).{tab && <> Also for a tab&apos;s audio</>}</span></div>
        <input aria-label="Temperature" className="narrow-input" type="number" min={TEMPERATURE.min} max={TEMPERATURE.max} step={TEMPERATURE.step} defaultValue={voice.temperature ?? ''} placeholder="—"
          onChange={(e) => set({ temperature: e.target.value ? clampTemperature(Number(e.target.value)) : undefined })}
          onBlur={(e) => (e.target.value = e.target.value ? String(clampTemperature(Number(e.target.value)) ?? '') : '')} />
      </li>
      <li>
        <div><strong>Silence level</strong><span className="hint">A chunk whose loudest sound is under it is not sent (models invent text for silence). {SILENCE_LEVELS.min} to {SILENCE_LEVELS.max}; 0 sends every chunk (a dictation still stops after silence under {SILENCE_LEVELS.default}). Test shows the level heard.{tab && <> Also for a tab&apos;s audio</>}</span></div>
        <input aria-label="Silence level" className="narrow-input" type="number" min={SILENCE_LEVELS.min} max={SILENCE_LEVELS.max} step={SILENCE_LEVELS.step} defaultValue={voice.silenceLevel ?? ''} placeholder={String(SILENCE_LEVELS.default)}
          onChange={(e) => set({ silenceLevel: e.target.value ? clampSilenceLevel(Number(e.target.value)) : undefined })}
          onBlur={(e) => (e.target.value = e.target.value ? String(clampSilenceLevel(Number(e.target.value))) : '')} />
      </li>
      <li>
        <div><strong>Stop after silence</strong><span className="hint">Seconds without sound that stop a dictation, {SILENCE_STOP_SECONDS.min} to {SILENCE_STOP_SECONDS.max}; 0: never</span></div>
        <input aria-label="Stop after silence (seconds)" className="narrow-input" type="number" min={0} max={SILENCE_STOP_SECONDS.max} step={SILENCE_STOP_SECONDS.step} defaultValue={voice.silenceStopSeconds ?? ''} placeholder={String(SILENCE_STOP_SECONDS.default)}
          onChange={(e) => set({ silenceStopSeconds: e.target.value ? clampSilenceStop(Number(e.target.value)) : undefined })}
          onBlur={(e) => (e.target.value = e.target.value ? String(clampSilenceStop(Number(e.target.value))) : '')} />
      </li>
      <VoiceTest settings={settings} />
    </ul>
  );
  const tabAudio = (
    <>
      <AudioViewPicker value={tabAudioView(settings)} onChange={(view) => set({ tabAudioView: view === 'pill' ? undefined : view })} />
      <p className="hint">In the pill on the page, where the extension may reach it. The transcript shows only when the audio goes to Review or Chat.</p>
      <ul className="switch-rows voice-rows" aria-label="A tab's audio">
        <li>
          <div><strong>Language</strong><span className="hint">Empty: detected from the speech (a page may speak any language). A code such as es or en</span></div>
          <input aria-label="Language of a tab's audio" className="narrow-input" placeholder="auto" value={tabLanguage} onChange={(e) => set({ tabLanguage: e.target.value.trim() || undefined })} />
        </li>
        {tabLanguage && !languageOf(tabLanguage) && <li><p className="msg error" role="alert">“{tabLanguage}” is not a language code (two or three letters, such as en): it is not sent, the language is detected.</p></li>}
        <li>
          <div><strong>Chunk length</strong><span className="hint">Seconds. Shorter: the text shows sooner, with more requests and more sentences cut in two. Each chunk is transcribed on its own</span></div>
          <input aria-label="Chunk length of a tab's audio (seconds)" className="narrow-input" type="number" min={TAB_CHUNK_SECONDS.min} max={TAB_CHUNK_SECONDS.max} step={TAB_CHUNK_SECONDS.step} defaultValue={voice.tabChunkSeconds ?? ''} placeholder={String(TAB_CHUNK_SECONDS.default)}
            onChange={(e) => set({ tabChunkSeconds: e.target.value ? clampTabChunk(Number(e.target.value)) : undefined })}
            onBlur={(e) => (e.target.value = e.target.value ? String(clampTabChunk(Number(e.target.value))) : '')} />
        </li>
      </ul>
    </>
  );
  return (
    <section className="voice-settings">
      <SectionHead title="Voice" about={tab ? <>
        Dictation in the message box (the microphone), and a tab&apos;s audio (the toolbar button&apos;s Audio line), both transcribed by the model
        chosen here.
      </> : <>Dictation in the message box (the microphone), transcribed by the model chosen here.</>} />
      <StatStrip stats={[
        { label: 'Audio model', value: <span className="stat-text">{provider ? voice.model || 'Choose a model' : 'Not set'}</span>, sub: provider ? provider.name : 'Dictation needs one' },
        { label: 'Microphone', value: <span className="stat-text">{chosenMic?.label || (voice.deviceId ? 'Not plugged in' : 'The default')}</span>, sub: voice.language ? `Language: ${voice.language}` : 'Language detected' },
        { label: 'Chunks', value: <>{voice.chunkSeconds ?? CHUNK_SECONDS.default} <span className="stat-of">s{tab && ` · tab ${voice.tabChunkSeconds ?? TAB_CHUNK_SECONDS.default} s`}</span></>, sub: 'Each transcribed on its own' },
      ]} />
      <SectionTabs label="Voice" tabs={[
        { id: 'dictation', label: 'Dictation', render: () => dictation },
        // Where the browser cannot capture a tab's audio (core/build), the tab says why.
        { id: 'tab', label: "A tab's audio", render: () => (tab ? tabAudio : <FeatureNote id="tabAudio" />) },
        { id: 'top', label: 'Shortcut and limits', render: () => <SectionTop page="voice" /> },
      ]} />
    </section>
  );
}

// The microphones the browser lists (its "default" and "communications" entries are the default),
// again when one is plugged in or out. Without the permission the browser lists none by name.
function useMicrophones(): MediaDeviceInfo[] {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices) return;
    let current = true;
    const list = () =>
      void devices.enumerateDevices().then(
        (all) => current && setMics(all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')),
        () => undefined,
      );
    list();
    devices.addEventListener('devicechange', list);
    return () => {
      current = false;
      devices.removeEventListener('devicechange', list);
    };
  }, []);
  return mics;
}
