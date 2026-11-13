import { describe, expect, it } from 'vitest';
import { siteContextItems, type SiteContextInput } from '../src/context/site-context';
import type { MemoryItem } from '../src/memory/store';
import type { Skill } from '../src/skills/types';
import type { Settings } from '../src/storage/settings';
import type { PageTemplate } from '../src/templates/types';

const skill: Skill = { id: 's', name: 'shop', description: 'd', matches: ['*://shop.example.test/*'], body: 'Prices in EUR.', references: [], enabled: true };
const template: PageTemplate = { id: 't', name: 'cart', description: 'd', matches: ['*://shop.example.test/*'], views: [], enabled: true };
const memory = (id: string, text: string, domains: string[] = []): MemoryItem =>
  ({ id, enabled: true, text, pinned: false, domains, agents: [], source: 'user', createdAt: 1, updatedAt: 1 }) as MemoryItem;

const input = (settings: Partial<Settings>, over: Partial<SiteContextInput> = {}): SiteContextInput => ({
  settings: { providers: [], systemPrompt: '', ...settings } as Settings,
  skills: [skill],
  templates: [template],
  memory: [memory('m-site', 'Ships on Fridays', ['shop.example.test']), memory('m-any', 'Grafana lives at grafana.example.test')],
  memoryOpts: { reads: true, saves: true },
  url: 'https://shop.example.test/cart',
  typed: 'grafana dashboards',
  history: [],
  ...over,
});

describe('siteContextItems', () => {
  it('gives the site skills, the memory for the site and what the message matches, in that order', () => {
    const site = siteContextItems(input({ memory: { autoAttach: { enabled: true, threshold: 60 } } } as Partial<Settings>));
    expect(site.skills.map((s) => s.name)).toEqual(['shop']);
    expect(site.templates.map((t) => t.name)).toEqual(['cart']);
    expect(site.items.map((i) => i.kind)).toEqual(['skill', 'memory', 'memory']);
  });

  it('leaves out what Settings → Auto-inject turns off, and what the conversation skips', () => {
    const off = siteContextItems(input({ autoInject: { siteSkills: false, templates: false, memory: false } } as Partial<Settings>));
    expect(off).toEqual({ skills: [], templates: [], items: [] });
    const skipped = siteContextItems(input({}, { skip: ['memory'] }));
    expect(skipped.items.map((i) => i.kind)).toEqual(['skill']);
  });

  describe('the memory for the site', () => {
    const shown = (site: { items: { kind: string; text: string }[] }) => site.items.filter((i) => i.kind === 'memory').map((i) => i.text).join('\n');
    const rule = memory('m-site', 'Ships on Fridays', ['shop.example.test']);

    it('by default, an item your message does not match goes by title, also with Auto-attach off', () => {
      const site = shown(siteContextItems(input({})));
      expect(site).toContain('<memory_index');
      expect(site).toContain('m-site');
      expect(site).not.toContain('- [m-site]');
      expect(shown(siteContextItems(input({}, { typed: 'when does it ship on fridays' })))).toContain('- [m-site] Ships on Fridays');
    });

    it('uses the match set in Auto-attach, or its default', () => {
      const all = [rule, memory('m-a', 'ship by air'), memory('m-b', 'ship by sea'), memory('m-c', 'quick delivery')];
      const typed = 'ship with quick delivery';
      const low = input({ memory: { autoAttach: { threshold: 20 } } } as Partial<Settings>, { memory: all, typed });
      const high = input({ memory: { autoAttach: { threshold: 95 } } } as Partial<Settings>, { memory: all, typed });
      expect(shown(siteContextItems(low))).toContain('- [m-site] Ships on Fridays');
      expect(shown(siteContextItems(high))).not.toContain('- [m-site]');
    });

    it('the switch off gives all of them whole; unset is on', () => {
      expect(shown(siteContextItems(input({ autoInject: { memorySiteMatch: false } } as Partial<Settings>)))).toContain('- [m-site] Ships on Fridays');
      expect(shown(siteContextItems(input({ autoInject: {} } as Partial<Settings>)))).not.toContain('- [m-site]');
    });

    it('an agent without memory.read gets them whole: a title would be of no use to it', () => {
      expect(shown(siteContextItems(input({}, { memoryOpts: { reads: false, saves: false } })))).toContain('- [m-site] Ships on Fridays');
    });

    it('with memory left out of the conversation, not even by title', () => {
      expect(shown(siteContextItems(input({}, { skip: ['memory'] })))).toBe('');
    });
  });

  it('has nothing for another site', () => {
    expect(siteContextItems(input({}, { url: 'https://other.example.test/' }))).toEqual({ skills: [], templates: [], items: [] });
  });
});
