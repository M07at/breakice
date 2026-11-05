# Features implemented since the feature/integration clone

- **Project:** 破冰局 / Break Ice Hall
- **Date:** 6 November 2026, Asia/Shanghai
- **Original:** cloned `feature/integration`, [`e64a6da`](https://gitee.com/amadys/break-ice-hall/commit/e64a6da)
- **Current:** `master`, [`d3edfeb`](https://gitee.com/amadys/break-ice-hall/commit/d3edfeb), **v23-1106-deepseek**

The local Git reflog records the initial clone at `e64a6da`; `origin/feature/integration` also points there. This document compares that feature-branch clone with the current app, not with the repository's empty initial commit.

## Player profile and lobby

### 1. Clear game-name field — improved

**Before:** The home page already had an automatically saved nickname input, without the requested explicit name label.

**Now:** The field displays **请你填你的游戏名字** and a matching placeholder. Automatic saving remains available.

### 2. MBTI selection and persistence — added

**Before:** Player profiles contained a nickname and avatar; there was no selectable MBTI profile field.

**Now:** Players can choose any of the 16 MBTI types, leave it blank, change it or clear it. The value is saved locally and synchronized to the authenticated Supabase profile.

### 3. Colored NAME + MBTI badges — added

**Before:** Room/game views displayed player names without MBTI badges.

**Now:** Shared identity components display names and MBTI in room/game interfaces, including drawing, voting and relevant leaderboard views. The four groups are **NT purple, NF green, SJ blue/teal and SP yellow**. Unset values do not create fake badges.

### 4. One player per lobby row — changed

**Before:** Two player cards shared one row. Tight name space clipped long names and could hide the subsequently added MBTI badge.

**Now:** Every player has a full-width row. Only the name is truncated when necessary; MBTI, host status and readiness retain space. Multiple empty placeholders are reduced to one waiting row.

### 5. Direct snowman color changes — added

**Before:** Players changed avatar layers using arrows. The color layer used the same sliding animation as other parts.

**Now:** Players can **tap the snowman's body to change its color immediately**. Color changes no longer slide the body out of place. The hint **点击雪人身体换颜色** explains the interaction; the arrows remain available.

## Joining and mobile reliability

### 6. Album QR joining — added

**Before:** The room scanner used `onlyFromCamera: true`, restricting it to the camera.

**Now:** The **扫码 / 相册** control beside the code field supports scanning with the camera or selecting a saved QR image from the album. Manual room-code entry is retained.

### 7. Reliable room-code parsing — fixed

**Before:** Scanned content was decoded and truncated to six characters. Invalid fragments could be accepted, and malformed encoding could throw an error.

**Now:** The parser accepts valid six-character alphanumeric codes and supported `code`/`scene` parameters. Malformed content is rejected, and cancelling the scanner is handled separately from an actual scan failure.

### 8. Persistent room-entry errors — improved

**Before:** Create/join failures mainly appeared in short toasts that disappeared before they could be inspected.

**Now:** Errors remain visible in a dialog. Domain rejection, authentication problems and timeouts have clearer messages, including the operation that failed.

### 9. Slow-mobile request handling — fixed

**Before:** Requests generally shared a 10-second deadline, including first login and room entry.

**Now:** Login/Auth allows **45 seconds**, profile/create/join **30 seconds**, and AI **60 seconds**. Ordinary reads retain a shorter deadline. Compatibility handling no longer treats unrelated network/authentication errors as an old-server issue.

The phone was confirmed working on Wi-Fi during troubleshooting. This does not establish reliable access through every 4G carrier.

## Drawing setup and development testing

### 10. Five-bot cap — increased

**Before:** The backend capped test bots at **2**. That code path could not fill one real player up to the four-player game requirement.

**Now:** Up to **5 test bots** are supported. Without an explicit count, the backend can fill the shortfall to four players. Oversized requests are capped. Unlimited bots and an additional AI-control panel were not added.

### 11. One-person ordinary drawing — added

**Before:** Ordinary **你画我猜** required at least two seats. A one-person roster could fall back to a generated two-seat roster.

**Now:** **One real player can start and complete ordinary drawing** for testing, retaining their actual identity without a phantom second player. Undercover/hybrid multiplayer rules remain intact.

### 12. Configurable custom drawing time — added

**Before:** Custom mode already existed, but its setup did not offer a drawing-duration selector.

**Now:** The host can choose **30, 60, 90, 120 or 180 seconds**. The default is 90 seconds. The chosen duration is shared with the round and retained when advancing.

### 13. Working custom-prompt room flow — fixed

**Before:** A custom-prompt input existed, but the room-to-live-game route did not consistently pass the prompt into the online session.

**Now:** The host enters the prompt through the setup flow, and both prompt and duration reach the live session. Empty/cancelled setup does not silently launch a custom game. Invalid duration parameters normalize safely.

## Drawing experience and game completion

### 14. Large, visible countdown — improved

**Before:** Drawing/review countdown text was easy to miss while scrolling or looking at artwork.

**Now:** A large sticky countdown remains visible, with warning colors during the last five seconds. Relevant phase changes return the page to the top so the next stage is noticeable.

### 15. Early drawing submission — added/fixed

**Before:** Hybrid drawing relied on automatic submission. An accepted drawing could still wait for the remaining speaking/drawing deadline.

**Now:** **完成作画并提交** lets the current painter finish early. Submission advances through the existing turn-completion rule instead of waiting for the old countdown.

### 16. Independent hybrid pictures — changed

**Before:** The hybrid used a relay-style canvas that seeded a later player's picture with earlier strokes.

**Now:** Each player draws an independent picture for their private word. Submitted pictures are reviewed together before voting, following the requested 谁是卧底-style flow.

### 17. Clean artwork loading and display — fixed

**Before:** A private JPEG/PNG filename could briefly appear while artwork loaded. The final relay image could also be displayed twice.

**Now:** Loading displays **画作加载中…** instead of a storage filename. The duplicate **完整接力画** block is removed. Gallery entries retain player identity and grading information.

### 18. Non-blocking hybrid AI grading — fixed

**Before:** Drawing submission could wait for AI scoring before returning, delaying the visible transition.

**Now:** Artwork is submitted first and AI grading runs asynchronously. Hybrid review/voting can proceed if grading is slow or unavailable.

### 19. Complete-match and early-end cleanup — fixed

**Before:** Voting/win rules existed, but room status, drawing-session state and readiness could remain inconsistent after completion or host early end.

**Now:** Natural completion and host early end close the match, return the room to the lobby and clear readiness. Results offer a manual return and automatically return players after five seconds. A new game uses a fresh drawing session.

Existing Undercover win/tie/elimination rules are preserved: **draw → review → vote → reveal**, followed by another round if no terminal condition has been reached. A winner, round limit or host early end finishes the match.

### 20. Protection against stale game updates — fixed

**Before:** Delayed AI results, pending state publication and leftover timers could affect a game after it ended or after a new game started.

**Now:** Late ordinary-drawing AI results cannot reopen a finished round. Old completion requests cannot close a newer game. Pending publication is handled before cleanup, and polling/auto-submission timers are released on exit.

## AI scoring

### 21. Real ordinary-drawing scoring backend — connected

**Before:** The ordinary online page did not supply a real scorer, so its room engine fell back to `MockAiScorer`. A separate hybrid AI path existed.

**Now:** Ordinary drawing calls authenticated `draw-score` and stores a real grading receipt. Hybrid artwork is graded through `ai-score`. Private words and images are read on the server.

### 22. DeepSeek semantic similarity — replaced the old grading system

**Before:** The AI path used a limited Drawzy classifier and a guess/time-based formula. It could not meaningfully assess arbitrary prompts such as **图书馆**. Scores could be misleadingly similar and high, or close to zero.

**Now:** Both drawing games use the same **DeepSeek vision grader** to compare the actual picture with its assigned prompt. Players receive a **0–100 semantic similarity grade**, the subject the model sees, and a short Chinese explanation. Rough finger drawings are accepted; speed and neatness are not separate bonuses.

### 23. Broader prompt support — changed

**Before:** Ordinary drawing filtered its word pool to subjects mapped to the old classifier. Compound Chinese prompts could also map to an unsuitable simpler object.

**Now:** The old live-word filter is removed. The backend sends the original private prompt to DeepSeek, without requiring a QuickDraw category mapping.

### 24. Cloud AI without the PC recognizer — changed

**Before:** Drawzy grading depended on a Python process on the PC and a temporary tunnel whose address could change after restart.

**Now:** Supabase calls DeepSeek directly. **AI grading no longer depends on that PC recognizer or tunnel.** Existing host-device game-timer behavior is unchanged.

### 25. Validated, saved grades and server-only credentials — strengthened

**Before:** The two modes did not share one grading implementation/result-version policy; the ordinary real-AI receipt path was missing.

**Now:** Both share a server-only rubric and response validator. Successful DeepSeek grades are saved and reused. Old classifier receipts are not reused as DeepSeek grades. Failure/timeout is reported as unavailable rather than an invented score. API keys stay in Supabase secrets, with authentication and private-image checks retained.

### Intermediate classifier repairs included in the work

Before replacing Drawzy, the missing first label in its 46-output model, time/top-five score bonuses, weak resized thin strokes, bright-pen handling and stale score caches were repaired. These are part of the implementation history; **DeepSeek is the current live grading path**.

## Word-bank management and delivery

### 26. Native word-bank smoke coverage — added verification

**Before:** Bank CRUD, system/bilingual banks and CSV/JSON import/export already existed. They were not newly created during these changes.

**Now:** A reproducible native WeChat harness verifies four bank categories, ownership/read-only rules, item editing/deletion, duplicates, invalid batches, CSV/JSON round trips, Chinese UTF-8 file IO, cancellation and persistence after a real runtime restart. Visible create/edit/delete forms were also checked before the later instruction to stop smoke testing.

**Storage boundary:** Native custom banks remain device-local. Cloud sharing and using them as custom online Undercover pools have not been implemented by this work.

### 27. Consistent visible build version — fixed

**Before:** Different parts of the app could show inconsistent/stale versions, including a lobby still displaying v15.

**Now:** The lobby and console use a shared identifier: **v23-1106-deepseek** for the current implementation.

### 28. Working preview and backend rollout — completed setup

**Before:** The cloned code needed dependency/build setup, the correct compiled DevTools project and configuration/deployment for the user's environment.

**Now:** The build and phone-preview setup is working, the app uses the user's AppID/Supabase environment, server-domain settings were saved, relevant backend migrations/functions were deployed, and fresh preview QR packages were generated. Completed source changes were pushed to the main Gitee repository.

The AppID, Supabase architecture and preview mechanism already existed in the baseline code. This records setup and rollout, not newly invented systems. No public release or experience-version upload was performed.

## Features already present in the cloned branch

- The four core game modes and main room/lobby flow.
- Nickname input, layered avatar artwork and arrow-based customization.
- Drawing tools, undo/redo, emoji/custom modes, chat guesses and leaderboards.
- Undercover private words, turns, voting, elimination and winner rules.
- Supabase authentication/room/game architecture, hybrid artwork upload and realtime/polling foundations.
- System/custom bank management and CSV/JSON import/export.
- Build/quality scripts and the winter visual theme.

These were extended or repaired where described above; they are not counted as newly created game systems.

## Verification and remaining scope

- Before DeepSeek, v22 passed **313 application tests**, **3 project checks**, **5 preprocessing tests**, both builds and the native bank smoke suite.
- For DeepSeek, type checking and the WeChat build passed, both backend functions and the server credential were deployed, and the user reported the grading satisfactory.
- DeepSeek application smoke tests were skipped after the user's instruction. Earlier v22 totals are not a fresh automated regression of v23.
- A model grade remains a judgment; ambiguous pictures do not have a guaranteed objectively correct numeric score.
- Cloud-shared custom banks, universal 4G reliability, public release/filing preparation, hosted CI activation and a complete four-real-phone regression are not claimed completed.

## Implementation commit references

- `a9250c1` — five-bot cap.
- `a92e0b3` — album QR joining and code parsing.
- `fca93be` — name label, MBTI profile and badges.
- `cc387cf` — profile/bot backend deployment verification.
- `4ab83d1`, `ad7959a` — persistent errors and mobile request deadlines.
- `65cb658` — custom-prompt flow and drawing-duration settings.
- `35be642` — ordinary real-AI backend and recognizer restoration.
- `88f3923` — lifecycle, early submission, solo ordinary drawing, countdown and gallery fixes.
- `7fb5375`, `fa71f91` — intermediate classifier score/input repairs.
- `1c3c93f` — full-row lobby and protected MBTI display.
- `8a33479` — direct snowman color changes.
- `84f3c83` — native bank smoke coverage.
- `d3edfeb` — shared DeepSeek grading and removal of the old live-word filter.

The chronological record remains in [CHANGELOG-SESSION-2026-11-06.md](./CHANGELOG-SESSION-2026-11-06.md).
