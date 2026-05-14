# Security policy

We take security seriously. Thank you for helping keep `mgz-pkmn` and its users safe.

## Supported versions

`mgz-pkmn` is pre-1.0 and ships from `main`. Security fixes land on the latest
release line — older tagged versions are not patched.

| Version | Supported          |
| ------- | ------------------ |
| `main` / latest release | :white_check_mark: |
| Older tags              | :x:                |

## Reporting a vulnerability

**Please do not file public GitHub issues for security problems.** Use one of
the following private channels:

- Preferred: [GitHub's private vulnerability reporting](https://github.com/mgzwarrior/mgz-pkmn/security/advisories/new)
  on this repository. This routes the report directly to the maintainers and
  keeps the discussion private until a fix is ready.
- Alternative: email the maintainer (see the `mgzwarrior` GitHub profile for
  contact details) with the subject line `SECURITY: mgz-pkmn`.

Please include:

- A description of the issue and the impact you believe it has.
- Steps to reproduce, or a proof of concept.
- The affected version, commit SHA, or deployment (CLI / API / web SPA).
- Any suggested remediation, if you have one.

## What to expect

- **Acknowledgement:** within 3 business days.
- **Initial assessment:** within 7 business days, including severity and a
  rough timeline.
- **Coordinated disclosure:** we will work with you on a public advisory and
  credit you in the release notes (unless you ask to remain anonymous).

## Scope

In scope:

- The CLI (`pkmn` command) and library code under `src/mgz_pkmn/`.
- The FastAPI service under `api/`.
- The web SPA under `web/`.
- Build and release tooling under `.github/`.

Out of scope:

- Vulnerabilities in third-party services we query (pokemontcg.io, TCGdex,
  PriceCharting) — please report those upstream.
- Issues that require attacker-controlled access to a user's machine or
  account (e.g. modifying `~/.cache/mgz-pkmn` directly).

Thanks again for practicing responsible disclosure.
