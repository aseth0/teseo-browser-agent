import { describe, expect, it } from 'vitest';
import { text } from '../src/core/model-texts';

describe('the DevTools tools texts', () => {
  it('fill their placeholders', () => {
    expect(text('error.devtools_covered', { other: 'button "OK"' })).toBe('The element is covered by button "OK" at its center: not clicked');
    expect(text('error.devtools_detached', { reason: 'canceled_by_user' })).toBe('The debugger was detached (canceled_by_user): try again');
    expect(text('result.devtools_masked', { count: '2' })).toBe('2 sensitive fields were masked');
  });

  it('have the approved wording', () => {
    expect(text('error.devtools_no_box')).toBe('The element has no visible box (hidden or zero-size)');
    expect(text('error.devtools_in_frame')).toBe('The element is inside a frame, which real input cannot reach yet');
    expect(text('error.devtools_busy')).toBe('Another debugger is attached to this tab (DevTools open?): close it and try again');
  });
});

describe('the DevTools engine texts', () => {
  it('names the new actions', async () => {
    const { actionNote } = await import('../src/core/model-texts');
    expect(actionNote({ kind: 'hover' })).toBe('hovered');
    expect(actionNote({ kind: 'drag' })).toBe('dragged');
  });

  it('says which keys real input can press', () => {
    expect(text('error.devtools_key', { keys: 'Enter, Tab' })).toBe('This key cannot be pressed with real input: use one of Enter, Tab, or a single character');
  });
});

describe('the network-busy notice', () => {
  it('is a text of its own', () => expect(text('result.network_busy', { seconds: '15' })).toBe('The network was still busy after 15 s.'));
});
