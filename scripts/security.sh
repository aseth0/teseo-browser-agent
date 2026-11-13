#!/bin/sh
# Security checks, run by `pnpm security` and by CI (checks.yml, which build.yml and release.yml call):
# - Semgrep's JavaScript, TypeScript, security-audit and secrets rules over the extension's own code. A finding
#   that is safe by design gets a `nosemgrep: <rule>` comment saying why.
# - The shipped dependencies' known vulnerabilities, high and critical (pnpm audit).
# Semgrep comes from PATH, else uvx or pipx at the version below. Nothing is sent but the rule download.
set -eu
SEMGREP_VERSION=1.183.0

if command -v semgrep >/dev/null 2>&1; then
  set -- semgrep
elif command -v uvx >/dev/null 2>&1; then
  set -- env UV_PYTHON_PREFERENCE=only-managed uvx --python 3.12 "semgrep@$SEMGREP_VERSION"
else
  set -- pipx run --spec "semgrep==$SEMGREP_VERSION" semgrep
fi

"$@" scan --metrics=off --error --quiet \
  --config p/javascript --config p/typescript --config p/security-audit --config p/secrets \
  src public scripts wxt.config.ts

pnpm audit --prod --audit-level high
