import {
  OWGames,
  OWGamesEvents,
  OWHotkeys
} from "@overwolf/overwolf-api-ts";

import { AppWindow } from "../AppWindow";
import { kHotkeys, kWindowNames, kGamesFeatures } from "../consts";

import WindowState = overwolf.windows.WindowStateEx;

// Define these at a higher scope or pass them in if they vary,
// for now, using manifest values.
const MANIFEST_ORIGINAL_WIDTH = 1212;
const MANIFEST_ORIGINAL_HEIGHT = 699;

// --- Constants --- 
const HEADER_HEIGHT = 54; // Assumed height of the header in pixels
const PURCHASE_REMINDER_DELAY_SECONDS_CONFIG = 30; // 30 seconds (Original)
const TEST_REMINDER_DELAY_SECONDS = 30; // 5 seconds for testing (longer than 2 to avoid rapid fire)
const CURRENT_REMINDER_DELAY_SECONDS = TEST_REMINDER_DELAY_SECONDS; // Use this constant

// --- High Gold Constants ---
const HIGH_GOLD_THRESHOLD = 3000;
const HIGH_GOLD_INTERVAL_SECONDS = 60;
const HIGH_GOLD_AUDIO_FILE = 'icarus_song_001.mp3';

// --- Ward Constants ---
const CONTROL_WARD_ID = 2055;
const ENEMY_WARD_PURCHASED_AUDIO = '<champion_name>_ward_purchased.mp3'; // Placeholder template
const ENEMY_WARD_PLACED_AUDIO = '<champion_name>_ward_placed.mp3'; // Placeholder template

