import { describe, expect, it } from 'vitest';
import { grantedSites, patternHost, sitePattern } from '../src/page/permissions';

describe('sitePattern', () => {
  it('turns a bare host into an https pattern', () => {
    expect(sitePattern('  chat.example.com ')).toBe('https://chat.example.com/*');
  });
  it('keeps the scheme and drops port, path and query', () => {
    expect(sitePattern('http://localhost:8065/api/v4?x=1')).toBe('http://localhost/*');
  });
  it('throws on input that is not a URL', () => {
    expect(() => sitePattern('not a host')).toThrow();
  });
});

describe('grantedSites', () => {
  it('drops the fixed hosts and <all_urls>, dedupes and sorts', () => {
    const fixed = ['https://api.openai.com/*', 'http://localhost/*'];
    const granted = ['https://z.example/*', '<all_urls>', 'https://api.openai.com/*', 'https://a.example/*', 'https://z.example/*'];
    expect(grantedSites(granted, fixed)).toEqual(['https://a.example/*', 'https://z.example/*']);
  });
});

describe('patternHost', () => {
  it('gives the host a site policy is keyed by', () => {
    expect(patternHost('https://chat.example.com/*')).toBe('chat.example.com');
  });
  it('has no host for wildcard patterns', () => {
    expect(patternHost('https://*.example.com/*')).toBeUndefined();
    expect(patternHost('<all_urls>')).toBeUndefined();
  });
});
