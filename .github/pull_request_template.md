## What and why

<!-- What this changes, and the problem it solves. Link the issue if there is one. -->

## Texts sent to the model

<!-- A new or changed text in TEXT_DEFS (src/core/texts/defs-*.ts): its wording and where it goes.
     Otherwise write "None". -->

## Checklist

- [ ] `pnpm compile && pnpm lint && pnpm test` pass, and `pnpm security` (Semgrep and `pnpm audit`).
- [ ] Checked in a browser (the build from this branch's GitHub Actions run, or a local `pnpm build`).
- [ ] Tests for what it changes.
- [ ] A line in `CHANGELOG.md` under the next version (*Added*, *Changed*, *Fixed*…).
- [ ] Dependencies, if any were added or updated, pinned to exact versions.
- [ ] English only, and nothing personal or from a company: no real hosts, names, paths, accounts, tokens,
      screenshots or logs in code, tests, docs or commits.
