// A settings page's texts that go to the model, folded at its top: the same blocks Prompt preview
// shows (editable, with the bar of the page's color), so a text is changed where its page is too.
// The ones a page already shows elsewhere (its mentions) are left out with `skip`.
import { textIds, type TextDef, type TextId } from '../core/model-texts';
import { ModelTextEditor } from './EditableText';
import { pageOf } from './text-pages';
import { ToModel } from './ToModel';

export function PageModelTexts({ page, skip = [] }: { page: string; skip?: TextId[] }) {
  const ids = textIds((d: TextDef) => !d.tool).filter((id) => pageOf(id)?.hash === page && !skip.includes(id));
  return (
    <ModelTextsFold ids={ids} when="the texts of this page, each when its tag says"
      hint="What reaches the model from this page, as in Prompt preview. Edit them here or there: they are the same texts." />
  );
}

// The fold itself, for any list of texts: `when` goes on its mark, `id` and `open` for a link to it.
export function ModelTextsFold({ ids, when, hint, id, open }: { ids: readonly TextId[]; when: string; hint: string; id?: string; open?: boolean }) {
  if (!ids.length) return null;
  return (
    <details id={id} className="settings-fold model-texts-fold" open={open}>
      <summary>Sent to the model <ToModel when={when} /> <span className="muted">{ids.length} {ids.length === 1 ? 'text' : 'texts'}</span></summary>
      <p className="hint">{hint}</p>
      {ids.map((textId) => <ModelTextEditor key={textId} id={textId} />)}
    </details>
  );
}
