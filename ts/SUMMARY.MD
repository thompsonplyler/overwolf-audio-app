# Overwolf League Audio Cue App - Development Summary

**Project Goal:** To enhance the Overwolf sample TypeScript app to provide real-time audio cues for specific in-game events and states in League of Legends.

**Special Note** The user does not have access to conventional DevTools. When you need to see information from the log, it can only come from a log that the user pulls up manually. But at no point should you ask the user to interact with the Developer Tools or other real-time logging interfaces.

**Features Implemented:**

1.  **Item Purchase Opportunity Cue:**
    - Plays an audio file (e.g., `getlichbane.mp3`) when the player owns at least one component of a prioritized item (Lich Bane, Rabadon's, Banshee's, Zhonya's, Shadowflame, Void Staff) and has enough gold to purchase the completed item.
    - Uses a priority list (`ITEM_PRIORITY`) to only suggest the highest-priority available item at any given time.
    - Has a cooldown period (`CURRENT_REMINDER_DELAY_SECONDS`) after a suggestion is made for a specific item.
2.  **Item Purchase Reminder Cue:**
    - If the initial item cue played, and after a delay (`CURRENT_REMINDER_DELAY_SECONDS`) the player _still_ hasn't bought the item but _still_ can afford it, a reminder audio file (`idiot_song_001.mp3`) plays.
    - This reminder resets its own timer but keeps the same item as the target.
3.  **High Gold Cue:**
    - Plays an audio file (`icarus_song_001.mp3`) when the player's gold exceeds a threshold (`HIGH_GOLD_THRESHOLD` = 3000).
    - Plays immediately when crossing the threshold and then repeats every interval (`HIGH_GOLD_INTERVAL_SECONDS` = 60s) as long as gold remains high.
    - **Overrides** the item purchase/reminder cues (they are skipped if gold is high).
4.  **Enemy Control Ward Cues:**
    - Tracks the number of Control Wards (ID: 2055) in each enemy player's inventory.
    - Plays a champion-specific audio file (`<ChampionName>_ward_purchased.mp3`) when an enemy's Control Ward count increases.
    - Plays a champion-specific audio file (`<ChampionName>_ward_placed.mp3`) when an enemy's Control Ward count decreases.
    - This logic runs independently of the high gold override.

**Challenges Faced & Debugging:**

- **Identifying Event Data Structure:** The primary challenge was determining the correct path within the Overwolf `info` object (from `onInfoUpdates`) to access reliable player data (items, gold, summoner name, team ID, game time). We discovered that:
  - Data often arrives in partial updates.
  - Key objects (`active_player`, `all_players`) and values (`game_info.gold`) were nested inside **stringified JSON**, requiring `JSON.parse()`.
  - The correct path for items/player info was eventually found in the parsed `info.live_client_data.all_players` array.
  - The correct path for gold involved checking both parsed `info.live_client_data.active_player.currentGold` and parsed `info.game_info.gold.gold`.
  - Reliable game time in seconds came from the `match_clock` event via `onNewEvents`, not from `onInfoUpdates`.
- **Debugging Process:** We extensively used `console.log` in the DevTools console and temporarily logged data to the app's UI (`_infoLog` panel) to inspect the raw `info` object structure and trace the logic flow within state updates and check functions. This involved several cycles of adding/removing logs to isolate issues. We also had to reset the codebase once (`git reset --hard HEAD`) due to accumulated complexity during debugging.
- **Audio Playback Issues:** Initial attempts using a single shared `Audio` element caused sounds to interrupt each other or fail (`DOMException`). This was fixed by creating a new `Audio` object within the `playAudio` function for each playback request.
- **Logic Refinement:** The initial item check logic triggered multiple cues simultaneously. This was refined by implementing a strict priority system (`ITEM_PRIORITY`) and a single-target state (`_currentTargetItemId`) to ensure only one item suggestion/reminder cycle is active. The reminder logic was adjusted to repeat for the same item until conditions change.

**Project Description for Rebuilding:**

This project modifies the standard Overwolf TypeScript sample app (`overwolf/sample-app/ts`) to function as an audio alert system for League of Legends.

- **Core Logic Location:** Most custom code resides in `src/in_game/in_game.ts` within the `InGame` class.
- **Event Handling:**
  - `onInfoUpdates(info)`: Receives frequent, often partial, game state updates. It parses nested JSON strings within `info.live_client_data` (`active_player`, `all_players`) and `info.game_info` (`gold`) to update the internal `_playerState`. It updates the UI only when relevant state changes. It then calls functions to check audio conditions.
  - `onNewEvents(e)`: Handles discrete events, specifically parsing the `match_clock` event to update `_playerState.gameTime` accurately.
- **State Management:** A stateful approach is crucial due to partial updates. `_playerState` stores the latest known gold, items, summoner name, team ID, and game time. `_currentTargetItemId` and `_currentTargetSuggestionTime` manage the single-item suggestion/reminder cycle. `_enemyWardCounts` tracks ward inventory per enemy.
- **Audio Cue Logic:**
  - `checkHighGold()`: Checks gold threshold and plays repeating audio, returning a boolean to override item cues.
  - `checkTargetItem()`: Iterates through `ITEM_PRIORITY`. Finds the highest-priority affordable item based on components and cost, manages the single target state, plays the initial cue, and handles the reminder logic based on `_currentTarget...` state and game time.
  - `checkEnemyWardChanges()`: Compares current enemy ward counts (from `_allPlayersState`) against previously stored counts (`_enemyWardCounts`) and plays specific audio cues on changes.
  - `playAudio(fileName)`: Creates a new `Audio` object for independent playback.
- **Constants:** Item definitions (`ALL_TRACKED_ITEMS`), component costs (`PRICE`), item priority (`ITEM_PRIORITY`), thresholds, delays, and audio filenames are defined as constants near the top of `src/in_game/in_game.ts`.
- **Build Process:** Uses `npm run build` via Webpack. Audio files must be placed in `public/audio`.

## Session on Window Minimization/Hiding (Current Session Context)

**Objective:** Modify the "Hide Logs" button to not only hide log content but also shrink the entire Overwolf window to a minimal, clickable state. This is intended to provide the necessary user interaction to enable audio cues that currently don't fire until a manual Ctrl+F action.

**Key Attempts & Learnings:**

1.  **Content Hiding:** Successfully implemented logic in `src/in_game/in_game.ts` (`toggleLogsDisplayBtn`) to hide the main content area (`<main>`) by setting `style.display = 'none'` and changing button text to "Activate App".
2.  **Window Resizing (`overwolf.windows.changeSize`)**: Introduced calls to `overwolf.windows.changeSize()` to resize the window to predefined small dimensions (`COLLAPSED_WINDOW_WIDTH`, `COLLAPSED_WINDOW_HEIGHT`) when hiding content, and restore to original size when showing content. This included fetching and storing initial window ID and dimensions.
3.  **API Typing Resolution:** Iteratively corrected TypeScript type issues for `WindowResult` (confirming `success: boolean` not `status: string`) and for `changeSize` callbacks within the `getWindowInfo` helper and `setupToggleLogsDisplay` method in `src/in_game/in_game.ts`.
4.  **Manifest `min_size`:** Identified that the `manifest.json` for the in-game window requires its `min_size` property to be set to dimensions that accommodate the desired collapsed state (e.g., `width: 150, height: 50`).

**Current State & Next Steps (as of end of this session):**

- The internal content of the window is correctly hidden/shown by the button.
- **Persistent Problem:** The Overwolf window itself does not visually shrink to the `COLLAPSED_WINDOW_WIDTH` x `COLLAPSED_WINDOW_HEIGHT` dimensions when the button is pressed. It remains at its larger size, with the internal content area becoming blank.
- **Next Focus:** Investigate why `overwolf.windows.changeSize()` is not achieving the desired small window dimensions despite code changes and `manifest.json` `min_size` considerations. This will be the primary task for the next session.

## Session on Button Functionality & Initial Window State (Continued from previous session)

**Objective:** Resolve issues where the "Hide Logs" button did not correctly shrink the window, the app started in a visually incorrect "collapsed" state, and ensure audio cues worked reliably post-interaction.

**Key Challenges & Learnings:**

1.  **Persistent Small Window Size:**

    - **Problem:** Despite `manifest.json` defining a large initial `size` (e.g., 1212x699) for the `in_game` window, the Overwolf API (`overwolf.windows.getCurrentWindow()`) at app startup consistently reported the window's dimensions as the small, collapsed size (150x50). This caused the app to start visually collapsed and prevented logic from correctly restoring to a "large" original size.
    - **Assumption Challenged:** The initial assumption was that the manifest `size` property would be the definitive size reported by the API on fresh load, or that `_originalWindowWidth/Height` could be reliably captured from an early API call. However, Overwolf appears to prioritize restoring a window to its _last known size_ before it was closed, even across sessions, overriding the manifest's default `size`.
    - **Solution:** Implemented a direct call to `overwolf.windows.changeSize()` at the beginning of the `InGame.run()` method to _explicitly force_ the window to the large dimensions (e.g., `MANIFEST_ORIGINAL_WIDTH = 1212`, `MANIFEST_ORIGINAL_HEIGHT = 699`) defined as constants. The application's internal `_originalWindowWidth` and `_originalWindowHeight` state variables were then set from these constants _after_ the successful forced resize, making these constants the source of truth for the "expanded" state.

2.  **Incorrect Visual State in Collapsed Mode:**

    - **Problem:** When the window was (or started) small, header elements (icon, title, hotkey text, window controls) remained visible, and the toggle button's text did not update correctly, making the intended "Activate App" button inaccessible or visually incorrect.
    - **Solution:**
      - Ensured that element selectors in the `InGame` constructor correctly targeted all individual header components.
      - Refined the `_updateUIVisibility()` method to explicitly set `display: 'none'` on these individual header elements when collapsing, and `display: ''` (to revert to stylesheet defaults) when expanding. This ensured that even in the small 150x50 window, only the intended `_toggleLogsDisplayBtn` would occupy space when collapsed.
      - Centralized UI state updates (button text, element visibility) within `_updateUIVisibility()`, which is called both after the initial forced resize in `run()` and during the button's click event.

3.  **Troubleshooting `background.html` Not Found:**

    - **Problem:** A separate issue arose where the app failed to load, erroring with `manifest.json window "background" file name "background.html" doesnt exist`.
    - **Debugging:** This involved inspecting `manifest.json` (which correctly pointed to `background.html`) and then `webpack.config.js`. The issue was traced to a misconfiguration where `HtmlWebpackPlugin` was attempting to generate `background.html` from a template in `src/background/`, but the actual file was intended to be `src/background/background.html` itself. Reverting a previous incorrect modification to the Webpack config (which had removed this `HtmlWebpackPlugin` entry) and ensuring the template path was correct resolved this. This highlighted the importance of verifying build process outputs.

4.  **Debugging Process & Future Approach:**
    - **Extensive `console.log`:** Used detailed logging at various stages: element selection, state variable values, API call results, and critically, `getComputedStyle()` for DOM elements to verify if style changes were actually applying.
    - **Iterative Refinement:** The solution for the initial window size and UI state was arrived at iteratively. Initial attempts to simply read the size or set it later in the lifecycle were insufficient due to Overwolf's behavior.
    - **Future Approach for Similar Issues:**
      1.  When an Overwolf window's initial size is critical and might differ from the manifest `size` (due to being previously closed at a different size), **explicitly call `overwolf.windows.changeSize()` very early in the window's lifecycle (e.g., start of `run()`) to force the desired dimensions.**
      2.  Store "original" or "default" dimensions from constants rather than relying solely on API calls at startup if the startup size is unpredictable.
      3.  For complex UI visibility changes, ensure each distinct visual section/element is individually controlled and hidden/shown, especially within a constrained parent container.
      4.  When debugging style issues, `getComputedStyle()` is invaluable for confirming if JavaScript style manipulations are effective or being overridden.

**Final State (after this session):**

- The in-game window now reliably starts at its large, expanded size (1212x699).
- The "Hide Logs" button correctly:
  - Hides the main log content.
  - Hides superfluous header elements (icon, title, hotkey, window controls).
  - Changes its text to "Activate App".
  - Resizes the window to the small, collapsed dimensions (150x50), leaving only the "Activate App" button visible and interactive.
- Clicking "Activate App" correctly restores the large size and all visual elements.
- Audio cues play correctly after the initial button interaction.
