// Settings → Providers: each OpenAI-compatible provider, its key, headers and extra body, tested from here.
import { agentStore } from '../agents/profiles';
import { actionStore } from '../widget/store';
import { InlineConfirm } from './InlineConfirm';
import { useCollection } from './useCollection';
import { useEffect, useRef, useState } from 'react';
import { hostOf, isObject, plural } from '../core/util';
import { allowSite } from './ask-permission';
import { humanizeError, testConnection } from '../providers/connection-test';
import { headerValues } from '../providers/headers';
import { createProvider } from '../providers/registry';
import { THINKING_PARAMS, type ThinkingParam } from '../providers/thinking';
import type { ProviderConfig } from '../storage/settings';
import { ENV_PROVIDER_ID, envKeyInjected } from '../storage/settings-migrate';
import { PRESETS } from '../storage/settings-types';
import type { SectionProps as Props } from './useSettings';
import { DefaultModelField } from './DefaultModelField';
import { PickerModelsField } from './PickerModelsField';
import { useListedModels } from './useListedModels';
import { SectionHead, StatStrip } from './SectionParts';

// A context window typed: a whole number of tokens, at least 1 (a fraction is cut); else none.
const wholeTokens = (text: string) => {
  const n = Math.floor(Number(text));
  return n >= 1 ? n : undefined;
};

