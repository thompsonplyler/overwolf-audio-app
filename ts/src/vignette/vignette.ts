import { OWGames } from '@overwolf/overwolf-api-ts';

const BACKEND_BASE = 'http://127.0.0.1:5001';
const POLL_INTERVAL_MS = 200;

interface MicVignetteSettings {
  max_level: number;
  resting_radius_pct: number;
  max_radius_pct: number;
  feather_pct: number;
}

interface MicVignetteResponse {
  level: number;
  raw_mic_level: number | null;
  settings: MicVignetteSettings;
}

/**
 * Step 1-3 of the mic-reactive vignette (private/customization/GAME_PLAN.MD):
 * sizes/positions this window to exactly cover the game view (Step 1,
 * live-verified 2026-08-31), then polls back/'s GET /api/mic-vignette for
 * the live level + current settings and drives the CSS radial-gradient
 * accordingly (Step 3).
 *
 * No CSS transition on the gradient itself -- gradients don't animate
 * smoothly across renders in standard CSS anyway, and the backend's own
 * state machine already computes a smoothly-interpolated value every
 * ~200ms, so simply re-painting each poll already looks smooth. The
 * asymmetric slow-grow/fast-recede pacing lives entirely in
 * back/app/mic_vignette.py -- this file only ever displays whatever
 * number it's told.
 */
class Vignette {
  private constructor() {
    this.alignToGameWindow();
    this.startPolling();
  }

  public static run(): void {
    new Vignette();
  }

  private async alignToGameWindow(): Promise<void> {
    const info = await OWGames.getRunningGameInfo();
    if (!info || !info.logicalWidth || !info.logicalHeight) {
      console.warn('[vignette] no running game info yet; cannot size/position window', info);
      return;
    }

    overwolf.windows.getCurrentWindow(result => {
      if (!result || !result.success || !result.window) {
        console.error('[vignette] getCurrentWindow failed', result);
        return;
      }
      const id = result.window.id;

      overwolf.windows.changePosition(id, 0, 0, () => {});
      overwolf.windows.changeSize(id, info.logicalWidth, info.logicalHeight, () => {
        console.log(
          `[vignette] sized to ${info.logicalWidth}x${info.logicalHeight} at (0,0)`
        );
      });
    });
  }

  private startPolling(): void {
    this.pollOnce();
    setInterval(() => this.pollOnce(), POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    try {
      const res = await fetch(`${BACKEND_BASE}/api/mic-vignette`);
      if (!res.ok) return;
      const data: MicVignetteResponse = await res.json();
      this.applySettings(data.level, data.settings);
    } catch (e) {
      // Backend unreachable -- leave the vignette exactly as it was rather
      // than guessing; the next successful poll corrects it.
    }
  }

  private applySettings(level: number, settings: MicVignetteSettings): void {
    const fraction = settings.max_level > 0 ? Math.max(0, Math.min(1, level / settings.max_level)) : 0;
    const clearRadiusPct =
      settings.resting_radius_pct - fraction * (settings.resting_radius_pct - settings.max_radius_pct);
    const featherRadiusPct = clearRadiusPct + settings.feather_pct;

    const root = document.documentElement.style;
    root.setProperty('--clear-radius', `${clearRadiusPct}%`);
    root.setProperty('--feather-radius', `${featherRadiusPct}%`);
  }
}

Vignette.run();
