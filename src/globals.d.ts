// Injected at build time by wxt.config.ts (vite define).
declare const __ENV_PROVIDER__: { baseURL: string; defaultModel: string } | null;
// Read by background/env-key alone, so that only the worker's file has it.
declare const __ENV_API_KEY__: string | null;
// The Chrome Web Store's build (core/build).
declare const __STORE__: boolean;
// The project's repository (core/repo-url), and whether this is a release's build (core/links).
declare const __REPO_URL__: string;
declare const __RELEASE_BUILD__: boolean;

// GitHub-flavored Markdown rules for Turndown (tables, strikethrough, task lists); the package ships no types.
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
}
