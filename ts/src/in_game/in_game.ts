import {
  OWGames,
  OWGamesEvents,
  OWHotkeys
} from "@overwolf/overwolf-api-ts";

import { AppWindow } from "../AppWindow";
import { kHotkeys, kWindowNames, kGamesFeatures } from "../consts";

import WindowState = overwolf.windows.WindowStateEx;

// --- Constants --- 
const PURCHASE_REMINDER_DELAY_SECONDS_CONFIG = 30; // 30 seconds (Original)
const TEST_REMINDER_DELAY_SECONDS = 30; // 5 seconds for testing (longer than 2 to avoid rapid fire)
const CURRENT_REMINDER_DELAY_SECONDS = TEST_REMINDER_DELAY_SECONDS; // Use this constant

// --- Item Definitions (Based on user input/logic) ---
const PRICE = {
  lichbane: 3200,
  rabadons: 3600,
  void: 3000,
  zhonyas: 3250, // Using standard cost based on previous discussion
  armguard: 1600,
  jewel: 1100,
  wand: 850,
  rod: 1250,
  sheen: 900,
  wisp: 850,
  alt: 1100,
  banshees: 3000,
  shadowflame: 3200,
  verdant: 1600, // Standard cost
  codex: 850,    // Standard cost
}

interface ItemComponent {
  id: number;
  cost: number; // Cost of the component itself
}

interface ItemDefinition {
  id: number; // Final item ID
  name: string;
  cost: number; // Final item cost
  components: ItemComponent[];
  audioCue: string; // Filename like 'getrabadons.mp3'
  requiresComponentCheck: boolean;
}

const NEEDLESSLY_LARGE_ROD: ItemComponent = { id: 1058, cost: PRICE.rod };
const SHEEN: ItemComponent = { id: 3057, cost: PRICE.sheen };
const AETHER_WISP: ItemComponent = { id: 3113, cost: PRICE.wisp };
const FIENDISH_CODEX: ItemComponent = { id: 3108, cost: PRICE.codex };
const SEEKERS_ARMGUARD: ItemComponent = { id: 2420, cost: PRICE.armguard };
const BLIGHTING_JEWEL: ItemComponent = { id: 4630, cost: PRICE.jewel };
const BLASTING_WAND: ItemComponent = { id: 1026, cost: PRICE.wand };
const HEXTECH_ALTERNATOR: ItemComponent = { id: 3145, cost: PRICE.alt };
const VERDANT_BARRIER: ItemComponent = { id: 4632, cost: PRICE.verdant };

// --- Define All Tracked Items (Unordered initially) ---
const ALL_TRACKED_ITEMS: Record<string, ItemDefinition> = {
  LICH_BANE: {
    id: 3100, name: 'Lich Bane', cost: PRICE.lichbane,
    components: [SHEEN, AETHER_WISP, NEEDLESSLY_LARGE_ROD],
    audioCue: 'getlichbane.mp3', requiresComponentCheck: true,
  },
  RABADONS: {
    id: 3089, name: "Rabadon's Deathcap", cost: PRICE.rabadons,
    components: [NEEDLESSLY_LARGE_ROD, NEEDLESSLY_LARGE_ROD],
    audioCue: 'getrabadons.mp3', requiresComponentCheck: true,
  },
  BANSHEES: {
    id: 3102, name: "Banshee's Veil", cost: PRICE.banshees,
    components: [VERDANT_BARRIER, FIENDISH_CODEX],
    audioCue: 'getbanshees.mp3', requiresComponentCheck: true,
  },
  ZHONYAS: {
    id: 3157, name: "Zhonya's Hourglass", cost: PRICE.zhonyas,
    components: [SEEKERS_ARMGUARD, NEEDLESSLY_LARGE_ROD],
    audioCue: 'getzhonyas.mp3', requiresComponentCheck: true,
  },
  SHADOWFLAME: {
    id: 4645, name: "Shadowflame", cost: PRICE.shadowflame,
    components: [HEXTECH_ALTERNATOR, NEEDLESSLY_LARGE_ROD],
    audioCue: 'getshadowflame.mp3', requiresComponentCheck: true,
  },
  VOID_STAFF: {
    id: 3135, name: 'Void Staff', cost: PRICE.void,
    components: [BLIGHTING_JEWEL, BLASTING_WAND],
    audioCue: 'getvoidstaff.mp3', requiresComponentCheck: true,
  },
};

// --- Define Item Priority --- 
const ITEM_PRIORITY: ItemDefinition[] = [
  ALL_TRACKED_ITEMS.LICH_BANE,
  ALL_TRACKED_ITEMS.RABADONS,
  ALL_TRACKED_ITEMS.BANSHEES,
  ALL_TRACKED_ITEMS.ZHONYAS,
  ALL_TRACKED_ITEMS.SHADOWFLAME,
  ALL_TRACKED_ITEMS.VOID_STAFF
];

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

  // --- State Variables ---
  private _playerState: { gold: number; items: any[]; summonerName: string | null; gameTime: number } =
    { gold: 0, items: [], summonerName: null, gameTime: 0 };
  private _lastLoggedInventoryString: string = '';
  private _lastLoggedGold: number = -1;

  // --- NEW Target Item State ---
  // ID of the single item currently being suggested
  private _currentTargetItemId: number | null = null;
  // Game time when the current target was first suggested
  private _currentTargetSuggestionTime: number | null = null;

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
    let goldChanged = false;
    let itemsChanged = false;
    let nameFound = false;

    // --- 1. Update State from Parsed Nested JSON --- 
    try {
      const liveClientData = info?.live_client_data;

      // --- High-level console logging --- 
      if (liveClientData) {
        console.log("Found liveClientData object.");
        console.log(`Type of active_player: ${typeof liveClientData.active_player}`);
        console.log(`Type of all_players: ${typeof liveClientData.all_players}`);
      } else {
        console.log("liveClientData object NOT found in this update.");
      }
      // --- End high-level logging ---

      // --- Process active_player --- 
      if (liveClientData && typeof liveClientData.active_player === 'string') {
        try {
          const activePlayerData = JSON.parse(liveClientData.active_player);
          // ... (Update summonerName, gold) ...
          if (!this._playerState.summonerName && activePlayerData.summonerName) {
            this._playerState.summonerName = activePlayerData.summonerName;
            nameFound = true;
          }
          if (activePlayerData.currentGold !== undefined && activePlayerData.currentGold !== this._playerState.gold) {
            this._playerState.gold = activePlayerData.currentGold;
            goldChanged = true;
          }
        } catch (parseError) {
          console.error("[active_player check] Failed to parse active_player JSON string:", parseError); // Simplified error
        }
      }

      // --- Process all_players --- 
      if (this._playerState.summonerName && liveClientData && typeof liveClientData.all_players === 'string') {
        // ... (Parsing logic for allPlayersArray) ...
        try {
          const allPlayersArray = JSON.parse(liveClientData.all_players);
          if (Array.isArray(allPlayersArray)) {
            const playerData = allPlayersArray.find(p => p.summonerName === this._playerState.summonerName);
            if (playerData && Array.isArray(playerData.items)) {
              const currentItemsString = JSON.stringify(playerData.items);
              if (currentItemsString !== JSON.stringify(this._playerState.items)) {
                this._playerState.items = playerData.items;
                itemsChanged = true;
              }
            }
          }
        } catch (parseError) {
          console.error("[all_players check] Failed to parse all_players JSON string:", parseError); // Simplified error
        }
      }

      // --- Fallback Gold Check (game_info) --- 
      if (!goldChanged) {
        // ... (Existing game_info.gold parsing logic, setting goldChanged) ...
        const gameInfoGoldString = info?.game_info?.gold;
        if (typeof gameInfoGoldString === 'string') {
          try {
            const innerGoldData = JSON.parse(gameInfoGoldString);
            const currentGoldString = innerGoldData?.gold;
            if (currentGoldString !== undefined) {
              const currentGold = parseInt(currentGoldString) || 0;
              if (currentGold !== this._playerState.gold) {
                this._playerState.gold = currentGold;
                goldChanged = true;
                console.log("Updated gold from game_info:", this._playerState.gold);
              }
            }
          } catch (parseError) { /* Ignore */ }
        }
      }

    } catch (e) {
      console.error('Error processing info update:', e);
    }

    // --- 2. Update UI Log --- 
    const goldChangedForUI = this._playerState.gold !== this._lastLoggedGold;
    const itemsStringForUI = JSON.stringify(this._playerState.items);
    const itemsChangedForUI = itemsStringForUI !== this._lastLoggedInventoryString;

    const shouldUpdateUI = goldChangedForUI || itemsChangedForUI || nameFound;

    if (shouldUpdateUI) {
      if (goldChangedForUI) this._lastLoggedGold = this._playerState.gold;
      if (itemsChangedForUI) this._lastLoggedInventoryString = itemsStringForUI;

      if (this._infoLog) {
        this._infoLog.innerHTML = '';
        this.logLine(this._infoLog, this._playerState.items, false);
        this.logLine(this._infoLog, `Gold: ${this._playerState.gold}`, false);
        this.logLine(this._infoLog, `GameTime: ${this._playerState.gameTime}s`, false);
      }
    }

    // --- Call Single Target Check Function --- 
    if (this._playerState.summonerName && this._playerState.items && this._playerState.gold >= 0 && this._playerState.gameTime > 0) {
      this.checkTargetItem();
    }
  }

  // Special events will be highlighted in the event log
  private onNewEvents(e) {
    // --- Handle match_clock event --- 
    if (e.events) {
      for (const event of e.events) {
        if (event.name === 'match_clock') {
          try {
            const newGameTime = parseInt(event.data);
            if (!isNaN(newGameTime) && newGameTime !== this._playerState.gameTime) {
              // console.log(`[onNewEvents] Updating gameTime to ${newGameTime} from match_clock`); // Optional log
              this._playerState.gameTime = newGameTime;
              // We could potentially trigger a UI update here too if needed,
              // but let's rely on gold/item changes for now to avoid too much flicker.
            }
          } catch (err) {
            console.error("Error parsing match_clock data:", event.data, err);
          }
          // No need to process other events in this loop for now
          break; // Assuming only one match_clock event per batch
        }
      }
    }
    // --- End match_clock handling ---

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
  private logLine(log: HTMLElement, data: any, highlight: boolean) {
    if (!log) return; // Safety check
    const line = document.createElement('pre');
    line.textContent = JSON.stringify(data);

    if (highlight) {
      line.className = 'highlight';
    }

    // Check if scroll is near bottom *before* appending
    const shouldAutoScroll =
      log.scrollTop + log.offsetHeight >= log.scrollHeight - 10;

    log.appendChild(line);

    // Scroll down only if it was already near the bottom
    if (shouldAutoScroll) {
      log.scrollTop = log.scrollHeight;
    }
  }

  private async getCurrentGameClassId(): Promise<number | null> {
    const info = await OWGames.getRunningGameInfo();

    return (info && info.isRunning && info.classId) ? info.classId : null;
  }

  // --- NEW Single Target Check Logic --- 
  private checkTargetItem(): void {
    if (!this._playerState || !this._playerState.items) return;

    const playerGold = this._playerState.gold;
    const currentGameTime = this._playerState.gameTime;
    const playerItemCounts = new Map<number, number>();
    this._playerState.items.forEach(item => {
      playerItemCounts.set(item.itemID, (playerItemCounts.get(item.itemID) || 0) + item.count);
    });

    let potentialTargetItemId: number | null = null;

    // 1. Find the highest priority potential target
    console.log("[TargetCheck] Finding potential target...");
    // Log before starting the loop
    console.log(`[TargetCheck] Looping through ITEM_PRIORITY (count: ${ITEM_PRIORITY.length})...`);

    for (const itemDef of ITEM_PRIORITY) {
      // Log each item being checked
      console.log(`[TargetCheck] Checking item in loop: ${itemDef.name}`);

      // Specific check for Void Staff
      if (itemDef.id === 3135) { // Void Staff ID
        console.log("[TargetCheck] --- Currently checking VOID STAFF --- ");
      }

      const ownsFinalItem = playerItemCounts.has(itemDef.id);
      if (ownsFinalItem) {
        console.log(`[TargetCheck] -> ${itemDef.name}: Already own final item. Skipping.`);
        continue; // Skip if already owned
      }

      let ownsAnyComponent = false;
      if (itemDef.requiresComponentCheck) {
        ownsAnyComponent = itemDef.components.some(comp => playerItemCounts.has(comp.id));
        if (!ownsAnyComponent) {
          console.log(`[TargetCheck] -> ${itemDef.name}: Component required but not owned. Skipping.`);
          continue; // Skip if component required but not owned
        }
      }

      // Calculate remaining cost
      let remainingCost = itemDef.cost;
      const requiredComponentCounts = new Map<number, number>();
      itemDef.components.forEach(comp => {
        requiredComponentCounts.set(comp.id, (requiredComponentCounts.get(comp.id) || 0) + 1);
      });
      let componentValueOwned = 0;
      for (const [reqCompId, reqCount] of requiredComponentCounts.entries()) {
        const ownedCount = playerItemCounts.get(reqCompId) || 0;
        const countToDiscount = Math.min(reqCount, ownedCount);
        const componentCost = itemDef.components.find(c => c.id === reqCompId)?.cost || 0;
        if (componentCost > 0) componentValueOwned += countToDiscount * componentCost;
      }
      remainingCost -= componentValueOwned;

      const canAfford = playerGold >= remainingCost;

      // Ensure this log is active and prominent
      console.log(`>>>> [TargetCheck] -> ${itemDef.name}: OwnsComponent=${ownsAnyComponent}, CanAfford=${canAfford} (${playerGold} >= ${remainingCost}) <<<<`);

      if (canAfford) {
        potentialTargetItemId = itemDef.id; // Found highest priority target
        console.log(`[TargetCheck] Potential target identified: ${itemDef.name} (ID: ${potentialTargetItemId})`);
        break; // Stop checking lower priority items
      }
    }

    // --- REMOVED Log --- 
    // console.log(`[TargetCheck] Current target: ${this._currentTargetItemId}, Potential target: ${potentialTargetItemId}`);

    // 2. Compare potential target with current target and act IMMEDIATELY
    if (potentialTargetItemId !== null) {
      // We found an item we can buy
      if (potentialTargetItemId !== this._currentTargetItemId) {
        // It's a NEW target (or target was null before)
        console.log(`[TargetCheck] NEW Target identified: ${potentialTargetItemId}. Old: ${this._currentTargetItemId}. Playing initial cue.`);
        const newTargetDef = ITEM_PRIORITY.find(i => i.id === potentialTargetItemId);
        if (newTargetDef) {
          this.playAudio(newTargetDef.audioCue);
          this._currentTargetItemId = potentialTargetItemId;
          this._currentTargetSuggestionTime = currentGameTime;
        } else {
          console.error(`[TargetCheck] Could not find item definition for ID: ${potentialTargetItemId}`);
          this._currentTargetItemId = null; // Clear inconsistent state
          this._currentTargetSuggestionTime = null;
        }
      } else {
        // It's the SAME target as before - check reminder
        console.log(`[TargetCheck] Target is still ${potentialTargetItemId}. Checking reminder.`);
        if (this._currentTargetSuggestionTime !== null) {
          const delay = CURRENT_REMINDER_DELAY_SECONDS;
          const reminderDue = currentGameTime >= (this._currentTargetSuggestionTime + delay);
          console.log(`[TargetCheck] Reminder check: ${currentGameTime} >= (${this._currentTargetSuggestionTime} + ${delay}) -> ${reminderDue}`);
          if (reminderDue) {
            console.log(`[TargetCheck] >>> PLAYING REMINDER (Target: ${this._currentTargetItemId}) <<<`);
            this.playAudio('idiot_song_001.mp3');
            this._currentTargetSuggestionTime = currentGameTime; // Reset timer
            console.log("[TargetCheck] Reminder played, reminder timer reset.");
          } else {
            console.log("[TargetCheck] Reminder not due yet.");
          }
        } else {
          console.warn("[TargetCheck] Target item ID exists but suggestion time is null. Resetting suggestion time.");
          this._currentTargetSuggestionTime = currentGameTime; // Reset time for safety
        }
      }
    } else {
      // No potential target found in the loop
      if (this._currentTargetItemId !== null) {
        // We HAD a target, but now can't afford/don't have components for it
        console.log(`[TargetCheck] No potential target found. Clearing previous target (${this._currentTargetItemId}).`);
        this._currentTargetItemId = null;
        this._currentTargetSuggestionTime = null;
      } else {
        // No potential target, and no previous target. Do nothing.
        console.log("[TargetCheck] No current or potential target. Doing nothing.");
      }
    }
  }

  // Modify playAudio function
  private playAudio(fileName: string): void {
    // Construct the path relative to the in_game.html file
    const audioPath = `../../audio/${fileName}`;
    console.log(`Attempting to play audio: ${audioPath}`);

    // Create a NEW Audio object each time
    const audio = new Audio(audioPath);

    // Play and handle errors locally
    audio.play().catch(e => {
      // Log errors without stopping execution
      console.error(`Error playing audio ${fileName} (${audioPath}):`, e);
    });
    // No need to manage this audio object further, let garbage collection handle it.
  }
}

InGame.instance().run();