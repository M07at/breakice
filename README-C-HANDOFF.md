# Member C integration handoff — for the next developer or AI

Recorded 2026-10-31. This document describes the current local checkout, not a claim that the complete four-person product is released.

## 1. Start with the actual checkout

Read the root README, this file, `app/package.json`, and the interface files below. Inspect `git status` and the existing diff before making changes. Check Git status/history for the current C1–C4 commit state; do not reset, clean, replace the checkout, or overwrite teammates' changes while integrating it. Fetch/rebase/merge only after preserving the current work in a reviewable branch or commit.

Older `docs/C-模块计划.md` and `docs/C-集成指南.md` contain useful background but also obsolete descriptions of single-phone pages. There is now only **one phone per player**. Do not restore `pages-uc/play.vue`, `ClassicGame.vue`, `startLocalGame`, a player switcher, or an automatic “current actor becomes me” UI.

## 2. Read these boundaries first

- `app/src/modules/undercover/player.ts`: `UcPlayerPort`, personal snapshots, permissions, snapshot ordering, and `installPlayerPort`.
- `app/src/modules/undercover/backend.ts`: command types, request metadata, local reference adapter and deduplication semantics.
- `app/src/modules/undercover/engine.ts`, `types.ts`, `rules.ts`, `view.ts`: pure game logic, state, events and public/private projections.
- `app/src/pages-uc/components/GameSetup.vue` and `PlayerGame.vue`: shared internal components behind the independent routes.
- `app/src/modules/bank/repository.ts`, `language.ts`, `validate.ts`, `service.ts`, `importer.ts`: bank interface, language detection, validation and file contracts.
- `app/src/modules/local/player-preview.ts` and `session.ts`: current development transport and bank-repository selection.
- `app/dev/c1-preview-plugin.ts`, `c1-preview-store.ts`, `c3-bank-store.ts`: development HTTP service and persistence. These are fixtures, not production platform implementations.

The `.me` field on `LocalUcBackend` is used internally by fixtures/tests. It must never become a production UI identity selector. Real adapters bind the authenticated user independently of command payloads.

## 3. Resolve the pending Gitee CI task

**Solution:** activate a Gitee job that executes the already implemented checks, then enforce its result before merge. This requires a repository administrator's authenticated Gitee settings. No authenticated Gitee CLI/connector was available in this session, and no account settings were changed. Do not report this as enabled merely because configuration files exist.

The prepared inputs are `scripts/ci.sh`, `.gitee/ci-job.json`, and `docs/c/engineering.md`. The JSON file is a human/machine-readable setup recipe, not a Gitee workflow importer. Do not rename it to YAML and assume it will run.

Administrator checklist:

1. Open the repository's pipeline settings and provision/select a **Node.js 22** runner. Confirm the account's actual available runtime; use a suitable custom runner if necessary.
2. Bind this repository as the code source. For review checks, build the PR's current candidate revision, not a stale checkout of master.
3. Execute from the repository root: `sh scripts/ci.sh`. It enters `app`, runs `npm ci --no-audit --no-fund`, then `npm run verify`. On a Windows runner, configure the equivalent two npm commands with `app` as the working directory instead of assuming `sh` is installed.
4. Enable PR creation/update targeting master and push-to-master triggers. Confirm the account's source/target branch filters using a real test PR.
5. Preserve the failing exit code. Do not add `|| true`, ignore failures, or mark a failed build successful.
6. Retain `app/reports/verify.json`, `tests.xml`, `release-manifest.json`, and the two `app/dist/build` target directories as job artifacts. Retain the failure report even when a build stops early; later artifacts may not exist.
7. Configure the resulting check as required before merging, where the repository/account supports it. If that capability is unavailable, record the limitation and use an enforced maintainer review gate with a linked successful run. Do not describe a manual review as automatic protection.
8. Create a disposable PR with an intentional failing test. Verify a red result on the correct revision and that merge is blocked. Fix the test, verify green, and record both run links and the repository protection setting.

