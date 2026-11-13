// What a custom tool is (tools/custom/runtime runs it): a tool of the catalog (the base) offered again
// under a name and description of the user's, an HTTP request or a script.
import type { JSONSchema } from '../../core/types';
import type { CollectionItem } from '../../storage/collection';
import type { HttpRequest } from '../http';

export interface CustomTool extends CollectionItem {
  name: string; // dotted, like the catalog's: "reddit.search"
  description: string; // what the model reads to decide when to call it
  base: string; // the tool it runs: "web.search", "http" (its request in `http`) or "script" (`script`)
  // By the base's parameter. With the base's parameters, one not listed is filled by the model as for
  // the base; with inputs, one not listed is not sent.
  params: Record<string, ParamRule>;
  inputs?: CustomInput[]; // its own parameters, the only ones the model sees (always, for an HTTP request)
  http?: HttpRequest; // a script's site (url), headers, session and readOnly too (its method is not used)
  script?: string; // a script's code: the body of an async function given input and request (tools/custom/script-tool)
  uses?: string[]; // the tools a script calls with tool(name, args): only these (script/steps); then its site is optional
  labels?: string[]; // the user's, to find it in Settings (tools/labels); the model never sees them
  group?: string; // the section it is listed under (named so in the tools menus), a team's or the user's; not for the model
  createdBy?: 'model'; // saved by the model (custom_tools.save), after the user approved it
  source?: ToolSource; // read from a source (tools/custom/sources), replaced at each of its syncs
}

// Where a tool synced from a source came from, and what it did there: a sync that brings another
// request or code turns it off, `changed`, until the user checks it and switches it on.
interface ToolSource {
  id: string;
  does: string; // tools/custom/store whatItDoes
  changed?: boolean;
}

export type InputType = 'string' | 'number' | 'boolean';
export const INPUT_TYPES: InputType[] = ['string', 'number', 'boolean'];

export interface CustomInput {
  name: string;
  type: InputType;
  description: string;
  required?: boolean;
  default?: string | number | boolean; // when the model leaves it out
}

export type ParamRule =
  | { mode: 'model'; template?: string; description?: string } // a text one goes into the template, at {value}
  | { mode: 'fixed'; value: unknown }
  | { mode: 'built'; template: string }; // from the inputs, at {name}

export const VALUE = '{value}';

export interface ObjectSchema {
  properties?: Record<string, JSONSchema & { type?: string; description?: string }>;
  required?: string[];
}

// A new custom tool, as the editor starts it.
export const newCustomTool = (): CustomTool => ({ id: crypto.randomUUID(), name: '', description: '', base: '', params: {}, enabled: true });
