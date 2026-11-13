// A fixed text sent to the model: read-only (TemplateView) or editable (EditableText), with a
// tag saying when it is sent. Shared by Settings → Prompt preview and Settings → Tools.
import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import type { LimitId } from '../core/limits';
import { placeholdersOf, stripMarks, TEXT_DEFS, type TextDef, type TextId } from '../core/model-texts';
import type { Settings } from '../storage/settings';
import { InlineConfirm } from './InlineConfirm';
import { LimitMark } from './LimitMark';
import { textColor } from './text-pages';
import { CopyIconButton } from './icons';
import { BlockText, MarkdownView, useSectionMarkdown } from './PromptSection';
import { textSentWhen, ToModel } from './ToModel';
import type { SettingsPatch } from './useSettings';
import { MarkdownToggle } from './MarkdownToggle';
import { useSettingsContext } from './settings-context';
import { withKey } from './edits';

// Overrides of the fixed texts, saved in the settings.
export function textOverrides(settings: Settings, onChange: SettingsPatch) {
  const overrides = settings.promptTexts ?? {};
  const setOverride = (key: string, value: string | undefined) => onChange({ promptTexts: withKey(overrides, key, value) });
  return { overrides, setOverride };
}

interface TextProps {
  label: ReactNode;
  defaultText: string;
  value?: string; // the override, if any
  when?: string | null; // condition; undefined = always; null = no tag
  note?: string;
  limit?: LimitId; // the size limit on what it carries
  action?: ReactNode; // e.g. a link to where it is edited
  color?: string; // a bar in the margin, the color of the part it belongs to (as in "As sent")
}

// Which texts a list shows by when they are sent (Prompt preview → Templates): all, those always
// sent, or those sent only under a condition. Texts without a tag (null) show only under "all".
export type WhenFilter = 'all' | 'always' | 'only';
export const WhenFilterContext = createContext<WhenFilter>('all');
const passes = (filter: WhenFilter, when: string | null | undefined) =>
  filter === 'all' || (filter === 'always' ? when === undefined : typeof when === 'string');

// "Only when" for conditional texts, the condition on pointing at it; "Always" for the rest.
export function WhenTag({ when }: { when?: string | null }) {
  if (when === null) return null;
  return when ? (
    <span className="when-tag" title={`Sent only when ${when}`}>⏱ Only when</span>
  ) : (
    <span className="when-tag always" title="Sent in every request where this part applies">Always</span>
  );
}

function Head(props: TextProps & { children?: ReactNode }) {
  return (
    <div className="text-block-head">
      <strong>{props.label}</strong>
      <ToModel when={textSentWhen(props.when)} />
      {props.limit && <LimitMark id={props.limit} />}
      {props.value !== undefined && <span className="badge accent">modified</span>}
      <WhenTag when={props.when} />
      <span className="spacer" />
      {props.action}
      {props.children}
    </div>
  );
}

// Under the head: how the text is shown.
const Actions = ({ children }: { children: ReactNode }) => <div className="text-block-actions">{children}</div>;

// How a block shows its text: rendered as Markdown, or as written (tags and placeholders in color).
// Until chosen, as its section says (Markdown outside one).
type BlockMode = 'markdown' | 'text';

function useBlockMode(text: string) {
  const section = useSectionMarkdown() ? 'markdown' : 'text';
  const [chosen, setMode] = useState<BlockMode>();
  const mode = chosen ?? section;
  const buttons = (
    <span className="icon-toolbar block-views" role="toolbar" aria-label="Show this text as">
      <MarkdownToggle on={mode === 'markdown'} onChange={(on) => setMode(on ? 'markdown' : 'text')} marks />
      <CopyIconButton text={stripMarks(text)} label="Copy to clipboard" />
    </span>
  );
  const body = <MarkdownView on={mode === 'markdown'}><BlockText text={text} /></MarkdownView>;
  return { buttons, body };
}

export function TemplateView(props: TextProps) {
  const { buttons, body } = useBlockMode(props.value ?? props.defaultText);
  if (!passes(useContext(WhenFilterContext), props.when)) return null;
  return (
    <div className={props.color ? 'text-block colored' : 'text-block'} style={props.color ? ({ '--part': props.color } as CSSProperties) : undefined}>
      <Head {...props} />
      <Actions>{buttons}</Actions>
      {props.note && <p className="hint block-note">{props.note}</p>}
      {body}
    </div>
  );
}

export function EditableText(props: TextProps & { warning?: string; onSave: (v: string | undefined) => void }) {
  const current = props.value ?? props.defaultText;
  const [draft, setDraft] = useState<string | null>(null);
  const required = placeholdersOf(props.defaultText);
  const problems = draft === null ? [] : [
    ...required.filter((p) => !draft.includes(`{${p}}`)).map((p) => `Missing {${p}}: it carries data the model needs.`),
    ...(!draft.trim() && props.defaultText.trim() ? ['The text is empty.'] : []),
  ];
  const unknown = draft === null ? [] : placeholdersOf(draft).filter((p) => !required.includes(p));
  const { buttons, body } = useBlockMode(current);
  const filter = useContext(WhenFilterContext);
  if (!passes(filter, props.when)) return null;

  return (
    <div className={props.color ? 'text-block colored' : 'text-block'} style={props.color ? ({ '--part': props.color } as CSSProperties) : undefined}>
      <Head {...props}>
        {draft === null && <button onClick={() => setDraft(current)}>Edit</button>}
        {draft === null && props.value !== undefined && (
          <InlineConfirm question="Discard your edit?" action="Restore default" label="Confirm: restore the default text" onConfirm={() => props.onSave(undefined)}>
            {(ask) => <button onClick={ask}>Restore default</button>}
          </InlineConfirm>
        )}
      </Head>
      {draft === null && <Actions>{buttons}</Actions>}
      {props.note && <p className="hint block-note">{props.note}</p>}
      {draft === null ? (
        body
      ) : (
        <div className="prompt-edit">
          {props.warning && <p className="warning">⚠ {props.warning}</p>}
          <textarea className="mono" rows={Math.min(16, draft.split('\n').length + 1)} value={draft} onChange={(e) => setDraft(e.target.value)} />
          {required.length > 0 && <p className="hint">Placeholders: {required.map((p) => `{${p}}`).join(' ')}</p>}
          {problems.length > 0 && <ul className="problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {unknown.length > 0 && <p className="hint">Unknown placeholders are sent as written: {unknown.map((p) => `{${p}}`).join(' ')}</p>}
          <div className="row">
            <button
              className="primary"
              disabled={problems.length > 0}
              onClick={() => {
                props.onSave(draft === props.defaultText ? undefined : draft);
                setDraft(null);
              }}
            >
              Save
            </button>
            <button onClick={() => setDraft(null)}>Cancel</button>
            {draft !== props.defaultText && <button onClick={() => setDraft(props.defaultText)}>Default text</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// One of the fixed model texts (core/model-texts), editable where it belongs.
export function ModelTextEditor({ id, action }: { id: TextId; action?: ReactNode }) {
  const { settings, update } = useSettingsContext();
  const { overrides, setOverride } = textOverrides(settings, update);
  const def: TextDef = TEXT_DEFS[id];
  return (
    <EditableText label={def.label} when={def.when} limit={def.limit} note={def.note} warning={def.warning} defaultText={def.text}
      value={overrides[id]} onSave={(v) => setOverride(id, v)} action={action} color={textColor(id)} />
  );
}
