# GUI Overhaul Game Plan

Our objective is to transition the app from a developer-focused utility to a user-friendly tool. This involves creating a new settings UI and a simple, interactive in-game component to replace the current log-based interface.

We will proceed with extreme caution, implementing and testing each step incrementally to ensure the core audio-cue functionality remains stable.

---

### **Phase 1: Implement the "Let's Go!" Clicker (New In-Game Window)**

This phase introduces a new, small, interactive window that serves as the primary user interaction point to enable audio playback. The existing log window will remain functional but separate.

- **1.1. Create Window Files:**
  - Create `src/clicker/clicker.html`: A minimal HTML file with a single clickable `<div>` or `<button>` with the ID `lets-go-button`.
  - Create `public/css/clicker.css`: Style the button. It should have a red background initially.
  - Create `src/clicker/clicker.ts`: A new script file for this window's logic.
- **1.2. Register the New Window:**
  - In `manifest.json`, add a new window named `"clicker"`.
  - **Properties:**
    - `"file": "clicker.html"`
    - `"transparent": true`
    - `"resizable": false`
    - `"show_in_taskbar": false`
    - `"size"`: small, e.g., `{ "width": 150, "height": 50 }`
    - `"start_visible": true`
  - **Hotkey:** Assign `Ctrl+G` to toggle the visibility of this window.
- **1.3. Implement Clicker Logic:**
  - In `clicker.ts`, add a click event listener to the `#lets-go-button`.
  - On the first click, the script will change the button's background color to green.
  - No complex inter-window communication is needed initially. The user's click on this browser element should be sufficient to enable audio across the entire app.
- **1.4. Update Build Process:**
  - In `webpack.config.js`, add the new `clicker` window to the configuration so its HTML and TS files are processed and copied correctly.
- **1.5. Test:**
  - ✅ **Visibility:** Does the red "Let's go!" button appear in-game?
  - ✅ **Interaction:** Does the button turn green when clicked?
  - ✅ **Functionality:** After clicking the button, do the audio cues (e.g., for high gold) play correctly?
  - ✅ **Hotkey:** Does `Ctrl+G` correctly hide and show the button?
  - ✅ **Regression:** Does the original log window still function as expected?

---

### **Phase 2: Default the Log Window to Hidden**

This phase makes the new "Let's Go!" clicker the primary, default-visible UI, while keeping the log accessible via a hotkey for debugging.

- **2.1. Modify Manifest:**
  - In `manifest.json`, find the definition for the original `in_game` window.
  - Change its `"start_visible"` property to `false`.
  - Ensure it has a `"toggle"` hotkey assigned (e.g., `Ctrl+F`) so it can be opened manually.
- **2.2. Test:**
  - ✅ **Default State:** When starting a game, is only the "Let's Go!" clicker visible?
  - ✅ **Hotkey:** Can the log window be opened and closed using its hotkey?
  - ✅ **Functionality:** Does the app's core logic still work perfectly?

---

### **Phase 3: Build the In-Game Settings Menu**

This phase transforms the hidden log window into a functional in-game settings panel.

- **3.1. Redesign In-Game HTML:**
  - In `src/in_game/in_game.html`, replace the log-display elements with a new settings form.
  - **Inputs:**
    - Gold Threshold (number)
    - Gold Interval (number)
    - Item Reminder Interval (number)
    - Master Volume (range slider)
  - The old log `<div>` can be kept but hidden with `display: none`.
- **3.2. Implement Settings Persistence:**
  - In `in_game.ts`, create functions to manage settings using `localStorage`.
  - **Load:** On `run()`, load settings from `localStorage`. If no settings are found, use the current hardcoded values as defaults and save them.
  - **Save:** Add `onchange` event listeners to the new form inputs. When a value is changed, save the entire settings object to `localStorage`.
  - **Apply:** Populate the UI with the loaded settings.
- **3.3. Refactor Core Logic:**
  - Modify the `check...()` functions (`checkHighGold`, `checkTargetItem`) to use the dynamic setting values from the state, instead of hardcoded constants.
- **3.4. Test:**
  - ✅ **UI:** Does the in-game window (via hotkey) now show the settings panel?
  - ✅ **Functionality:** Does changing a setting (e.g., gold threshold) correctly alter the behavior of the audio cues in real-time?
  - ✅ **Persistence:** Do the settings remain saved after closing and reopening the game/app?

---

### **Phase 4: Build the Desktop Settings Window**

This phase creates the out-of-game settings window, which will share its configuration with the in-game panel.

- **4.1. Design Desktop HTML:**
  - In `src/background/background.html`, build a comprehensive settings page.
  - Include all controls from the in-game menu, plus:
  - **Sound Selection:** Add `<select>` dropdowns for "Next Item Cue" and "High Gold Cue". The options will be based on a predefined list of available audio files.
- **4.2. Implement Desktop Logic:**
  - In `background.ts`, implement the same `localStorage` load/save logic as the in-game window. This ensures settings are synchronized.
  - Populate the UI, including the sound selection dropdowns, with the loaded settings.
  - Update `localStorage` when any setting is changed.
- **4.3. Test:**
  - ✅ **Synchronization:** Does changing a setting in the desktop window reflect in the in-game menu, and vice-versa?
  - ✅ **Sound Selection:** Does changing a sound in the desktop settings and restarting the game result in the new sound being played for the correct cue?