// Why a tab's page cannot be recorded (background/recording-host) or its audio captured
// (background/audio-host), or none: a browser page, or a site the user has not enabled (its pill
// could not be shown, and the site's content would go to the provider unasked).
import { hasAccess } from '../page/access';
import { isRestrictedUrl } from '../page/permissions';

export async function whyNot(url: string | undefined, verb: 'recorded' | 'captured'): Promise<string | undefined> {
  if (!url || isRestrictedUrl(url) || !/^https?:/.test(url)) return `Pages like this one cannot be ${verb}.`;
  if (!(await hasAccess(url))) return 'This site is not enabled.';
  return undefined;
}
