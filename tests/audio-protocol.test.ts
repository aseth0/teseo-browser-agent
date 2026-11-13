import { describe, expect, it } from 'vitest';
import { audioFileName } from '../src/audio/protocol';

// The name a tab's audio is saved under: its site and when, in local time.
describe('the saved audio file name', () => {
  const at = new Date(2026, 10, 1, 14, 32).getTime();
  it('its site, day and time', () => expect(audioFileName('video.example.test', at)).toBe('audio-video.example.test-2026-11-01-1432.webm'));
  it('a port or odd characters become dashes', () => expect(audioFileName('localhost:8080', at)).toBe('audio-localhost-8080-2026-11-01-1432.webm'));
  it('no site: tab', () => expect(audioFileName('', at)).toBe('audio-tab-2026-11-01-1432.webm'));
});
