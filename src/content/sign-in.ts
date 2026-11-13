// Whether a page asks to sign in: a visible password field, or a sign-in page's URL. Pure DOM, run on
// the page (page-agent), for web.read. By the path alone: a query naming one (?next=/login) is not one.
const SIGN_IN_PATH = /\/(log-?in|sign-?in|signin|auth|sso|account\/login)(\/|$)/i;

export function asksToSignIn(doc: Document, url: string): boolean {
  let path = '';
  try {
    const u = new URL(url);
    path = u.pathname;
  } catch {
    // not a URL: by the page alone
  }
  if (SIGN_IN_PATH.test(path)) return true;
  // Visible: one kept hidden (e.g. for a later step) does not ask yet.
  return [...doc.querySelectorAll<HTMLInputElement>('input[type="password"]')].some((f) => f.getClientRects().length > 0);
}
