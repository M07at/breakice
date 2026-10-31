# C1 backend contract v1

Scope: C's classic-game interface and local reference adapter. The authoritative definitions are `app/src/modules/undercover/backend.ts`, `types.ts`, `view.ts`, and `errors.ts`. `backend.test.ts` exercises this contract against `LocalUcBackend`.

## Interface

```ts
interface UcCommandMeta {
  requestId: string
  expectedVersion: number
  expectedPhase?: Phase
  expectedRound?: number
  expectedTurnKey?: string
}
interface UcBackend {
  start(options: UcStartOptions): Promise<{ gameId: string; view: UcPublicView }>
  act(gameId: string, action: UcClientAction, meta?: UcCommandMeta): Promise<UcPublicView>
  tick(gameId: string): Promise<UcPublicView>
  getView(gameId: string): Promise<UcPublicView>
  getMyWord(gameId: string): Promise<UcSecretView>
  subscribe(gameId: string, onView: (view: UcPublicView) => void): () => void
}
```

`UcClientAction` permits `acknowledgeWord`, `turnDone`, `vote`, `endGame`, and the existing legacy `skipTurn`, `next`, `drawingSubmitted` actions. Classic UI automatically advances result screens and does not expose skip/next controls. `playerLeft` and `aiScored` are internal engine actions, not client commands. Extra fields such as a forged `by` are rejected by the local adapter. Actor identity is supplied by the adapter, not the command body.

`UcStartOptions` includes `roomId`, `variant`, optional `bankIds`, optional partial `config`, and optional `requestId`. The local session selects the pair before constructing its adapter; `bankIds` is a selection hint for a future repository-backed adapter, not a claim of remote implementation.

## Command lifecycle

1. Read the current public snapshot. Each accepted state change has an increasing integer `version`.
2. Construct a fresh `requestId` (1–100 characters) and capture `expectedVersion` for the user's operation.
3. Send the command with that metadata. Classic UI always uses metadata. The optional signature remains for legacy callers, which do not receive version/retry protection.
4. Retry an uncertain transport result with the **same** request ID, actor, and payload. The local adapter returns the latest view, not a historical secret or a second transition.
5. Reusing a successful request ID with another payload returns `REQUEST_CONFLICT`.
6. A new operation against an old version returns `STALE_STATE`, except independent acknowledgements/votes carrying all three matching stage fields (`expectedPhase`, `expectedRound`, `expectedTurnKey`). Those may share an earlier version while others submit within the same stage. The version must not be from the future. No old vote may cross a stage, round, or tie-break boundary. Other stale choices require refresh and confirmation, not a silently replaced request ID.

Accepted command receipts are scoped to game and actor. Start receipts are scoped to actor and request ID, with the room/settings included in the fingerprint. Repeating a successful start returns the same game, including after that game ends. A deliberate replay uses a new request ID. A different start while the room already has an active game returns `GAME_ACTIVE`.

`LocalUcBackend` stores state and receipts only for the process lifetime. Its `.me` property and departure simulation are development tools, not authenticated identity or room security. A future real adapter must bind identity, serialize state changes, persist receipts with state, and provide actual membership checks. No such server is implemented in C1-P1.

## Deadlines and snapshots

- `phaseDeadline` is an absolute millisecond timestamp; `0` means there is no timer (`word`, `ended`).
- The pure engine refuses late speaking/voting/next commands with `DEADLINE_PASSED`.
- The local adapter settles due transitions before reading a public view or applying a command. It advances from the scheduled deadlines, catching up all expired turns, votes, and results after background time. It never grants every missed speaker a fresh timer on return.
- A stale request may therefore be rejected after the clock advances the game. Read the latest snapshot rather than interpreting the rejection as a rollback of time.
- Duplicate `tick` calls at the same time do not repeat transitions or scoring.
- Public snapshots are independent JSON data. Mutating a returned view or a listener's copy cannot alter game state or another listener's view.
- Subscription listeners receive full public snapshots; clients ignore versions older than their current view and clear private displays/selections on a changed version. The unsubscribe callback removes the listener. On initial load and foreground return, retrieve a snapshot to cover missed events.

## Visibility

Before game end, public views contain progress, seat IDs, turn order, deadline, alive/out state, and acknowledgement/vote completion. They omit living players' camps and all words. Eliminated players' camps are visible. Completed round results retain the existing ballot history in the data contract, although the classic result UI shows aggregated tallies. Whether voter identities should remain public after settlement is a review decision recorded in the rules.

