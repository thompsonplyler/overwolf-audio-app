Overwolf LoL Assistant — Game Plan (Living Document)

Goal
Deliver a robust, extensible in-game assistant for League of Legends with real-time audio cues and WebSocket emissions, plus a desktop settings UI to customize thresholds, intervals, and sounds.

Must-Haves (Current Acceptance Criteria)

1. Enemy control ward purchase → play audio internally

   - Test: Enemy buys Control Ward (2055). Expect console logs from WardCheck and audio playback.

2. Enemy control ward placed → play audio internally

   - Test: Enemy ward count decreases; expect WardCheck "PLACED/LOST" log and audio.

3. Rabadon purchase (3089) → WebSocket emission once per match

   - Test: Acquire item 3089. Expect logs:
     - [WS][Event][Rabadon] … willEmit=true
     - [WS][Event] Emitting event: rabadon → WS send

4. High gold (> threshold) → audio with cooldown interval

   - Test: Reach gold > threshold. Expect HighGold logs and audio; repeat only after interval passes.

5. First purchasable target (priority list) → immediate audio

   - Test: Own required components; reach required gold; expect target identification and audio.

6. Reminder for purchasable target every N seconds

   - Test: Keep target affordable; expect reminder after configured delay.

7. Player reaches level 6 → WebSocket emission once per match
   - Test: Reach level 6; expect any of the [WS][Event][Level][…] logs followed by villain emission.

Observability Requirements (Always-On)

- Log subscribed features, event names, and info categories per update.
- Log WS lifecycle (connect, disconnect, error) and each send with payload.
- Log detection paths for level and item acquisition.
- Log window state changes and UI toggles.

Architecture Pillars (Modularization)

- Settings: `src/config/settings.ts` exposes thresholds, intervals, and audio files; desktop UI can update via SettingsManager.
- Items: `src/items/items.ts` centralizes items/components, priority, and `calculateRemainingCost()`.
- Audio: `src/audio/audio.ts` unifies playback.
- WS: `src/ws/wsClient.ts` standardizes ops and logging.
- In-game logic: `src/in_game/in_game.ts` orchestrates state, detections, audio, and WS.

Near-Term Feature: Compact-First In-Game UI
Objective

- Default to a compact window on launch with two controls: "Let’s Go!" (enables audio) and "Show log" (expands to full logs view). Maintain existing hotkeys.

Acceptance Criteria

- On app/game start, in-game window opens in compact mode.
- Clicking "Let’s Go!" counts as a user interaction (audio can play thereafter) and expands to current full UI.
- Clicking "Show log" expands to full UI (same as above).
- Ctrl+F still minimizes/restores; Ctrl+K/Ctrl+G still toggles log visibility.
- No regression in audio cues or WS emissions.

Implementation Notes

- Use existing `_updateUIVisibility()` to set collapsed size on first launch.
- Button wiring: reuse `_toggleLogsDisplayBtn` or add a compact-only button and map both to expand action.
- Persist the last chosen state if helpful (optional).

Tests

1. Start app → confirm compact UI (dimensions and hidden elements) and clickable controls visible.
2. Click "Let’s Go!" → confirm UI expands, then trigger a small audio (e.g., manual reminder) to ensure audio allowed.
3. Toggle back/forth with hotkeys to ensure no regressions.
4. Play a practice/live match and validate Must-Haves 1–7 still pass.

Future Roadmap
Phase 1 — Desktop Settings UI

- Expose settings (thresholds, intervals, audio filenames) with validation.
- Persist via `SettingsManager.update()`.
- Add a basic preview button to play selected audio.

Phase 2 — Item Event Mapping

- Centralize itemId→WS event mapping (purchase events) and per-match dedupe in one module.
- Provide editor UI in desktop to enable/disable item events and assign event names.

Phase 3 — Advanced Observability

- Add a dedicated "Diagnostics" tab showing recent detections and WS sends with timestamps.
- Optional: Allow exporting logs from the in-game window.

Phase 4 — Animation & UX Polish

- Animate the compact button on interaction.
- Improve layout responsiveness and theming.

Phase 5 — Robustness

- Auto-retry WS connection with backoff.
- Graceful handling for manifest or feature subscription changes.
