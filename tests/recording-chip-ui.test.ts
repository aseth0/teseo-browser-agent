// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Recording } from '../src/recording/recording';
import { RecordingChip } from '../src/entrypoints/sidepanel/RecordingChip';
import { recordingPreview } from '../src/recording/block';
import { shortChars } from '../src/recording/review';

// The attached recording's chip: its calls, its site and its size as the model gets it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const r: Recording = {
  tabId: 1, site: 'shop.example.test', startedAt: 0, hidden: [],
  calls: [{ id: 'a', method: 'GET', url: 'https://shop.example.test/api/items', at: 1, included: true, status: 200, responseBody: '{"id":4242}' }],
};

describe('the recording chip', () => {
  it('says its calls, site and size', async () => {
    const root = document.createElement('div');
    await act(async () => createRoot(root).render(createElement(RecordingChip, { recording: r, onReview: () => undefined, onRemove: () => undefined })));
    expect(root.textContent).toContain(`Recording · 1 call · shop.example.test · ${shortChars(recordingPreview(r).size)} chars`);
  });
});