export function ProvidersSection({ settings, onChange }: Props) {
  const agents = useCollection(agentStore);
  const actions = useCollection(actionStore);
  // Asked first, saying what uses it: they would then go on a provider no longer there.
  const removeQuestion = (id: string) => {
    const agentsUsing = agents.filter((a) => a.providerId === id).length;
    const actionsUsing = actions.filter((a) => a.providerId === id).length;
    const chat = settings.activeProviderId === id;
    const others = [agentsUsing && plural(agentsUsing, 'agent'), actionsUsing && plural(actionsUsing, 'action')].filter(Boolean).join(' and ');
    if (chat) return `Remove? The chat uses it${others ? `, and ${others}` : ''}.`;
    if (others) return `Remove? ${others} ${agentsUsing + actionsUsing === 1 ? 'uses' : 'use'} it.`;
    return 'Remove?';
  };
  const [status, setStatus] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string>(); // the provider shown (none: the chat's)

  const setProviders = (providers: ProviderConfig[]) => onChange({ providers });

  const add = (presetName: string) => {
    const preset = PRESETS.find((p) => p.name === presetName);
    if (!preset) return;
    const cfg: ProviderConfig = { ...preset, id: crypto.randomUUID(), apiKey: '' };
    onChange({ providers: [...settings.providers, cfg], activeProviderId: settings.activeProviderId ?? cfg.id });
    setPicked(cfg.id);
  };

  const patch = (id: string, change: Partial<ProviderConfig>) =>
    setProviders(settings.providers.map((p) => (p.id === id ? { ...p, ...change } : p)));

  // Called from a click (user gesture), required by permissions.request.
  const test = async (cfg: ProviderConfig) => {
    setStatus((s) => ({ ...s, [cfg.id]: 'Testing…' }));
    try {
      if (!cfg.baseURL) throw new Error('Base URL is missing');
      await allowSite(cfg.baseURL);
      const result = await testConnection(createProvider(cfg), cfg.defaultModel);
      setStatus((s) => ({ ...s, [cfg.id]: result }));
    } catch (e) {
      setStatus((s) => ({ ...s, [cfg.id]: `Error: ${humanizeError(e, cfg.baseURL)}` }));
    } finally {
      // Asked again, now that its site may be allowed.
      if (cfg.id === p?.id) listed.refresh();
    }
  };

  const providers = settings.providers;
  const p = providers.find((x) => x.id === picked) ?? providers.find((x) => x.id === settings.activeProviderId) ?? providers[0];
  const active = providers.find((x) => x.id === settings.activeProviderId);
  const listed = useListedModels(p); // the models of the provider shown, for its fields
  const keyless = providers.filter((x) => !x.apiKey && !(x.id === ENV_PROVIDER_ID && envKeyInjected())).length;
  const failing = providers.filter((x) => status[x.id]?.startsWith('Error')).length;
  return (
    <section className="providers-settings">
      <SectionHead title="Providers" about={<>
        OpenAI-compatible servers (<code>/chat/completions</code>) the chat, agents and actions use: each with its key, headers and extra
        body, tested from here.
      </>} />
      <StatStrip stats={[
        { label: 'Providers', value: providers.length, sub: keyless ? `${keyless} without a key` : 'Each with its key' },
        { label: 'The chat uses', value: <span className="stat-text">{active?.name ?? 'None yet'}</span>, sub: active?.defaultModel || 'Chosen in the chat' },
        { label: 'Tested', value: <>{Object.keys(status).length - failing} <span className="stat-of">/ {providers.length} answered</span></>, sub: failing ? <span className="error-text">{failing} failed</span> : 'In this visit' },
      ]} />
      <div className="tools-layout providers-layout">
        <nav className="tool-groups" aria-label="Providers">
          {providers.map((x) => (
            <button key={x.id} type="button" className={`tool-group-item${x.id === p?.id ? ' on' : ''}`} aria-current={x.id === p?.id ? 'true' : undefined} onClick={() => setPicked(x.id)}>
              <span>{x.name || 'Unnamed provider'}</span>
              <span className="tool-group-count">{x.id === settings.activeProviderId ? 'chat' : ''}</span>
              <span className="provider-item-sub">{hostOf(x.baseURL) || 'not set up yet'}</span>
            </button>
          ))}
          <select aria-label="Add a provider" value="" onChange={(e) => add(e.target.value)}>
            <option value="">＋ Add provider…</option>
            {PRESETS.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </select>
        </nav>
        {p ? (
          // Made anew for each provider: its fields' drafts and model list are its own.
          <div key={p.id} className="tool-pane provider-pane">
            <div className="tool-pane-head">
              <input aria-label="Name" className="recording-name" value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} />
              {p.id === settings.activeProviderId && <span className="badge" title="The chat's provider">active</span>}
              <button className="primary" onClick={() => void test(p)} title="Lists the models, and asks for the site's permission the first time">Test connection</button>
              <InlineConfirm question={removeQuestion(p.id)} action="Remove" label={`Confirm: remove the provider ${p.name}`} onConfirm={() => { setPicked(undefined); setProviders(providers.filter((x) => x.id !== p.id)); }}>
                {(ask) => <button className="danger" onClick={ask}>Remove</button>}
              </InlineConfirm>
            </div>
            {status[p.id] && <p className={`provider-status${status[p.id]!.startsWith('Error') ? ' error-text' : ''}`} role="status">{status[p.id]}</p>}
            <ul className="switch-rows provider-rows" aria-label={`${p.name}: its settings`}>
              <li className="stack">
                <div><strong>Base URL</strong><span className="hint">Its address, up to /v1</span></div>
                <input aria-label="Base URL" className="mono" value={p.baseURL} placeholder="https://api.example.com/v1" onChange={(e) => patch(p.id, { baseURL: e.target.value })} />
              </li>
              <li className="stack">
                <div><strong>API key</strong><span className="hint">Kept only in this browser, where only the extension&apos;s own pages read it</span></div>
                {p.id === ENV_PROVIDER_ID && envKeyInjected() ? (
                  <input aria-label="API key" value="•••••• (EXTERNAL_MODEL_API_KEY, injected at build time)" disabled />
                ) : (
                  <input aria-label="API key" type="password" value={p.apiKey} onChange={(e) => patch(p.id, { apiKey: e.target.value })} />
                )}
              </li>
              <li className="stack">
                <div><strong>Default model</strong><span className="hint">Test connection lists its models</span></div>
                <DefaultModelField provider={p} listed={listed} onChange={(defaultModel) => patch(p.id, { defaultModel })} />
              </li>
              <li className="stack">
                <div><strong>Models in the picker</strong><span className="hint">Those ticked are the only ones the chat&apos;s model picker lists for it, besides its default (Show all lists the rest); none ticked, all of them</span></div>
                <PickerModelsField provider={p} listed={listed} onChange={(models) => patch(p.id, { models })} />
              </li>
              <li>
                <div><strong>Context window</strong><span className="hint">Tokens, for its models whose server does not say it (optional). One model&apos;s is set in the chat&apos;s context meter</span></div>
                <input aria-label="Context window, tokens" className="narrow-input" type="number" min={0} placeholder="128000" value={p.contextWindow ?? ''}
                  onChange={(e) => patch(p.id, { contextWindow: wholeTokens(e.target.value) })} />
              </li>
              <li>
                <div><strong>Thinking parameter</strong><span className="hint">How the chat&apos;s thinking level is sent</span></div>
                <select aria-label="Thinking parameter" value={p.thinkingParam ?? 'auto'} onChange={(e) => patch(p.id, { thinkingParam: e.target.value as ThinkingParam })}>
                  {THINKING_PARAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </li>
              <li className="stack">
                <JsonField label="Extra headers (JSON, optional)" about="{{apiKey}} is the key above" placeholder='{"api-key": "{{apiKey}}"}' value={p.extraHeaders}
                  onChange={(v) => patch(p.id, { extraHeaders: v && headerValues(v) })} />
              </li>
              <li className="stack">
                <JsonField label="Extra request body (JSON, optional)" about="Sent with every request: some servers need a flag here to send their reasoning" placeholder='{"temperature": 0.7, "max_tokens": 4096}'
                  value={p.extraBody} onChange={(v) => patch(p.id, { extraBody: v })} />
              </li>
            </ul>
          </div>
        ) : <p className="hint">No providers yet: <strong>＋ Add provider…</strong></p>}
      </div>
      <p className="hint">
        For Ollama, start it with <code>OLLAMA_ORIGINS=chrome-extension://*</code>. Reasoning from OpenAI-compatible servers is shown automatically when
        they send it.
      </p>
    </section>
  );
}

// JSON object field; only saved when the JSON is a valid object. While you are not typing in it, it
// shows the value as it is now (imported, or changed in another page).
function JsonField({
  label,
  about,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  about: string;
  placeholder: string;
  value?: Record<string, unknown>;
  onChange: (v?: Record<string, unknown>) => void;
}) {
  const shown = value && Object.keys(value).length ? JSON.stringify(value) : '';
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const typing = useRef(false);
  useEffect(() => {
    if (typing.current) return;
    setText(shown);
    setInvalid(false);
  }, [shown]);
  const update = (raw: string) => {
    setText(raw);
    if (!raw.trim()) {
      setInvalid(false);
      return onChange(undefined);
    }
    try {
      const parsed = JSON.parse(raw);
      if (!isObject(parsed)) throw new Error('not an object');
      onChange(parsed);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <>
      <div><strong>{label}</strong><span className="hint">{about}{invalid && <span className="error-text"> · invalid JSON object</span>}</span></div>
      <input aria-label={label} className="mono" value={text} placeholder={placeholder} onChange={(e) => update(e.target.value)}
        onFocus={() => (typing.current = true)} onBlur={() => (typing.current = false)} />
    </>
  );
}
