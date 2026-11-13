// What the user tools (tools/user) show in the chat: the questions of user.ask, the card of
// user.pick_element while the user picks on the page, and the plan of user.plan pinned above the
// message box; and the card of a page web.read finds asking to sign in.
import { Icon } from '../../ui/chat-icons';
import { useId, useState } from 'react';
import { browser } from 'wxt/browser';
import { errorText } from '../../core/errors';
import { hostOf } from '../../core/util';
import type { AskQuestion, UserReply, UserRequest } from '../../core/types';
import type { PlanStep } from '../../tools/user/shapes';

export function UserCard({ request, onReply }: { request: UserRequest; onReply: (reply: UserReply) => void }) {
  if (request.kind === 'ask') return <AskCard questions={request.questions} onReply={onReply} />;
  if (request.kind === 'sign-in') return <SignInCard url={request.url} tabId={request.tabId} onReply={onReply} />;
  return <PickCard prompt={request.prompt} onCancel={() => onReply({ dismissed: true })} />;
}

// A page the model reads asks to sign in: its tab stays open (in the background, in the agent's tab
// group) for the user to sign in there; then it is read, or left.
function SignInCard({ url, tabId, onReply }: { url: string; tabId: number; onReply: (reply: UserReply) => void }) {
  const [note, setNote] = useState('');
  const show = async () => {
    try {
      const tab = await browser.tabs.update(tabId, { active: true });
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
      if (tab?.groupId !== undefined && tab.groupId >= 0) await browser.tabGroups.update(tab.groupId, { collapsed: false }).catch(() => undefined);
    } catch (e) {
      // Closed meanwhile, as a rule; anything else as the browser says it.
      const open = await browser.tabs.get(tabId).catch(() => undefined);
      setNote(open ? errorText(e) : 'Its tab is closed.');
    }
  };
  return (
    <div className="confirm" role="alertdialog" aria-label="Sign in">
      <div className="confirm-title"><Icon name="key" /> {hostOf(url) || url} asks you to sign in</div>
      <div className="confirm-summary">The model is reading <code>{url}</code>. Its tab stays open: sign in there, then read it.</div>
      {note && <div className="muted small">{note}</div>}
      <div className="row">
        <button onClick={() => void show()}>Show the tab</button>
        <button className="primary" onClick={() => onReply({ answers: [['signed in']] })}>Done, read it</button>
        <button onClick={() => onReply({ dismissed: true })}>Skip</button>
      </div>
    </div>
  );
}

const OTHER = '\u0000other'; // the "Other…" option, whose answer is what is written next to it

function AskCard({ questions, onReply }: { questions: AskQuestion[]; onReply: (reply: UserReply) => void }) {
  const [chosen, setChosen] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));
  const set = <T,>(list: T[], i: number, value: T) => list.map((x, j) => (j === i ? value : x));
  const answers = questions.map((q, i) =>
    q.type === 'text' ? [other[i]!.trim()].filter(Boolean) : chosen[i]!.map((c) => (c === OTHER ? other[i]!.trim() : c)).filter(Boolean),
  );
  const toggle = (i: number, label: string, multi: boolean) =>
    setChosen((c) => set(c, i, multi ? (c[i]!.includes(label) ? c[i]!.filter((x) => x !== label) : [...c[i]!, label]) : [label]));
  // Writing next to "Other…" picks it (going there with Tab does not: it would undo a pick).
  const pickOther = (i: number, multi: boolean) => setChosen((c) => (c[i]!.includes(OTHER) ? c : set(c, i, multi ? [...c[i]!, OTHER] : [OTHER])));
  // The radios of each question their own group, apart from another card's.
  const group = useId();
  return (
    <div className="confirm user-ask" role="alertdialog" aria-label="Questions from the model">
      <div className="confirm-title">The model asks</div>
      {questions.map((q, i) => (
        <fieldset key={i} className="user-question">
          <legend>
            {q.header && <span className="badge">{q.header}</span>} {q.question}
          </legend>
          {q.type === 'text' ? (
            <textarea rows={2} value={other[i]} placeholder={q.placeholder} aria-label={q.question} onChange={(e) => setOther((o) => set(o, i, e.target.value))} />
          ) : (
            <>
              {(q.options ?? []).map((o) => (
                <label key={o.label} className="user-option">
                  <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={`${group}-q${i}`} checked={chosen[i]!.includes(o.label)} onChange={() => toggle(i, o.label, q.type === 'multi')} />
                  <span>
                    {o.label}
                    {o.description && <span className="muted"> — {o.description}</span>}
                  </span>
                </label>
              ))}
              <label className="user-option">
                <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={`${group}-q${i}`} checked={chosen[i]!.includes(OTHER)} onChange={() => toggle(i, OTHER, q.type === 'multi')} />
                <input className="user-other" value={other[i]} placeholder="Other…" aria-label={`${q.question} (other answer)`}
                  onChange={(e) => {
                    setOther((o) => set(o, i, e.target.value));
                    if (e.target.value.trim()) pickOther(i, q.type === 'multi');
                  }} />
              </label>
            </>
          )}
        </fieldset>
      ))}
      <div className="row">
        <button className="primary" disabled={answers.every((a) => !a.length)} onClick={() => onReply({ answers })}>Send answers</button>
        <button onClick={() => onReply({ dismissed: true })}>Skip</button>
      </div>
    </div>
  );
}

function PickCard({ prompt, onCancel }: { prompt: string; onCancel: () => void }) {
  return (
    <div className="confirm" role="alertdialog" aria-label="Pick an element">
      <div className="confirm-title"><Icon name="pick" /> Click an element on the page</div>
      {prompt && <div className="confirm-summary">{prompt}</div>}
      <div className="muted small">Esc on the page, or Cancel here, to give up.</div>
      <div className="row">
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const STEP_ICONS = { pending: 'pending', in_progress: 'doing', done: 'done' } as const;

// Pinned above the message box (shapes planShown): open while the plan is under way, gone once it is done and the
// turn has ended; its close button takes it away (the model showing a plan again brings it back).
export function PlanView({ steps, onDismiss }: { steps: PlanStep[]; onDismiss: () => void }) {
  const done = steps.filter((s) => s.status === 'done').length;
  return (
    <details className="plan" open={done < steps.length || undefined}>
      <summary>
        <Icon name="plan" /> Plan · {done}/{steps.length} done
        <span className="spacer" />
        <button className="icon-button plan-close" title="Remove the plan from here (it stays in the conversation)" aria-label="Remove the plan"
          onClick={(e) => (e.preventDefault(), onDismiss())}><Icon name="close" /></button>
      </summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i} className={`plan-step ${s.status}`}>
            <span className="plan-icon" aria-label={s.status.replace('_', ' ')}><Icon name={STEP_ICONS[s.status]} size={12} /></span> {s.title}
          </li>
        ))}
      </ol>
    </details>
  );
}
