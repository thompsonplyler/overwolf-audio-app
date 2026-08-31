import {
  OWGames,
  OWGamesEvents,
  OWHotkeys,
  OWGameListener
} from "@overwolf/overwolf-api-ts";

import { AppWindow } from "../AppWindow";
import { kHotkeys, kWindowNames, kGamesFeatures, kGameClassIds } from "../consts";

import RunningGameInfo = overwolf.games.RunningGameInfo;

import WindowState = overwolf.windows.WindowStateEx;
import { SettingsManager, AudioCueId, AUDIO_CUE_LABELS, STORAGE_KEY } from "../config/settings";
import { playAudioFile, stopAudioChannel } from "../audio/audio";
import { setupVignetteSettingsPanel } from "../vignette/vignetteSettingsPanel";
import {
  ITEM_PRIORITY,
  calculateRemainingCost,
  DEFAULT_PURCHASE_EVENT_MAP,
  shouldDeferToHigherPriorityItem,
  MEJAI_SOULSTEALER_ITEM_ID,
  DARK_SEAL_ITEM_ID,
  MEJAI_STACK_RATES,
  MejaiTier,
} from "../items/items";
import { DeathEventWSPayload, KillEventWSPayload, RespawnEventWSPayload, WSClient } from "../ws/wsClient";

// Define these at a higher scope or pass them in if they vary,
// for now, using manifest values.
const MANIFEST_ORIGINAL_WIDTH = 1212;
const MANIFEST_ORIGINAL_HEIGHT = 699;

// --- Constants --- 
const HEADER_HEIGHT = 54; // Assumed height of the header in pixels

// Settings-backed constants
const settings = SettingsManager.instance();

// --- Ward Constants ---
const CONTROL_WARD_ID = 2055;
const ENEMY_WARD_PURCHASED_AUDIO = '<champion_name>_ward_purchased.mp3'; // Placeholder template
const ENEMY_WARD_PLACED_AUDIO = '<champion_name>_ward_placed.mp3'; // Placeholder template

// Item priority now imported from items module

// Compact HUD: full design layout, scaled visually (see .ingame-hud-scaler in CSS)
const HUD_DESIGN_WIDTH = 248;
// Includes the "More" extra panel's reserved space (see --ingame-hud-extra-slot-height in ingame-hud.css).
const HUD_DESIGN_HEIGHT = 620;
const HUD_DESIGN_ARTBOARD = 240;
/** 0.5 ≈ half of ~210px on-screen disc; tunable via HUD_LAYOUT_SCALE */
const HUD_LAYOUT_SCALE = 0.5;
/** While the "More" panel is open, the whole HUD renders at 200% of its normal compact scale. */
const HUD_LAYOUT_SCALE_EXPANDED = HUD_LAYOUT_SCALE * 2;
/** Disc center on 1920×1080 — bottom row, just left of champion portrait (see layout screenshot) */
const HUD_DISC_CENTER_X = 500;
const HUD_DISC_CENTER_Y = 1060;

const COLLAPSED_WINDOW_WIDTH = Math.round(HUD_DESIGN_WIDTH * HUD_LAYOUT_SCALE);
/** Compact HUD — fixed size; More panel toggles visibility and, since it also scales the HUD 200%, the window size. */
const COLLAPSED_WINDOW_HEIGHT = Math.round(HUD_DESIGN_HEIGHT * HUD_LAYOUT_SCALE);
const HUD_DISC_DIAMETER_PX = Math.round(HUD_DESIGN_ARTBOARD * HUD_LAYOUT_SCALE);

const EXPANDED_WINDOW_WIDTH = Math.round(HUD_DESIGN_WIDTH * HUD_LAYOUT_SCALE_EXPANDED);
const EXPANDED_WINDOW_HEIGHT = Math.round(HUD_DESIGN_HEIGHT * HUD_LAYOUT_SCALE_EXPANDED);
const HUD_DISC_DIAMETER_PX_EXPANDED = Math.round(HUD_DESIGN_ARTBOARD * HUD_LAYOUT_SCALE_EXPANDED);

// Late game, low level audio sting (3:01+, level < 4, repeats every 60s game time)
const WHATAREYOUDOING_GAME_TIME_SEC = 181; // 3:01 on match_clock
const WHATAREYOUDOING_INTERVAL_SEC = 60;
const WHATAREYOUDOING_LEVEL_THRESHOLD = 4;

type FirstShopReminderState = 'idle' | 'waiting' | 'resolved';

/** Fountain starting-items shop always happens before this (game seconds). */
const FIRST_SHOP_BASELINE_WINDOW_SEC = 15;

function normalizeInventoryForSnapshot(items: unknown[]): string {
  if (!Array.isArray(items)) return '[]';
  const parts = items
    .map((raw) => {
      const it = raw as { itemID?: unknown; itemId?: unknown; count?: unknown };
      const id = Number(it.itemID ?? it.itemId);
      const cnt = Number(it.count);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(cnt) || cnt <= 0) return null;
      return `${id}:${cnt}`;
    })
    .filter((p): p is string => p !== null)
    .sort();
  return JSON.stringify(parts);
}

function tryParseGoldValue(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const direct = Number(trimmed);
    if (!isNaN(direct)) return direct;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return tryParseGoldValue(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }
    return null;
  }
  if (typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    if (rec.gold !== undefined) return tryParseGoldValue(rec.gold);
    if (rec.total_gold !== undefined) return tryParseGoldValue(rec.total_gold);
  }
  return null;
}

function applyGoldIfChanged(currentGold: number, playerState: { gold: number }): boolean {
  if (!Number.isFinite(currentGold) || currentGold === playerState.gold) {
    return false;
  }
  playerState.gold = currentGold;
  return true;
}

/**
 * When true: once per in-game window lifetime, logs the entire `onInfoUpdates` payload as expanded JSON
 * (parses string blobs like live_client_data.active_player). Set false after you capture logs.
 */
const DUMP_FULL_INFO_UPDATES_ONCE = false;

/** Log GEP events + summoner-spell info changes to find Flash usage signals. Set false after testing. */
const PROBE_FLASH_SUMMONER_SPELLS = true;

const FLASH_PROBE_EVENT_IGNORE = new Set(['match_clock']);

function circularReplacer(): (this: unknown, key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value as object)) return '[Circular]';
      seen.add(value as object);
    }
    return value;
  };
}

function tryParseJsonString(s: string): unknown {
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return s;
  try {
    return JSON.parse(t);
  } catch {
    return s;
  }
}

/** Walk an object tree and collect paths whose keys look spell/cooldown related. */
function collectSpellCooldownPaths(
  obj: unknown,
  prefix = '',
  out: string[] = [],
  depth = 0,
): string[] {
  if (obj == null || depth > 10) return out;
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      collectSpellCooldownPaths(tryParseJsonString(trimmed), prefix, out, depth + 1);
    }
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectSpellCooldownPaths(item, `${prefix}[${i}]`, out, depth + 1));
    return out;
  }
  if (typeof obj !== 'object') return out;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (/flash|summoner|spell|cooldown|abilityready|ult_cd/i.test(key)) {
      out.push(`${path}=${JSON.stringify(value)}`);
    }
    collectSpellCooldownPaths(value, path, out, depth + 1);
  }
  return out;
}

function extractSummonerSpellsFromActivePlayer(liveClientData: Record<string, unknown>): unknown {
  const raw = liveClientData.active_player;
  let ap: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    const parsed = tryParseJsonString(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ap = parsed as Record<string, unknown>;
  } else if (raw && typeof raw === 'object') {
    ap = raw as Record<string, unknown>;
  }
  return ap?.summonerSpells ?? null;
}

function extractLocalPlayerSummonerSpells(
  liveClientData: Record<string, unknown>,
  summonerName: string | null,
): unknown {
  const fromActive = extractSummonerSpellsFromActivePlayer(liveClientData);
  if (fromActive) return fromActive;

  const raw = liveClientData.all_players;
  let players: unknown[] | null = null;
  if (typeof raw === 'string') {
    const parsed = tryParseJsonString(raw);
    if (Array.isArray(parsed)) players = parsed;
  } else if (Array.isArray(raw)) {
    players = raw;
  }
  if (!players || !summonerName) return null;

  const me = players.find(
    (p) => p && typeof p === 'object' && (p as { summonerName?: string }).summonerName === summonerName,
  ) as { summonerSpells?: unknown } | undefined;
  return me?.summonerSpells ?? null;
}

function parseLiveClientEventsBlob(liveClientData: Record<string, unknown>): unknown[] {
  const raw = liveClientData.events;
  if (typeof raw === 'string') {
    const parsed = tryParseJsonString(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const events = (parsed as { Events?: unknown[] }).Events;
      if (Array.isArray(events)) return events;
    }
  }
  return [];
}

/** LoL GEP kill event `label` → normalized multikill tier for WebSocket consumers. */
function multikillFromGeKillLabel(label: string | undefined): KillEventWSPayload['multikill'] {
  switch (label) {
    case 'double_kill':
      return 'double';
    case 'triple_kill':
      return 'triple';
    case 'quadra_kill':
      return 'quadra';
    case 'penta_kill':
      return 'penta';
    default:
      return 'single';
  }
}

