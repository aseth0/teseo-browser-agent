// Skills section of the options page: list, enable/disable, and an editor for user skills.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { skillStore } from '../skills/store';
import { isSiteSkill, newSkill, type Skill } from '../skills/types';
import { skillProblems } from '../skills/validate';
import { findVariables } from '../skills/variables';
import { ModelTextEditor } from './EditableText';
import { CopyIconButton, IconButton, TECH_ICON } from './icons';
import { AsSentList, type AsSentPart } from './AsSent';
import { markValue, text, withMarkedValues } from '../core/model-texts';
import { loadedSkillText, referencesNote, siteSkillBlock } from '../skills/prompt';
import { BlockText, MarkdownView } from './PromptSection';
import { pageColor, pageIcon } from './text-pages';
import { MentionsFold } from './MentionsFold';
import { ModelLabel } from './ToModel';
import { useCollection } from './useCollection';
import { BackToList, builtIn, ByModelBadge, CollectionTable, EditorFooter, EmptyCollection, FilterBox, NoSuchItem, useFilter } from './Collection';
import { useCollectionScreen } from './useCollectionScreen';
import { keyOf, patchAt } from './keys';
import { CollectionIO } from './collection/CollectionIO';
import { tableSelect, useSelection } from './collection/selection';
import { exportSkills, importSkills } from '../skills/io';
import { agentLabel, agentStore, type AgentProfile } from '../agents/profiles';
import { PageModelTexts } from './PageModelTexts';
import { MarkdownToggle } from './MarkdownToggle';
import { SectionTop } from './SectionTop';
import { FilterChips, SectionHead, SectionTabs, StatStrip, ToneChip, type ChipTone } from './SectionParts';

export const useSkills = () => useCollection(skillStore);


// When a skill's name and description are sent (site skills are not in the catalog).
const SKILL_CATALOG = 'in the skills catalog of the system prompt, on every request (general skills)';

type SkillKind = 'general' | 'site' | 'builtin' | 'mine';
const SKILL_FILTERS: { id: SkillKind; label: string; tone: ChipTone; title: string; is: (s: Skill) => boolean }[] = [
  { id: 'general', label: '≡ General', tone: 'title', title: 'In the catalog the model is given: it loads one when a request matches', is: (s) => !isSiteSkill(s) },
  { id: 'site', label: '◉ Site', tone: 'site', title: 'Its rules go on the pages its URL patterns match', is: isSiteSkill },
  { id: 'builtin', label: 'Built-in', tone: 'plain', title: 'Comes with the extension: read-only', is: (s) => !!s.builtin },
  { id: 'mine', label: 'Yours', tone: 'always', title: 'Written by you, or by the model once you approved it', is: (s) => !s.builtin },
];

const filterOf = (id: SkillKind) => SKILL_FILTERS.find((f) => f.id === id)!;
// A skill's kind on its row, as its chip over the list.
const KindChip = ({ kind }: { kind: 'general' | 'site' }) => {
  const f = filterOf(kind);
  return <ToneChip tone={f.tone} title={f.title}>{f.label}</ToneChip>;
};

export function SkillsSection() {
  const { items: skills, loaded, target, editing, missing, open, close } = useCollectionScreen(skillStore, { route: 'skills', fresh: newSkill });
  const agents = useCollection(agentStore);
  const { filter, setFilter, matches } = useFilter();
  const [kind, setKind] = useState<SkillKind | 'all'>('all');
  const searched = skills.filter((s) => matches([s.name, s.description]));
  const shown = kind === 'all' ? searched : searched.filter(filterOf(kind).is);
  const selection = useSelection(skills.filter((s) => !s.builtin).map((s) => s.id));

  if (editing) return <SkillEditor key={editing.id} skill={editing} skills={skills} onClose={close} />;
  if (missing) return <NoSuchItem route="skills" noun="skill" target={target} />;
  if (target) return null; // still loading
  const on = skills.filter((s) => s.enabled);
  const list = (
    <>
      <CollectionIO noun={['skill', 'skills']} label="Skills" fileName="skills.json" items={skills} shown={shown} id={(s) => s.id}
        cannot={builtIn} exportJson={exportSkills}
        none="Only your skills are exported: the built-in ones come with the extension. You have none yet."
        placeholder={'{ "skills": [ { "name": "review-pr", "description": "…", "body": "1. …" } ] }'}
        read={(json) => importSkills(json, skills)} save={(items) => skillStore.saveMany(items)} selection={selection}>
        <FilterBox label="Filter skills" value={filter} onChange={setFilter} />
        <button onClick={() => open('new')}>＋ New skill</button>
      </CollectionIO>
      <FilterChips label="Show the skills" value={kind} onChange={setKind} total={searched.length}
        filters={SKILL_FILTERS.map((f) => ({ id: f.id, label: f.label, tone: f.tone, title: f.title, count: searched.filter(f.is).length }))} />
      <CollectionTable className="skills-table" rows={shown} rowKey={(s) => s.id} name={(s) => s.name} nameHead="Skill" onOpen={(s) => () => open(s.id)}
        select={tableSelect(selection, builtIn)}
        onTitle="Enabled" isOn={(s) => s.enabled} onToggle={(s, on) => skillStore.update(s.id, { enabled: on })}
        tags={(s) => <>
          <KindChip kind={isSiteSkill(s) ? 'site' : 'general'} />
          {s.builtin && <span className="badge">built-in</span>}
          <ByModelBadge by={s.createdBy} />
        </>}
        columns={[{ head: 'Agents', cell: (s) => <span className="row-tags"><SkillAgents skill={s} agents={agents} /></span> }]}
        description={(s) => s.description} descriptionTitle={(s) => s.description} />
      <EmptyCollection shown={shown.length} total={skills.length} one="skill" many="skills" loaded={loaded} />
    </>
  );
  return (
    <section>
      <SectionHead title="Skills" about="Instructions for specific tasks: general ones the model loads when a request matches, site ones that apply on their pages." />
      <StatStrip stats={[
        { label: 'Skills', value: skills.length, sub: `${on.length} on · ${skills.filter((s) => s.builtin).length} built-in` },
        { label: 'General, in the catalog', value: on.filter((s) => !isSiteSkill(s)).length, sub: 'Switched on: their name and description go with every request' },
        { label: 'Site skills', value: on.filter(isSiteSkill).length, sub: 'Switched on: their rules go on their pages' },
      ]} />
      <SectionTabs label="Skills" tabs={[
        { id: 'list', label: 'Skills', render: () => list },
        { id: 'texts', label: 'Limits and texts', render: () => (
          <>
            <SectionTop page="skills" />
            <MentionsFold syntax="/skill-name">
              <p className="hint">
                Mention a skill in a message with <code>/skill-name</code> to load it for that message, without waiting for the model to
                ask for it (switch mentions off in Auto-inject → Mentions).
              </p>
              <ModelTextEditor id="skill.mention" />
            </MentionsFold>
            <PageModelTexts page="skills" skip={['skill.mention']} />
          </>
        ) },
      ]} />
    </section>
  );
}

