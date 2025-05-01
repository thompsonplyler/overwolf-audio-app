import {
  OWGames,
  OWGamesEvents,
  OWHotkeys
} from "@overwolf/overwolf-api-ts";

import { AppWindow } from "../AppWindow";
import { kHotkeys, kWindowNames, kGamesFeatures } from "../consts";

import WindowState = overwolf.windows.WindowStateEx;

// The window displayed in-game while a game is running.
// It listens to all info events and to the game events listed in the consts.ts file
// and writes them to the relevant log using <pre> tags.
// The window also sets up Ctrl+F as the minimize/restore hotkey.
// Like the background window, it also implements the Singleton design pattern.
class InGame extends AppWindow {
  private static _instance: InGame;
  private _gameEventsListener: OWGamesEvents;
  private _eventsLog: HTMLElement;
  private _infoLog: HTMLElement;

  // --- Restore State Variables ---
  private _playerState: { gold: number; items: any[]; summonerName: string | null } = { gold: 0, items: [], summonerName: null };
  private _lastLoggedInventoryString: string = '';

  private constructor() {
    super(kWindowNames.inGame);
    this._eventsLog = document.getElementById('eventsLog');
    this._infoLog = document.getElementById('infoLog');
    if (this._infoLog) this._infoLog.innerHTML = ''; // Clear log initially
    this.setToggleHotkeyBehavior();
    this.setToggleHotkeyText();
  }

  public static instance() {
    if (!this._instance) {
      this._instance = new InGame();
    }

    return this._instance;
  }

  public async run() {
    const gameClassId = await this.getCurrentGameClassId();

    const gameFeatures = kGamesFeatures.get(gameClassId);

    if (gameFeatures && gameFeatures.length) {
      this._gameEventsListener = new OWGamesEvents(
        {
          onInfoUpdates: this.onInfoUpdates.bind(this),
          onNewEvents: this.onNewEvents.bind(this)
        },
        gameFeatures
      );

      this._gameEventsListener.start();
    }
  }

  private onInfoUpdates(info) {
    let stateChanged = false;

    // --- 1. Update Stored State from different possible paths --- 
    try {
      // Check for activePlayer data (for items/name)
      const activePlayer = info?.info?.live_client_data?.activePlayer;
      if (activePlayer) {
        const currentItems = Array.isArray(activePlayer.items) ? activePlayer.items : this._playerState.items;
        const currentSummonerName = activePlayer.summonerName || this._playerState.summonerName;
        const itemsString = JSON.stringify(currentItems);

        if (itemsString !== JSON.stringify(this._playerState.items) || currentSummonerName !== this._playerState.summonerName) {
          this._playerState.items = currentItems;
          this._playerState.summonerName = currentSummonerName;
          stateChanged = true;
          console.log("Updated state from activePlayer:", JSON.stringify(this._playerState));
        }
      }

      // Check for game_info gold data (parsing the inner JSON string)
      const gameInfoGoldString = info?.game_info?.gold;
      if (typeof gameInfoGoldString === 'string') { // Check if it's a string before parsing
        try {
          const innerGoldData = JSON.parse(gameInfoGoldString);
          const currentGoldString = innerGoldData?.gold; // Access the 'gold' property within
          if (currentGoldString !== undefined) {
            const currentGold = parseInt(currentGoldString) || 0;
            if (currentGold !== this._playerState.gold) {
              this._playerState.gold = currentGold;
              stateChanged = true;
              console.log("Updated gold from game_info (parsed):", this._playerState.gold);
            }
          }
        } catch (parseError) {
          console.error("Failed to parse inner gold JSON string:", gameInfoGoldString, parseError);
        }
      }

    } catch (e) {
      console.error('Error processing info update for state:', e);
    }

    // --- 2. Update UI Log (Only if state actually changed) ---
    // We now update if *any* part of the player state relevant to the UI changed
    if (stateChanged) {
      const currentItemsString = JSON.stringify(this._playerState.items);
      // Check items string again just in case gold updated but items didn't
      // Only update UI fully if items changed, to avoid flicker just for gold? 
      // Let's update if *anything* changed for simplicity now.

      // Update the comparison string
      this._lastLoggedInventoryString = currentItemsString;

      if (this._infoLog) {
        this._infoLog.innerHTML = ''; // Clear before rewrite
        // Log the current inventory from our stored state
        this.logLine(this._infoLog, this._playerState.items, false);
        // Log current gold from stored state
        this.logLine(this._infoLog, `Gold: ${this._playerState.gold}`, false);
      }
    }
  }

  // Special events will be highlighted in the event log
  private onNewEvents(e) {
    const shouldHighlight = e.events.some(event => {
      switch (event.name) {
        case 'kill':
        case 'death':
        case 'assist':
        case 'level':
        case 'matchStart':
        case 'match_start':
        case 'matchEnd':
        case 'match_end':
          return true;
      }

      return false
    });
    this.logLine(this._eventsLog, e, shouldHighlight);
  }

  // Displays the toggle minimize/restore hotkey in the window header
  private async setToggleHotkeyText() {
    const gameClassId = await this.getCurrentGameClassId();
    const hotkeyText = await OWHotkeys.getHotkeyText(kHotkeys.toggle, gameClassId);
    const hotkeyElem = document.getElementById('hotkey');
    hotkeyElem.textContent = hotkeyText;
  }

  // Sets toggleInGameWindow as the behavior for the Ctrl+F hotkey
  private async setToggleHotkeyBehavior() {
    const toggleInGameWindow = async (
      hotkeyResult: overwolf.settings.hotkeys.OnPressedEvent
    ): Promise<void> => {
      console.log(`pressed hotkey for ${hotkeyResult.name}`);
      const inGameState = await this.getWindowState();

      if (inGameState.window_state === WindowState.NORMAL ||
        inGameState.window_state === WindowState.MAXIMIZED) {
        this.currWindow.minimize();
      } else if (inGameState.window_state === WindowState.MINIMIZED ||
        inGameState.window_state === WindowState.CLOSED) {
        this.currWindow.restore();
      }
    }

    OWHotkeys.onHotkeyDown(kHotkeys.toggle, toggleInGameWindow);
  }

  // Appends a new line to the specified log
  private logLine(log: HTMLElement, data, highlight) {
    const line = document.createElement('pre');
    line.textContent = JSON.stringify(data);

    if (highlight) {
      line.className = 'highlight';
    }

    // Check if scroll is near bottom
    const shouldAutoScroll =
      log.scrollTop + log.offsetHeight >= log.scrollHeight - 10;

    log.appendChild(line);

    if (shouldAutoScroll) {
      log.scrollTop = log.scrollHeight;
    }
  }

  private async getCurrentGameClassId(): Promise<number | null> {
    const info = await OWGames.getRunningGameInfo();

    return (info && info.isRunning && info.classId) ? info.classId : null;
  }
}

InGame.instance().run();
