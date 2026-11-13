import { describe, expect, it } from 'vitest';
import { exportBlacklist, mergeEntries, parseBlacklistFile } from '../src/word-blacklist/io';

describe('word blacklist files', () => {
  it('reads back what it exports, without the rows not filled in', () => {
    const file = exportBlacklist([{ term: ' Acme ', replacement: 'CLIENT_A' }, { term: 'x', replacement: '' }]);
    expect(parseBlacklistFile(file)).toEqual([{ term: 'Acme', replacement: 'CLIENT_A' }]);
  });

  it('reads a CSV with a header, quotes, semicolons or tabs', () => {
    expect(parseBlacklistFile('term,replacement\nAcme,CLIENT_A\n"Acme, Inc.","CLIENT_""B"""\n')).toEqual([{ term: 'Acme', replacement: 'CLIENT_A' }, { term: 'Acme, Inc.', replacement: 'CLIENT_"B"' }]);
    expect(parseBlacklistFile('﻿José Pérez;PERSON_1\r\nGlobex;CLIENT_C')).toEqual([{ term: 'José Pérez', replacement: 'PERSON_1' }, { term: 'Globex', replacement: 'CLIENT_C' }]);
    expect(parseBlacklistFile('Acme\tCLIENT_A')).toEqual([{ term: 'Acme', replacement: 'CLIENT_A' }]);
  });

  it('refuses what is not one of these files', () => {
    expect(parseBlacklistFile('{"entries": []}')).toBeUndefined();
    expect(parseBlacklistFile('{ nope')).toBeUndefined();
    expect(parseBlacklistFile('a,b,c\nd,e,f')).toBeUndefined();
    expect(parseBlacklistFile('')).toBeUndefined();
  });

  it('adds the new terms and gives those already there the file replacement', () => {
    const { entries, updated } = mergeEntries([{ term: 'Acme', replacement: 'CLIENT_A' }, { term: 'Globex', replacement: 'OLD' }], [{ term: 'ACME', replacement: 'CLIENT_A' }, { term: 'globex', replacement: 'CLIENT_B' }, { term: 'Initech', replacement: 'CLIENT_C' }]);
    expect(entries).toEqual([{ term: 'Acme', replacement: 'CLIENT_A' }, { term: 'Globex', replacement: 'CLIENT_B' }, { term: 'Initech', replacement: 'CLIENT_C' }]);
    expect(updated).toBe(1);
  });
});
