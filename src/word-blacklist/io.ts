// The word blacklist's terms as a file (Settings → Word blacklist → Export, Import…): exported as JSON;
// imported from that JSON, or from a CSV of two columns (term, replacement; a header row, commas,
// semicolons or tabs, as spreadsheets save it). Imported terms are added; one already there gets the
// file's replacement.
import { isObject } from '../core/util';
import { isBlacklistEntry, termKey, usableEntries, type BlacklistEntry } from './core';

const TYPE = 'browser-agent-word-blacklist';

export const exportBlacklist = (entries: BlacklistEntry[]) => JSON.stringify({ type: TYPE, version: 1, entries: usableEntries(entries) }, null, 2);

// The entries of a file; none when it is not one of these.
export function parseBlacklistFile(text: string): BlacklistEntry[] | undefined {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
    if (!isObject(json) || json.type !== TYPE || !Array.isArray(json.entries)) return undefined;
    const entries = json.entries.filter(isBlacklistEntry);
    return usableEntries(entries);
  }
  return parseCsv(trimmed);
}

function parseCsv(text: string): BlacklistEntry[] | undefined {
  const rows = csvRows(text);
  const first = rows[0];
  if (!first || rows.some((r) => r.filter((c) => c.trim()).length > 2)) return undefined;
  const header = /^(real )?terms?$/i.test(first[0]?.trim() ?? '') && /^replacements?$/i.test(first[1]?.trim() ?? '');
  const entries = usableEntries((header ? rows.slice(1) : rows).map((r) => ({ term: r[0] ?? '', replacement: r[1] ?? '' })));
  return entries.length ? entries : undefined;
}

// Rows of cells: the separator the first line uses (tab, semicolon, else comma); "quoted" cells may
// hold it, line breaks and "" for a quote.
function csvRows(text: string): string[][] {
  const line = text.split(/\r?\n/, 1)[0]!;
  const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') cell += text[++i];
      else quoted = false;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) endCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

// The list with the file's entries: the new ones added, those already there with the file's
// replacement (`updated`: how many of them changed).
export function mergeEntries(current: BlacklistEntry[], imported: BlacklistEntry[]): { entries: BlacklistEntry[]; updated: number } {
  const entries = [...current];
  let updated = 0;
  for (const e of imported) {
    const i = entries.findIndex((x) => x.term.trim() && termKey(x.term) === termKey(e.term));
    if (i < 0) entries.push(e);
    else if (entries[i]!.replacement.trim() !== e.replacement) {
      entries[i] = { ...entries[i]!, replacement: e.replacement };
      updated++;
    }
  }
  return { entries, updated };
}
