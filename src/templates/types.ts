// A page template: one per website (its URL patterns), with views. On a page, the first view whose
// paths match the URL is applied: a Liquid template that reads the page (templates/liquid) whose
// output is attached to every message there, as page content. A view without paths is a block that
// other views insert with {% render "name" %}.
export interface PageTemplate {
  id: string;
  name: string; // kebab-case, unique
  description: string; // what it extracts and when it helps: shown to the user, and listed to the model (templates/prompt)
  matches: string[]; // Chrome match patterns: the website
  views: TemplateView[]; // in order: the first that matches is applied
  enabled: boolean;
  webRead?: boolean; // web.read gives what it extracts (when it finds something) instead of the page's text
  builtin?: boolean; // shipped with the extension: read-only
  createdBy?: 'model'; // saved by the model (templates.save), after the user approved it
}

export interface TemplateView {
  name: string; // kebab-case, unique within the template
  paths: string[]; // URL paths with *, e.g. "/app/project/*" (query included); none: a block, only rendered
  description?: string; // what it extracts, one line: listed to the model with the user's templates (templates/prompt)
  replacePage: boolean; // send its data instead of the page's visible elements
  body: string; // Liquid
}

// A new view and a new site template (with one view, "main"), as the editor starts them.
export const newView = (name = 'main'): TemplateView => ({ name, paths: ['*'], replacePage: false, body: '' });
export const newTemplate = (): PageTemplate => ({ id: crypto.randomUUID(), name: '', description: '', matches: [], views: [newView()], enabled: true });
