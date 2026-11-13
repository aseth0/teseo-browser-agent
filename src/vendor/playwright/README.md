# Playwright's accessibility utilities (vendored)

Taken from [Playwright](https://github.com/microsoft/playwright) **v1.64.1**, Apache License 2.0
([LICENSE](LICENSE), [NOTICE](NOTICE)), Copyright (c) Microsoft Corporation. Playwright does not
publish these as a package. `content/a11y-names` uses them for the roles, accessible names,
hidden-ness and disabled-ness the page snapshot shows; `content/actions` uses `actionUtils.ts` for what is on top
of an element it clicks and for the values it types into inputs.

| File | Upstream | Changes |
|---|---|---|
| `roleUtils.ts` | `packages/injected/src/roleUtils.ts` | `// @ts-nocheck` line; import paths; `getElementContentText` added at the end |
| `domUtils.ts` | `packages/injected/src/domUtils.ts` | none |
| `cssTokenizer.ts` | `packages/isomorphic/cssTokenizer.ts` | `// @ts-nocheck` line (written for other compiler options) |
| `actionUtils.ts` | `packages/injected/src/injectedScript.ts` | `expectHitTarget` as `hitTargetParents` (returns the hit element's chain, `[]` when the target is hit, instead of throwing; `this.window` → the target's window); `fill`'s input-type sets, and its value checks as `inputFillValue` (returns the error, no focus or events) |
| `ariaRole.ts` | `packages/isomorphic/ariaSnapshot.ts` | only the `AriaRole` type |

To update: copy the files of the new tag over these, redo the changes above, and run the tests.
