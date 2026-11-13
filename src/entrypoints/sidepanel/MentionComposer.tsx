// The message box, with mentions: typing "::" at the start of a word suggests the enabled site
// templates, then (after "/") their views; "/" the skills, "$" the tools, "#" the saved conversations, and "b::" the bookmarks. ↑ ↓ move, Enter or Tab
// complete, Esc closes; while the list is open Enter completes instead of sending. Ctrl/⌘+Enter
// sends at once (onSendNow: while the agent works, it stops it; Enter queues). Below the box,
// the mentions in the text as chips. Otherwise ↑ on the first line brings back your previous
// messages (↓ goes forward, back to what you were writing). The box grows with its text up to a
// share of the window, then scrolls; its top edge, dragged, sets its height instead (BoxGrip).
import { memo, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { BoxGrip } from './BoxGrip';
import type { ToolInfo } from '../../core/protocol';
import { useBookmarks } from '../../ui/useBookmarks';
import { useConversations } from '../../ui/useConversations';
import type { Mentions } from '../../storage/settings-types';
import { useTemplates } from '../../ui/templates/useTemplates';
import { useSkills } from '../../ui/Skills';
import { isEnter } from '../../ui/enter';
import { MentionChips } from './composer/MentionChips';
import { LIST_LABELS, suggestionsFor, typingAt, type Suggestion } from './composer/suggestions';
import { useMentionChips } from './composer/useMentionChips';
import { useRecallKeys } from './composer/useRecallKeys';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendNow?: () => void; // Ctrl/⌘+Enter; none: as Enter
  placeholder: string;
  prompts?: string[]; // your messages in the conversation, oldest first
  recall?: Recall; // the one shown in the box, or none
  onRecall?: (recall: Recall | undefined) => void;
  tools?: ToolInfo[]; // what $ suggests
  disabledTools?: string[];
  mentions?: Mentions; // which kinds are on (Settings → Auto-inject → Mentions)
  conversationId?: string; // the current one, not offered with #
  bookmarksRoot?: string; // the folder b:: offers (Settings → Bookmarks); none: every bookmark
  ref?: Ref<ComposerHandle>;
}

// The message ↑ ↓ brought back (its index in `prompts`), and what was being written before.
export interface Recall {
  index: number;
  draft: string;
}

// What the chat can do with the box: focus it, the caret at the end (after inserting a mention); its
// text and caret as shown, and the caret put where `at` says once the next text is in (dictation).
export interface ComposerHandle {
  focusEnd(): void;
  selection(): { value: string; at: number } | undefined;
  caretAfterRender(at: () => number): void;
}

const NO_TOOLS: ToolInfo[] = [];

// Memoized: the chat re-renders for much else than the box (a message arrives, a card, the page).
export const MentionComposer = memo(function MentionComposer(props: Props) {
  const templates = useTemplates();
  const skills = useSkills();
  const tools = props.tools ?? NO_TOOLS;
  const allConversations = useConversations();
  const conversations = useMemo(() => allConversations.filter((c) => c.id !== props.conversationId), [allConversations, props.conversationId]);
  const { mentions: kinds } = props;
  const on = useMemo(
    () => ({ template: kinds?.templates ?? true, skill: kinds?.skills ?? true, tool: kinds?.tools ?? true, history: kinds?.history ?? true, bookmark: kinds?.bookmarks ?? true }),
    [kinds],
  );
  const bookmarks = useBookmarks(on.bookmark, props.bookmarksRoot);
  const box = useRef<HTMLTextAreaElement>(null);
  // Dictated text: where the caret goes, asked once its text is in the box (it may change before it renders).
  const caretAfter = useRef<() => number>(undefined);
  const [height, setHeight] = useState<number>(); // dragged; else it grows with its text
  useImperativeHandle(props.ref, () => ({
    focusEnd: () => {
      const el = box.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    },
    selection: () => (box.current ? { value: box.current.value, at: box.current.selectionStart } : undefined),
    caretAfterRender: (at) => {
      caretAfter.current = at;
    },
  }));
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;
  // Where to put the caret once the new text is in the box: before the next key is typed.
  const caretTo = useRef<number>(undefined);
  useLayoutEffect(() => {
    if (caretTo.current === undefined) return;
    box.current?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = undefined;
  });
  const [caret, setCaret] = useState(0);
  useLayoutEffect(() => {
    const at = caretAfter.current?.();
    if (at === undefined) return;
    caretAfter.current = undefined;
    box.current?.setSelectionRange(at, at);
  });
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false); // Esc: until the next edit
  const recall = props.recall;
  const prompts = props.prompts ?? [];

  const typing = typingAt(props.value.slice(0, caret), on);
  // Nothing to suggest for a mention already written in full (Enter then sends).
  const suggestions = closed ? [] : suggestionsFor(typing, { templates, skills, tools, disabled: props.disabledTools ?? [], conversations, bookmarks }).filter((sg) => sg.insert.trim() !== typing?.mention);
  const open = suggestions.length > 0;
  const selected = Math.min(index, suggestions.length - 1);
  // The mentions in the text, as chips.
  const chips = useMentionChips(props.value, on, { templates, skills, tools, conversations, bookmarks });

  const track = () => setCaret(box.current?.selectionStart ?? 0);
  const { leaveRecall, onRecallKey } = useRecallKeys({ prompts, recall, onRecall: props.onRecall, onChange: props.onChange, caretTo });
  const send = (now = false) => {
    leaveRecall();
    (now && props.onSendNow ? props.onSendNow : props.onSend)();
  };
  const accept = (s: Suggestion) => {
    if (!typing) return;
    const start = caret - typing.mention.length;
    const next = props.value.slice(0, start) + s.insert + props.value.slice(caret);
    const at = start + s.insert.length;
    props.onChange(next);
    setIndex(0);
    setCaret(at);
    caretTo.current = at;
  };

  return (
    <div className="mention-composer">
      {open && typing && (
        <ul id={listId} className="mention-list" role="listbox" aria-label={LIST_LABELS[typing.kind]}>
          {suggestions.map((s, i) => (
            <li key={`${i}:${s.label}`} id={optionId(i)} role="option" aria-selected={i === selected} onMouseDown={(e) => { e.preventDefault(); accept(s); }}>
              <strong>{s.label}</strong> <span className="muted">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <BoxGrip box={box} onHeight={setHeight} />
      <textarea
        ref={box}
        className={height === undefined ? undefined : 'sized'}
        style={height === undefined ? undefined : { height }}
        // The suggestions, for screen readers: open or not, and the one ↑ ↓ are on.
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(selected) : undefined}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => {
          props.onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setClosed(false);
          setIndex(0);
          leaveRecall(); // edited: it is your text now
        }}
        onSelect={track}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const by = e.key === 'ArrowDown' ? 1 : -1;
              return setIndex((selected + by + suggestions.length) % suggestions.length);
            }
            if (isEnter(e) || e.key === 'Tab') {
              e.preventDefault();
              return accept(suggestions[selected]!);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              return setClosed(true);
            }
          }
          if (isEnter(e) && !e.shiftKey) {
            e.preventDefault();
            return send(e.ctrlKey || e.metaKey);
          }
          onRecallKey(e);
        }}
      />
      <MentionChips chips={chips} forceTool={props.mentions?.forceTool} disabledTools={props.disabledTools} />
    </div>
  );
});
