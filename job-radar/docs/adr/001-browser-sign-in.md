# ADR-001: How Auto-fill's browser signs in to job sites

**Status:** Accepted · **Date:** 2026-09-26 · **Deciders:** Shubham

## Context
Auto-fill stopped at login walls (jsgurujobs, Workday accounts, LinkedIn, Wellfound). Many sites use Google sign-in or 2FA, and Google refuses sign-ins typed by automated browsers. Job Radar is local-only.

## Options
- **A. Credentials file** (email + password per site): plain-text secrets in a folder scripts and agents read; fails on Google sign-in and 2FA; login code per site. Rejected.
- **B. Bitwarden CLI** (`bw get`, code types the password): encrypted at rest, but still automated password typing, so the same Google/2FA wall plus vault-unlock plumbing. Deferred.
- **C. Persistent signed-in browser profile** — chosen. You sign in once per site in Job Radar's own Chrome window; cookies persist; Job Radar never sees a password.
- **D. Attach to a Chrome you start yourself** (remote-debugging port): fallback if Google rejects sign-in in C's window.

## Decision
C. Password managers: install the Bitwarden extension from the Chrome Web Store inside that window once and sign in to it; you click its autofill yourself.

## Consequences
- Works with any sign-in method; no secrets in the app or repo.
- First sign-in per site is manual; sessions expire occasionally. Auto-fill detects a visible password field, stops without filling, and asks you to sign in.
- The profile (`data/browser-profile/`, git-ignored) holds live sessions: anyone with your macOS account can use them, same as your everyday Chrome.
- Revisit D if Google blocks sign-in; revisit B only for unattended logins on plain email+password sites.
