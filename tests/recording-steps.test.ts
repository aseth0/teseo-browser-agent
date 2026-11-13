// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchSteps } from '../src/content/steps';
import type { RecordedStep } from '../src/recording/step-types';

let steps: Omit<RecordedStep, 'tabId'>[] = [];
let stop: () => void;
const $ = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  vi.useFakeTimers();
  steps = [];
  document.body.innerHTML = '<button id="pay">Pay</button><label for="q">Search</label><input id="q" type="search"><input id="pw" type="password" aria-label="Password"><input id="k" name="api_key" aria-label="Key">';
  stop = watchSteps(document, (s) => steps.push(s), () => true);
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

const typeInto = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('watchSteps', () => {
  it("records a click with the element's description", () => {
    $('pay').click();
    expect(steps).toEqual([{ at: expect.any(Number), kind: 'click', target: 'button "Pay"' }]);
  });

  it('records typing once the field rests', () => {
    typeInto($('q') as HTMLInputElement, 'la');
    typeInto($('q') as HTMLInputElement, 'lamp');
    expect(steps).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(steps).toEqual([{ at: expect.any(Number), kind: 'type', target: expect.stringContaining('Search'), text: 'lamp' }]);
  });

  it('never keeps what is typed in a password field', () => {
    typeInto($('pw') as HTMLInputElement, 'hunter2');
    vi.advanceTimersByTime(600);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.text).toBeUndefined();
    expect(JSON.stringify(steps)).not.toContain('hunter2');
  });

  it('nor in a field named like a secret', () => {
    typeInto($('k') as HTMLInputElement, 'abc123');
    vi.advanceTimersByTime(600);
    expect(JSON.stringify(steps)).not.toContain('abc123');
  });

  it('ignores untrusted events', () => {
    stop();
    stop = watchSteps(document, (s) => steps.push(s), (e) => e.isTrusted);
    $('pay').click(); // synthetic in jsdom: isTrusted false
    expect(steps).toEqual([]);
  });

  it('stops listening', () => {
    stop();
    $('pay').click();
    expect(steps).toEqual([]);
    stop = () => undefined;
  });
});

describe('typed text that looks sensitive', () => {
  it('a card number typed in a field not marked as one is not kept', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="cn" name="cardnumber">');
    typeInto($('cn') as HTMLInputElement, '4111 1111 1111 1111');
    vi.advanceTimersByTime(600);
    expect(JSON.stringify(steps)).not.toContain('4111');
  });

  it('nor a code field', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="otp" name="otp">');
    typeInto($('otp') as HTMLInputElement, '123456');
    vi.advanceTimersByTime(600);
    expect(JSON.stringify(steps)).not.toContain('123456');
  });
});

describe('a password field shown as text', () => {
  it('keeps no text once it was a password field', () => {
    const pw = $('pw') as HTMLInputElement;
    typeInto(pw, 'hunt');
    pw.type = 'text'; // "show password"
    typeInto(pw, 'hunter2');
    vi.advanceTimersByTime(600);
    expect(JSON.stringify(steps)).not.toContain('hunter2');
  });
});
