# Ledgerly

Ledgerly is a privacy-first, local-first invoicing app for independent businesses. It runs in a browser or as an optional macOS desktop app. A new workspace is empty, and Ledgerly has no account system or application backend.

## What it does

- Create invoices, clients, products, and manually recorded payments
- Track draft, sent, overdue, partial, paid, void, and cancelled invoices
- Export invoices as PDFs and records as CSV or JSON backups
- Keep invoice totals accurate across supported currencies
- Customise invoice layouts, colours, density, and logo placement
- Work as an installable web app or a native macOS application

## Quick start

Ledgerly needs Node.js 22.12 or newer. Node.js 24 and npm 10 or newer are recommended.

```bash
npm ci
npm run dev
```

Open `http://localhost:4173`.

## Privacy and data

The browser app stores its workspace in browser local storage. The Electron app also keeps a native copy in the current user's application-data directory, with a previous-state recovery copy. Download JSON backups regularly; browser storage can be cleared by browser settings.

Ledgerly does not offer cloud sync, user accounts, payment processing, email delivery, or public invoice links. The sharing flow prepares local copy text only. No invoice data is sent to a Ledgerly service.

## Development

```bash
npm run frontend:verify
```

This runs TypeScript checking, unit tests, and a production build. UI component tests do not exist yet, so manually check any screen you change.

| Path | Responsibility |
| --- | --- |
| `src/domain.ts` | Invoice state, currency math, and date helpers |
| `src/persistence.ts` | Local-storage format, recovery, and migrations |
| `src/store.tsx` | Application state and persistence ownership |
| `src/App.tsx` | Application interface |
| `electron/` | Native storage, updater, and desktop window |

Money is stored as integer minor units. User-facing dates are local `YYYY-MM-DD` values. See [CONTRIBUTING.md](CONTRIBUTING.md) before changing either convention.

## Desktop builds

macOS and Xcode command-line tools are required for desktop packaging.

```bash
npm run desktop:build    # unpackaged app for native QA
npm run desktop:package  # DMG and ZIP for a native release
```

The desktop updater is disabled until `LEDGERLY_UPDATE_HOST` and `LEDGERLY_UPDATE_PUBLIC_KEY` are set. `npm run frontend:bundle` creates an update manifest. Set `LEDGERLY_UPDATE_KEY` only in a secure release environment; never commit it, customer data, or generated release files.

A public macOS release must be signed and notarized. A locally built DMG is not a public release.

## Static deployment

Run `npm run build`, then serve `dist/` from an HTTPS host with `index.html` fallback routing. HTTPS is required for service-worker caching outside localhost.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md). Dependency and distribution notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Ledgerly is licensed under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
