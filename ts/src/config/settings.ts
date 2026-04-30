// Centralized settings with simple persistence to localStorage (expandable later)

export interface ThresholdSettings {
    highGoldThreshold: number; // e.g., 3000
}

export interface IntervalSettings {
    highGoldIntervalSec: number; // e.g., 60
    targetReminderDelaySec: number; // e.g., 30
}

export interface AudioSettings {
    highGoldFile: string; // e.g., 'icarus_song_001.mp3'
    reminderFile: string; // e.g., 'idiot_song_001.mp3'
}

export interface AppSettings {
    thresholds: ThresholdSettings;
    intervals: IntervalSettings;
    audio: AudioSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
    thresholds: {
        highGoldThreshold: 3000,
    },
    intervals: {
        highGoldIntervalSec: 60,
        targetReminderDelaySec: 30,
    },
    audio: {
        highGoldFile: 'icarus_song_001.mp3',
        reminderFile: 'idiot_song_001.mp3',
    },
};

const STORAGE_KEY = 'ow_app_settings';

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

    public update(partial: Partial<AppSettings>): void {
        this._settings = {
            thresholds: { ...this._settings.thresholds, ...(partial.thresholds || {}) },
            intervals: { ...this._settings.intervals, ...(partial.intervals || {}) },
            audio: { ...this._settings.audio, ...(partial.audio || {}) },
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
                    const parsed = JSON.parse(raw);
                    return parsed as AppSettings;
                }
            }
        } catch (_) { /* ignore */ }
        return null;
    }
}

export const getDefaultSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS });

