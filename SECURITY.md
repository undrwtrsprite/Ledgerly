# Security Policy

## Supported versions

Security fixes target the current `main` branch and latest desktop release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or expose customer data, local backups, private keys, or proof-of-concept payloads in an issue.

Use GitHub private vulnerability reporting once it is enabled for this repository. Until then, contact the repository owner privately through GitHub and include affected version, reproduction steps, impact, and any safe mitigation you found.

## Scope

Ledgerly is local-first. The browser app stores records in browser local storage; the Electron app also persists records in its user-data directory. The optional desktop frontend updater accepts only HTTPS update hosts and verifies a signed manifest before staging an update.
