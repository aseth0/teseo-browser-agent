// The page side of a tabs-and-mouse recording (recording/devtools): the user's clicks and typing, as
// the elements' descriptions and the text typed. Only events the user made (trusted); never the text of
// a password, card, one-time-code or secret-named field.
import { namedLike, SECRET_FIELDS, SECRET_KEY } from '../recording/recording';
import type { RecordedStep } from '../recording/step-types';
import { describeElement } from './a11y-names';
import { reasonOf } from '../recording/sensitive';

const TYPING_REST_MS = 500;

// Fields whose name says card or code, besides the secret-named ones.
const CARD_OR_CODE = /card|cvv|cvc|pin\b|otp|code/i;
// Its text is kept unless the field, or the text itself, looks sensitive (a card number, a token).
const keepsText = (el: Element, value: string) => {
  if (el.matches(SECRET_FIELDS) || namedLike(el, SECRET_KEY) || namedLike(el, CARD_OR_CODE)) return false;
  const kind = reasonOf(el.getAttribute('name') ?? '', value);
  return kind !== 'card' && kind !== 'token' && kind !== 'secret-key';
};

const valueOf = (el: Element) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? ''));

export function watchSteps(doc: Document, report: (step: Omit<RecordedStep, 'tabId'>) => void, trusted: (e: Event) => boolean = (e) => e.isTrusted): () => void {
  const typing = new Map<Element, ReturnType<typeof setTimeout>>();
  // A field that was a password field once ("show password" makes it text): its text is never kept.
  const once = new WeakSet<Element>();
  const typed = (el: Element) => {
    typing.delete(el);
    const value = valueOf(el);
    report({ at: Date.now(), kind: 'type', target: describeElement(el), ...(!once.has(el) && keepsText(el, value) && { text: value }) });
  };
  const onClick = (e: Event) => {
    if (!trusted(e) || !(e.target instanceof Element)) return;
    report({ at: Date.now(), kind: 'click', target: describeElement(e.target) });
  };
  const onInput = (e: Event) => {
    if (!trusted(e) || !(e.target instanceof Element)) return;
    const el = e.target;
    if (el.matches(SECRET_FIELDS)) once.add(el);
    clearTimeout(typing.get(el));
    typing.set(el, setTimeout(() => typed(el), TYPING_REST_MS));
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('input', onInput, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('input', onInput, true);
    for (const t of typing.values()) clearTimeout(t);
    typing.clear();
  };
}
