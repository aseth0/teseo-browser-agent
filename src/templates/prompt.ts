// What the model sees of the site templates in the system prompt: that their data comes in notes,
// and the user's own templates with their views, so it knows what each gives and can suggest
// ::name/view. The built-in ones (the search engines', for web.search) are not listed.
import { text } from '../core/model-texts';
import type { PageTemplate, TemplateView } from './types';

const viewLine = (v: TemplateView) => {
  const values = { view_name: v.name, view_paths: v.paths.join(', ') };
  return v.description ? text('system.templates_view', { ...values, view_description: v.description }) : text('system.templates_view_bare', values);
};

// A template's line, then one per view with paths (blocks are only inserted by other views).
const templateLines = (t: PageTemplate) => [
  t.description ? text('system.templates_item', { template_name: t.name, template_description: t.description }) : text('system.templates_item_bare', { template_name: t.name }),
  ...t.views.filter((v) => v.paths.length).map(viewLine),
];

export function templatesInstructions(templates: PageTemplate[], mentions: boolean): string {
  const enabled = templates.filter((t) => t.enabled);
  if (!enabled.length) return '';
  const own = enabled.filter((t) => !t.builtin);
  const list = own.flatMap(templateLines).join('\n');
  const catalog = own.length ? text('system.templates_catalog', { template_list: list }) + (mentions ? text('system.templates_mention') : '') : '';
  return text('system.templates', { template_catalog: catalog });
}
