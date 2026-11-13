// What an agent may do on a site (policy/store), and how the user is shown it: a leaf, so that the
// agents' tools and the views can name a policy without importing policy/.
export type SitePolicy = 'ask' | 'auto' | 'read-only';

// How the user is shown each policy (the site selects, the confirmation cards).
export const POLICY_LABELS: Record<SitePolicy, string> = {
  ask: 'Ask before acting',
  auto: 'Act without asking',
  'read-only': 'Read only',
};
