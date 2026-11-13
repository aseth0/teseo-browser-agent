// The side panel's speak buttons (an answer's, the selection chip's): shown while Speak is on with a voice (a
// profile, or the system's); each reads its text with the voice of the agent it is of (an answer: the agent that gave it;
// the selection: the active one), its pill on the panel's tab, and turns into Stop while that text is read.
import { useMemo, useState } from 'react';
import { errorText } from '../../core/errors';
import { sendRuntime } from '../../core/runtime';
import { SPEAK_TEXT } from '../../speech/protocol';
import { speakAvailable } from '../../core/build';
import { DEFAULT_AGENT_ID } from '../../agents/builtins';
import type { AgentProfile } from '../../agents/profiles';
import { agentVoiceOf, canRead, profileOr, providerUrlOf } from '../../speech/settings';
import type { Settings } from '../../storage/settings';
import type { SpeakButtons } from '../../ui/chat/contexts';
import { useSpeak } from '../../ui/useSpeak';

export function useSpeakButtons(settings: Settings, agents: AgentProfile[], tabId: number | undefined): SpeakButtons | undefined {
  const { speaking, toggle, failed } = useSpeak();
  const [notRead, setNotRead] = useState<{ key: string; error: string }>(); // the last answer read on its own that could not be
  const on = speakAvailable() && canRead(settings);
  return useMemo(() => {
    if (!on) return undefined;
    // The agent by id (none, or Browser's: the settings'), and the provider its voice reads with.
    const urlFor = (agentId: string | undefined) => {
      const agent = agentId && agentId !== DEFAULT_AGENT_ID ? agents.find((a) => a.id === agentId) : undefined;
      return providerUrlOf(settings, profileOr(settings, agentVoiceOf(settings, agent).voiceProfileId));
    };
    return {
      speaking,
      failed,
      toggle: (key, text, agentId) => {
        setNotRead(undefined);
        toggle(key, { text, agentId: agentId ?? DEFAULT_AGENT_ID, ...(tabId !== undefined && { tabId }) }, urlFor(agentId));
      },
      // Without a click, the provider's site cannot be asked for: one not granted yet says so on its 🔊.
      readOnItsOwn: (key, text, agentId, o) => {
        void sendRuntime({ type: SPEAK_TEXT, text, agentId: agentId ?? DEFAULT_AGENT_ID, key, queued: true, ...(o?.growing && { growing: true }), ...(tabId !== undefined && { tabId }) })
          .then((r) => (r && 'error' in r ? setNotRead({ key, error: r.error }) : !r ? setNotRead({ key, error: 'The extension did not answer.' }) : undefined))
          .catch((e: unknown) => setNotRead({ key, error: errorText(e) }));
      },
      notRead: (key) => (notRead?.key === key ? notRead.error : undefined),
    };
  }, [on, agents, settings, speaking, failed, toggle, tabId, notRead]);
}
