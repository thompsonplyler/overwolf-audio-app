/**
 * Shared wiring for the "Mic Vignette Settings" panel, embedded identically
 * (same field IDs, different prefix) in both desktop.html and in_game.html
 * -- see private/customization/GAME_PLAN.MD. Settings live in back/ (via
 * GET/POST /api/mic-vignette/settings), not Overwolf's own SettingsManager,
 * so both windows always agree on the same values without relying on
 * Overwolf's per-window storage being shared (2026-08-31, Thompson).
 */

const BACKEND_BASE = 'http://127.0.0.1:5001';

interface MicVignetteSettings {
  enabled: boolean;
  speak_threshold: number;
  grow_seconds: number;
  recede_seconds: number;
  max_level: number;
  resting_radius_pct: number;
  max_radius_pct: number;
  feather_pct: number;
}

async function fetchSettings(): Promise<MicVignetteSettings | null> {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/mic-vignette/settings`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function postSettings(partial: Partial<MicVignetteSettings>): void {
  fetch(`${BACKEND_BASE}/api/mic-vignette/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  }).catch(() => {
    // Backend unreachable -- the input still shows what the user set
    // locally; next successful save (or a reload) reconciles it.
  });
}

function bindNumberInput(id: string, initialValue: number, onChange: (value: number) => void): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) {
    console.warn(`[VignetteSettings] ${id} not found in DOM.`);
    return;
  }
  input.value = String(initialValue);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (Number.isNaN(value)) return;
    onChange(value);
  });
}

function bindCheckboxInput(id: string, initialValue: boolean, onChange: (value: boolean) => void): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) {
    console.warn(`[VignetteSettings] ${id} not found in DOM.`);
    return;
  }
  input.checked = initialValue;
  input.addEventListener('change', () => onChange(input.checked));
}

/** Wires a settings panel whose input IDs are `${idPrefix}<Field>Input`
 * (e.g. "desktopVignetteGrowSecondsInput", "ingameVignetteGrowSecondsInput").
 * Fetches current values from back/ once and binds each input to POST its
 * own field on change -- one field change never clobbers the others. */
export async function setupVignetteSettingsPanel(idPrefix: string): Promise<void> {
  const settings = await fetchSettings();
  if (!settings) {
    console.warn('[VignetteSettings] could not fetch current settings from backend');
    return;
  }

  bindCheckboxInput(`${idPrefix}EnabledInput`, settings.enabled, v => postSettings({ enabled: v }));
  bindNumberInput(`${idPrefix}GrowSecondsInput`, settings.grow_seconds, v => postSettings({ grow_seconds: v }));
  bindNumberInput(`${idPrefix}RecedeSecondsInput`, settings.recede_seconds, v => postSettings({ recede_seconds: v }));
  bindNumberInput(`${idPrefix}SpeakThresholdInput`, settings.speak_threshold, v => postSettings({ speak_threshold: v }));
  bindNumberInput(`${idPrefix}MaxLevelInput`, settings.max_level, v => postSettings({ max_level: v }));
  bindNumberInput(`${idPrefix}RestingRadiusInput`, settings.resting_radius_pct, v => postSettings({ resting_radius_pct: v }));
  bindNumberInput(`${idPrefix}MaxRadiusInput`, settings.max_radius_pct, v => postSettings({ max_radius_pct: v }));
  bindNumberInput(`${idPrefix}FeatherInput`, settings.feather_pct, v => postSettings({ feather_pct: v }));
}
