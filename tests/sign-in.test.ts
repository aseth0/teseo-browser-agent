// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { asksToSignIn } from '../src/content/sign-in';

describe('asksToSignIn on the page', () => {
  it("takes a sign-in page's URL for one, whatever the page shows", () => {
    for (const url of ['https://example.com/login', 'https://example.com/log-in?next=/', 'https://example.com/SignIn', 'https://example.com/sign-in/', 'https://example.com/auth', 'https://example.com/sso?team=x', 'https://example.com/account/login'])
      expect(asksToSignIn(document, url), url).toBe(true);
  });

  it('takes no other page for one by its URL: its path counts, not its query', () => {
    for (const url of ['https://example.com/', 'https://example.com/blog/login-tips', 'https://example.com/author', 'https://example.com/authors/ann', 'https://example.com/q?next=/login', 'not a url'])
      expect(asksToSignIn(document, url), url).toBe(false);
  });
});
