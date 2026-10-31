# 破冰局 / Break Ice Hall

A WeChat mini-program project for face-to-face icebreaker games. **Each participant uses their own phone.** The host is also a player; the game controls turns, voting and results.

**For the next developer or AI: read [README-C-HANDOFF.md](README-C-HANDOFF.md) before integrating member C's work.** It records the actual interfaces, shared data model, mock boundaries, CI activation steps and acceptance checks. Some older planning documents describe superseded single-device prototypes; the current code and handoff take precedence for implementation status.

## Current member C delivery

- 谁是卧底: fixed-player private words, speaking turns, timers, voting, elimination, results and replay.
- 你画我猜谁是卧底: separate pages, synchronized mock drawing submission, artwork review, voting and scoring failure/timeout paths. B's real canvas and A's real AI are still integration work.
- Shared question bank: 157 Chinese and 60 English default pairs, word-language selection, custom-bank CRUD, filtering and JSON/CSV import/export. Both games use one `undercover` collection; hybrid additionally filters drawable pairs.
- Engineering: environment checks, fail-fast verification, JUnit/JSON reports, WeChat and H5 builds, package limits, secret scanning and release hashes.

The development server synchronizes separate browser/phone clients. Custom banks persist in `app/.c3-data/banks.json`. This is a **local development data source**, not an implemented Supabase production database or WeChat login service. Game sessions are in memory and expire when the preview server restarts.

## Quick start

Use Node.js 22 as the team's CI baseline. From the repository root:

```powershell
Set-Location app
npm ci
npm run doctor
npm run dev:players
```

For phones, open the **Network address** printed by Vite while connected to the same reachable network as the computer. The home has separate entries for the two games. Create a test game, then distribute a different seat invitation to each participant. A localhost link works only on that same computer.

No real credentials are required for this preview. If configuring public platform values, copy `app/.env.example` to `app/.env.local`. Public configuration alone does not install a real platform adapter. Never put service-role, AI, AppSecret or upload credentials in frontend variables.

## Independent game routes

- Classic setup: `/pages-uc/setup`; personal game: `/pages-uc/player`.
- Hybrid setup: `/pages-uc/hybrid`; personal game: `/pages-uc/hybrid-player`.
- Shared bank management: `/pages-bank/index` and `/pages-bank/detail`.

The separate routes reuse internal components and one bank repository. There is no phone-handoff mode or player switcher.

## Verification

```powershell
npm --prefix app run verify
```

This runs environment checks, TypeScript, application tests, quality-gate tests, both production builds, package-size and secret checks, and a release manifest. Any failed stage stops the pipeline and returns a nonzero exit code.

Reports: `app/reports/verify.json`, `tests.xml`, `release-manifest.json`. Builds: `app/dist/build/mp-weixin` and `app/dist/build/h5`. Reports, builds and local bank data are not committed.

Latest recorded local evidence: 117 application tests and 3 quality-gate tests passed, with both builds and all verification stages passing. That run used Node v25.8.1; a hosted Node 22 job and real WeChat device integration have not been verified here.

## Remaining CI activation

The repository is hosted on Gitee. `scripts/ci.sh` is runnable; `.gitee/ci-job.json` is a setup recipe, **not an automatically loaded workflow**. A repository administrator must activate the job, configure triggers and require its result before merge. See the exact checklist in [the handoff](README-C-HANDOFF.md) and [engineering guide](docs/c/engineering.md). Hosted CI status has not been inspected or changed by this work.

## Ownership and integration

- **A:** production database, login/authentication, RLS, room membership, private channels, RPC and AI service.
- **B:** real drawing canvas/stroke synchronization, AI presentation, unified scoring and rankings.
- **C:** both undercover game flows and specific pages, question-bank management, engineering scripts and contracts.
- **D:** lobby/room UI, shared design system, host/player shells, Truth or Dare and sharing.

Replace C's development adapters at their boundaries; preserve the game rules, per-user privacy and shared bank semantics. Follow [the handoff](README-C-HANDOFF.md) for the integration order and concrete files.

## Current documentation

- [C integration handoff](README-C-HANDOFF.md)
- [Classic rules](docs/c/undercover-rules.md)
- [Hybrid rules and mock adapter](docs/c/hybrid-rules.md)
- [Fixed-player backend contract](docs/c/undercover-backend-contract.md)
- [Shared bank model and pages](docs/c/shared-question-bank.md)
- [Multi-device preview](docs/c/fixed-player-preview.md)
- [Engineering and CI](docs/c/engineering.md)
- [Release checklist](docs/c/release-checklist.md)
- [Changelog](CHANGELOG.md)
