// One piece to the provider's POST /audio/speech (the OpenAI-compatible text to speech), with the
// provider's auth and extra headers; its extraBody is JSON for chat requests, so it does not go. The
// answer is the clip, MP3. The word blacklist does not apply.
import { buildHeaders } from '../providers/headers';
import type { SpeechTarget } from './settings';

export function speechRequest(t: SpeechTarget, input: string): { url: string; init: RequestInit } {
  const body = { model: t.model, input, voice: t.voice, response_format: 'mp3', speed: t.speed };
  return {
    url: `${t.provider.baseURL.replace(/\/+$/, '')}/audio/speech`,
    init: { method: 'POST', headers: buildHeaders(t.provider.apiKey, t.provider.extraHeaders), body: JSON.stringify(body) },
  };
}

// A server that never answers is given up after this (a model on a CPU may take a while per piece).
const REQUEST_MS = 120_000;

// What the server says when it refuses: its JSON's error message (a 400 for an unknown voice lists the
// voices it has), else its text.
export function refusalText(status: number, body: string): string {
  let said = body.trim();
  try {
    const j = JSON.parse(body) as { error?: unknown; detail?: unknown; message?: unknown };
    const e = j.error as { message?: unknown } | string | undefined;
    const message = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : typeof j.detail === 'string' ? j.detail : typeof j.message === 'string' ? j.message : undefined;
    if (message) said = message;
  } catch {
    // not JSON: its text
  }
  return `The voice server answered ${status}${said ? `: ${said.slice(0, 500)}` : ''}`;
}

export async function fetchClip(t: SpeechTarget, input: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const { url, init } = speechRequest(t, input);
  const res = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)]) });
  if (!res.ok) throw new Error(refusalText(res.status, await res.text().catch(() => '')));
  return res.arrayBuffer();
}
