Overwolf League of Legends Assistant (TypeScript) — Project Summary

Overview
This Overwolf app provides real-time audio cues and WebSocket emissions for League of Legends gameplay events. It runs in a Chromium-based environment, using Overwolf APIs for game events and windowing, and standard Web APIs (WebSocket, Audio) for connectivity and playback. The in-game window shows logs and a compact toggle, enabling an initial user interaction to satisfy Chromium’s autoplay policy.

Tech Stack

- Overwolf APIs: `overwolf.games`, `overwolf.games.events`, `overwolf.windows`, `overwolf.settings.hotkeys`
- Language/Build: TypeScript, Webpack
- UI: HTML/CSS (Overwolf windows), minimal DOM scripts
- WebSocket: native browser `WebSocket`
- Structure: background window (app controller), in-game window (runtime UI + logic), desktop window (future settings UI)

Key Files and Directories

- src/in_game/in_game.ts: Main game logic, event handling, audio triggers, WebSocket lifecycle, UI toggling
- src/background/background.ts: Window orchestration, app lifecycle
- src/desktop/\*: Desktop window (future settings UI)
- src/config/settings.ts: Centralized settings manager (thresholds, intervals, audio files) with localStorage persistence
- src/audio/audio.ts: Audio playback utility
- src/items/items.ts: Item/component registry, priority list, cost calculation helpers
- src/ws/wsClient.ts: WebSocket client wrapper with consistent logging
- public/manifest.json: Windows, permissions, hotkeys, and game classes configuration

Runtime Data Flow (High Level)

1. GEP subscriptions → onInfoUpdates/onNewEvents fire in `in_game.ts`
2. Logic updates internal state (gold, items, all_players, teamId, gameTime)
3. Triggers:
   - Enemy control ward purchase/place → internal audio cues
   - High gold (>threshold) → periodic audio
   - First purchasable target item → immediate audio then reminders every N seconds
   - Item 3089 (Rabadon) acquired once per match → WS event: { op: "event", name: "rabadon" }
   - Player level reaches 6 once per match → WS event: { op: "event", name: "villain" }
4. Match lifecycle → WS ops: game_start/game_end

Current Behavior Guarantees

- Emits high gold audio with cooldown interval
- Detects target item affordability and plays initial/reminder cues
- Detects enemy control ward purchase/place and plays audio
- Emits WebSocket events for game lifecycle and one-shots (rabadon, villain)
- Extensive console logging for GEP inputs, detections, and WS sends

Modularity and Extensibility

- Settings: thresholds, intervals, audio file names exposed via `SettingsManager` (desktop UI can update)
- Audio: `playAudioFile()` abstracts playback
- Items: registry + `calculateRemainingCost()` for consistent logic; add items by editing `src/items/items.ts`
- WebSocket: `WSClient` for consistent ops/logging; replace URL or add auth in one place

Build/Run

- npm run build
- Overwolf loads from built artifacts; ensure changes are in `src/` (not `dist/`). Overwolf may require client restart for manifest/background changes.

Hotkeys and Windows

- Ctrl+F: toggle in-game window minimize/restore (via `OWHotkeys`)
- Ctrl+K/Ctrl+G: toggle log visibility/compact mode (handled in `in_game.ts`)
- In-game window can collapse to a compact UI with a button to re-expand

Lessons Learned (Assumptions → Errors → Fixes)

1. Manifest source assumption

   - Assumption: Root manifest.json is used by build.
   - Error: Ghost reference to removed `toggler_button.html` persisted.
   - Fix: Build used `public/manifest.json`; updated it. Always verify which manifest is bundled.

2. Programmatic window visibility

   - Assumption: Declared window with start_visible:true auto-appears.
   - Error: New window didn’t appear.
   - Fix: Explicit `obtainDeclaredWindow()` + `restore()` from background.

3. Game detection nulls

   - Assumption: `getRunningGameInfo()` returns false when no game.
   - Error: Returned null caused restore attempts on null windows.
   - Fix: Guard for null → return false. Restart Overwolf if detection stalls.

4. Desktop window blank UI

   - Assumption: Relative paths were correct post-build.
   - Error: Desktop UI invisible due to wrong CSS/img paths.
   - Fix: Adjusted paths to `css/` and `img/` for dist layout.

5. Hotkey handling location

   - Assumption: Background hotkey listener covers in-game logic.
   - Error: Ctrl+G not detected by in-game due to separation.
   - Fix: Move relevant hotkey handling to `in_game.ts` via `OWHotkeys`.

6. Level 6 detection sources

   - Assumption: Single GEP event provides level consistently.
   - Error: No dedicated level event; level present in varying objects.
   - Fix: Aggregate detection from `info.level`, `live_client_data.active_player`, and `live_client_data.all_players` with robust logging.

7. WebSocket visibility

   - Assumption: Minimal logging sufficient.
   - Error: Hard to confirm emissions.
   - Fix: Comprehensive logs for connect, send, lifecycle, and detection points.

8. Chromium autoplay policy
   - Assumption: Audio can play on load.
   - Error: Audio blocked without user gesture.
   - Fix: Compact UI with a button to provide the required interaction, then expand to logs.

How to Extend

- Add a new item cue: update `ITEMS` and (optionally) purchase event map; the detection and cost logic are shared.
- Change thresholds/intervals/audio: use `SettingsManager.update()`; desktop UI can bind to this manager.
- Add new WS events: add case to per-match emission logic and/or map itemId→event name in one place.
