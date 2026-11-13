/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Pieces of InjectedScript (packages/injected/src/injectedScript.ts) as plain functions: the hit-target
// check of expectHitTarget, and the input types and value checks of fill. See README.md for the changes.

import { enclosingShadowRootOrDocument, parentElementOrShadowHost } from './domUtils';

// What is at hitPoint (viewport CSS pixels), down through the shadow roots that lead to targetElement,
// and its composed ancestors up to targetElement: [] when the target or one of its descendants is hit.
// From expectHitTarget, which throws with a description of hitParents[0] instead.
export function hitTargetParents(hitPoint: { x: number, y: number }, targetElement: Element): Element[] {
  const roots: (Document | ShadowRoot)[] = [];

  // Get all component roots leading to the target element.
  // Go from the bottom to the top to make it work with closed shadow roots.
  let parentElement = targetElement;
  while (parentElement) {
    const root = enclosingShadowRootOrDocument(parentElement);
    if (!root)
      break;
    roots.push(root);
    if (root.nodeType === 9 /* Node.DOCUMENT_NODE */)
      break;
    parentElement = (root as ShadowRoot).host;
  }

  // Hit target in each component root should point to the next component root.
  // Hit target in the last component root should point to the target or its descendant.
  let hitElement: Element | undefined;
  for (let index = roots.length - 1; index >= 0; index--) {
    const root = roots[index]!;
    // All browsers have different behavior around elementFromPoint and elementsFromPoint.
    // https://github.com/w3c/csswg-drafts/issues/556
    // http://crbug.com/1188919
    const elements: Element[] = root.elementsFromPoint(hitPoint.x, hitPoint.y);
    const singleElement = root.elementFromPoint(hitPoint.x, hitPoint.y);
    if (singleElement && elements[0] && parentElementOrShadowHost(singleElement) === elements[0]) {
      const style = targetElement.ownerDocument.defaultView?.getComputedStyle(singleElement);
      if (style?.display === 'contents') {
        // Workaround a case where elementsFromPoint misses the inner-most element with display:contents.
        // https://bugs.chromium.org/p/chromium/issues/detail?id=1342092
        elements.unshift(singleElement);
      }
    }
    // Workaround webkit bug: elementsFromPoint() puts the outermost shadow host first (seen with <input>).
    // Drop elements[0] when elements[1] matches it and elements[0] is the host of this or any enclosing
    // root. Using `roots` makes it work for closed shadow roots.
    if (elements[0] && elements[1] === singleElement && roots.slice(index).some(r => (r as ShadowRoot).host === elements[0]))
      elements.shift();
    const innerElement = elements[0] as Element | undefined;
    if (!innerElement)
      break;
    hitElement = innerElement;
    if (index && innerElement !== (roots[index - 1] as ShadowRoot).host)
      break;
  }

  // Check whether hit target is the target or its descendant.
  const hitParents: Element[] = [];
  while (hitElement && hitElement !== targetElement) {
    hitParents.push(hitElement);
    // Prefer the composed tree over the light-dom tree, as browser performs hit testing on the composed tree.
    // Note that we will still eventually climb to the light-dom parent, as any element distributed to a slot is a direct child of the shadow host that contains the slot.
    hitElement = hitElement.assignedSlot ?? parentElementOrShadowHost(hitElement);
  }
  if (hitElement === targetElement)
    return [];
  return hitParents;
}

// From fill.
export const kInputTypesToSetValue = new Set(['color', 'date', 'time', 'datetime-local', 'month', 'range', 'week']);
export const kInputTypesToTypeInto = new Set(['', 'email', 'number', 'password', 'search', 'tel', 'text', 'url']);

// The value fill gives an <input> of a type it can fill, or why it cannot. From fill, returning the error
// in place of throwing it, without the focus and events (the caller's own).
export function inputFillValue(input: HTMLInputElement, value: string): { value: string } | { error: string } {
  const type = input.type.toLowerCase();
  if (!kInputTypesToTypeInto.has(type) && !kInputTypesToSetValue.has(type))
    return { error: `Input of type "${type}" cannot be filled` };
  if (type === 'number') {
    value = value.trim();
    if (isNaN(Number(value)))
      return { error: 'Cannot type text into input[type=number]' };
  }
  if (type === 'color')
    value = value.toLowerCase();
  if (kInputTypesToSetValue.has(type))
    value = value.trim();
  return { value };
}