// The agents that get it: Browser while it is on, and each agent it was given to (Settings → Agents).
function SkillAgents({ skill, agents }: { skill: Skill; agents: AgentProfile[] }) {
  const given = agents.filter((a) => a.skills.includes(skill.name));
  return (
    <>
      {skill.enabled && <span className="badge agent-badge" title="Browser gets every skill switched on here">Browser</span>}
      {given.map((a) => (
        <span key={a.id} className={`badge agent-badge${a.enabled ? '' : ' off'}`}
          title={`Given to the agent "${a.name}" in Settings → Agents${a.enabled ? '' : ' (the agent is switched off)'}${skill.enabled ? '' : '; it gets it even while it is off here'}`}>
          {agentLabel(a)}
        </span>
      ))}
    </>
  );
}

// A Markdown text as a block like Prompt preview's: shown rendered or as written, its buttons in its
// title with Edit to change it (an empty one opens for writing; a built-in skill's Edit is off) and
// Done to see it again. What is written goes to the skill being edited, saved with it.
function MarkdownField({ label, name, value, rows, readOnly, onChange, asSent }: { label: ReactNode; name: string; value: string; rows: number; readOnly: boolean; onChange: (v: string) => void; asSent?: AsSentPart[] }) {
  const [editing, setEditing] = useState(!readOnly && !value.trim());
  const [rendered, setRendered] = useState(true);
  const [layers, setLayers] = useState(false); // as the model gets it (`asSent`)
  return (
    <div className="text-block colored markdown-field" style={{ '--part': pageColor('skills') } as CSSProperties}>
      <div className="text-block-head">
        <strong>{label}</strong>
        <span className="spacer" />
        {!editing && (
          <span className="icon-toolbar block-views" role="toolbar" aria-label="Show the text as">
            {asSent && (
              <IconButton label="As sent: as the model gets it, part by part" pressed={layers} onClick={() => setLayers(!layers)} icon={TECH_ICON} />
            )}
            <MarkdownToggle on={rendered} onChange={setRendered} />
            <CopyIconButton text={value} label="Copy to clipboard" />
          </span>
        )}
        <button disabled={readOnly} title={readOnly ? 'Built-in skills cannot be changed: switch it off and write your own' : undefined}
          onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>
      </div>
      {editing ? (
        <textarea rows={rows} className="mono" aria-label={name} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        // As tall as the box it is edited in, so the form keeps its shape.
        <div className="markdown-field-view" style={{ minHeight: `${rows * 1.5}em` }}>
          <MarkdownView on={rendered}>
            {layers && asSent ? <AsSentList parts={asSent} /> : value.trim() ? <BlockText text={value} /> : <p className="hint">Nothing written yet.</p>}
          </MarkdownView>
        </div>
      )}
    </div>
  );
}

