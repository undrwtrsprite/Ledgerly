# Contributing to Ledgerly

Ledgerly is a local-first invoicing application. Keep changes small, reviewable, and safe for existing local data.

## Development

Use Node.js 24, or Node.js 22.12 or newer.

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm run frontend:verify
```

The command runs type checking, unit tests, and a production build.

## Project conventions

- Store money as integer minor units. Use helpers from `src/domain.ts`.
- Store user-facing dates as local `YYYY-MM-DD` strings.
- Keep invoice status derived from persisted state and payments.
- Route state mutations through `src/store.tsx`; components must not write persisted data directly.
- Do not edit `dist/` or `release/`. They are generated artifacts.
- Do not add real client, banking, personal, API-key, or credential data to tests, fixtures, screenshots, or commits.

## Pull requests

Describe user-visible behavior, data-migration effects, and verification performed. Add focused tests for domain, persistence, locale, PDF, or Electron updater changes. Manually exercise affected UI paths because this project has no component-test suite.
