# Overwolf League Audio Cue App - Development Summary

**Project Goal:** To enhance the Overwolf sample TypeScript app to provide real-time audio cues for specific in-game events and states in League of Legends.

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