Completion evidence: a linked hosted run, a failing-then-passing PR demonstration, and verified merge protection. A screenshot of the recipe file or a local green run is insufficient. No automatic upload, deployment, release or merge is part of this job.

Official references: [Gitee code-source triggers](https://help.gitee.com/enterprise/pipeline/source/trigger/), [Gitee Go](https://gitee.com/features/gitee-go). Exact account UI/runtime availability must be checked by the administrator.

Until activation, run `npm --prefix app run verify` locally and attach the current report to the PR; that is an interim review step, not a replacement for hosted CI.

## 4. Integrate A's platform through the personal port

Implement `UcPlayerPort` against the authenticated platform service. Its methods are `load`, `getMyWord`, `act`, `replay`, and optional drawing submission. A snapshot includes `sessionId`, `gameId`, increasing `gameNumber`, the fixed `playerId`, `hostId`, public roster, public `view`, and `serverNow` in milliseconds.

Before D navigates into a game, install the correct session adapter:

```ts
import { installPlayerPort } from '@/modules/undercover/player'

// realClassicPort must implement UcPlayerPort for the logged-in user.
installPlayerPort(realClassicPort, 'classic')
uni.navigateTo({ url: '/pages-uc/player' })

// For the separate hybrid game session:
installPlayerPort(realHybridPort, 'draw')
uni.navigateTo({ url: '/pages-uc/hybrid-player' })
```

Use the plain production route after installation. Query parameters named `session` and `ticket` intentionally select the development preview adapter; do not pass fixture tickets when entering through real login.

Preserve these invariants:

- `playerId` always means the logged-in user, never the current speaker/drawer or next voter.
- The server validates membership, host rights, alive state, phase and deadline. Hiding a button is not authorization.
- Word allocation, voting, elimination and winner decisions run on the authoritative service. Reuse the pure engine; do not duplicate rules in UI or RPC code.
- Public snapshots omit living players' camps and all words until the documented reveal conditions. Fetch only the authenticated user's private word. Never broadcast the full `UcState`.
- New matches increment `gameNumber`; commands for an old `gameId` cannot affect a new match. The UI ignores older snapshots and rejects identity changes.
- Persist request receipts and state atomically in a real backend. Retry an uncertain result with the same request ID and payload. Matching phase/round/turn context permits independent concurrent word acknowledgements/votes; stale earlier-stage commands remain invalid.
- Use server deadlines/time. Clients display a countdown; they do not independently choose the next phase or winner.
- A supplies actual reconnect channels and host-transfer semantics. The development host identity is fixed and is not a production implementation of host transfer.

Setting Supabase public values in `.env.local` does not install this adapter. The current `backendConfigured` flag means only that public configuration is present.

## 5. Keep one shared question bank

Both variants read the same `gameType: 'undercover'` collection. `variant: 'draw'` means hybrid gameplay, not the unrelated bank `gameType: 'draw'` used by B's ordinary drawing game. Do not create separate classic/hybrid copies of every word pair.

The pair content is `civilian`, `undercover`, and optional `drawable`; records also carry tags and difficulty. Language uses `lang:zh` / `lang:en` tags to remain compatible with the current JSON/CSV formats. Legacy Chinese records are detected by `languageOf`. Hybrid uses the chosen language plus `drawable=true`. The defaults currently include 157 Chinese and 60 English pairs.

Implement a production `BankRepository` and replace/register it at `app/src/modules/local/session.ts`'s `bankRepo()` factory. This factory currently selects the shared development HTTP proxy for H5; there is not yet a public production bank injection function. All bank-editor operations and authoritative game picking must use the same production repository/database.

The database supplies authenticated ownership and RLS. The development service forces a single `local-host` workspace editor identity; do not carry that identity into production. `getBank`/`listItems` alone are not a production authorization layer.

Preserve stable IDs and normalization/deduplication rules when migrating. Both sides of a pair must remain distinct; swapped pairs count as duplicates. Preserve language tags, category tags, difficulty and drawable flags during import/export. A word-bank edit changes future games, not words already assigned in an active match.

Back up `app/.c3-data/banks.json` before replacing the development store or switching machines. It contains custom-bank data and is ignored by Git; it is not included in source ZIPs. Seed/system banks are loaded from code. Game sessions/request receipts are only in memory in the preview service. Older browser-local bank storage is retained but is not automatically migrated into this file; import its exported JSON/CSV explicitly.

## 6. Integrate B's canvas and scoring

The current `MockDrawingAdapter.vue` is explicitly a symbol/outcome simulator. Replace its use through an adapter around B's component; do not copy and fork B's canvas implementation.

Agree the real props/events with B: room/game/round/turn identity, drawer ID, editable flag, deadline, restored drawing state and an idempotent submission reference. Only the current authenticated drawer may submit. A viewer must be read-only. The current mock `DrawingSubmission.preview/scoreMode` format is not an agreed production upload API; remove user-controlled score outcomes from the real adapter.

Implement `UcPlayerPort.submitDrawing` to associate B's exported artifact with the authenticated drawer/turn. Preserve retries without duplicate artworks or scoring requests. Adapt the artwork gallery to B's renderer rather than displaying a raw URL as text.

A invokes the actual AI service. Pending/success/failure/timeout must settle without freezing review/voting. Current proposed rules use AI for an optional bonus, not the camp winner; confirm the policy with the team before changing it. Current mock success is a fixed test score, not a measured AI output.

Engine events are named `phase`, `speaker`, `eliminated`, `ended`, and `score`; they are not already platform events named `game.finished`. Map them explicitly if the platform uses other names. B's unified scoring needs stable game/event IDs and deduplication; durable cross-service delivery is not implemented by the local callback. Never increment rankings separately on every client's copy of a result.

## 7. Integrate D's lobby and shared UI

Use separate routes: classic setup `/pages-uc/setup`, classic play `/pages-uc/player`; hybrid setup `/pages-uc/hybrid`, hybrid play `/pages-uc/hybrid-player`. D can bypass the development setup after its actual room flow installs the personal adapter. Replace development seat links with the real room/share flow.

The host remains a normal participant. Preserve waiting screens after own word confirmation/vote submission and show the current speaker on every phone. Do not give the host other players' words or vote controls.

D supplies design tokens, player cards, public profile visibility, room navigation and sharing. Replace C's temporary visual primitives with shared components while keeping state/actions in C's modules. The current dev home is an entry harness, not the completed D lobby. C's player UI does not yet supply a real “今天认识的人” service or profile privacy backend.

## 8. Integration order and acceptance

1. Preserve the current work and run the baseline checks. Agree the still-provisional rules in `docs/c/undercover-rules.md` and `hybrid-rules.md`.
2. Connect A's fixed-user port and shared repository. Run the existing engine/contract/bank tests against adapter behavior.
3. Connect D's room entry/navigation to the two game routes. Test four actual authenticated clients through a complete classic game.
4. Replace the hybrid mock canvas and AI adapter with B/A implementations. Verify success, failure, timeout, duplicate submissions and reconnect restoration.
5. Activate/verify hosted CI as described above. Record real device and cross-room authorization results in `docs/c/release-checklist.md` before claiming release readiness.

Essential checks: private words, independent simultaneous votes, non-speaker rejection, dead-player rejection, request replay, stale round/game rejection, two victory branches, ties/timeouts, reconnect/host transfer, shared bank edits, both languages and drawable filtering, JSON/CSV round trips, scoring deduplication, and old data remaining readable.

Latest local evidence: 117 application tests plus 3 quality-gate tests, both production builds, package/secret checks and a 90-file release manifest passed. Browser mock walkthroughs covered six independent players, hybrid fallback, separate routes and shared bilingual custom banks. Intentional TypeScript/test failures stopped verification before builds. None of those results establishes production RLS, real WeChat device compatibility, actual pen-sync/AI latency, or a hosted CI run.

## 9. Hand back concrete evidence

Provide the reviewed diff/commit IDs, installed adapter and interface versions, CI run links, device/network details, completed checklist items and remaining failures. Keep `.env.local`, credentials, local bank data and build outputs out of commits. Do not describe tests that were not run as passed, or placeholders as real integrated services.