// How a skill reaches the model: a site skill, in your message on its websites; a general one, its
// line in the system message's catalog, then its instructions in the reply when the model loads it.
// What comes from the skill, in its origin color.
function skillAsSent(skill: Skill, site: boolean): AsSentPart[] {
  const color = pageColor('skills');
  const icon = pageIcon('skills');
  return withMarkedValues((): AsSentPart[] => site
    ? [{ key: 'site', label: 'Your message · site skill', text: siteSkillBlock(skill.name, markValue(skill.body, 'skill')), color, icon, sent: 'skill.site_block' }]
    : [
      { key: 'catalog', label: 'System message · catalog line', text: text('system.skills_item', { skill_name: markValue(skill.name, 'skill'), skill_description: markValue(skill.description, 'skill') }), color, icon, sent: 'system.skills_item' },
      { key: 'load', label: 'skills__load reply', text: loadedSkillText(skill.name, markValue(skill.body, 'skill') + referencesNote(skill.references.map((r) => r.path))), color, icon, sent: 'result.skill_loaded' },
    ]);
}

// Site skills can ask for values from the page; they are sent apart, as untrusted page content.
function PageValuesHint({ body, site }: { body: string; site: boolean }) {
  const vars = findVariables(body);
  return (
    <p className="hint">
      Page values: <code>{'{{selector:h1}}'}</code>, <code>{'{{selector:img.hero?src}}'}</code>, <code>{'{{meta:og:price}}'}</code>,{' '}
      <code>{'{{schema:@Product:offers.price}}'}</code>, <code>{'{{url}}'}</code>. They are read from the page on every message and sent in a separate,
      untrusted block.
      {vars.length > 0 &&
        (site ? (
          <> Used here: {vars.map((v, i) => <span key={v}>{i > 0 && ', '}<code>{v}</code></span>)}.</>
        ) : (
          <strong> Only site skills (with URL patterns) fill them in.</strong>
        ))}
    </p>
  );
}

function SkillEditor({ skill, skills, onClose }: { skill: Skill; skills: Skill[]; onClose: () => void }) {
  const [draft, setDraft] = useState(skill);
  const [matchesText, setMatchesText] = useState(skill.matches.join('\n'));
  const readOnly = !!skill.builtin;
  const isNew = !skills.some((s) => s.id === skill.id);
  const patch = (change: Partial<Skill>) => setDraft((d) => ({ ...d, ...change }));
  const matches = matchesText.split('\n').map((l) => l.trim()).filter(Boolean);

  const problems = skillProblems({ ...draft, matches }, skills);

  const save = async () => {
    await skillStore.save({ ...draft, name: draft.name.trim(), description: draft.description.trim(), matches });
    onClose();
  };

  return (
    <section className="editor">
      <BackToList route="skills" title="Skills" />
      <h3>{readOnly ? draft.name : isNew ? 'New skill' : `Edit ${skill.name}`}</h3>
      {readOnly && <p className="hint">Built-in skills are read-only. You can enable or disable them from the list.</p>}
      <label><ModelLabel text="Name" when={`${SKILL_CATALOG}; a site skill's, with its instructions on its websites`} /><input value={draft.name} disabled={readOnly} placeholder="review-pr" onChange={(e) => patch({ name: e.target.value })} /></label>
      <label><ModelLabel text="Description (what it does and when to use it; the model reads it to decide)" when={SKILL_CATALOG} />
        <textarea rows={2} value={draft.description} disabled={readOnly} onChange={(e) => patch({ description: e.target.value })} />
      </label>
      <label>Site URL patterns (one per line; empty = general skill)
        <textarea rows={2} className="mono" value={matchesText} disabled={readOnly} placeholder="*://code.example.com/*/pull/*" onChange={(e) => setMatchesText(e.target.value)} />
      </label>
      <MarkdownField label={<ModelLabel text="Instructions (Markdown)" when="when the model loads the skill; a site skill's, with every message on its websites" limits={['skillValue', 'skillItems']} />}
        name="Instructions" rows={14} value={draft.body} readOnly={readOnly} onChange={(body) => patch({ body })} asSent={skillAsSent(draft, matches.length > 0)} />
      <PageValuesHint body={draft.body} site={matches.length > 0} />

      <div className="skill-refs">
        <div>Reference files <span className="muted">(read by the model only when it needs them)</span></div>
        {draft.references.map((r, i) => (
          <div key={keyOf(r)} className="skill-ref">
            <div className="row">
              <input className="mono" value={r.path} disabled={readOnly} placeholder="references/checklist.md"
                onChange={(e) => patch({ references: patchAt(draft.references, i, { path: e.target.value }) })} />
              {!readOnly && <button className="danger" onClick={() => patch({ references: draft.references.filter((_, j) => j !== i) })}>Remove</button>}
            </div>
            <MarkdownField label={<span className="muted">Content</span>} name={`Content of ${r.path || 'the reference file'}`} rows={5} value={r.content} readOnly={readOnly}
              onChange={(content) => patch({ references: patchAt(draft.references, i, { content }) })} />
          </div>
        ))}
        {!readOnly && <button onClick={() => patch({ references: [...draft.references, { path: '', content: '' }] })}>＋ Add reference file</button>}
      </div>

      <EditorFooter problems={problems} readOnly={readOnly} isNew={isNew} onSave={save} onDelete={() => skillStore.remove(skill.id)} onClose={onClose} />
    </section>
  );
}
