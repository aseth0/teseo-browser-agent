import { describe, expect, it } from 'vitest';
import { markdownToJira } from '../src/ui/jira-markup';

describe('markdownToJira', () => {
  it('writes headings, emphasis, code, links and breaks as Jira markup', () => {
    expect(markdownToJira('# Title\n\n## Sub\n\nSome **bold**, *italic*, ~~gone~~ and `code {x}`.\nNext  \nline')).toBe(
      'h1. Title\n\nh2. Sub\n\nSome *bold*, _italic_, -gone- and {{code \\{x\\}}}.\nNext \\\\\nline',
    );
    expect(markdownToJira('[the docs](https://docs.example.com/a) and https://example.com')).toBe('[the docs|https://docs.example.com/a] and [https://example.com]');
    expect(markdownToJira('```ts\nconst a = 1;\n```\n\n> said\n\n---')).toBe('{code:ts}\nconst a = 1;\n{code}\n\n{quote}\nsaid\n{quote}\n\n----');
    expect(markdownToJira('```\nwrite {code} here\n```')).toBe('{noformat}\nwrite {code} here\n{noformat}');
  });

  it('writes lists, nested and ordered, with their checks', () => {
    expect(markdownToJira('- one\n- two\n  1. a\n  2. b\n- [x] done\n- [ ] to do')).toBe('* one\n* two\n*# a\n*# b\n* (/) done\n* ☐ to do');
  });

  it('writes tables with a header row', () => {
    expect(markdownToJira('| Key | State |\n|---|---|\n| INC-1 | a \\| b |')).toBe('||Key||State||\n|INC-1|a \\| b|');
  });

  it('escapes what Jira would read as markup', () => {
    expect(markdownToJira('Use [brackets] and {braces}; *not bold* here: 2 * 3')).toBe('Use \\[brackets\\] and \\{braces\\}; _not bold_ here: 2 * 3');
    expect(markdownToJira('a_b snake_case -flag')).toBe('a_b snake_case \\-flag');
  });
});
