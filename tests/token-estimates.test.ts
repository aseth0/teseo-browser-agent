import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { corrected, estimateTokens, IMAGE_TOKENS, imageTokens } = await import('../src/context/budget');
const { imageSize } = await import('../src/core/image');
const { learnFromCall, learnTokenRatio, nextRatio, tokenRatioOf } = await import('../src/context/token-ratio');
const { compactionOf, compactionStep } = await import('../src/context/compaction');
type Message = import('../src/core/types').Message;

// Tokens estimated by script and images by size, then corrected per model from what its server reports.
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const png = (w: number, h: number) => b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, w >>> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >>> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255]);
// SOI, an APP0 segment, then SOF0 with the size.
const jpeg = (w: number, h: number) => b64([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0]);

describe('token estimates', () => {
  it('go by script: 4 characters a token in Latin text, 1 a character in CJK, 2 in the other scripts', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('é'.repeat(400))).toBe(100); // accented Latin as Latin
    expect(estimateTokens('漢'.repeat(100))).toBe(100);
    expect(estimateTokens('ひらがな한국어')).toBe(7);
    expect(estimateTokens('я'.repeat(100))).toBe(50);
    expect(estimateTokens(`${'a'.repeat(40)}${'漢'.repeat(10)}${'я'.repeat(10)}`)).toBe(25);
  });

  it('count an image by its size, read from its PNG or JPEG header', () => {
    expect(imageSize(png(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(imageSize(jpeg(400, 300))).toEqual({ width: 400, height: 300 });
    expect(imageSize('not an image')).toBeUndefined();
    expect(imageTokens({ mediaType: 'image/jpeg', data: jpeg(400, 300) })).toBe(160);
    expect(imageTokens({ mediaType: 'image/png', data: png(4000, 3000) })).toBe(1600); // at most
    expect(imageTokens({ mediaType: 'image/png', data: png(10, 10) })).toBe(85); // at least
    expect(imageTokens({ mediaType: 'image/png', data: 'AAAA' })).toBe(IMAGE_TOKENS);
  });
});

describe('the correction per model', () => {
  it('starts at a call\'s ratio, then moves toward each new one, within ×0.5–×2.5', () => {
    expect(nextRatio(undefined, 1500, 1000)).toBe(1.5);
    expect(nextRatio(1.5, 1000, 1000)).toBeCloseTo(1.35);
    expect(nextRatio(undefined, 9000, 1000)).toBe(2.5);
    expect(nextRatio(1.2, 50, 100)).toBe(1.2); // too small a request to tell
    expect(corrected(1000, 1.35)).toBe(1350);
    expect(corrected(1000, undefined)).toBe(1000);
  });

  it('is kept by model', async () => {
    await learnTokenRatio('p', 'm', 2000, 1000);
    await learnTokenRatio('p', 'other', 1000, 1000);
    expect(await tokenRatioOf('p', 'm')).toBe(2);
    expect(await tokenRatioOf('p', 'other')).toBe(1);
    expect(await tokenRatioOf('q', 'm')).toBeUndefined();
  });

  it('is learned from the text of a request, not its images', async () => {
    const call = (text: number, images: number, reported: number) => ({
      breakdown: { system: 0, tools: 0, conversation: text, pageContext: 0, skills: 0, toolResults: images },
      estimatedOutput: 0,
      estimatedImages: images,
      reported: { input: reported, output: 0 },
    });
    // 10,000 tokens of text the server counts as 12,000, and a screenshot estimated at 900 that it counts as 258.
    await learnFromCall('p', 'shots', call(10000, 900, 12000 + 258));
    expect(await tokenRatioOf('p', 'shots')).toBeCloseTo((12258 - 900) / 10000); // not 12258 / 10900
    // A request mostly images: the ratio does not move, whatever the server counts.
    await learnFromCall('p', 'shots', call(1000, 3 * 1500, 1000 + 3 * 258));
    expect(await tokenRatioOf('p', 'shots')).toBeCloseTo((12258 - 900) / 10000);
  });

  it('weighs what compaction counts on as the server would', () => {
    // A page block in each turn: something compaction trims (a step that saves nothing is none).
    const turn = (n: number): Message[] => [{ role: 'user', parts: [{ type: 'text', context: 'page', text: 'p'.repeat(4000) }, { type: 'text', text: `ask ${n} ${'x'.repeat(4000)}` }] }, { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }];
    const history = [1, 2, 3, 4, 5, 6].flatMap(turn);
    const cfg = compactionOf({ summarize: false });
    const plain = compactionStep(history, cfg, { used: 8000, window: 100000, canSummarize: false, auto: true })!;
    const twice = compactionStep(history, cfg, { used: 8000, window: 100000, canSummarize: false, auto: true, ratio: 2 })!;
    expect(twice.before).toBe(plain.before * 2);
  });
});
