import { describe, expect, it } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import { memoryAttachMatches, memoryMatches } from '../src/memory/items';
import { memoryAutoItems } from '../src/memory/prompt';
import { memoryIndexOf, memoryIndexSource, memoryMatchOf } from '../src/context/sources';
import type { MemoryItem } from '../src/memory/store';

const item = (id: string, text: string, change: Partial<MemoryItem> = {}): MemoryItem =>
  ({ id, enabled: true, text, pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1, ...change }) as MemoryItem;
const items = [
  item('m-graf', 'Grafana lives at grafana.example.test, login with SSO'),
  item('m-pin', 'Grafana dashboards are pinned', { pinned: true }),
  item('m-site', 'Grafana on this site', { domains: ['example.test'] }),
  item('m-cat', 'The cat is called Tofu'),
];

describe('memory auto-attach', () => {
  it('attaches the items the message matches, neither pinned nor for a site, once a chat, when on', () => {
    const on = { enabled: true, threshold: 60 };
    expect(memoryAutoItems(items, 'grafana', [], undefined)).toEqual([]);
    const [block] = memoryAutoItems(items, 'grafana', [], on);
    const said = stripMarks(block!.text);
    expect(memoryMatchOf(block!.source)).toEqual({ origin: 'message', titles: ['Grafana lives at grafana.example.test, login with SSO'], count: 1 });
    expect(said).toContain('attached="automatically"');
    expect(said).toContain('[m-graf] Grafana lives at');
    expect(said).not.toContain('m-pin');
    expect(said).not.toContain('m-site');
    // Sent already in this chat: not again.
    const before = [{ role: 'user' as const, parts: [{ type: 'text' as const, text: block!.text, context: 'memory' as const, source: block!.source }] }];
    expect(memoryAutoItems(items, 'grafana again', before, on)).toEqual([]);
    expect(memoryAutoItems(items, 'weather tomorrow', [], on)).toEqual([]);
  });

  it('a message mostly of words no item has: no full match for the one in common', () => {
    const on = { enabled: true, threshold: 60 };
    const many = [item('m-test', 'Prueba siempre los cambios en el navegador antes del commit', { title: 'Pruebas' }), item('m-cat', 'The cat is called Tofu'), item('m-tz', 'My timezone is Europe/Madrid'), item('m-pkg', 'Prefer pnpm over npm')];
    expect(memoryAutoItems(many, 'Crea una Meeting de prueba con Ana para el martes y mándale la invitación', [], on)).toEqual([]);
    expect(memoryAttachMatches(many, 'Crea una Meeting de prueba con Ana para el martes y mándale la invitación')[0]!.match).toBeLessThan(0.6);
    // memory__search still finds it by that word, as it did.
    expect(memoryMatches(many, 'Crea una Meeting de prueba con Ana para el martes y mándale la invitación')[0]!.match).toBe(1);
    // A message about it still attaches it.
    expect(stripMarks(memoryAutoItems(many, 'prueba los cambios antes del commit', [], on)[0]!.text)).toContain('[m-test]');
  });

  it('between steps: what the model wrote, its own block, not again after a step', () => {
    const on = { enabled: true, threshold: 60, steps: true };
    const [block] = memoryAutoItems(items, 'Grafana SSO login', [], on, 'step');
    expect(memoryMatchOf(block!.source)).toMatchObject({ origin: 'step', count: 1 });
    expect(stripMarks(block!.text)).toContain('what you wrote in your last reply');
    // Attached after a tool's result already: neither with a later step nor with your message.
    const before = [{ role: 'tool' as const, parts: [{ type: 'tool_result' as const, toolCallId: 'c1', content: 'ok', attached: [{ kind: 'memory' as const, text: block!.text, source: block!.source }] }] }];
    expect(memoryAutoItems(items, 'grafana again', before, on, 'step')).toEqual([]);
    expect(memoryAutoItems(items, 'grafana', before, on)).toEqual([]);
  });

  it('reads an older source, which says only how many', () => {
    expect(memoryMatchOf('memory-auto:2')).toEqual({ origin: 'message', titles: [], count: 2 });
    expect(memoryMatchOf('memory:example.test')).toBeUndefined();
  });

  it('reads a site index source, and leaves out a broken one', () => {
    expect(memoryIndexOf(memoryIndexSource('example.test', ['Prices']))).toEqual({ host: 'example.test', titles: ['Prices'] });
    expect(memoryIndexOf('memory-index:not json')).toBeUndefined();
    expect(memoryIndexOf('memory-index:{"host":1}')).toBeUndefined();
    expect(memoryIndexOf('memory:example.test')).toBeUndefined();
  });
});
