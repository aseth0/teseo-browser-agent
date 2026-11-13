import { useState } from 'react';
import { errorText } from '../../core/errors';
import type { ToolInfo } from '../../core/protocol';
import { originPattern } from '../../page/permissions';
import { SCRIPT_BASE } from '../../tools/custom/script-tool';
import { baseParams } from '../../tools/custom/runtime';
import { customIssues, type Issue } from '../../tools/custom/validate';
import type { CustomInput, CustomTool, ParamRule } from '../../tools/custom/types';
import { customToolStore } from '../../tools/custom/store';
import { hasFixedHost, HTTP_BASE, type HttpRequest } from '../../tools/http';
import { askOrigins } from '../ask-permission';
import { parseValue } from './parse-value';
import { withKey } from '../edits';

export type Kind = 'tool' | 'http' | 'script';

// A custom tool while it is edited (ui/custom-tools/Editor): the draft, what it is and runs, its
// fixed values as typed, what is wrong with it, and saving it.
export function useCustomToolDraft(custom: CustomTool, customs: CustomTool[], catalog: ToolInfo[], onClose: () => void) {
  const [draft, setDraft] = useState(custom);
  // The fixed values as typed, and why one cannot be read as its parameter's type.
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(custom.params).flatMap(([n, r]) => (r.mode === 'fixed' ? [[n, typeof r.value === 'string' ? r.value : JSON.stringify(r.value)]] : []))),
  );
  const isNew = !customs.some((c) => c.id === custom.id);
  const patch = (change: Partial<CustomTool>) => setDraft((d) => ({ ...d, ...change }));
  const bases = catalog.filter((t) => t.source !== 'custom');
  // What it is: a tool you have, preset (some of its parameters fixed or wrapped), a request, or a
  // script; none yet for a new one until a kind is picked.
  const [picked, setPicked] = useState<Kind | undefined>();
  const kind: Kind | undefined = draft.base === HTTP_BASE ? 'http' : draft.base === SCRIPT_BASE ? 'script' : draft.base ? 'tool' : picked;
  const chooseBase = (value: string) => {
    if (value === HTTP_BASE) return patch({ base: HTTP_BASE, params: {}, inputs: draft.inputs ?? [], http: draft.http ?? { method: 'GET', url: '' }, script: undefined });
    // A script's site and access are kept as a request's (only its site, the origin).
    if (value === SCRIPT_BASE) {
      const site = hasFixedHost(draft.http?.url ?? '') ? new URL(draft.http!.url).origin : '';
      return patch({ base: SCRIPT_BASE, params: {}, inputs: draft.inputs ?? [], http: { ...draft.http, method: 'GET', url: site }, script: draft.script ?? '' });
    }
    const chosen = bases.find((t) => t.name === value);
    // A new one starts with the description of the tool it runs.
    patch({ base: value, params: {}, http: undefined, script: undefined, uses: undefined, description: draft.description || chosen?.description || '' });
  };
  const chooseKind = (k: Kind) => {
    setPicked(k);
    if (k !== kind) chooseBase(k === 'http' ? HTTP_BASE : k === 'script' ? SCRIPT_BASE : '');
  };
  // A request pasted or taken from an example: it replaces the one there was.
  const startRequest = (http: HttpRequest, inputs: CustomInput[] = []) => {
    setPicked('http');
    patch({ base: HTTP_BASE, params: {}, inputs, http, script: undefined, uses: undefined });
  };
  const base = bases.find((t) => t.name === draft.base);
  const params = base ? baseParams(base) : {};
  const setRule = (name: string, rule: ParamRule | undefined) => patch({ params: withKey(draft.params, name, rule) });

  const badValues = Object.entries(draft.params).flatMap(([name, rule]) => {
    if (rule.mode !== 'fixed') return [];
    try {
      parseValue(typed[name] ?? '', params[name]?.type);
      return [];
    } catch (e) {
      return [{ field: `param:${name}`, text: `"${name}": the fixed value must be ${errorText(e)}.` } satisfies Issue];
    }
  });
  // Each with the field it is about, to show it there.
  const issues: Issue[] = [...customIssues(draft, customs, catalog), ...badValues];
  const problems = issues.map((i) => i.text);

  const save = async () => {
    const fixedValues = Object.fromEntries(
      Object.entries(draft.params).map(([name, rule]) => [name, rule.mode === 'fixed' ? { mode: 'fixed', value: parseValue(typed[name] ?? '', params[name]?.type) } : rule]),
    ) as Record<string, ParamRule>;
    // A request: the API's site is asked for now, from this click (otherwise on its first call).
    // None for a script that only calls tools: it has no site.
    if (draft.http?.url.trim()) await askOrigins(originPattern(draft.http.url.trim()));
    await customToolStore.save({ ...draft, name: draft.name.trim(), description: draft.description.trim(), params: fixedValues });
    onClose();
  };
  return { draft, typed, setTyped, isNew, patch, bases, kind, chooseBase, chooseKind, startRequest, base, params, setRule, issues, problems, save };
}
