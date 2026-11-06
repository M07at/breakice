# 破冰局 — Complete session changelog

Recorded: **6 November 2026, Asia/Shanghai**. Current application: **v23-1106-deepseek**. The preceding v22 baseline is commit **84f3c83**. After trying DeepSeek, the user reported it satisfactory and authorized committing the integration and changelog to the Gitee main branch (`master`).

This records the changes, setup work, fixes and testing covered by this development conversation. It distinguishes the existing project foundation from later requested changes. API keys, access tokens and passwords are intentionally excluded.

## 1. Repository and development setup

- Established the active checkout at `D:\Software Project\break-ice-hall`, connected to [amadys/break-ice-hall on Gitee](https://gitee.com/amadys/break-ice-hall).
- Continued development on `master`, preserving and pushing the completed integration work.
- Installed the application dependencies and built the uni-app project for WeChat Mini Program and H5.
- Corrected the initial WeChat import problem: the repository source is not a directly runnable native mini-program. DevTools must load the compiled `mp-weixin` output, which contains `app.json`.
- Configured the actual Mini Program AppID, `wxe68c87b8910a3ec8`, superseding the early tourist/test AppID discussion.
- Enabled and used the WeChat DevTools service port and CLI for compilation, simulator checks and fresh phone preview QR codes.
- Kept client configuration, local project settings, development reports and server credentials out of feature commits where appropriate.
- A phone preview contains the code packaged when its QR was generated. Changing source alone does not update an already-open phone preview; new builds received fresh QR codes.
- The user selected **preview QR distribution**. No public release or experience-version upload was performed in these changes.

## 2. Existing application foundation and earlier integration

The original project and its earlier integration commits already supplied much of the game foundation. These are part of the current application, rather than features invented during the latest UI fixes:

- Vue 3 / TypeScript / uni-app application with WeChat and H5 targets.
- Room lobby, avatar creation, room codes, readiness and host game selection.
- 谁是卧底: private words, individual player identities, speaking order, deadlines, voting, elimination, win conditions and replay.
- 你画我猜: strokes, colors, undo/redo, erasing, canvas export, emoji/custom variants, guesses and settlement.
- 你画我猜谁是卧底: drawing integrated with Undercover rules and individual player pages.
- 真心话大冒险: shared room turn/question state and room-based navigation.
- Supabase profiles, rooms, membership, games, private words, artwork storage and score records.
- Authenticated `uc-command` game commands and personal `UcPlayerPort` integration.
- Realtime room/game notifications with polling fallback.
- Private image storage, signed image URLs and room QR code generation.
- Chinese/English system banks, private-bank management, CSV/JSON import/export and development-bank persistence.
- Build checks, generated backend bundles, release manifests, package-size checks and secret scanning.

The older [`CHANGELOG.md`](./CHANGELOG.md) retains historical implementation notes. Some entries describe intermediate states that were subsequently replaced; the current behavior is recorded below.

## 3. Online Supabase and WeChat connectivity

- Connected the Mini Program to project `qfgyotxmcqmrbpjktuzo` at `https://qfgyotxmcqmrbpjktuzo.supabase.co`.
- Configured authenticated profile, room, game and artwork paths rather than treating the local development fixture as the online server.
- Verified deployed backend behavior with temporary authenticated test accounts and disposable rooms.
- The user saved the Supabase HTTPS domain for WeChat request, uploadFile and downloadFile, and its WSS equivalent for socket requests.
- Distinguished WeChat domain checking/debug mode from the preview package itself. Disabling debugging and scanning a preview are separate operations.
- Fixed short-lived room errors so the phone displays the actual failure in a persistent dialog.
- Investigated the phone's profile-sync/room-entry failure. The user confirmed that the same preview worked on Wi-Fi while 4G timed out.
- Increased login/Auth timeout to 45 seconds and profile/create/join timeout to 30 seconds. AI requests allow 60 seconds; ordinary reads/game requests retain shorter deadlines.
- Kept timeout/domain/authentication errors distinct from compatibility fallbacks and avoided blindly repeating room-creation requests.
- These changes do not establish reliable connectivity on every mobile carrier. Wi-Fi was the verified demo route.

Commits: `cc387cf`, `4ab83d1`, `ad7959a`.

## 4. Test bots: maximum five

- Increased the test bot cap to **5**.
- Enforced the cap in the shared rules and deployed backend, including oversized requested counts.
- Preserved automatic filling of a four-player Undercover game when too few humans are present.
- Did not add the previously discussed unlimited-bot or extra AI-control interface.

Commit: `a9250c1`; deployment verification: `cc387cf`.

## 5. Album QR joining

- Added camera/album scanning to the room-code join flow.
- Used `onlyFromCamera: false`, allowing users to choose a QR image saved in their album.
- Kept manual room-code entry available.
- Generated fresh mini-program preview QR codes for the user and authorized testers as the application changed.

Commit: `a92e0b3`.

## 6. Game name and MBTI

- Added the home-page label **请你填你的游戏名字**.
- Added optional selection of all 16 MBTI types, including an option to leave it unset.
- Saved MBTI separately from the nickname and authenticated user ID.
- Added shared name/MBTI presentation across room and game interfaces.
- Applied four visual groups: NT analysts purple, NF diplomats green, SJ sentinels blue/teal, SP explorers yellow.
- Added self-profile RPC support, normalization, invalid-value rejection and clearing an existing MBTI value.
- Included profile information in room rosters and game snapshots, with compatibility handling for older deployments.
- Applied migration `0023_profile_mbti.sql` and verified actual backend writes and cross-player roster reads.

Commits: `fca93be`, `cc387cf`.

## 7. Custom drawing prompt and timer

- Added a custom-prompt setup flow for the ordinary drawing game.
- Allowed the host to choose **30, 60, 90, 120 or 180 seconds**, with a 90-second default.
- Passed the selected duration through shared round state so players use the same deadline.
- Preserved the selected duration when advancing rounds.
- Prevented a cancelled/empty custom prompt from silently starting a game; normalized invalid duration parameters.

Commit: `65cb658`.

## 8. Real drawing AI integration

- Replaced the ordinary online drawing path's mock AI scorer with a real server-side scoring call.
- Added the `draw-score` Edge Function and `draw_ai_scores` receipt/cache table for ordinary drawing sessions.
- Kept hybrid scoring in `ai-score`, backed by private artwork records and private per-player words.
- Restored the original Drawzy CNN in an isolated local Python service.
- Corrected the original model's label alignment: it has **46 outputs**, while the upstream label list omitted `aircraft carrier` at index zero.
- Aligned ink/background preprocessing with the training bitmap convention.
- Added authenticated service access and a temporary tunnel used by Supabase, keeping service credentials out of the mini-program.
- Added a restart helper that checks service/tunnel health and refreshes Supabase's AI endpoint configuration.
- Kept phones connected only to Supabase; they do not call the local AI tunnel directly.
- Added receipt idempotency, image-path ownership checks, explicit unavailable/unsupported outcomes and tests against actual hosted endpoints.

Commit: `35be642`; migration: `0024_draw_ai_scores.sql`.

## 9. Removed the repeated high-score behavior

- Investigated nearly repeated high scores such as 69/79.
- Removed a generous time-based bonus and the rule that over-rewarded a target merely appearing in the top five predictions.
- Changed both scoring endpoints to use the target category's actual model confidence on a 0–100 scale.
- Shared the recognition evaluation rules between ordinary and hybrid drawing.
- Versioned score receipts so old successful caches do not silently retain an obsolete grading algorithm.
- Prevented stale successful scores from appearing beside failed artwork scores.

Commit: `7fb5375`.

## 10. Fixed the complete drawing-game lifecycle

- Added **完成作画并提交** to hybrid drawing.
- Made an early drawing submission advance through the existing turn-completion rule immediately.
- Moved hybrid AI scoring off the critical transition path so review/voting can proceed if AI is slow or unavailable.
- Preserved the Undercover game rules: private word → drawings in order → review → vote → reveal/elimination; another round follows if no terminal condition is reached.
- Closed the whole match on a winner, round limit or host early end.
- Synchronized the ended game and room/lobby state instead of leaving an apparently active game behind.
- Cleared readiness when a match ends; a new game requires fresh readiness.
- Returned players to the lobby after the results display, with a manual return option.
- Prevented old drawing-session completion requests from closing a newer game.
- Prevented late ordinary-drawing AI responses from reopening a finished round.
- Waited for pending drawing-state publication before cleanup and released polling/automatic-submission timers on exit.
- Validated AI score receipts on the server rather than trusting arbitrary scores sent by clients.
- Added atomic backend lifecycle handling and migration/rollback `0025_drawing_lifecycle.sql`.

Commit: `88f3923`.

## 11. One-player ordinary drawing tests

- Changed ordinary **你画我猜** to allow **1 real player** for testing.
- Preserved the real authenticated roster and user identity; no phantom second seat is added.
- Verified drawing → reveal → ended behavior for a genuine one-person roster.
- Undercover/hybrid retains its multiplayer rules and bot filling.

Commit: `88f3923`.

## 12. Drawing timer and artwork display

- Enlarged the drawing/review/voting countdown and kept it visible while scrolling.
- Added warning colors for the final five seconds.
- Reset page position on initial load and relevant phase changes so the next stage is noticeable.
- Removed the brief private JPEG/PNG filename fallback while artwork URLs load; the gallery shows **画作加载中…** instead.
- Removed the repeated **完整接力画** block.
- Kept hybrid drawings independent instead of seeding the next player's canvas with the previous picture.

Commit: `88f3923`.

## 13. Full-row lobby and visible MBTI

- Changed the lobby from two player cards per row to **one player per row**.
- Gave the name, MBTI badge, host badge and readiness indicator adequate space.
- Limited ellipsis to the name itself so a long nickname cannot hide the MBTI badge.
- Reduced multiple empty seat placeholders to one waiting-to-join row.
- Checked long names and multiple MBTI groups in an isolated WeChat simulator fixture.

Commit: `1c3c93f`.

## 14. Direct snowman color changes

- Made the snowman's body tappable to cycle its color.
- Changed color immediately instead of sliding the whole color/body layer away during an animation.
- Kept the existing layer-selection arrows and their other animations.
- Added the visible hint **点击雪人身体换颜色**.
- Verified that the real body-tap handler updates the displayed color asset without a color slide animation.

Commit: `8a33479`.

## 15. Fixed the thin-stroke / bright-color 0–1 AI score problem

- Reproduced a separate input problem: 4px phone-canvas lines became too weak after reduction to the CNN's 28×28 input.
- Found that grayscale brightness thresholds also mishandled bright pen colors.
- Added color-aware ink extraction, white-background alpha compositing, contrast normalization, adaptive thin-line preservation and centered model input.
- Kept explicit rejection of blank and oversized images.
- Introduced `canvas-ink-v3` preprocessing and `confidence-v3` receipt checks for both deployed drawing scorers.
- Rejected results from an outdated preprocessing service and invalidated old successful scoring caches.
- Added five Python preprocessing tests and a public human-sketch acceptance test.
- On the held-out set of 48 drawings in four categories, tested in black/blue/yellow, top-one recognition improved from 0/48 to 40/48 per color. This is a measured subset result, not an accuracy claim for every category or user drawing.
- Verified ordinary scoring through actual Supabase storage and the live recognizer.
- Verified that both drawing-game endpoints return the same score for the same picture and private prompt, and preserve the score on repeated requests.
- Unified the console and lobby build tag as **v22-1106**, replacing the misleading old lobby v15 label.

Commit: `fa71f91`.

## 16. Native 词库管理 smoke tests

- Added a reproducible isolated mini-program smoke project and PowerShell runner.
- Tested all four management categories: Undercover, drawing, truth and dare.
- Verified system-bank availability/read-only protection and private-bank ownership restrictions.
- Verified creating/renaming banks, adding/editing/deleting items, duplicate handling and invalid-batch behavior.
- Verified CSV and JSON round trips, including Chinese text, content, tags, difficulty and drawable flags.
- Restarted the actual mini-program runtime and verified restoration of 12 test banks/copies, then removed the recorded test banks.
- Exercised real native UTF-8 file reading/writing and cancellation handling; file sharing was mocked so no messages were sent.
- Also checked the visible management forms: create a bank, save 苹果 / 香蕉, edit it to 苹果 / 西瓜, and delete the temporary bank.
- Documented the actual storage boundary: native custom banks are device-local; online Undercover still selects from server-built-in words.

Commit: `84f3c83`. Instructions: [`docs/c/bank-smoke.md`](./docs/c/bank-smoke.md).

## 17. Checks and delivery evidence

Latest completed v22 validation:

- **313 application tests** passed.
- **3 project-quality tests** passed.
- **5 Python preprocessing tests** passed.
- TypeScript, generated-function freshness, H5 build and WeChat build passed.
- Package size approximately **0.98 MB total**, main package approximately **0.88 MB**.
- Client/source secret checks passed.
- Live scoring, authenticated rejection checks, receipt caching and cross-game score comparison passed.
- Native bank CRUD, CSV/JSON, restart persistence and file-IO smoke tests passed.
- Isolated simulator test pages were excluded from the production preview.
- Each completed feature was committed and pushed separately to Gitee.
- Fresh preview QR packages were generated through v22. The user's latest feedback says the application is now working well; that is not a separate four-real-phone regression test.

Reports remain under ignored `app/reports`. Feature evidence is described in [`docs/c/drawing-scoring.md`](./docs/c/drawing-scoring.md) and [`docs/c/bank-smoke.md`](./docs/c/bank-smoke.md).

## 18. Remaining boundaries at v22, before DeepSeek

The first three AI limitations below describe the former v22 service; section 19 supersedes them for the new DeepSeek scoring path.

- The current CNN recognizes a limited object vocabulary. Confidence is not a general semantic or artistic-quality grade. For example, 图书馆 is outside its 46-class vocabulary, so a low score does not prove that a library drawing is poor.
- The current Chinese-word mapper also permits substring matches. A compound prompt can be mapped to a simpler supported object; this is another reason not to use that classifier as an arbitrary-prompt semantic judge.
- The AI service currently runs on this PC through a temporary tunnel. The PC must stay awake and online. The restart helper is not permanent hosting.
- Custom native banks are not yet connected to cloud-shared custom-bank selection for online Undercover.
- Reliable 4G access on every carrier has not been established.
- Public release, required filing/account preparation, hosted Gitee CI activation and a complete multi-human phone regression are not claimed complete here.

## 19. New request: DeepSeek semantic-similarity grading

**Status: backend replacement deployed; user reported DeepSeek satisfactory and authorized committing v23 to Gitee `master` on 6 November 2026.**

The user requested that both drawing games use a vision model to judge how well the actual drawing represents its assigned prompt. The new shared DeepSeek backend replaces classifier confidence with semantic similarity. Existing room lifecycle, authenticated identity, private words, image ownership checks and Undercover game-point rules are retained.

Changes in v23:

- Both `draw-score` and `ai-score` use the same server-only `deepseek-flash` image grader.
- The actual uploaded picture is compared with the server's private assigned prompt, including prompts outside the old 46 categories.
- The grade is semantic similarity, 0–100, with a short Chinese explanation. It is not model probability, download time or a composition/creativity weighted total.
- The rubric accepts rough finger drawings, penalizes blank/unrelated pictures and does not reward merely writing the answer.
- Grading results are validated and saved; repeat calls reuse the same saved DeepSeek grade. Old classifier receipts are not reused as DeepSeek results.
- Normal drawing no longer filters the word bank down to the old classifier vocabulary.
- The API key is stored as `DEEPSEEK_API_KEY` in Supabase server secrets. Neither the mini-program nor this document contains it.
- The new AI path calls DeepSeek directly from Supabase and no longer relies on the PC's local recognizer/tunnel.
- TypeScript checking and the WeChat build passed. Backend deployment and server-secret configuration completed.
- The change was initially held uncommitted at the user's request. After manual use, the user reported DeepSeek satisfactory and requested committing it to the main repository. Application smoke tests remain skipped as requested; this feedback is not a claim of a complete automated or multi-phone regression.

Current official DeepSeek documentation lists image input for `deepseek-flash`; `deepseek-v4-pro` is not the vision choice. Integration details and the earlier bounded feasibility-check result are recorded in [`docs/c/deepseek-scoring-plan.md`](./docs/c/deepseek-scoring-plan.md).

No API key is included in this changelog. Any production credential belongs in server-side Supabase secrets, never in the mini-program package or Git.