The private view returns the selected player's `playerId`, `word`, and `isBlank`. Words never enter the error or progress banners. After game end the public view intentionally contains all camps and words.

## Error handling

Business rejections use `{ code, message }` with a known `UcErrorCode` and a player-readable message. `isUcError` distinguishes known business rejections from unknown/transport errors, including transport errors that also have a `code` field.

- `STALE_STATE`, `DEADLINE_PASSED`, `ALREADY_VOTED`: refresh, clear the old selection, explain what changed.
- `WRONG_PHASE`, `NOT_YOUR_TURN`, `NOT_ELIGIBLE`, `INVALID_TARGET`, `HOST_ONLY`: show the reason; no command transition is applied.
- `BAD_REQUEST`, `BAD_CONFIG`, `BAD_PAIR`, `PLAYER_COUNT`, `DUPLICATE_PLAYER`: correct the request or setup.
- `UNKNOWN_PLAYER`, `GAME_NOT_FOUND`: show a recovery path; do not guess private state.
- `REQUEST_CONFLICT`: use a fresh ID only for a genuinely new operation; never change a retry's payload.
- `GAME_ACTIVE`: resume or explicitly end the existing local game.
- Unknown/transport error: the outcome is uncertain. Keep the original command metadata and offer a retry. Block further game commands until the result is resolved. A snapshot refresh alone does not prove an uncertain command failed.

UI provides pending feedback, safe retry, manual refresh, and a two-second minimum interval between automatic failed timer update attempts. A native vote-confirmation dialog captures the actor and version; if the stage changes while it is open, its old choice is not submitted.

## Departure and results

The local player-management panel calls `simulateLocalDeparture` in the local session assembly layer. Leaving removes speaking/voting eligibility, invalidates votes for the departed player, and may immediately determine the winner. A duplicate departure is a no-op. An unconfirmed player leaving no longer blocks the remaining players' word acknowledgements. The host's fixed local identity is preserved for demonstration; real host transfer is outside this mock.

The engine's `ended` and `score` events retain their existing shapes. C1 tests ensure one accepted final vote/tick only produces one settlement. The local callback is a demo consumer: callback failures are logged and do not undo the committed game. Durable cross-service event delivery and unified rankings are outside this implementation; integrations should wrap results with a stable game/event ID rather than infer unique events from delivery count.

## Tested contract cases

Automated cases include start deduplication, request conflicts, stale versions, repeated speaking completion, last-vote retries, repeated ending, deadline-boundary rejection, background catch-up, one-time settlement, duplicate departure, non-member rejection, malformed client actions, snapshot isolation, subscriber isolation/unsubscribe, and invalid timer/role configuration. These local adapter tests do not establish real backend authentication, RLS, or multi-device behavior.

## Fixed-player UI port

`player.ts` defines `UcPlayerPort`, `UcPlayerSnapshot`, permission derivation, and snapshot ordering for `/pages-uc/player`. A port instance is bound to one player and has no actor-switch method. A/D can call `installPlayerPort(adapter)` before navigating to this page. The page calls `load`, `getMyWord`, `act`, and host-only `replay`; it does not instantiate a local engine or choose another player's identity.

The snapshot includes session/player identity, game ID, a monotonically increasing `gameNumber`, public view, roster names, host ID, and server time. A new match resets secrets/selections while preserving player identity. A late response from a lower `gameNumber` is ignored, as is an older version within the same game. Unexpected identity changes are rejected.

The page polls for public snapshots, displays a server-clock-adjusted countdown, and disables actions during loss of connection. The test adapter polls every 750ms. Only the fixed user's word is retrieved, independently of the current speaker. Words are masked when leaving the foreground and when a match/phase changes. Within a stage, another user's submission does not interrupt someone reading their own word.

The Vite-only mock uses different bearer tickets per predefined test player. Only its fixture host can retrieve the test invitation list. This is development fixture provisioning, not WeChat login, production room authorization, or a replacement for A's service. See `fixed-player-preview.md` for local multi-device testing and its limits.

## C2 update
Phone-handoff UI/routes are removed. Draw games now require word acknowledgement and include a timed review phase. UcPlayerPort adds submitDrawing; snapshots add artworks. See hybrid-rules.md for mock scoring, concurrency, permission and replacement boundaries.
