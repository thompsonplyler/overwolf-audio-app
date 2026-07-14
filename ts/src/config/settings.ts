// Centralized settings with simple persistence to localStorage (expandable later)

export interface ThresholdSettings {
    highGoldThreshold: number; // e.g., 3000
    /** Gold at which the once-per-match first-shop reminder arms. */
    firstShopGoldThreshold: number; // e.g., 1600
    /** Stop high-gold loop after this many DEFAULT_PURCHASE_EVENT_MAP milestones this match. */
    highGoldDisableAfterItemMilestones: number; // e.g., 5
}

export interface IntervalSettings {
    highGoldIntervalSec: number; // e.g., 60
    targetReminderDelaySec: number; // e.g., 30
    /** Game seconds after first reaching first-shop gold before reminder plays. */
    firstShopReminderDelaySec: number; // e.g., 20
}

export interface AudioSettings {
    highGoldFile: string; // e.g., 'icarus_song_001.mp3'
    reminderFile: string; // e.g., 'idiot_song_001.mp3'
    /** First time reaching first-shop gold without shopping (go back to base). */
    firstShopReminderFile: string; // e.g., 'whatareyoudoing_1.mp3'
    /** Still below level threshold after the late-game cutoff (e.g. not level 4 by 3:01). */
    lowLevelLateGameFile: string; // e.g., 'whatareyoudoing_1.mp3'
}

/** Manual toggles; desktop UI can update the same persisted keys later. */
export interface FeatureSettings {
    /** High-gold (icarus) + item purchase/reminder cues. Ward / first-shop / low-level late-game are separate. */
    shoppingAudioEnabled: boolean;
}

export interface AppSettings {
    thresholds: ThresholdSettings;
    intervals: IntervalSettings;
    audio: AudioSettings;
    features: FeatureSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
    thresholds: {
        highGoldThreshold: 3000,
        firstShopGoldThreshold: 1600,
        highGoldDisableAfterItemMilestones: 5,
    },
    intervals: {
        highGoldIntervalSec: 60,
        targetReminderDelaySec: 45,
        firstShopReminderDelaySec: 20,
    },
    audio: {
        highGoldFile: 'icarus_song_001.mp3',
        reminderFile: 'idiot_song_001.mp3',
        firstShopReminderFile: 'whatareyoudoing_1.mp3',
        lowLevelLateGameFile: 'whatareyoudoing_1.mp3',
    },
    features: {
        shoppingAudioEnabled: true,
    },
};

const STORAGE_KEY = 'ow_app_settings';

export type AppSettingsUpdate = {
    thresholds?: Partial<ThresholdSettings>;
    intervals?: Partial<IntervalSettings>;
    audio?: Partial<AudioSettings>;
    features?: Partial<FeatureSettings>;
};

export class SettingsManager {
    private static _instance: SettingsManager | null = null;
    private _settings: AppSettings;

    private constructor() {
        this._settings = this._load() || DEFAULT_SETTINGS;
    }

    public static instance(): SettingsManager {
        if (!SettingsManager._instance) {
            SettingsManager._instance = new SettingsManager();
        }
        return SettingsManager._instance;
    }

    public getSettings(): AppSettings {
        return this._settings;
    }

    public update(partial: AppSettingsUpdate): void {
        this._settings = {
            thresholds: { ...this._settings.thresholds, ...(partial.thresholds || {}) },
            intervals: { ...this._settings.intervals, ...(partial.intervals || {}) },
            audio: { ...this._settings.audio, ...(partial.audio || {}) },
            features: { ...this._settings.features, ...(partial.features || {}) },
        };
        this._persist();
    }

    public reset(): void {
        this._settings = DEFAULT_SETTINGS;
        this._persist();
    }

    private _persist(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
            }
        } catch (_) { /* ignore */ }
    }

    private _load(): AppSettings | null {
        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw) as Partial<AppSettings>;
                    return {
                        thresholds: { ...DEFAULT_SETTINGS.thresholds, ...parsed.thresholds },
                        intervals: { ...DEFAULT_SETTINGS.intervals, ...parsed.intervals },
                        audio: { ...DEFAULT_SETTINGS.audio, ...parsed.audio },
                        features: { ...DEFAULT_SETTINGS.features, ...parsed.features },
                    };
                }
            }
        } catch (_) { /* ignore */ }
        return null;
    }
}

export const getDefaultSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS });

