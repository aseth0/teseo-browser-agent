import { describe, expect, it } from 'vitest';
import { autoInjectGlobal, autoInjectOn } from '../src/context/auto-inject';

const s = (x: object) => ({ providers: [], ...x }) as never;

describe('auto-inject', () => {
  it('memory, site skills and templates are on by default; auto-attach is not', () => {
    expect(autoInjectGlobal(s({}), 'memory')).toBe(true);
    expect(autoInjectGlobal(s({}), 'memorySiteMatch')).toBe(true);
    expect(autoInjectGlobal(s({ autoInject: { memorySiteMatch: false } }), 'memorySiteMatch')).toBe(false);
    expect(autoInjectGlobal(s({ autoInject: { memory: false } }), 'memorySiteMatch')).toBe(false);
    expect(autoInjectGlobal(s({}), 'siteSkills')).toBe(true);
    expect(autoInjectGlobal(s({}), 'templates')).toBe(true);
    expect(autoInjectGlobal(s({}), 'historyAuto')).toBe(false);
    expect(autoInjectGlobal(s({ history: { autoAttach: { enabled: true } } }), 'historyAuto')).toBe(true);
  });

  it('follows Settings, and memory or history being off', () => {
    expect(autoInjectGlobal(s({ autoInject: { siteSkills: false } }), 'siteSkills')).toBe(false);
    expect(autoInjectGlobal(s({ memory: { enabled: false } }), 'memory')).toBe(false);
    expect(autoInjectGlobal(s({ history: { enabled: false, autoAttach: { enabled: true } } }), 'historyAuto')).toBe(false);
  });

  it('a conversation leaves out what it skips, never turns on what Settings switched off', () => {
    expect(autoInjectOn(s({}), 'templates', ['templates'])).toBe(false);
    expect(autoInjectOn(s({}), 'templates', ['memory'])).toBe(true);
    expect(autoInjectOn(s({ autoInject: { memory: false } }), 'memory', [])).toBe(false);
  });

  it("between the model's steps: on with its auto-attach only, and left out with it", () => {
    const on = s({ memory: { autoAttach: { enabled: true, steps: true } } });
    expect(autoInjectOn(on, 'memorySteps')).toBe(true);
    expect(autoInjectOn(on, 'memorySteps', ['memorySteps'])).toBe(false);
    expect(autoInjectOn(on, 'memorySteps', ['memoryAuto'])).toBe(false);
    expect(autoInjectGlobal(s({ memory: { autoAttach: { steps: true } } }), 'memorySteps')).toBe(false);
    expect(autoInjectGlobal(s({ bookmarks: { autoAttach: { enabled: true } } }), 'bookmarkSteps')).toBe(false);
  });

  it('matching by meaning goes with Semantic search being usable, and a conversation can leave it out', () => {
    const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
    const on = { providers: [provider], memory: { semantic: { enabled: true, providerId: 'p1', model: 'embed' } } };
    expect(autoInjectGlobal(s({}), 'memoryMeaning')).toBe(false);
    expect(autoInjectGlobal(on as never, 'memoryMeaning')).toBe(true);
    expect(autoInjectOn(on as never, 'memoryMeaning', ['memoryMeaning'])).toBe(false);
    expect(autoInjectGlobal({ providers: [], memory: on.memory } as never, 'memoryMeaning')).toBe(false);
  });
});
