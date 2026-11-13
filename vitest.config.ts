import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
import { repoUrlOf } from './src/core/repo-url';

// The repository the links point to, as the build sets it (wxt.config.ts); __STORE__ and __RELEASE_BUILD__
// are left out, so that tests stub them (core/build, core/links).
const repo = repoUrlOf(JSON.parse(fs.readFileSync('package.json', 'utf8')), process.env);

export default defineConfig({ define: { __REPO_URL__: JSON.stringify(repo) }, test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup-dom.ts'] } });
