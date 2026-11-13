// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings-types';

// Agents and Speak: the profile each one's answers are read with, the switch that offers it speech.say
// (off by default, Browser too), the tool itself, and both carried by the agents' export.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const stored: unknown[] = [];
vi.mock('wxt/browser', () => ({ browser: { offscreen: {} } }));
vi.mock('../src/agents/profiles', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentStore: { load: async () => stored },
}));
const { speechTools } = await import('../src/speech/tool');
const { speaksAloud, agentVoiceOf } = await import('../src/speech/settings');
const { setTextOverrides } = await import('../src/core/model-texts');
const { AgentVoice } = await import('../src/ui/agents/AgentVoice');
const { agentVoiceProfile } = await import('../src/background/speech-host');
const { exportAgents, importAgents } = await import('../src/agents/io');
const { newAgentProfile } = await import('../src/agents/profiles');
const { browserAsAgent } = await import('../src/agents/builtins');

const CALM = { id: 'a', name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a' };
const QUICK = { id: 'b', name: 'Quick', providerId: 'p', model: 'tts-1', voice: 'nova_b' };
const base = (more: Partial<Settings> = {}) => ({ providers: [], systemPrompt: '', speak: { profiles: [CALM, QUICK] }, ...more }) as Settings;

describe('speech.say', () => {
  it('is offered only to an agent whose switch is on, Speak on and a voice there', () => {
    expect(speaksAloud(base(), undefined)).toBe(false); // Browser, by default
    expect(speaksAloud(base({ browserAgent: { canSpeak: true } }), undefined)).toBe(true);
    expect(speaksAloud(base(), { canSpeak: true })).toBe(true);
    expect(speaksAloud(base(), {})).toBe(false);
    expect(speaksAloud(base({ speak: { profiles: [CALM], enabled: false } }), { canSpeak: true })).toBe(false);
    expect(speaksAloud(base({ speak: {} }), { canSpeak: true })).toBe(true); // the system voice
    expect(speaksAloud(base({ speak: { systemVoice: false } }), { canSpeak: true })).toBe(false);
    expect(browserAsAgent(base({ browserAgent: { canSpeak: true, voiceProfileId: 'b' } }))).toMatchObject({ canSpeak: true, voiceProfileId: 'b' });
    expect(agentVoiceOf(base({ browserAgent: { voiceProfileId: 'b' } }), undefined)).toEqual({ voiceProfileId: 'b' });
  });

  it('reads with the agent running, and says so; a refusal is the tool\'s error', async () => {
    setTextOverrides({});
    const say = vi.fn(async (..._a: unknown[]) => ({ started: true as const }));
    const [tool] = speechTools(say);
    expect(tool).toMatchObject({ name: 'speech.say', effect: 'read', siteless: true, source: 'speech' });
    const ctx = { signal: new AbortController().signal, settings: base(), agentId: 'reader', tabId: 4 };
    expect(await tool!.run({ text: ' Hello. ' }, ctx)).toEqual({ type: 'text', text: 'It is being read aloud to the user.' });
    expect(say).toHaveBeenCalledWith('Hello.', 'reader', 4);
    const refused = speechTools(async () => ({ error: 'The voice server answered 500' }))[0]!;
    expect(await refused.run({ text: 'Hi' }, ctx)).toEqual({ type: 'text', text: 'It was not read aloud: The voice server answered 500', isError: true });
  });
});

describe("an agent's voice", () => {
  it('the profile its answers are read with: the agent named, else the active one; Browser\'s in the settings', async () => {
    stored.length = 0;
    stored.push({ ...newAgentProfile(), id: 'reader', name: 'reader', voiceProfileId: 'b' }, { ...newAgentProfile(), id: 'off', name: 'off', enabled: false, voiceProfileId: 'b' });
    expect(await agentVoiceProfile(base(), 'reader')).toBe('b');
    expect(await agentVoiceProfile(base({ activeAgentId: 'reader' }), undefined)).toBe('b');
    expect(await agentVoiceProfile(base({ browserAgent: { voiceProfileId: 'a' } }), undefined)).toBe('a');
    expect(await agentVoiceProfile(base(), 'off')).toBeUndefined();
  });

  it('is chosen in its editor, with its switch', async () => {
    let now: { voiceProfileId?: string; canSpeak?: boolean } = {};
    function Harness() {
      const [voice, setVoice] = useState(now);
      return createElement(AgentVoice, { settings: base(), voice, onChange: (v: typeof now) => setVoice((now = v)) });
    }
    const box = document.createElement('div');
    await act(async () => createRoot(box).render(createElement(Harness)));
    const select = box.querySelector<HTMLSelectElement>('[aria-label="Voice"]')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['The default (Calm)', 'Calm', 'Quick']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'b');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => box.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(now).toEqual({ voiceProfileId: 'b', canSpeak: true });
  });

  it('travels with the agent\'s export, and comes back with it', () => {
    const reader = { ...newAgentProfile(), name: 'reader', voiceProfileId: 'b', canSpeak: true };
    const [shared] = JSON.parse(exportAgents([reader])).agents;
    expect(shared).toMatchObject({ voiceProfileId: 'b', canSpeak: true });
    expect(importAgents(exportAgents([reader]), []).agents[0]).toMatchObject({ voiceProfileId: 'b', canSpeak: true, enabled: false });
  });
});