// --- Item Definitions (Based on user input/logic) ---
const PRICE = {
  lichbane: 3200,
  rabadons: 3600,
  void: 3000,
  zhonyas: 3250, // Using standard cost based on previous discussion
  armguard: 1600,
  jewel: 1100,
  wand: 850,
  rod: 1200,
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

// Define target dimensions for the "small button" state
const COLLAPSED_WINDOW_WIDTH = 150; // Example width, adjust as needed
const COLLAPSED_WINDOW_HEIGHT = 50;  // Example height, adjust as needed (ensure manifest.json min_size allows this)

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
  private _logsContainer: HTMLElement;
  private _mainElement: HTMLElement;
  private _toggleLogsDisplayBtn: HTMLButtonElement;
  private _areLogsVisible: boolean = true;

  // --- Header elements to toggle ---
  private _headerIcon: HTMLImageElement;
  private _headerTitle: HTMLHeadingElement;
  private _headerHotkeyText: HTMLHeadingElement;
  private _windowControlsGroup: HTMLDivElement;

  // --- State Variables ---
  private _playerState: { gold: number; items: any[]; summonerName: string | null; gameTime: number; teamId: string | null } =
    { gold: 0, items: [], summonerName: null, gameTime: 0, teamId: null };
  private _lastLoggedInventoryString: string = '';
  private _lastLoggedGold: number = -1;

  private _originalWindowWidth: number;
  private _originalWindowHeight: number;
  private _currentWindowId: string;

  // --- NEW Target Item State ---
  // ID of the single item currently being suggested
  private _currentTargetItemId: number | null = null;
  // Game time when the current target was first suggested
  private _currentTargetSuggestionTime: number | null = null;

  // --- High Gold State ---
  // Game time when the high gold cue was last played
  private _lastHighGoldCueTime: number | null = null;

  // State for all players' data
  private _allPlayersState: any[] = [];
  private _lastLoggedAllPlayersString: string = ''; // Track changes to this array

  // --- Enemy Ward State ---
  // Stores previous ward count for each enemy champion
  private _enemyWardCounts: Record<string, number> = {}; // Key: ChampionName, Value: Count

  private constructor() {
    super(kWindowNames.inGame);

    // Original dimensions are now set in run(), after forcing initial size.

    this._eventsLog = document.getElementById('eventsLog');
    this._infoLog = document.getElementById('infoLog');
    if (this._infoLog) this._infoLog.innerHTML = '';

    this._logsContainer = document.getElementById('logs') as HTMLElement;
    this._mainElement = document.querySelector('main') as HTMLElement;
    this._toggleLogsDisplayBtn = document.getElementById('toggleLogsDisplayBtn') as HTMLButtonElement;
    this._headerIcon = document.querySelector('#header > img') as HTMLImageElement;
    this._headerTitle = document.querySelector('#header > h1:not(.hotkey-text)') as HTMLHeadingElement;
    this._headerHotkeyText = document.querySelector('#header > .hotkey-text') as HTMLHeadingElement;
    this._windowControlsGroup = document.querySelector('#header > .window-controls-group') as HTMLDivElement;

    console.log('Constructor: All base elements queried.');
    // _updateUIVisibility will be called in run() after initial size is forced.
  }

  public static instance(): InGame {
    if (!InGame._instance) {
      InGame._instance = new InGame();
    }
    return InGame._instance;
  }

  private async getWindowInfo(windowName?: string): Promise<overwolf.windows.WindowInfo> {
    return new Promise<overwolf.windows.WindowInfo>((resolve, reject) => {
      const callback = (result: overwolf.windows.WindowResult) => {
        if (result && typeof result === 'object' && typeof (result as any).success === 'boolean') {
          const successResult = result as { success: boolean; window?: overwolf.windows.WindowInfo; error?: string };
          if (successResult.success && successResult.window) {
            resolve(successResult.window);
          } else {
            const errorMessage = successResult.error || `Operation not successful or window data missing for ${windowName || 'current window'}`;
            reject(errorMessage);
          }
        } else {
          reject(`Received unexpected result structure for ${windowName || 'current window'}`);
        }
      };
      if (windowName) {
        overwolf.windows.obtainDeclaredWindow(windowName, callback);
      } else {
        overwolf.windows.getCurrentWindow(callback);
      }
    });
  }

  public async run() {
    try {
      const preliminaryWindowInfo = await this.getWindowInfo();
      this._currentWindowId = preliminaryWindowInfo.id;
      console.log(`Run: Obtained window ID: ${this._currentWindowId}. Current reported size: ${preliminaryWindowInfo.width}x${preliminaryWindowInfo.height}`);

      await new Promise<void>((resolve, reject) => {
        console.log(`Run: Attempting to force window to manifest size: ${MANIFEST_ORIGINAL_WIDTH}x${MANIFEST_ORIGINAL_HEIGHT}`);
        overwolf.windows.changeSize(
          { window_id: this._currentWindowId, width: MANIFEST_ORIGINAL_WIDTH, height: MANIFEST_ORIGINAL_HEIGHT, auto_dpi_resize: true },
          (result) => {
            if (result && result.success) {
              console.log('Run: Successfully forced initial large size.');
              this._originalWindowWidth = MANIFEST_ORIGINAL_WIDTH;
              this._originalWindowHeight = MANIFEST_ORIGINAL_HEIGHT;
              resolve();
            } else {
              console.error('Run: Failed to force initial large size. Using reported size instead.', result);
              this._originalWindowWidth = preliminaryWindowInfo.width; // Fallback
              this._originalWindowHeight = preliminaryWindowInfo.height; // Fallback
              // We might still want to resolve, or reject if this is critical failure.
              // For now, let's resolve and see the state.
              resolve();
            }
          }
        );
      });

      console.log(`Run: Effective original dimensions: ${this._originalWindowWidth}x${this._originalWindowHeight}.`);

      // Now apply initial UI visibility based on the (now hopefully correct) size
      this._updateUIVisibility(); // _areLogsVisible is true by default

      this.setToggleHotkeyText();
      this.setToggleHotkeyBehavior();
      this.setupToggleLogsDisplay();

      const gameClassId = await this.getCurrentGameClassId();
      const gameFeatures = kGamesFeatures.get(gameClassId);
      if (gameFeatures && gameFeatures.length) {
        this._gameEventsListener = new OWGamesEvents({ onInfoUpdates: this.onInfoUpdates.bind(this), onNewEvents: this.onNewEvents.bind(this) }, gameFeatures);
        this._gameEventsListener.start();
      }
    } catch (e) {
      console.error("Failed to initialize InGame window essentials:", e);
    }
  }

  private onInfoUpdates(info) {
    let goldChanged = false;
    let itemsChanged = false;
    let nameFound = false;
    let allPlayersChanged = false; // Flag for the *entire* all_players array
    let teamFound = false; // Flag for initial team discovery

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

      // --- Process active_player (stringified JSON) --- 
      if (liveClientData && typeof liveClientData.active_player === 'string') {
        try {
          const activePlayerData = JSON.parse(liveClientData.active_player);
          // Update Summoner Name (only if currently null)
          if (!this._playerState.summonerName && activePlayerData.summonerName) {
            this._playerState.summonerName = activePlayerData.summonerName;
            nameFound = true;
          }
          // Update Gold (check for NaN)
          if (activePlayerData.currentGold !== undefined) {
            const currentGoldNum = Number(activePlayerData.currentGold); // Convert safely
            if (!isNaN(currentGoldNum) && currentGoldNum !== this._playerState.gold) {
              this._playerState.gold = currentGoldNum;
              goldChanged = true;
            }
          }
        } catch (parseError) {
          // Log the string that failed parsing
          console.error("[active_player parse ERROR] Failed to parse string:", liveClientData.active_player, "Error:", parseError);
        }
      }

      // --- Process all_players (stringified JSON Array) --- 
      if (this._playerState.summonerName && liveClientData && typeof liveClientData.all_players === 'string') {
        try {
          const allPlayersArray = JSON.parse(liveClientData.all_players);
          if (Array.isArray(allPlayersArray)) {
            // Store the whole array
            const currentAllPlayersString = JSON.stringify(allPlayersArray);
            if (currentAllPlayersString !== this._lastLoggedAllPlayersString) {
              this._allPlayersState = allPlayersArray; // Update state
              this._lastLoggedAllPlayersString = currentAllPlayersString; // Update tracker
              allPlayersChanged = true; // Mark change
              console.log("Updated _allPlayersState");
            }

            // Also update the *player's specific* items if needed
            if (this._playerState.summonerName) {
              console.log(`[ItemUpdate] Trying to find player data for summoner: ${this._playerState.summonerName}`);
              const playerData = allPlayersArray.find(p => p.summonerName === this._playerState.summonerName);
              console.log("[ItemUpdate] Player data found in all_players:", playerData); // Log found player data

              if (playerData) {
                console.log("[ItemUpdate] Checking playerData.items...");
                if (Array.isArray(playerData.items)) {
                  console.log("[ItemUpdate] playerData.items IS an array. Comparing strings...");
                  const currentItemsString = JSON.stringify(playerData.items);
                  const previousItemsString = JSON.stringify(this._playerState.items);
                  console.log(`[ItemUpdate] Previous items string: ${previousItemsString}`);
                  console.log(`[ItemUpdate] Current items string: ${currentItemsString}`);
                  if (currentItemsString !== previousItemsString) {
                    console.log("[ItemUpdate] Item strings DIFFER. Updating _playerState.items.");
                    this._playerState.items = playerData.items;
                    itemsChanged = true;
                  } else {
                    console.log("[ItemUpdate] Item strings are the SAME. No update needed.");
                  }
                } else {
                  console.warn("[ItemUpdate] playerData.items is NOT an array:", playerData.items);
                }
                // Update teamId (check for valid string)
                if (playerData && typeof playerData.team === 'string' && playerData.team && playerData.team !== this._playerState.teamId) {
                  this._playerState.teamId = playerData.team;
                  teamFound = true;
                  console.log(`Player team ID set to: ${this._playerState.teamId}`);
                }
              } else {
                console.warn("[ItemUpdate] Player data NOT found in all_players array for name:", this._playerState.summonerName);
              }
            } else {
              console.warn("[ItemUpdate] Cannot update player items because summonerName is still null.");
            }
          }
        } catch (parseError) {
          // Log the string that failed parsing
          console.error("[all_players parse ERROR] Failed to parse string:", liveClientData.all_players, "Error:", parseError);
        }
      }

      // --- Fallback Gold Check (game_info) --- 
      if (!goldChanged) {
        // ... (get gameInfoGoldString) ...
        const gameInfoGoldString = info?.game_info?.gold;
        if (typeof gameInfoGoldString === 'string') {
          try {
            const innerGoldData = JSON.parse(gameInfoGoldString);
            const currentGoldString = innerGoldData?.gold;
            if (currentGoldString !== undefined) {
              const currentGold = parseInt(currentGoldString); // parseInt handles potential non-numbers
              if (!isNaN(currentGold) && currentGold !== this._playerState.gold) { // Check isNaN
                this._playerState.gold = currentGold;
                goldChanged = true;
                console.log("Updated gold from game_info:", this._playerState.gold);
              }
            }
          } catch (parseError) {
            // Log the string that failed parsing
            console.error("[game_info gold parse ERROR] Failed to parse string:", gameInfoGoldString, "Error:", parseError);
          }
        }
      }

    } catch (e) {
      console.error('Error processing info update:', e);
    }

    // --- 2. Update UI Log --- 
    const goldChangedForUI = this._playerState.gold !== this._lastLoggedGold;
    const itemsChangedForUI = JSON.stringify(this._playerState.items) !== this._lastLoggedInventoryString;
    const shouldUpdateUI = goldChangedForUI || itemsChangedForUI || nameFound || allPlayersChanged || teamFound;

    if (shouldUpdateUI) {
      if (goldChangedForUI) this._lastLoggedGold = this._playerState.gold;
      if (itemsChangedForUI) this._lastLoggedInventoryString = JSON.stringify(this._playerState.items);

      if (this._infoLog) {
        this._infoLog.innerHTML = ''; // Clear log panel *once*
        // Log the full all_players array again
        this.logLine(this._infoLog, this._allPlayersState, false);

        // Log Gold and GameTime below it
        this.logLine(this._infoLog, `Gold: ${this._playerState.gold}`, false);
        this.logLine(this._infoLog, `GameTime: ${this._playerState.gameTime}s`, false);
      }
    }

    // --- 3. Call Audio Cue Checks --- 
    const canRunAudioChecks =
      this._playerState.summonerName &&
      this._playerState.items &&
      !isNaN(this._playerState.gold) && this._playerState.gold >= 0 &&
      !isNaN(this._playerState.gameTime) && this._playerState.gameTime > 0;

    if (canRunAudioChecks) {
      // Check high gold condition first
      const isHighGoldActive = this.checkHighGold();
      console.log(`[AudioCheck Pre-Cond] isHighGoldActive: ${isHighGoldActive}`); // Log result

      // Only check for item targets if high gold cue IS NOT active
      if (!isHighGoldActive) {
        console.log("[AudioCheck Pre-Cond] High gold NOT active, checking target item...");
        this.checkTargetItem();
      } else {
        console.log("[AudioCheck Pre-Cond] High gold IS active, skipping target item check.");
        // Clear any existing item target if high gold takes priority
        if (this._currentTargetItemId !== null) {
          console.log("[AudioCheck Pre-Cond] Clearing existing item target due to high gold.");
          this._currentTargetItemId = null;
          this._currentTargetSuggestionTime = null;
        }
      }

      // NOTE: Ward checks would go here and run regardless of isHighGoldActive
      // this.checkWardStatus(); 
      this.checkEnemyWardChanges(); // Call the new ward check function
    } else {
      // Log specific reasons for skipping
      let skipReason = "SKIPPING audio checks due to invalid state: ";
      if (!this._playerState.summonerName) skipReason += " summonerName missing;";
      if (!this._playerState.items) skipReason += " items missing;"; // Should be initialized, but check anyway
      if (isNaN(this._playerState.gold) || this._playerState.gold < 0) skipReason += ` invalid gold (${this._playerState.gold});`;
      if (isNaN(this._playerState.gameTime) || this._playerState.gameTime <= 0) skipReason += ` invalid gameTime (${this._playerState.gameTime});`;
      console.log("[AudioCheck Pre-Cond]", skipReason, JSON.stringify(this._playerState));
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
            if (!isNaN(newGameTime) && newGameTime >= 0 && newGameTime !== this._playerState.gameTime) {
              // Log periodically to confirm time updates are still happening
              if (newGameTime % 60 === 0) { // Log every minute
                console.log(`[onNewEvents] GameTime updated via match_clock: ${newGameTime}`);
              }
              this._playerState.gameTime = newGameTime;
            }
          } catch (err) {
            console.error("Error parsing match_clock data:", event.data, err);
          }
          break;
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
    // Add validation at the start
    if (!this._playerState || isNaN(this._playerState.gold) || isNaN(this._playerState.gameTime) || !Array.isArray(this._playerState.items)) {
      console.warn("[TargetCheck] Invalid state detected, skipping check.", this._playerState);
      return;
    }

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
        // We HAD a target, but now none meet criteria (afford/component/etc.)
        console.log(`[TargetCheck] Conditions no longer met for any item. Clearing previous target (${this._currentTargetItemId}).`);
        this._currentTargetItemId = null;
        this._currentTargetSuggestionTime = null;
      } else {
        // No potential target, and no previous target. Do nothing.
        // console.log("[TargetCheck] No current or potential target. Doing nothing.");
      }
    }
  }

  // Modify playAudio function
  private playAudio(fileName: string): void {
    // Construct the path relative to the in_game.html file
    const audioPath = `audio/${fileName}`;
    console.log(`Attempting to play audio: ${audioPath}`);

    const audio = new Audio(audioPath);

    audio.play().catch(e => {
      // Make error more prominent
      console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
      console.error(`!!! ERROR PLAYING AUDIO FILE: ${fileName} !!!`);
      console.error(`Path: ${audioPath}`);
      console.error(`Error Details:`, e);
      console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    });
  }

  // --- High Gold Check Logic --- 
  /**
   * Checks if gold is above threshold and plays audio cue periodically.
   * @returns true if gold is high (regardless of whether audio played due to cooldown), false otherwise.
   */
  private checkHighGold(): boolean {
    // Add validation at the start
    if (!this._playerState || isNaN(this._playerState.gold) || isNaN(this._playerState.gameTime) || this._playerState.gameTime <= 0) {
      console.warn("[HighGold] Invalid state detected, skipping check.", this._playerState);
      return false;
    }

    // Re-add entry log
    console.log("[HighGold] Running check...");

    const playerGold = this._playerState.gold;
    const currentGameTime = this._playerState.gameTime;
    const isCurrentlyHighGold = playerGold > HIGH_GOLD_THRESHOLD;
    console.log(`[HighGold] Current Gold: ${playerGold}, Threshold: ${HIGH_GOLD_THRESHOLD}, Is High: ${isCurrentlyHighGold}`); // Log current state

    if (isCurrentlyHighGold) {
      // Check if it's the first time or if interval has passed
      const timeCheckPassed =
        this._lastHighGoldCueTime === null ||
        currentGameTime >= (this._lastHighGoldCueTime + HIGH_GOLD_INTERVAL_SECONDS);

      console.log(`[HighGold] TimeCheck: ${currentGameTime} >= (${this._lastHighGoldCueTime} + ${HIGH_GOLD_INTERVAL_SECONDS}) -> ${timeCheckPassed}`);

      if (timeCheckPassed) {
        console.log(`[HighGold] >>> PLAYING HIGH GOLD CUE <<< (Time check passed)`); // Add reason
        this.playAudio(HIGH_GOLD_AUDIO_FILE);
        this._lastHighGoldCueTime = currentGameTime;
      } else {
        console.log("[HighGold] Time check failed (on cooldown)."); // Log cooldown state
      }
      return true;
    } else {
      // Gold is below threshold
      if (this._lastHighGoldCueTime !== null) {
        console.log(`[HighGold] Gold dropped below threshold. Resetting timer.`);
        this._lastHighGoldCueTime = null; // Reset timer if gold drops
      }
      return false;
    }
  }

  // --- Enemy Ward Check Logic --- 
  private checkEnemyWardChanges(): void {
    // Add validation at the start
    if (!this._playerState?.teamId || !this._allPlayersState || this._allPlayersState.length === 0 || !this._playerState.summonerName) {
      console.warn("[WardCheck] Invalid state detected (teamId, allPlayers, name), skipping check.", this._playerState, this._allPlayersState);
      return;
    }

    console.log("[WardCheck] Running check...");
    const currentEnemyWards: Record<string, number> = {};

    // Calculate current ward counts for all enemies
    for (const player of this._allPlayersState) {
      // Check if enemy and has needed data
      if (player.team && player.team !== this._playerState.teamId && player.championName) {
        const champName = player.championName;
        let currentWardCount = 0;
        if (Array.isArray(player.items)) {
          const wardItem = player.items.find(item => item.itemID === CONTROL_WARD_ID);
          currentWardCount = wardItem ? wardItem.count : 0;
        }
        currentEnemyWards[champName] = currentWardCount;
      }
    }

    // Compare current counts with previous counts
    for (const champName in currentEnemyWards) {
      const currentCount = currentEnemyWards[champName];
      const previousCount = this._enemyWardCounts[champName] ?? 0; // Default to 0 if new enemy

      console.log(`[WardCheck] ${champName}: Prev=${previousCount}, Curr=${currentCount}`);

      if (currentCount > previousCount) {
        console.log(`[WardCheck] >>> ${champName} PURCHASED/GAINED WARD <<<`);
        const audioFile = ENEMY_WARD_PURCHASED_AUDIO.replace('<champion_name>', champName);
        this.playAudio(audioFile);
      } else if (currentCount < previousCount) {
        console.log(`[WardCheck] >>> ${champName} PLACED/LOST WARD <<<`);
        const audioFile = ENEMY_WARD_PLACED_AUDIO.replace('<champion_name>', champName);
        this.playAudio(audioFile);
      }

      // Update the stored count for the next check
      this._enemyWardCounts[champName] = currentCount;
    }

    // Optional: Clean up enemies no longer in the game? (More complex state management)
    // for (const champName in this._enemyWardCounts) {
    //     if (!currentEnemyWards.hasOwnProperty(champName)) {
    //         delete this._enemyWardCounts[champName];
    //     }
    // }
    console.log("[WardCheck] Finished check.");
  }

  private setupToggleLogsDisplay(): void {
    if (
      this._toggleLogsDisplayBtn && // Check only button; other elements are handled by _updateUIVisibility
      this._mainElement &&
      this._currentWindowId &&
      typeof this._originalWindowWidth === 'number' &&
      typeof this._originalWindowHeight === 'number'
      // Removed checks for individual header elements here as _updateUIVisibility handles them
    ) {
      this._toggleLogsDisplayBtn.addEventListener('click', () => {
        this._areLogsVisible = !this._areLogsVisible;
        console.log(`Toggle button clicked. _areLogsVisible is now: ${this._areLogsVisible}`);

        // Update all UI elements based on the new state
        this._updateUIVisibility();

        // Perform window resizing
        let targetWidth: number;
        let targetHeight: number;
        let logMessage: string;

        if (this._areLogsVisible) {
          targetWidth = this._originalWindowWidth;
          targetHeight = this._originalWindowHeight;
          logMessage = `Window restoring to original size: ${targetWidth}x${targetHeight}.`;
        } else {
          targetWidth = COLLAPSED_WINDOW_WIDTH;
          targetHeight = COLLAPSED_WINDOW_HEIGHT;
          logMessage = `Window collapsing to ${targetWidth}x${targetHeight}.`;
        }

        const sizeParams: overwolf.windows.ChangeWindowSizeParams = {
          window_id: this._currentWindowId,
          width: targetWidth,
          height: targetHeight,
          auto_dpi_resize: true
        };

        overwolf.windows.changeSize(sizeParams, (result) => {
          if (result && result.success) {
            console.log(logMessage, 'Success.');
          } else {
            console.error('Failed to change window size:', result, logMessage);
          }
        });
      });
    } else {
      console.error("setupToggleLogsDisplay: Prerequisites not met for base elements.", {
        btn: !!this._toggleLogsDisplayBtn,
        main: !!this._mainElement,
        id: this._currentWindowId,
        width: this._originalWindowWidth,
        height: this._originalWindowHeight
      });
      // Log if specific header elements were not found during constructor (they won't be logged here anymore)
      // This part of the log might be less relevant if the _updateUIVisibility uses its internal checks.
    }
  }

  // NEW: Centralized UI update logic based on visibility state
  private _updateUIVisibility(): void {
    console.log(`_updateUIVisibility called, _areLogsVisible: ${this._areLogsVisible}`);
    if (this._areLogsVisible) {
      if (this._mainElement) this._mainElement.style.display = 'flex';
      if (this._toggleLogsDisplayBtn) this._toggleLogsDisplayBtn.innerText = 'Hide Logs';
      if (this._headerIcon) this._headerIcon.style.display = ''; // Revert to stylesheet default
      if (this._headerTitle) this._headerTitle.style.display = '';
      if (this._headerHotkeyText) this._headerHotkeyText.style.display = '';
      if (this._windowControlsGroup) this._windowControlsGroup.style.display = '';
    } else {
      if (this._mainElement) this._mainElement.style.display = 'none';
      if (this._toggleLogsDisplayBtn) this._toggleLogsDisplayBtn.innerText = 'Activate App';
      if (this._headerIcon) this._headerIcon.style.display = 'none';
      if (this._headerTitle) this._headerTitle.style.display = 'none';
      if (this._headerHotkeyText) this._headerHotkeyText.style.display = 'none';
      if (this._windowControlsGroup) this._windowControlsGroup.style.display = 'none';
    }
    // Diagnostic for button text after update
    if (this._toggleLogsDisplayBtn) console.log(`_updateUIVisibility - Button text is now: ${this._toggleLogsDisplayBtn.innerText}`);
  }
}

InGame.instance().run();