function parseKillEventData(raw: unknown): Omit<KillEventWSPayload, 'name' | 'ts' | 'killstreak'> {
  let obj: Record<string, unknown> | null = null;
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else if (typeof raw === 'string') {
    const parsed = tryParseJsonString(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  }
  const label = obj && typeof obj.label === 'string' ? obj.label : undefined;
  const multikill = multikillFromGeKillLabel(label);
  const gep_kill_label = typeof label === 'string' ? label : 'unknown';

  let gep_kill_type_count = 0;
  let gep_total_champion_kills_match = 0;
  if (obj) {
    if (obj.count !== undefined && obj.count !== null) {
      const n = Number(obj.count);
      if (!isNaN(n)) gep_kill_type_count = n;
    }
    if (obj.totalKills !== undefined && obj.totalKills !== null) {
      const n = Number(obj.totalKills);
      if (!isNaN(n)) gep_total_champion_kills_match = n;
    }
  }

  return { multikill, gep_kill_label, gep_kill_type_count, gep_total_champion_kills_match };
}

function parseDeathEventData(raw: unknown): { gep_death_count: number } {
  let obj: Record<string, unknown> | null = null;
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else if (typeof raw === 'string') {
    const parsed = tryParseJsonString(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  }
  let gep_death_count = 0;
  if (obj && obj.count !== undefined && obj.count !== null) {
    const n = Number(obj.count);
    if (!isNaN(n) && n >= 0) gep_death_count = n;
  }
  return { gep_death_count };
}

const LIVE_CLIENT_STRING_JSON_KEYS = ['active_player', 'all_players'] as const;

function expandLiveClientRecord(lcd: Record<string, unknown>): Record<string, unknown> {
  const out = { ...lcd };
  for (const key of LIVE_CLIENT_STRING_JSON_KEYS) {
    const v = out[key];
    if (typeof v === 'string') {
      out[key] = tryParseJsonString(v);
    }
  }
  return out;
}

/** Deep-enough copy for logging: expand known JSON strings so grep/search finds nested keys (e.g. stacks). */
function expandInfoUpdateForDump(info: unknown): unknown {
  if (!info || typeof info !== 'object') return info;
  const root = { ...(info as Record<string, unknown>) };

  if (root.live_client_data && typeof root.live_client_data === 'object') {
    root.live_client_data = expandLiveClientRecord(root.live_client_data as Record<string, unknown>);
  }

  for (const topKey of ['match_info', 'game_info'] as const) {
    const v = root[topKey];
    if (typeof v === 'string') root[topKey] = tryParseJsonString(v);
  }

  if (root.info && typeof root.info === 'object') {
    const inner = { ...(root.info as Record<string, unknown>) };
    if (inner.live_client_data && typeof inner.live_client_data === 'object') {
      inner.live_client_data = expandLiveClientRecord(inner.live_client_data as Record<string, unknown>);
    }
    for (const k of Object.keys(inner)) {
      const iv = inner[k];
      if (typeof iv === 'string') inner[k] = tryParseJsonString(iv);
    }
    root.info = inner;
  }

  return root;
}

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
  private _shoppingAudioToggleBtn: HTMLButtonElement | null = null;
  private _highGoldIntervalInput: HTMLInputElement | null = null;
  private _targetReminderIntervalInput: HTMLInputElement | null = null;
  private _masterVolumeInput: HTMLInputElement | null = null;
  private _masterMuteBtn: HTMLButtonElement | null = null;
  private _lowLevelVolumeInput: HTMLInputElement | null = null;
  private _lowLevelMuteCheckbox: HTMLInputElement | null = null;
  private _firstShopVolumeInput: HTMLInputElement | null = null;
  private _firstShopMuteCheckbox: HTMLInputElement | null = null;
  private _areLogsVisible: boolean = false;

  // --- Header elements to toggle ---
  private _headerIcon: HTMLImageElement;
  private _headerTitle: HTMLHeadingElement;
  private _headerHotkeyText: HTMLHeadingElement;
  private _windowControlsGroup: HTMLDivElement;

  private _ingameHud: HTMLElement | null = null;
  private _ingameHudExtra: HTMLElement | null = null;
  private _ingameMoreBtn: HTMLButtonElement | null = null;
  private _letsGoBtn: HTMLButtonElement;
  private _ingameMoreExpanded: boolean = false;
  // Per-session: true after the first Let's Go! click, never resets until window reload
  private _hasActivated: boolean = false;

  // --- State Variables ---
  private _playerState: { gold: number; items: any[]; summonerName: string | null; gameTime: number; teamId: string | null; level: number | null } =
    { gold: 0, items: [], summonerName: null, gameTime: 0, teamId: null, level: null };
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

  // Game time when the late-game low-level sting was last played
  private _lastWhatAreYouDoingCueTime: number | null = null;

  /**
   * Hoarding reminder: play once if gold reaches threshold without ever decreasing
   * after the fountain starting-items spend.
   */
  private _firstShopReminderState: FirstShopReminderState = 'idle';
  private _firstShopReminderArmedAtGameTime: number | null = null;
  private _startingSpendBaselineLocked: boolean = false;
  private _firstShopReminderDisqualified: boolean = false;
  /** Peak gold from active_player since starting-spend baseline; only this source drives disqualify. */
  private _peakGoldSinceStartingSpend: number | null = null;
  private _earlyWindowPeakGold: number | null = null;
  private _inventorySnapshotBeforeBaseline: string = '[]';
  private _sawNonEmptyInventoryBefore: boolean = false;
  /** Latest active_player.currentGold; fallback gold paths must not affect first-shop logic. */
  private _latestActivePlayerGold: number | null = null;

  // State for all players' data
  private _allPlayersState: any[] = [];
  private _lastLoggedAllPlayersString: string = ''; // Track changes to this array

  // --- Enemy Ward State ---
  // Stores previous ward count for each enemy champion
  private _enemyWardCounts: Record<string, number> = {}; // Key: ChampionName, Value: Count

  // --- WebSocket/Game session state ---
  private _gameListener: OWGameListener | null = null;
  private _wsClient: WSClient | null = null;
  private _wsPingInterval: number | null = null;
  private _currentMatchId: string | null = null;
  private _gameActive: boolean = false;
  /** Wall-clock anchor (ms) used to derive gameTime when the GEP 'match_clock' event never arrives (observed in Practice Tool). */
  private _localGameTimeAnchorMs: number | null = null;
  /** Once a real match_clock event lands, it becomes authoritative and the local wall-clock fallback stops overwriting gameTime. */
  private _matchClockEverReceived: boolean = false;
  private _emittedItemSignals: Set<number> = new Set<number>();
  private _emittedVillain: boolean = false;
  private _emittedLevel9: boolean = false;
  /** GEP session death count (from `death` event `count`). */
  private _deathCount: number = 0;
  /** Consecutive champion kills since last death (local player). */
  private _consecutiveKills: number = 0;
  private _didFullInfoLeviathanDump: boolean = false;
  private _flashProbeLastSummonerSpellsJson: string = '';
  private _flashProbeSeenLiveClientEventIds: Set<number> = new Set<number>();

  // Mejai's Soulstealer stack tracking (see items.ts MEJAI_STACK_RATES). 'none'
  // until Dark Seal is purchased; stacks carry over on the upgrade to 'mejais'.
  // All of this is reset in resetMatchCombatState() every game_start/game_end --
  // InGame is a long-lived singleton (InGame.instance().run(), one instance for
  // the whole Overwolf session), so without that reset these fields leak stale
  // values into the next match. Confirmed as the real cause of the "fires early,
  // around 22 stacks" bug report, 2026-08-25 -- there was no reset here at all.
  private _mejaiTier: MejaiTier | 'none' = 'none';
  private _mejaiStacks: number = 0;
  /** Mutual-exclusion guard: once ANY of mejai_0/mejai_s/mejai_25/mejai_instant_death
   * fires, the others are disabled for this match (mejai_25_death is the one
   * deliberate exception -- see applyMejaiStackDelta). */
  private _mejaiCueFired: boolean = false;
  /** Kills+assists landed since Mejai's Soulstealer itself (not Dark Seal) was
   * bought -- reset on the Dark Seal->Mejai's upgrade. Used for mejai_instant_death:
   * still 0 when the player dies. */
  private _mejaiKillsAssistsSincePurchase: number = 0;
  /** Set once stacks hit 25. Lets a later death still fire mejai_25_death even
   * though _mejaiCueFired is already true from mejai_25 itself. */
  private _mejaiReachedMax: boolean = false;
  private _mejai25DeathFired: boolean = false;

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

    this._ingameHud = document.getElementById('ingameHud');
    this._ingameHudExtra = document.getElementById('ingameHudExtra');
    this._ingameMoreBtn = document.getElementById('ingameMoreBtn') as HTMLButtonElement;
    this._letsGoBtn = document.getElementById('letsGoBtn') as HTMLButtonElement;
    this._shoppingAudioToggleBtn = document.getElementById('shoppingAudioToggleBtn') as HTMLButtonElement;
    this._highGoldIntervalInput = document.getElementById('highGoldIntervalInput') as HTMLInputElement;
    this._targetReminderIntervalInput = document.getElementById('targetReminderIntervalInput') as HTMLInputElement;
    this._masterVolumeInput = document.getElementById('masterVolumeInput') as HTMLInputElement;
    this._masterMuteBtn = document.getElementById('masterMuteBtn') as HTMLButtonElement;
    this._lowLevelVolumeInput = document.getElementById('lowLevelVolumeInput') as HTMLInputElement;
    this._lowLevelMuteCheckbox = document.getElementById('lowLevelMuteCheckbox') as HTMLInputElement;
    this._firstShopVolumeInput = document.getElementById('firstShopVolumeInput') as HTMLInputElement;
    this._firstShopMuteCheckbox = document.getElementById('firstShopMuteCheckbox') as HTMLInputElement;

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
      this._updateUIVisibility(); // _areLogsVisible is false by default (compact-first launch)

      this.setToggleHotkeyText();
      this.setToggleHotkeyBehavior();
      this.setupToggleLogsDisplay();
      this.setupIngameHudMore();
      this.setupShoppingAudioToggle();
      this.setupIntervalSettings();
      this.setupVolumeControls();
      setupVignetteSettingsPanel('ingameVignette');

      // Desktop and in-game share localStorage (same origin); pick up volume/interval changes
      // made on the desktop window live, without needing a restart. Mute checkboxes are session-only
      // and unaffected by this — they don't come from the persisted store.
      window.addEventListener('storage', (e) => {
        if (e.key === null || e.key === STORAGE_KEY) {
          this.syncVolumeControlsInputs();
          this.syncIntervalSettingsInputs();
        }
      });

      // Initialize WebSocket connection for outbound events
      this.connectWebSocket();

      this._gameListener = new OWGameListener({
        onGameStarted: this.onSupportedGameStarted.bind(this),
        onGameEnded: this.onSupportedGameEnded.bind(this),
      });
      this._gameListener.start();

      const gameClassId = await this.getCurrentGameClassId();
      const gameFeatures = kGamesFeatures.get(gameClassId) || [];
      console.log('[Events] Subscribing features for classId:', gameClassId, 'features:', gameFeatures);
      this._gameEventsListener = new OWGamesEvents({ onInfoUpdates: this.onInfoUpdates.bind(this), onNewEvents: this.onNewEvents.bind(this) }, gameFeatures);
      this._gameEventsListener.start();
    } catch (e) {
      console.error("Failed to initialize InGame window essentials:", e);
    }
  }

  /** One-shot explorer dump for discovering undocumented fields (e.g. item stacks) in the raw League payload. */
  private maybeDumpFullLiveGameInfo(info: unknown): void {
    if (!DUMP_FULL_INFO_UPDATES_ONCE || this._didFullInfoLeviathanDump) return;
    if (!info || typeof info !== 'object') return;
    const rec = info as Record<string, unknown>;
    const meaningful =
      rec.live_client_data != null ||
      rec.game_info != null ||
      rec.match_info != null ||
      rec.info != null;
    if (!meaningful) return;

    this._didFullInfoLeviathanDump = true;
    try {
      const expanded = expandInfoUpdateForDump(info);
      const json = JSON.stringify(expanded, circularReplacer(), 2);
      console.warn('[LiveGameLeviathan] Single expanded dump — search for 1082, 3041, stack, glory, charge:\n', json);
    } catch (e) {
      console.warn('[LiveGameLeviathan] stringify failed:', e);
      try {
        console.warn('[LiveGameLeviathan] Top-level keys:', Object.keys(rec));
      } catch (_) { /* ignore */ }
    }
  }

  private onInfoUpdates(info) {
    this.maybeDumpFullLiveGameInfo(info);
    if (PROBE_FLASH_SUMMONER_SPELLS) {
      this.probeFlashSummonerInfoUpdates(info);
    }

    // Fallback game clock: some sessions (observed in Practice Tool) never emit a GEP
    // 'match_clock' event, which is otherwise the only source for gameTime. Without this,
    // gameTime stays 0 forever and every audio check silently no-ops (canRunAudioChecks
    // requires gameTime > 0). Real match_clock events, if they arrive, take over as authoritative.
    if (this._gameActive && !this._matchClockEverReceived) {
      if (this._localGameTimeAnchorMs === null) {
        this._localGameTimeAnchorMs = Date.now();
      }
      this._playerState.gameTime = Math.floor((Date.now() - this._localGameTimeAnchorMs) / 1000);
    }

    let goldChanged = false;
    let itemsChanged = false;
    let activePlayerGoldThisUpdate: number | null = null;
    let nameFound = false; // Flag for the *entire* all_players array
    let allPlayersChanged = false; // Flag for the *entire* all_players array
    let teamFound = false; // Flag for initial team discovery

    // High-level visibility into categories present on each info update
    try {
      const rootKeys = Object.keys(info || {});
      if (rootKeys.length) {
        console.log('[Info] Root keys:', rootKeys.join(','));
      }
      const inf = (info as any)?.info;
      if (inf) {
        const catKeys = Object.keys(inf);
        if (catKeys.length) {
          console.log('[Info] Categories present:', catKeys.join(','));
        }
      }
    } catch (_) { }

    // --- Also try to capture match_id from match_info if available ---
    try {
      const matchInfoString = info?.match_info;
      if (typeof matchInfoString === 'string') {
        try {
          const matchInfo = JSON.parse(matchInfoString);
          const possibleMatchId = matchInfo?.matchId || matchInfo?.match_id || matchInfo?.gameId || matchInfo?.game_id;
          if (possibleMatchId && possibleMatchId !== this._currentMatchId) {
            this._currentMatchId = String(possibleMatchId);
            console.log(`[WS][Match] matchId detected/updated: ${this._currentMatchId}`);
          }
        } catch (_) {
          console.log('[WS][Match] match_info present but not parsable as JSON');
        }
      }
    } catch (e) {
      console.warn('[WS][Match] Error reading match_info:', e);
    }

    // --- Parse level from info updates (top-level or nested) ---
    try {
      const top = info as any;
      const levelCandidate = top?.level ?? top?.info?.level;
      if (levelCandidate !== undefined) {
        let lvlNum: number | null = null;
        if (typeof levelCandidate === 'number' || typeof levelCandidate === 'string') {
          const n = Number(levelCandidate);
          lvlNum = isNaN(n) ? null : n;
        } else if (levelCandidate && typeof levelCandidate === 'object') {
          const candidate = (levelCandidate as any).level ?? (levelCandidate as any).value ?? (levelCandidate as any).current;
          const n = Number(candidate);
          lvlNum = isNaN(n) ? null : n;
        }
        console.log('[WS][Event][Level][info] raw=', JSON.stringify(levelCandidate), 'parsed=', lvlNum);
        if (lvlNum !== null) {
          this.recordPlayerLevel(lvlNum, 'info.level');
        }
        if (lvlNum !== null && this._gameActive && !this._emittedVillain && lvlNum >= 6) {
          console.log('[WS][Event] Detected level >= 6 via info.level. Emitting villain once for this match. Level=', lvlNum);
          this.sendEventOncePerMatch('villain');
          this._emittedVillain = true;
        }
      }
    } catch (levCatErr) {
      console.log('[WS][Event][Level][info] parse error:', levCatErr);
    }

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
            if (!isNaN(currentGoldNum)) {
              this._latestActivePlayerGold = currentGoldNum;
              activePlayerGoldThisUpdate = currentGoldNum;
            }
            if (!isNaN(currentGoldNum) && currentGoldNum !== this._playerState.gold) {
              this._playerState.gold = currentGoldNum;
              goldChanged = true;
            }
          }
          // Detect level (some payloads use level on root, others under championStats)
          try {
            const detectedLevelRaw = activePlayerData?.level ?? activePlayerData?.championStats?.level;
            const detectedLevel = Number(detectedLevelRaw);
            if (!isNaN(detectedLevel)) {
              this.recordPlayerLevel(detectedLevel, 'active_player');
              // Keep gameTime-driven state but allow level-based villain trigger from info updates too
              if (this._gameActive && !this._emittedVillain && detectedLevel >= 6) {
                console.log('[WS][Event] Detected level >= 6 via info updates (active_player). Emitting villain once for this match. Level=', detectedLevel);
                this.sendEventOncePerMatch('villain');
                this._emittedVillain = true;
              }
            }
          } catch (levErr) {
            console.log('[WS][Event] Level parse from active_player failed:', levErr);
          }
        } catch (parseError) {
          // Log the string that failed parsing
          console.error("[active_player parse ERROR] Failed to parse string:", liveClientData.active_player, "Error:", parseError);
        }
      } else if (liveClientData && typeof liveClientData.active_player === 'object' && liveClientData.active_player !== null) {
        // Some clients may already have parsed objects
        try {
          const ap: any = liveClientData.active_player;
          if (!this._playerState.summonerName && ap.summonerName) {
            this._playerState.summonerName = ap.summonerName;
            nameFound = true;
          }
          if (ap.currentGold !== undefined) {
            const currentGoldNum = Number(ap.currentGold);
            if (!isNaN(currentGoldNum)) {
              this._latestActivePlayerGold = currentGoldNum;
              activePlayerGoldThisUpdate = currentGoldNum;
            }
            if (!isNaN(currentGoldNum) && currentGoldNum !== this._playerState.gold) {
              this._playerState.gold = currentGoldNum;
              goldChanged = true;
            }
          }
          const detectedLevelRaw = ap?.level ?? ap?.championStats?.level;
          const detectedLevel = Number(detectedLevelRaw);
          console.log('[WS][Event][Level][active_player:object] raw=', JSON.stringify(detectedLevelRaw), 'parsed=', detectedLevel);
          if (!isNaN(detectedLevel)) {
            this.recordPlayerLevel(detectedLevel, 'active_player:object');
          }
          if (!isNaN(detectedLevel) && this._gameActive && !this._emittedVillain && detectedLevel >= 6) {
            console.log('[WS][Event] Detected level >= 6 via active_player object. Emitting villain once for this match. Level=', detectedLevel);
            this.sendEventOncePerMatch('villain');
            this._emittedVillain = true;
          }
        } catch (e2) {
          console.log('[WS][Event][Level] active_player object parse error:', e2);
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

                // --- Fallback villain-level detection via all_players entry ---
                try {
                  const levelRaw = playerData?.level ?? playerData?.championStats?.level ?? playerData?.scores?.level;
                  const levelParsed = Number(levelRaw);
                  console.log('[WS][Event][Level][all_players] raw=', JSON.stringify(levelRaw), 'parsed=', levelParsed);
                  if (!isNaN(levelParsed)) {
                    this.recordPlayerLevel(levelParsed, 'all_players');
                  }
                  if (this._gameActive && !this._emittedVillain && !isNaN(levelParsed) && levelParsed >= 6) {
                    console.log('[WS][Event] Detected level >= 6 via all_players. Emitting villain once for this match. Level=', levelParsed);
                    this.sendEventOncePerMatch('villain');
                    this._emittedVillain = true;
                  }
                } catch (levelFromAllPlayersErr) {
                  console.log('[WS][Event][Level][all_players] parse error:', levelFromAllPlayersErr);
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

      // --- Fallback Gold Check (game_info, gold feature, nested info) ---
      if (!goldChanged) {
        const infoRec = info as Record<string, unknown>;
        const innerInfo = infoRec?.info as Record<string, unknown> | undefined;
        const goldCandidates: unknown[] = [
          infoRec?.gold,
          innerInfo?.gold,
          infoRec?.game_info,
          innerInfo?.game_info,
        ];
        if (infoRec?.game_info && typeof infoRec.game_info === 'object') {
          goldCandidates.push((infoRec.game_info as Record<string, unknown>).gold);
        }
        for (const candidate of goldCandidates) {
          const parsedGold = tryParseGoldValue(candidate);
          if (parsedGold !== null && applyGoldIfChanged(parsedGold, this._playerState)) {
            goldChanged = true;
            console.log('[Gold] Updated from fallback path:', this._playerState.gold);
            break;
          }
        }
      }

    } catch (e) {
      console.error('Error processing info update:', e);
    }

    // Emit a once-per-match WS event for every item registered in DEFAULT_PURCHASE_EVENT_MAP.
    // Wire format per emission: { op: "event", name: "<mapped short name>" }.
    try {
      if (itemsChanged && this._gameActive && Array.isArray(this._playerState.items)) {
        for (const [itemIdStr, eventName] of Object.entries(DEFAULT_PURCHASE_EVENT_MAP)) {
          const itemId = Number(itemIdStr);
          if (this._emittedItemSignals.has(itemId)) continue;
          const owns = this._playerState.items.some((it: any) => it && Number(it.itemID) === itemId && Number(it.count) > 0);
          console.log('[WS][Event][ItemSignal] itemId=', itemId, 'eventName=', eventName, 'owns=', owns, 'alreadyEmitted=', this._emittedItemSignals.has(itemId));
          if (owns) {
            console.log('[WS][Event] Detected acquisition of item', itemId, '. Emitting', eventName, 'once for this match.');
            this.sendEventOncePerMatch(eventName);
            const prevMilestoneCount = this._emittedItemSignals.size;
            this._emittedItemSignals.add(itemId);
            const milestoneLimit = settings.getSettings().thresholds.highGoldDisableAfterItemMilestones;
            if (prevMilestoneCount < milestoneLimit && this._emittedItemSignals.size >= milestoneLimit) {
              this.onItemMilestonesChanged();
            }
          }
        }
      }
    } catch (e) {
      console.warn('[WS][Event] Item-signal detection error:', e);
    }

    // Mejai's Soulstealer tier/sell detection -- separate from the generic
    // DEFAULT_PURCHASE_EVENT_MAP loop above (that loop only ever fires the
    // one-time 'mejais' purchase celebration; this tracks the ongoing stack
    // count across the Dark Seal -> Mejai's lifecycle).
    try {
      if (itemsChanged && this._gameActive && Array.isArray(this._playerState.items)) {
        this.updateMejaiTracking();
      }
    } catch (e) {
      console.warn('[Mejai] tracking error:', e);
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
    this.updateFirstShopGoldTracking(itemsChanged, activePlayerGoldThisUpdate);
    if (this.canRunFirstShopReminderCheck()) {
      this.checkFirstShopReminder();
    }

    const canRunAudioChecks =
      this._playerState.summonerName &&
      this._playerState.items &&
      !isNaN(this._playerState.gold) && this._playerState.gold >= 0 &&
      !isNaN(this._playerState.gameTime) && this._playerState.gameTime > 0;

    if (canRunAudioChecks) {
      const shoppingAudioOn = this.isShoppingAudioEnabled();

      // A purchase (or sale/combine) just happened -- silence the high-gold nag
      // immediately regardless of remaining gold. checkHighGold() below only clears
      // it once gold drops back at/under threshold, which doesn't cover "still above
      // threshold but you just acted on it"; this cuts it off on the spot instead.
      if (itemsChanged && this._lastHighGoldCueTime !== null) {
        this._lastHighGoldCueTime = null;
        this.stopAudio('highGold');
      }

      if (shoppingAudioOn) {
        // Item-target cues ("go get your Lich Bane") take priority over the generic
        // high-gold nag -- run the target check first, and only let the high-gold
        // cue play when nothing specific is actionable right now. Previously the
        // high-gold check ran first and skipped checkTargetItem() outright whenever
        // gold was above threshold, which is exactly the state you're in while
        // saving up for a cheap-component item like Lich Bane -- its cue would get
        // silently skipped for the whole accumulation window.
        this.checkTargetItem();
        const hasActiveItemTarget = this._currentTargetItemId !== null;
        const isHighGoldActive = hasActiveItemTarget ? false : this.checkHighGold();
        if (hasActiveItemTarget && this._lastHighGoldCueTime !== null) {
          this._lastHighGoldCueTime = null;
          this.stopAudio('highGold');
        }
        console.log(`[AudioCheck Pre-Cond] shoppingAudioOn=${shoppingAudioOn} hasActiveItemTarget=${hasActiveItemTarget} isHighGoldActive=${isHighGoldActive}`);
      } else if (this._currentTargetItemId !== null) {
        this._currentTargetItemId = null;
        this._currentTargetSuggestionTime = null;
        this.stopAudio('itemTarget');
        this.stopAudio('itemReminder');
      }

      // NOTE: Ward checks would go here and run regardless of isHighGoldActive
      // this.checkWardStatus();
      this.checkEnemyWardChanges(); // Call the new ward check function
      this.checkLowLevelLateGame();
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

  /** Logging-only: hunt for Flash / summoner-spell signals in GEP info updates. */
  private probeFlashSummonerInfoUpdates(info: unknown): void {
    if (!info || typeof info !== 'object') return;
    const rec = info as Record<string, unknown>;

    const spellPaths = collectSpellCooldownPaths(rec);
    if (spellPaths.length) {
      console.warn('[FlashProbe][Info] spell/cooldown paths:', spellPaths.join(' | '));
    }

    const lcd = rec.live_client_data;
    if (lcd && typeof lcd === 'object') {
      const lcdRec = lcd as Record<string, unknown>;
      const spells = extractLocalPlayerSummonerSpells(lcdRec, this._playerState.summonerName);
      if (spells != null) {
        const json = JSON.stringify(spells);
        if (json !== this._flashProbeLastSummonerSpellsJson) {
          console.warn('[FlashProbe][Info] summonerSpells changed:', json);
          this._flashProbeLastSummonerSpellsJson = json;
        }
      }

      for (const ev of parseLiveClientEventsBlob(lcdRec)) {
        if (!ev || typeof ev !== 'object') continue;
        const eventRec = ev as { EventID?: number; EventName?: string; EventTime?: number };
        const id = eventRec.EventID;
        if (id == null || this._flashProbeSeenLiveClientEventIds.has(id)) continue;
        this._flashProbeSeenLiveClientEventIds.add(id);
        const name = eventRec.EventName ?? 'unknown';
        if (/flash|summoner|spell|ability|cooldown/i.test(name) || name !== 'GameStart') {
          console.warn('[FlashProbe][LiveClientEvent]', JSON.stringify(eventRec));
        }
      }
    }

    const inner = rec.info;
    if (inner && typeof inner === 'object') {
      for (const [feature, payload] of Object.entries(inner as Record<string, unknown>)) {
        if (!/abilit|summoner|spell|team_frames/i.test(feature)) continue;
        console.warn(`[FlashProbe][Info][${feature}]`, JSON.stringify(payload));
      }
    }
  }

  // Special events will be highlighted in the event log
  private onNewEvents(e) {
    // --- Handle match_clock event --- 
    if (e.events) {
      try {
        const names = e.events.map(ev => ev && ev.name).filter(Boolean).join(',');
        console.log('[Events] Incoming names:', names);
      } catch (_) { }
      for (const event of e.events) {
        if (
          PROBE_FLASH_SUMMONER_SPELLS &&
          event?.name &&
          !FLASH_PROBE_EVENT_IGNORE.has(event.name)
        ) {
          console.warn('[FlashProbe][GEP-Event]', event.name, event.data);
        }

        if (event.name === 'match_clock') {
          try {
            const newGameTime = parseInt(event.data);
            if (!isNaN(newGameTime) && newGameTime >= 0 && newGameTime !== this._playerState.gameTime) {
              // Log periodically to confirm time updates are still happening
              if (newGameTime % 60 === 0) { // Log every minute
                console.log(`[onNewEvents] GameTime updated via match_clock: ${newGameTime}`);
              }
              this._playerState.gameTime = newGameTime;
              this._matchClockEverReceived = true;
              if (!this._gameActive) {
                this.emitGameStartLifecycle('gep.match_clock');
              }
              if (
                newGameTime >= FIRST_SHOP_BASELINE_WINDOW_SEC &&
                !this._startingSpendBaselineLocked &&
                this.canRunFirstShopReminderCheck()
              ) {
                const inv = normalizeInventoryForSnapshot(this._playerState.items);
                if (inv !== '[]') {
                  this.lockFirstShopBaseline(
                    this._latestActivePlayerGold ?? this._playerState.gold,
                    inv,
                  );
                }
              }
              this.updateFirstShopGoldTracking(false, null);
              this.checkFirstShopReminder();
            }
          } catch (err) {
            console.error("Error parsing match_clock data:", event.data, err);
          }
          continue;
        }

        // Start/end and level handling for WebSocket emissions
        if (event.name === 'match_start' || event.name === 'matchStart' || event.name === 'gameStart' || event.name === 'match_detected') {
          this.emitGameStartLifecycle(`gep.${event.name}`);
        }
        if (event.name === 'match_end' || event.name === 'matchEnd' || event.name === 'match_ended' || event.name === 'gameEnd') {
          this.emitGameEndLifecycle(`gep.${event.name}`);
        }
        if (event.name === 'level' || event.name === 'playerLevel' || event.name === 'leveled_up') {
          try {
            const lvl = Number(event.data);
            console.log('[WS][Event][Level] level event name=', event.name, 'data=', event.data, 'parsed=', lvl);
            if (!isNaN(lvl)) {
              this.recordPlayerLevel(lvl, event.name);
            }
            if (this._gameActive && !this._emittedVillain && !isNaN(lvl) && lvl >= 6) {
              console.log('[WS][Event] Detected level >= 6 (', lvl, '). Emitting villain once for this match.');
              this.sendEventOncePerMatch('villain');
              this._emittedVillain = true;
            }
          } catch (_) {
            console.log('[WS][Event][Level] failed to parse level from event:', event);
          }
        }
        if (event.name === 'kill') {
          this.emitKillOnWebSocket(event.data);
          this.applyMejaiStackDelta('kill');
        }
        if (event.name === 'death') {
          this.emitDeathOnWebSocket(event.data);
          this.applyMejaiStackDelta('death');
        }
        if (event.name === 'assist') {
          // Assists are not currently relayed over the WebSocket at all (no
          // emitAssistOnWebSocket exists) -- they only matter here, locally,
          // for stack math. Flask never needs to know an assist happened.
          this.applyMejaiStackDelta('assist');
        }
        if (event.name === 'respawn') {
          this.emitRespawnOnWebSocket();
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
        case 'respawn':
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

  // (removed) legacy clicker hotkey behavior


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

  private isSupportedGame(info: RunningGameInfo): boolean {
    return kGameClassIds.includes(info.classId);
  }

  private onSupportedGameStarted(info: RunningGameInfo): void {
    if (!info || !this.isSupportedGame(info)) {
      return;
    }
    console.log('[WS][Lifecycle] Supported live game detected (Overwolf). classId=', info.classId);
    this.emitGameStartLifecycle('overwolf.game_started');
  }

  private onSupportedGameEnded(info: RunningGameInfo): void {
    if (!info || !this.isSupportedGame(info)) {
      return;
    }
    console.log('[WS][Lifecycle] Supported live game ended (Overwolf). classId=', info.classId);
    this.emitGameEndLifecycle('overwolf.game_ended');
  }

  // --- NEW Single Target Check Logic --- 
  private checkTargetItem(): void {
    if (!this.isShoppingAudioEnabled()) {
      return;
    }
    if (!this._playerState || isNaN(this._playerState.gold) || isNaN(this._playerState.gameTime) || !Array.isArray(this._playerState.items)) {
      console.warn("[TargetCheck] Invalid state detected, skipping check.", this._playerState);
      return;
    }

    const playerGold = this._playerState.gold;
    const currentGameTime = this._playerState.gameTime;
    const playerItemCounts = new Map<number, number>();
    for (const raw of this._playerState.items) {
      const it = raw as { itemID?: unknown; itemId?: unknown; count?: unknown };
      const id = Number(it.itemID ?? it.itemId);
      const cnt = Number(it.count);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(cnt) || cnt <= 0) continue;
      playerItemCounts.set(id, (playerItemCounts.get(id) || 0) + cnt);
    }

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

      const finalCount = playerItemCounts.get(itemDef.id) || 0;
      const ownsFinalItem = finalCount > 0;
      if (ownsFinalItem) {
        console.log(`[TargetCheck] -> ${itemDef.name}: Already own final item. Skipping.`);
        continue; // Skip if already owned
      }

      let ownsAnyComponent = false;
      if (itemDef.requiresComponentCheck) {
        const requiredDistinctComponents = itemDef.minOwnedComponents ?? 1;
        const distinctComponentIds = new Set(itemDef.components.map(comp => comp.id));
        const ownedDistinctCount = [...distinctComponentIds].filter(id => (playerItemCounts.get(id) || 0) > 0).length;
        ownsAnyComponent = ownedDistinctCount >= requiredDistinctComponents;
        if (!ownsAnyComponent) {
          console.log(`[TargetCheck] -> ${itemDef.name}: Owns ${ownedDistinctCount}/${requiredDistinctComponents} required distinct components. Skipping.`);
          continue; // Skip if component required but not owned
        }
      }

      // Calculate remaining cost via helper
      const remainingCost = calculateRemainingCost(itemDef, playerItemCounts);

      const canAfford = playerGold >= remainingCost;
      const deferToHigher = canAfford && shouldDeferToHigherPriorityItem(itemDef, playerItemCounts, playerGold);

      console.log(`>>>> [TargetCheck] -> ${itemDef.name}: OwnsComponent=${ownsAnyComponent}, CanAfford=${canAfford}, DeferToHigher=${deferToHigher} (${playerGold} >= ${remainingCost}) <<<<`);

      if (canAfford && !deferToHigher) {
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
          // Previous target (if any) is no longer the target — cut off its cue before starting the new one.
          this.stopAudio('itemTarget');
          this.stopAudio('itemReminder');
          this.playAudio(newTargetDef.audioCue, 'itemTarget');
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
          const delay = settings.getSettings().intervals.targetReminderDelaySec;
          const reminderDue = currentGameTime >= (this._currentTargetSuggestionTime + delay);
          console.log(`[TargetCheck] Reminder check: ${currentGameTime} >= (${this._currentTargetSuggestionTime} + ${delay}) -> ${reminderDue}`);
          if (reminderDue) {
            console.log(`[TargetCheck] >>> PLAYING REMINDER (Target: ${this._currentTargetItemId}) <<<`);
            this.playAudio(settings.getSettings().audio.reminderFile, 'itemReminder');
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
        this.stopAudio('itemTarget');
        this.stopAudio('itemReminder');
      } else {
        // No potential target, and no previous target. Do nothing.
        // console.log("[TargetCheck] No current or potential target. Doing nothing.");
      }
    }
  }

  // Modify playAudio function
  private playAudio(fileName: string, cueId: AudioCueId): void {
    const volume = settings.getEffectiveCueVolume(cueId);
    playAudioFile(fileName, volume, cueId);
  }

  /** Stops a cue's in-flight playback, e.g. once the condition that triggered it is no longer true. */
  private stopAudio(cueId: AudioCueId): void {
    stopAudioChannel(cueId);
  }

  private recordPlayerLevel(level: number, source: string): void {
    if (isNaN(level) || level < 1) {
      return;
    }
    if (this._playerState.level !== level) {
      console.log(`[Level] Updated from ${source}: ${this._playerState.level} -> ${level}`);
      this._playerState.level = level;
    }
    if (this._gameActive && !this._emittedLevel9 && level >= 9) {
      console.log('[WS][Event] Detected level >= 9 (', level, '). Emitting level9 once for this match.');
      this.sendEventOncePerMatch('level9');
      this._emittedLevel9 = true;
    }
  }

  private isShoppingAudioEnabled(): boolean {
    return settings.isShoppingAudioEffectivelyEnabled();
  }

  /** True when enough purchase-map milestones acquired to suppress high-gold loop for this match. */
  private isHighGoldSuppressedByItemMilestones(): boolean {
    const limit = settings.getSettings().thresholds.highGoldDisableAfterItemMilestones;
    return this._emittedItemSignals.size >= limit;
  }

  private onItemMilestonesChanged(): void {
    if (!this.isHighGoldSuppressedByItemMilestones()) {
      return;
    }
    if (this._lastHighGoldCueTime !== null) {
      console.log('[HighGold] Milestone threshold reached. Clearing high-gold timer.');
      this._lastHighGoldCueTime = null;
      this.stopAudio('highGold');
    }
    console.log(
      `[HighGold] ${this._emittedItemSignals.size} item milestones acquired (limit ${settings.getSettings().thresholds.highGoldDisableAfterItemMilestones}). High gold cues disabled for this match.`
    );
  }

  /**
   * Clears all in-game "this match only" mute overrides (shopping audio toggle, master mute,
   * per-cue mutes) at the start/end of a match. Never touches the persisted/desktop settings —
   * a mute set from the desktop window is a standing preference and must survive this reset.
   */
  private resetShoppingAudioForNewMatch(): void {
    settings.resetSessionOverrides();
    this._lastHighGoldCueTime = null;
    this._currentTargetItemId = null;
    this._currentTargetSuggestionTime = null;
    this.updateShoppingAudioToggleLabel();
    this.syncVolumeControlsInputs();
    console.log('[ShoppingAudio] Session mute overrides reset for new match.');
  }

  private setHudButtonLabel(button: HTMLElement | null, text: string): void {
    if (!button) return;
    const label = button.querySelector('.ingame-hud__btn-label');
    if (label) {
      label.textContent = text;
    } else {
      button.textContent = text;
    }
  }

  private updateShoppingAudioToggleLabel(): void {
    if (!this._shoppingAudioToggleBtn) return;
    const on = this.isShoppingAudioEnabled();
    this.setHudButtonLabel(this._shoppingAudioToggleBtn, on ? 'Mute gold/items' : 'Unmute gold/items');
    this._shoppingAudioToggleBtn.title = on
      ? 'Stop high-gold and item purchase reminders for this match only (wards unchanged; desktop settings unaffected)'
      : 'Resume high-gold and item purchase reminders for this match';
  }

  private setupShoppingAudioToggle(): void {
    if (!this._shoppingAudioToggleBtn) {
      console.warn('[ShoppingAudio] shoppingAudioToggleBtn not found in DOM.');
      return;
    }
    this.updateShoppingAudioToggleLabel();
    this._shoppingAudioToggleBtn.addEventListener('click', () => {
      const next = !this.isShoppingAudioEnabled();
      // Session-only: this is a per-match mute. It must not write to the persisted setting the
      // desktop window shows, and it must not be able to turn the family back on if the desktop
      // has it disabled as a standing preference.
      settings.setSessionShoppingAudioMuted(!next);
      if (!next) {
        this._lastHighGoldCueTime = null;
        this._currentTargetItemId = null;
        this._currentTargetSuggestionTime = null;
      }
      this.updateShoppingAudioToggleLabel();
      console.log('[ShoppingAudio] Session override toggled, effectively enabled=', this.isShoppingAudioEnabled());
    });
  }

  private static readonly INTERVAL_SETTING_MIN_SEC = 1;
  private static readonly INTERVAL_SETTING_MAX_SEC = 600;

  private clampIntervalSeconds(raw: number): number | null {
    if (!Number.isFinite(raw)) return null;
    const rounded = Math.round(raw);
    if (rounded < InGame.INTERVAL_SETTING_MIN_SEC || rounded > InGame.INTERVAL_SETTING_MAX_SEC) {
      return null;
    }
    return rounded;
  }

  private syncIntervalSettingsInputs(): void {
    const { highGoldIntervalSec, targetReminderDelaySec } = settings.getSettings().intervals;
    if (this._highGoldIntervalInput) {
      this._highGoldIntervalInput.value = String(highGoldIntervalSec);
    }
    if (this._targetReminderIntervalInput) {
      this._targetReminderIntervalInput.value = String(targetReminderDelaySec);
    }
  }

  private bindIntervalSettingInput(
    input: HTMLInputElement | null,
    settingKey: 'highGoldIntervalSec' | 'targetReminderDelaySec',
    logLabel: string,
  ): void {
    if (!input) {
      console.warn(`[Settings] ${settingKey} input not found in DOM.`);
      return;
    }

    const commit = (): void => {
      const parsed = this.clampIntervalSeconds(Number(input.value));
      if (parsed === null) {
        this.syncIntervalSettingsInputs();
        return;
      }
      if (parsed === settings.getSettings().intervals[settingKey]) {
        input.value = String(parsed);
        return;
      }
      if (settingKey === 'highGoldIntervalSec') {
        settings.update({ intervals: { highGoldIntervalSec: parsed } });
      } else {
        settings.update({ intervals: { targetReminderDelaySec: parsed } });
      }
      input.value = String(parsed);
      console.log(`[Settings] ${logLabel} updated to ${parsed}s (live)`);
    };

    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
  }

  private setupIntervalSettings(): void {
    this.syncIntervalSettingsInputs();
    this.bindIntervalSettingInput(
      this._highGoldIntervalInput,
      'highGoldIntervalSec',
      'High gold repeat interval',
    );
    this.bindIntervalSettingInput(
      this._targetReminderIntervalInput,
      'targetReminderDelaySec',
      'Item reminder interval',
    );
  }

  private syncVolumeControlsInputs(): void {
    const v = settings.getSettings().volume;
    if (this._masterVolumeInput) {
      this._masterVolumeInput.value = String(Math.round(v.masterVolume * 100));
    }
    // Mute checkboxes/button reflect the in-game SESSION override, not the persisted (desktop) value —
    // the in-game HUD only ever mutes for the current match.
    this.setHudButtonLabel(this._masterMuteBtn, settings.isSessionMasterMuted() ? 'Unmute all SFX' : 'Mute all SFX');
    if (this._lowLevelVolumeInput) {
      this._lowLevelVolumeInput.value = String(Math.round(v.cues.lowLevelLateGame.volume * 100));
    }
    if (this._lowLevelMuteCheckbox) {
      this._lowLevelMuteCheckbox.checked = settings.isSessionCueMuted('lowLevelLateGame');
    }
    if (this._firstShopVolumeInput) {
      this._firstShopVolumeInput.value = String(Math.round(v.cues.firstShopReminder.volume * 100));
    }
    if (this._firstShopMuteCheckbox) {
      this._firstShopMuteCheckbox.checked = settings.isSessionCueMuted('firstShopReminder');
    }
  }

  /** Wires a 0-100 range input to a cue's volume. Reusable for any cue in AUDIO_CUE_IDS. Persisted — shared with desktop. */
  private bindCueVolumeInput(input: HTMLInputElement | null, cueId: AudioCueId): void {
    if (!input) {
      console.warn(`[Volume] ${cueId} volume input not found in DOM.`);
      return;
    }
    input.addEventListener('input', () => {
      const pct = Math.max(0, Math.min(100, Number(input.value)));
      settings.update({ volume: { cues: { [cueId]: { volume: pct / 100 } } } });
      console.log(`[Volume] ${AUDIO_CUE_LABELS[cueId]} volume set to ${pct}%`);
    });
  }

  /**
   * Wires a mute checkbox to a cue's SESSION-only muted flag (this match only). Reusable for any
   * cue in AUDIO_CUE_IDS. Deliberately does not call settings.update() — see resetShoppingAudioForNewMatch.
   */
  private bindCueMuteCheckbox(checkbox: HTMLInputElement | null, cueId: AudioCueId): void {
    if (!checkbox) {
      console.warn(`[Volume] ${cueId} mute checkbox not found in DOM.`);
      return;
    }
    checkbox.addEventListener('change', () => {
      settings.setSessionCueMuted(cueId, checkbox.checked);
      console.log(`[Volume] ${AUDIO_CUE_LABELS[cueId]} session-muted=${checkbox.checked} (this match only)`);
    });
  }

  private setupVolumeControls(): void {
    this.syncVolumeControlsInputs();

    if (this._masterVolumeInput) {
      const input = this._masterVolumeInput;
      input.addEventListener('input', () => {
        const pct = Math.max(0, Math.min(100, Number(input.value)));
        settings.update({ volume: { masterVolume: pct / 100 } });
        console.log(`[Volume] Master volume set to ${pct}%`);
      });
    } else {
      console.warn('[Volume] masterVolumeInput not found in DOM.');
    }

    if (this._masterMuteBtn) {
      this._masterMuteBtn.addEventListener('click', () => {
        const next = !settings.isSessionMasterMuted();
        settings.setSessionMasterMuted(next);
        this.setHudButtonLabel(this._masterMuteBtn, next ? 'Unmute all SFX' : 'Mute all SFX');
        console.log(`[Volume] Master session-muted=${next} (this match only)`);
      });
    } else {
      console.warn('[Volume] masterMuteBtn not found in DOM.');
    }

    this.bindCueVolumeInput(this._lowLevelVolumeInput, 'lowLevelLateGame');
    this.bindCueMuteCheckbox(this._lowLevelMuteCheckbox, 'lowLevelLateGame');
    this.bindCueVolumeInput(this._firstShopVolumeInput, 'firstShopReminder');
    this.bindCueMuteCheckbox(this._firstShopMuteCheckbox, 'firstShopReminder');
  }

  private resetWhatAreYouDoingState(): void {
    this._lastWhatAreYouDoingCueTime = null;
    this._playerState.level = null;
  }

  private resetFirstShopReminderState(): void {
    this._firstShopReminderState = 'idle';
    this._firstShopReminderArmedAtGameTime = null;
    this._startingSpendBaselineLocked = false;
    this._firstShopReminderDisqualified = false;
    this._peakGoldSinceStartingSpend = null;
    this._earlyWindowPeakGold = null;
    this._inventorySnapshotBeforeBaseline = '[]';
    this._sawNonEmptyInventoryBefore = false;
    this._latestActivePlayerGold = null;
  }

  private getFirstShopGoldForReminder(): number {
    return this._latestActivePlayerGold ?? this._playerState.gold;
  }

  private lockFirstShopBaseline(gold: number, inventory: string): void {
    if (this._startingSpendBaselineLocked) {
      return;
    }
    this._startingSpendBaselineLocked = true;
    this._peakGoldSinceStartingSpend = gold;
    this._inventorySnapshotBeforeBaseline = inventory;
    console.log(
      `[FirstShop] Starting-spend baseline locked at ${gold}g (inventory=${inventory}). Any active_player gold drop after this disables the reminder.`,
    );
  }

  private disqualifyFirstShopReminder(previousGold: number, currentGold: number): void {
    if (this._firstShopReminderDisqualified) {
      return;
    }
    this._firstShopReminderDisqualified = true;
    console.log(
      `[FirstShop] Disqualified: gold decreased after starting spend (${previousGold} -> ${currentGold}). Reminder will not play.`,
    );
    if (this._firstShopReminderState === 'waiting') {
      this._firstShopReminderState = 'resolved';
      this._firstShopReminderArmedAtGameTime = null;
    }
  }

  private updateFirstShopGoldTracking(
    itemsChanged: boolean,
    activePlayerGold: number | null,
  ): void {
    if (!this.canRunFirstShopReminderCheck()) {
      return;
    }

    const currentGameTime = this._playerState.gameTime;
    const currentInventory = normalizeInventoryForSnapshot(this._playerState.items);
    const hasStartingInventory = currentInventory !== '[]';

    if (!this._startingSpendBaselineLocked) {
      if (currentGameTime <= FIRST_SHOP_BASELINE_WINDOW_SEC) {
        if (activePlayerGold !== null) {
          if (this._earlyWindowPeakGold === null || activePlayerGold > this._earlyWindowPeakGold) {
            this._earlyWindowPeakGold = activePlayerGold;
          }
        }

        let shouldLock = false;
        if (
          activePlayerGold !== null &&
          this._earlyWindowPeakGold !== null &&
          activePlayerGold < this._earlyWindowPeakGold
        ) {
          shouldLock = true;
        }
        if (
          itemsChanged &&
          hasStartingInventory &&
          currentInventory !== this._inventorySnapshotBeforeBaseline
        ) {
          shouldLock = true;
        }
        if (hasStartingInventory && !this._sawNonEmptyInventoryBefore) {
          this._sawNonEmptyInventoryBefore = true;
          shouldLock = true;
        }

        if (shouldLock) {
          const lockGold = activePlayerGold ?? this._latestActivePlayerGold ?? this._playerState.gold;
          this.lockFirstShopBaseline(lockGold, currentInventory);
        }
      } else if (hasStartingInventory) {
        const lockGold = activePlayerGold ?? this._latestActivePlayerGold ?? this._playerState.gold;
        this.lockFirstShopBaseline(lockGold, currentInventory);
      }
      return;
    }

    if (this._firstShopReminderDisqualified || activePlayerGold === null) {
      return;
    }

    if (
      this._peakGoldSinceStartingSpend !== null &&
      activePlayerGold < this._peakGoldSinceStartingSpend
    ) {
      this.disqualifyFirstShopReminder(this._peakGoldSinceStartingSpend, activePlayerGold);
      return;
    }

    if (
      this._peakGoldSinceStartingSpend !== null &&
      activePlayerGold > this._peakGoldSinceStartingSpend
    ) {
      this._peakGoldSinceStartingSpend = activePlayerGold;
    }
  }

  private canRunFirstShopReminderCheck(): boolean {
    return !!(
      this._playerState.summonerName &&
      !isNaN(this._playerState.gold) &&
      this._playerState.gold >= 0 &&
      !isNaN(this._playerState.gameTime) &&
      this._playerState.gameTime > 0
    );
  }

  /**
   * Hoarding reminder: once per match, play if gold reaches threshold without ever
   * decreasing after the fountain starting-items spend.
   */
  private checkFirstShopReminder(): void {
    if (!this.canRunFirstShopReminderCheck()) {
      if (this._firstShopReminderState !== 'resolved' && this._playerState.gold >= settings.getSettings().thresholds.firstShopGoldThreshold - 100) {
        console.log('[FirstShop] Check skipped — prerequisites not met:', {
          summonerName: this._playerState.summonerName,
          gold: this._playerState.gold,
          gameTime: this._playerState.gameTime,
          state: this._firstShopReminderState,
        });
      }
      return;
    }
    if (this._firstShopReminderState === 'resolved') {
      return;
    }
    if (this._firstShopReminderDisqualified) {
      this._firstShopReminderState = 'resolved';
      return;
    }
    if (!this._startingSpendBaselineLocked) {
      return;
    }

    const playerGold = this.getFirstShopGoldForReminder();
    const currentGameTime = this._playerState.gameTime;

    const firstShopGoldThreshold = settings.getSettings().thresholds.firstShopGoldThreshold;

    if (this._firstShopReminderState === 'idle') {
      if (playerGold < firstShopGoldThreshold) {
        return;
      }
      this._firstShopReminderState = 'waiting';
      this._firstShopReminderArmedAtGameTime = currentGameTime;
      const delaySec = settings.getSettings().intervals.firstShopReminderDelaySec;
      console.log(
        `[FirstShop] Armed at ${currentGameTime}s with ${playerGold}g. Will play in ${delaySec}s (gold has not decreased since starting spend).`,
      );
    }

    if (this._firstShopReminderState !== 'waiting' || this._firstShopReminderArmedAtGameTime === null) {
      return;
    }

    const dueAt = this._firstShopReminderArmedAtGameTime + settings.getSettings().intervals.firstShopReminderDelaySec;
    if (currentGameTime >= dueAt) {
      console.log(`[FirstShop] >>> PLAYING FIRST SHOP REMINDER <<< (${playerGold}g at ${currentGameTime}s)`);
      this.playAudio(settings.getSettings().audio.firstShopReminderFile, 'firstShopReminder');
      this._firstShopReminderState = 'resolved';
    }
  }

  // --- High Gold Check Logic --- 
  /**
   * Checks if gold is above threshold and plays audio cue periodically.
   * @returns true if gold is high (regardless of whether audio played due to cooldown), false otherwise.
   */
  private checkHighGold(): boolean {
    if (!this.isShoppingAudioEnabled()) {
      return false;
    }
    if (this.isHighGoldSuppressedByItemMilestones()) {
      if (this._lastHighGoldCueTime !== null) {
        this._lastHighGoldCueTime = null;
        this.stopAudio('highGold');
      }
      return false;
    }
    if (!this._playerState || isNaN(this._playerState.gold) || isNaN(this._playerState.gameTime) || this._playerState.gameTime <= 0) {
      console.warn("[HighGold] Invalid state detected, skipping check.", this._playerState);
      return false;
    }

    console.log("[HighGold] Running check...");

    const playerGold = this._playerState.gold;
    const currentGameTime = this._playerState.gameTime;
    const threshold = settings.getSettings().thresholds.highGoldThreshold;
    const isCurrentlyHighGold = playerGold > threshold;
    console.log(`[HighGold] Current Gold: ${playerGold}, Threshold: ${threshold}, Is High: ${isCurrentlyHighGold}`); // Log current state

    if (isCurrentlyHighGold) {
      // Check if it's the first time or if interval has passed
      const timeCheckPassed =
        this._lastHighGoldCueTime === null ||
        currentGameTime >= (this._lastHighGoldCueTime + settings.getSettings().intervals.highGoldIntervalSec);

      console.log(`[HighGold] TimeCheck: ${currentGameTime} >= (${this._lastHighGoldCueTime} + ${settings.getSettings().intervals.highGoldIntervalSec}) -> ${timeCheckPassed}`);

      if (timeCheckPassed) {
        console.log(`[HighGold] >>> PLAYING HIGH GOLD CUE <<< (Time check passed)`); // Add reason
        this.playAudio(settings.getSettings().audio.highGoldFile, 'highGold');
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
        this.stopAudio('highGold');
      }
      return false;
    }
  }

  /**
   * Plays whatareyoudoing_1.mp3 when match clock is at/after 3:01 and player level is below 4.
   * Repeats every 60 game seconds while the condition holds (same loop pattern as high gold).
   */
  private checkLowLevelLateGame(): void {
    if (!this._playerState || isNaN(this._playerState.gameTime) || this._playerState.gameTime <= 0) {
      console.warn('[WhatAreYouDoing] Invalid gameTime, skipping check.', this._playerState);
      return;
    }

    const level = this._playerState.level;
    if (level === null || isNaN(level)) {
      return;
    }

    const currentGameTime = this._playerState.gameTime;
    const isLateAndLowLevel =
      currentGameTime >= WHATAREYOUDOING_GAME_TIME_SEC && level < WHATAREYOUDOING_LEVEL_THRESHOLD;

    console.log(
      `[WhatAreYouDoing] gameTime=${currentGameTime}s level=${level} active=${isLateAndLowLevel}`
    );

    if (isLateAndLowLevel) {
      const timeCheckPassed =
        this._lastWhatAreYouDoingCueTime === null ||
        currentGameTime >= (this._lastWhatAreYouDoingCueTime + WHATAREYOUDOING_INTERVAL_SEC);

      console.log(
        `[WhatAreYouDoing] TimeCheck: ${currentGameTime} >= (${this._lastWhatAreYouDoingCueTime} + ${WHATAREYOUDOING_INTERVAL_SEC}) -> ${timeCheckPassed}`
      );

      if (timeCheckPassed) {
        console.log('[WhatAreYouDoing] >>> PLAYING LATE LOW LEVEL CUE <<<');
        this.playAudio(settings.getSettings().audio.lowLevelLateGameFile, 'lowLevelLateGame');
        this._lastWhatAreYouDoingCueTime = currentGameTime;
      }
    } else if (this._lastWhatAreYouDoingCueTime !== null) {
      console.log('[WhatAreYouDoing] Condition cleared. Resetting timer.');
      this._lastWhatAreYouDoingCueTime = null;
      this.stopAudio('lowLevelLateGame');
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
        this.playAudio(audioFile, 'wardPurchased');
      } else if (currentCount < previousCount) {
        console.log(`[WardCheck] >>> ${champName} PLACED/LOST WARD <<<`);
        const audioFile = ENEMY_WARD_PLACED_AUDIO.replace('<champion_name>', champName);
        this.playAudio(audioFile, 'wardPlaced');
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

  private setupIngameHudMore(): void {
    if (!this._ingameMoreBtn) {
      console.warn('setupIngameHudMore: ingameMoreBtn not found.');
      return;
    }
    this._ingameMoreBtn.addEventListener('click', () => {
      this._setIngameMoreExpanded(!this._ingameMoreExpanded);
    });
    this._setIngameMoreExpanded(false);
  }

  private _setIngameMoreExpanded(open: boolean): void {
    this._ingameMoreExpanded = open;
    if (this._ingameHud) {
      this._ingameHud.classList.toggle('ingame-hud--more-open', open);
    }
    // Drives --ingame-hud-scale (see .hud-more-open in ingame-hud.css): whole HUD renders at 200% while open.
    document.body.classList.toggle('hud-more-open', open);
    if (this._ingameMoreBtn) {
      this._ingameMoreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      this.setHudButtonLabel(this._ingameMoreBtn, open ? 'Less' : 'More');
    }
    // Window pixel size must match the new visual scale, or the expanded HUD gets clipped/unclickable
    // outside the window's bounds.
    this._applyCompactWindowLayout();
  }

  /** Window width/height/disc-diameter for the current compact scale (normal vs. "More" open at 200%). */
  private _compactLayoutDimensions(): { width: number; height: number; discDiameter: number } {
    if (this._ingameMoreExpanded) {
      return { width: EXPANDED_WINDOW_WIDTH, height: EXPANDED_WINDOW_HEIGHT, discDiameter: HUD_DISC_DIAMETER_PX_EXPANDED };
    }
    return { width: COLLAPSED_WINDOW_WIDTH, height: COLLAPSED_WINDOW_HEIGHT, discDiameter: HUD_DISC_DIAMETER_PX };
  }

  /** Pin compact window so disc center matches HUD_DISC_CENTER_* on 1920×1080 */
  private _positionCompactWindow(retry = 0): void {
    if (this._areLogsVisible || !this._currentWindowId) {
      return;
    }
    const { width, discDiameter } = this._compactLayoutDimensions();
    const left = Math.round(HUD_DISC_CENTER_X - width / 2);
    const top = Math.round(HUD_DISC_CENTER_Y - discDiameter / 2);
    overwolf.windows.changePosition(this._currentWindowId, left, top, (result) => {
      if (result && result.success) {
        console.log(`[HUD] Compact position (${left}, ${top}) for disc center (${HUD_DISC_CENTER_X}, ${HUD_DISC_CENTER_Y})`);
      } else {
        console.error('[HUD] Failed to set compact window position', result);
        if (retry < 2) {
          window.setTimeout(() => this._positionCompactWindow(retry + 1), 150);
        }
      }
    });
  }

  private _applyCompactWindowLayout(): void {
    if (this._areLogsVisible || !this._currentWindowId) {
      return;
    }
    const { width, height } = this._compactLayoutDimensions();
    const sizeParams: overwolf.windows.ChangeWindowSizeParams = {
      window_id: this._currentWindowId,
      width,
      height,
      auto_dpi_resize: true,
    };
    overwolf.windows.changeSize(sizeParams, (result) => {
      if (result && result.success) {
        console.log(`[HUD] Compact size ${width}x${height} (more-open=${this._ingameMoreExpanded})`);
        window.setTimeout(() => this._positionCompactWindow(), 50);
      } else {
        console.error('[HUD] Failed to set compact window size', result);
      }
    });
  }

  private setupToggleLogsDisplay(): void {
    if (this._toggleLogsDisplayBtn) {
      this._toggleLogsDisplayBtn.addEventListener('click', () => {
        this._areLogsVisible = !this._areLogsVisible;
        console.log(`Button clicked: _areLogsVisible is now ${this._areLogsVisible}`);
        this._updateUIVisibility(); // This method handles UI and window size changes
      });
      console.log('setupToggleLogsDisplay: Click listener added to button.');
    } else {
      console.error('setupToggleLogsDisplay: _toggleLogsDisplayBtn is not defined.');
    }

    if (this._letsGoBtn) {
      this._letsGoBtn.addEventListener('click', () => {
        if (!this._hasActivated) {
          this._hasActivated = true;
          this.setHudButtonLabel(this._letsGoBtn, 'GLHF!');
          console.log("Lets Go button clicked: _hasActivated=true. Audio gating gesture registered.");
        } else {
          console.log('Lets Go button clicked while already activated. No-op.');
        }
      });
      console.log('setupToggleLogsDisplay: Click listener added to letsGoBtn.');
    } else {
      console.error('setupToggleLogsDisplay: _letsGoBtn is not defined.');
    }

    // Listen for both hotkeys
    overwolf.settings.hotkeys.onPressed.addListener(async (hotkeyResult) => {
      if (hotkeyResult && (hotkeyResult.name === kHotkeys.toggleLogs || hotkeyResult.name === kHotkeys.toggleCompact)) {
        console.log(`Hotkey ${hotkeyResult.name} pressed: Toggle Logs display`);
        this._areLogsVisible = !this._areLogsVisible;
        this._updateUIVisibility(); // This method handles UI and window size changes
      }
    });
    console.log(`setupToggleLogsDisplay: Hotkey listeners added for ${kHotkeys.toggleLogs} and ${kHotkeys.toggleCompact}.`);
  }

  // NEW: Centralized UI update logic based on visibility state
  private _updateUIVisibility(): void {
    console.log(`_updateUIVisibility called, _areLogsVisible: ${this._areLogsVisible}`);

    let targetWidth: number;
    let targetHeight: number;
    let logMessageSuffix: string;

    document.body.classList.toggle('compact-mode', !this._areLogsVisible);

    if (this._areLogsVisible) {
      if (this._mainElement) this._mainElement.style.display = 'flex';
      this.setHudButtonLabel(this._toggleLogsDisplayBtn, 'Hide Logs');
      if (this._ingameHud) this._ingameHud.classList.remove('ingame-hud--more-open');
      if (this._headerIcon) this._headerIcon.style.display = '';
      if (this._headerTitle) this._headerTitle.style.display = '';
      if (this._headerHotkeyText) this._headerHotkeyText.style.display = '';
      if (this._windowControlsGroup) this._windowControlsGroup.style.display = '';

      targetWidth = this._originalWindowWidth;
      targetHeight = this._originalWindowHeight;
      logMessageSuffix = 'UI expanded, window restoring to original size.';
    } else {
      if (this._mainElement) this._mainElement.style.display = 'none';
      this.setHudButtonLabel(this._toggleLogsDisplayBtn, 'Show logs');
      this._setIngameMoreExpanded(false);
      if (this._headerIcon) this._headerIcon.style.display = 'none';
      if (this._headerTitle) this._headerTitle.style.display = 'none';
      if (this._headerHotkeyText) this._headerHotkeyText.style.display = 'none';
      if (this._windowControlsGroup) this._windowControlsGroup.style.display = 'none';
      this.setHudButtonLabel(this._letsGoBtn, this._hasActivated ? 'GLHF!' : "Let's Go!");

      targetWidth = COLLAPSED_WINDOW_WIDTH;
      targetHeight = COLLAPSED_WINDOW_HEIGHT;
      logMessageSuffix = 'UI collapsed, window shrinking.';
    }

    if (!this._areLogsVisible) {
      this._applyCompactWindowLayout();
    } else if (this._currentWindowId && typeof targetWidth === 'number' && typeof targetHeight === 'number' &&
      typeof this._originalWindowWidth === 'number' && typeof this._originalWindowHeight === 'number') {
      const sizeParams: overwolf.windows.ChangeWindowSizeParams = {
        window_id: this._currentWindowId,
        width: targetWidth,
        height: targetHeight,
        auto_dpi_resize: true
      };
      overwolf.windows.changeSize(sizeParams, (result) => {
        if (result && result.success) {
          console.log(`_updateUIVisibility: ${logMessageSuffix} Size changed to ${targetWidth}x${targetHeight}. Success.`);
        } else {
          console.error(`_updateUIVisibility: Failed to change window size for ${logMessageSuffix}`, result);
        }
      });
    } else {
      console.error('_updateUIVisibility: Prerequisites for changeSize not met or original dimensions not set. Cannot resize.', {
        currentWindowId: this._currentWindowId,
        targetWidth,
        targetHeight,
        originalWidth: this._originalWindowWidth,
        originalHeight: this._originalWindowHeight
      });
    }
  }

  // --- WebSocket helpers ---
  private emitGameStartLifecycle(context: string): void {
    if (this._gameActive) {
      console.log('[WS][Lifecycle] game_start skipped (session already active). context=', context);
      return;
    }
    this._gameActive = true;
    this._localGameTimeAnchorMs = Date.now();
    this._matchClockEverReceived = false;
    this._playerState.gameTime = 0;
    this._emittedItemSignals.clear();
    this._emittedVillain = false;
    this._emittedLevel9 = false;
    this.resetMatchCombatState();
    this.resetShoppingAudioForNewMatch();
    this.resetWhatAreYouDoingState();
    this.resetFirstShopReminderState();
    this._flashProbeLastSummonerSpellsJson = '';
    this._flashProbeSeenLiveClientEventIds.clear();
    const game_id = this._currentMatchId || 'unknown';
    console.log('[WS][Lifecycle] Emitting game_start. context=', context, 'game_id=', game_id);
    this.sendOp('game_start', { game_id });
    console.log('[WS][Lifecycle] game_start emitted');
  }

  private emitGameEndLifecycle(context: string): void {
    if (!this._gameActive) {
      console.log('[WS][Lifecycle] game_end skipped (session not active). context=', context);
      return;
    }
    console.log('[WS][Lifecycle] Emitting game_end. context=', context);
    this.sendOp('game_end');
    console.log('[WS][Lifecycle] game_end emitted');
    this._gameActive = false;
    this._localGameTimeAnchorMs = null;
    this._matchClockEverReceived = false;
    this._emittedItemSignals.clear();
    this._emittedVillain = false;
    this._emittedLevel9 = false;
    this.resetMatchCombatState();
    this.resetShoppingAudioForNewMatch();
    this.resetWhatAreYouDoingState();
    this.resetFirstShopReminderState();
    this._flashProbeLastSummonerSpellsJson = '';
    this._flashProbeSeenLiveClientEventIds.clear();
  }

  private resetMatchCombatState(): void {
    this._deathCount = 0;
    this._consecutiveKills = 0;
    this._mejaiTier = 'none';
    this._mejaiStacks = 0;
    this._mejaiCueFired = false;
    this._mejaiKillsAssistsSincePurchase = 0;
    this._mejaiReachedMax = false;
    this._mejai25DeathFired = false;
  }

  private connectWebSocket(): void {
    try {
      // Use IPv4 literal: "localhost" may resolve to ::1 first; Flask often binds IPv4 only.
      const url = 'ws://127.0.0.1:5001/api/ws';
      this._wsClient = new WSClient(url);
      this._wsClient.connect(
        () => {
          if (this._wsPingInterval != null) {
            window.clearInterval(this._wsPingInterval);
            this._wsPingInterval = null;
          }
          this._wsPingInterval = window.setInterval(() => {
            try {
              this.sendOp('ping', { ts: Date.now() });
            } catch (_) { /* ignore */ }
          }, 5000);

          if (this._gameActive) {
            console.log('[WS] On connect, game already active. Emitting game_start.');
            this.sendOp('game_start', { game_id: this._currentMatchId || 'unknown' });
          }
          try {
            this.sendOp('ping', { ts: Date.now() });
          } catch (_) { /* ignore */ }
        },
        () => {
          if (this._wsPingInterval != null) {
            window.clearInterval(this._wsPingInterval);
            this._wsPingInterval = null;
          }
        }
      );
    } catch (e) {
      console.error('[WS] Failed to connect:', e);
    }
  }

  private sendOp(op: 'game_start' | 'event' | 'game_end' | 'ping', payload?: any): void {
    if (!this._wsClient) {
      console.warn('[WS] No ws client to send op.');
      return;
    }
    this._wsClient.sendOp(op, payload);
  }

  /** Detects Dark Seal (1082) / Mejai's Soulstealer (3041) purchase and Mejai's sale,
   * from the same items array the DEFAULT_PURCHASE_EVENT_MAP loop above already reads. */
  private updateMejaiTracking(): void {
    const items = this._playerState.items;
    if (!Array.isArray(items)) return;
    const owns = (id: number) => items.some((it: any) => it && Number(it.itemID) === id && Number(it.count) > 0);

    const hasMejais = owns(MEJAI_SOULSTEALER_ITEM_ID);
    const hasDarkSeal = owns(DARK_SEAL_ITEM_ID);

    // Sold: was tracking at the 'mejais' tier, item no longer owned. Selling a
    // completed item doesn't refund Dark Seal, so this cleanly ends tracking.
    if (this._mejaiTier === 'mejais' && !hasMejais) {
      if (!this._mejaiCueFired) {
        console.log('[Mejai] Detected Mejai\'s Soulstealer sold. Emitting mejai_s.');
        this.sendEventOncePerMatch('mejai_s');
        this._mejaiCueFired = true;
      }
      return;
    }

    if (hasMejais && this._mejaiTier !== 'mejais') {
      this._mejaiTier = 'mejais';
      this._mejaiKillsAssistsSincePurchase = 0;
      console.log('[Mejai] Tier upgraded to mejais (stacks carried over):', this._mejaiStacks);
    } else if (hasDarkSeal && this._mejaiTier === 'none') {
      this._mejaiTier = 'dark_seal';
      console.log('[Mejai] Started tracking stacks at Dark Seal tier.');
    }
  }

  /** Applies the kill/assist/death stack delta for whichever tier is currently tracked.
   * No-ops before Dark Seal is bought, and after any of the mejai_* cues has fired
   * (per the confirmed mutual-exclusion rule -- whichever condition is hit first wins),
   * with one deliberate exception: a death after already hitting 25 stacks still fires
   * mejai_25_death, since that's a distinct follow-up moment, not a competing one. */
  private applyMejaiStackDelta(kind: 'kill' | 'assist' | 'death'): void {
    if (this._mejaiTier === 'none') return;
    if (this._mejaiCueFired) {
      if (kind === 'death' && this._mejaiReachedMax && !this._mejai25DeathFired) {
        this._mejai25DeathFired = true;
        console.log('[Mejai] Died after reaching 25 stacks. Emitting mejai_25_death.');
        this.sendEventOncePerMatch('mejai_25_death');
      }
      return;
    }
    const rates = MEJAI_STACK_RATES[this._mejaiTier];

    if (kind === 'kill' || kind === 'assist') {
      if (this._mejaiTier === 'mejais') this._mejaiKillsAssistsSincePurchase++;
      const gain = kind === 'kill' ? rates.perKill : rates.perAssist;
      this._mejaiStacks = Math.min(rates.max, this._mejaiStacks + gain);
    } else {
      // Died having bought Mejai's Soulstealer, never landed a kill or assist since --
      // its own distinct cue instead of the ordinary stack-loss handling below.
      if (this._mejaiTier === 'mejais' && this._mejaiKillsAssistsSincePurchase === 0) {
        console.log('[Mejai] Died with zero kills/assists since buying Mejai\'s Soulstealer. Emitting mejai_instant_death.');
        this.sendEventOncePerMatch('mejai_instant_death');
        this._mejaiCueFired = true;
        return;
      }
      this._mejaiStacks = Math.max(0, this._mejaiStacks - rates.lossOnDeath);
    }
    console.log(`[Mejai] ${kind} -> tier=${this._mejaiTier} stacks=${this._mejaiStacks}/${rates.max}`);
    this.checkMejaiThresholds();
  }

  /** Fires at most one of mejai_0 / mejai_25 -- only reachable once actually at the
   * 'mejais' tier (0 while still on Dark Seal alone isn't a "Mejai's" story; 25 is only
   * reachable at this tier anyway since Dark Seal caps at 10). mejai_s (sold) is handled
   * in updateMejaiTracking() instead, since it isn't a stack-delta event. */
  private checkMejaiThresholds(): void {
    if (this._mejaiCueFired || this._mejaiTier !== 'mejais') return;
    if (this._mejaiStacks <= 0) {
      console.log('[Mejai] Stacks hit 0. Emitting mejai_0.');
      this.sendEventOncePerMatch('mejai_0');
      this._mejaiCueFired = true;
    } else if (this._mejaiStacks >= MEJAI_STACK_RATES.mejais.max) {
      this._mejaiReachedMax = true;
      console.log('[Mejai] Stacks hit max (25). Emitting mejai_25.');
      this.sendEventOncePerMatch('mejai_25');
      this._mejaiCueFired = true;
    }
  }

  /** Every LoL GEP `kill` event → WebSocket `{ op: "event", name: "kill", multikill, killstreak, ... }`. */
  private emitKillOnWebSocket(rawData: unknown): void {
    const fields = parseKillEventData(rawData);
    if (!this._gameActive) {
      console.log('[WS][Event][Kill] Game not active. Emitting fallback game_start before kill.');
      this.emitGameStartLifecycle('gep.kill_fallback');
    }
    this._consecutiveKills += 1;
    const payload: KillEventWSPayload = {
      name: 'kill',
      ...fields,
      killstreak: this._consecutiveKills,
      ts: Date.now(),
    };
    console.log('[WS][Event][Kill] Emitting kill event:', JSON.stringify({ op: 'event', ...payload }));
    this.sendOp('event', payload);
  }

  /** LoL GEP `death` event (local player) → WebSocket `{ op: "event", name: "death", ... }`. */
  private emitDeathOnWebSocket(rawData: unknown): void {
    const { gep_death_count } = parseDeathEventData(rawData);
    if (!this._gameActive) {
      console.log('[WS][Event][Death] Game not active. Emitting fallback game_start before death.');
      this.emitGameStartLifecycle('gep.death_fallback');
    }
    if (gep_death_count > 0) {
      this._deathCount = gep_death_count;
    } else {
      this._deathCount += 1;
    }
    this._consecutiveKills = 0;
    const payload: DeathEventWSPayload = {
      name: 'death',
      death_count: this._deathCount,
      gep_death_count,
      ts: Date.now(),
    };
    console.log('[WS][Event][Death] Emitting death event:', JSON.stringify({ op: 'event', ...payload }));
    this.sendOp('event', payload);
  }

  /** LoL GEP `respawn` event (local player) → WebSocket `{ op: "event", name: "respawn", ... }`. */
  private emitRespawnOnWebSocket(): void {
    if (!this._gameActive) {
      console.log('[WS][Event][Respawn] Game not active. Emitting fallback game_start before respawn.');
      this.emitGameStartLifecycle('gep.respawn_fallback');
    }
    const payload: RespawnEventWSPayload = {
      name: 'respawn',
      death_count: this._deathCount,
      ts: Date.now(),
    };
    console.log('[WS][Event][Respawn] Emitting respawn event:', JSON.stringify({ op: 'event', ...payload }));
    this.sendOp('event', payload);
  }

  private sendEventOncePerMatch(name: string): void {
    if (!this._gameActive) {
      console.log('[WS][Event] Game not marked active. Emitting fallback game_start before event:', name);
      this.emitGameStartLifecycle(`gep.event_fallback.${name}`);
    }
    console.log('[WS][Event] Emitting event:', name);
    this.sendOp('event', { name });
  }
}

InGame.instance().run();