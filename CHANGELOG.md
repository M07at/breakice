# Changes

## Unreleased
- Integration: merged D's WeChat mini-program lobby base with C's modules on `feature/integration`;
  unified package/pages/manifest/vite/tsconfig, kept D's uni-app runtime, wired lobby and room entries
  to `pages-uc` and `pages-bank`, prefilled undercover seats from the room roster, and moved
  truth-or-dare prompts onto C's shared bank (69 truth + 52 dare). Multi-device realtime inside the
  mini program still needs A's `UcPlayerPort`; the H5 preview service remains development-only.
- Integration: merged B's `feat/b-drawcanvas` (ddbb310) into the same branch — `pages-draw` subpackage
  registered as a third subpackage and reachable from the room lobby. B's draw room is a local,
  single-device backend and its canvas only works in WeChat DevTools, not in the H5 preview.
- B1: draw engine (strokes / undo / redo / emoji), chunked stroke transport, AI scoring client with mock
  fallback, classic / emoji / custom variants, chat answering, reveal and settlement.
- B2: unified scoring (configurable AI weight, cap, idempotency) and leaderboard.
- C1: fixed-player classic game, private reveal, deadlines, voting, replay and command protection.
- C2: synchronized hybrid mock drawings, review stage and scoring fallback; actual canvas/AI not integrated.
- C3: independent game routes, Chinese/English defaults and shared persistent development question bank.
- C4: environment doctor, reproducible checks/reports, release hashes and Gitee activation recipe. Hosted CI activation remains pending.
