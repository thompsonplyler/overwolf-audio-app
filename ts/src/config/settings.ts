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

/**
 * Stable id per logical audio cue (not filename — some cues share a default file
 * but must be independently mixable). Add an id here + a label below to make a
 * new cue controllable; nothing else in the volume pipeline needs to change.
 */
export type AudioCueId =
    | 'highGold'
    | 'itemTarget'
    | 'itemReminder'
    | 'firstShopReminder'
    | 'lowLevelLateGame'
    | 'wardPurchased'
    | 'wardPlaced';

export const AUDIO_CUE_IDS: AudioCueId[] = [
    'highGold',
    'itemTarget',
    'itemReminder',
    'firstShopReminder',
    'lowLevelLateGame',
    'wardPurchased',
    'wardPlaced',
];

/** Human-readable label per cue, for any settings UI that lists them. */
export const AUDIO_CUE_LABELS: Record<AudioCueId, string> = {
    highGold: 'High gold',
    itemTarget: 'Item ready to buy',
    itemReminder: 'Item reminder',
    firstShopReminder: 'Return-to-base reminder',
    lowLevelLateGame: 'Low level warning',
    wardPurchased: 'Enemy ward purchased',
    wardPlaced: 'Enemy ward placed',
};

export interface CueVolumeSetting {
    volume: number; // 0..1
    muted: boolean;
}

export interface VolumeSettings {
    masterVolume: number; // 0..1, applies to every cue
    masterMuted: boolean;
    cues: Record<AudioCueId, CueVolumeSetting>;
}

export interface AppSettings {
    thresholds: ThresholdSettings;
    intervals: IntervalSettings;
    audio: AudioSettings;
    features: FeatureSettings;
    volume: VolumeSettings;
}

function defaultCueVolumes(): Record<AudioCueId, CueVolumeSetting> {
    const cues = {} as Record<AudioCueId, CueVolumeSetting>;
    for (const id of AUDIO_CUE_IDS) {
        cues[id] = { volume: 1, muted: false };
    }
    return cues;
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
    volume: {
        masterVolume: 1,
        masterMuted: false,
        cues: defaultCueVolumes(),
    },
};

const STORAGE_KEY = 'ow_app_settings';

export type AppSettingsUpdate = {
    thresholds?: Partial<ThresholdSettings>;
    intervals?: Partial<IntervalSettings>;
    audio?: Partial<AudioSettings>;
    features?: Partial<FeatureSettings>;
    volume?: {
        masterVolume?: number;
        masterMuted?: boolean;
        cues?: Partial<Record<AudioCueId, Partial<CueVolumeSetting>>>;
    };
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
        const nextCues = { ...this._settings.volume.cues };
        if (partial.volume?.cues) {
            for (const id of Object.keys(partial.volume.cues) as AudioCueId[]) {
                nextCues[id] = { ...nextCues[id], ...partial.volume.cues[id] };
            }
        }
        this._settings = {
            thresholds: { ...this._settings.thresholds, ...(partial.thresholds || {}) },
            intervals: { ...this._settings.intervals, ...(partial.intervals || {}) },
            audio: { ...this._settings.audio, ...(partial.audio || {}) },
            features: { ...this._settings.features, ...(partial.features || {}) },
            volume: {
                masterVolume: partial.volume?.masterVolume ?? this._settings.volume.masterVolume,
                masterMuted: partial.volume?.masterMuted ?? this._settings.volume.masterMuted,
                cues: nextCues,
            },
        };
        this._persist();
    }

    /** Effective 0..1 playback volume for a cue: 0 if either master or the cue itself is muted. */
    public getEffectiveCueVolume(cueId: AudioCueId): number {
        const v = this._settings.volume;
        const cue = v.cues[cueId] ?? { volume: 1, muted: false };
        if (v.masterMuted || cue.muted) {
            return 0;
        }
        const clamp = (n: number) => Math.max(0, Math.min(1, n));
        return clamp(v.masterVolume) * clamp(cue.volume);
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
                    const mergedCues = defaultCueVolumes();
                    if (parsed.volume?.cues) {
                        for (const id of AUDIO_CUE_IDS) {
                            const savedCue = parsed.volume.cues[id];
                            if (savedCue) {
                                mergedCues[id] = { ...mergedCues[id], ...savedCue };
                            }
                        }
                    }
                    return {
                        thresholds: { ...DEFAULT_SETTINGS.thresholds, ...parsed.thresholds },
                        intervals: { ...DEFAULT_SETTINGS.intervals, ...parsed.intervals },
                        audio: { ...DEFAULT_SETTINGS.audio, ...parsed.audio },
                        features: { ...DEFAULT_SETTINGS.features, ...parsed.features },
                        volume: {
                            masterVolume: parsed.volume?.masterVolume ?? DEFAULT_SETTINGS.volume.masterVolume,
                            masterMuted: parsed.volume?.masterMuted ?? DEFAULT_SETTINGS.volume.masterMuted,
                            cues: mergedCues,
                        },
                    };
                }
            }
        } catch (_) { /* ignore */ }
        return null;
    }
}

export const getDefaultSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS });

