// Enemy power-spike detection for the in-game window: diffs each enemy's level and item IDs
// between Live Client Data all_players snapshots (same idea as checkEnemyWardChanges) and
// returns what changed. Pure -- no Overwolf APIs -- so scripts/check-enemy-spikes.ts can run it.
// Spec: twitch-overlay-2025/docs/superpowers/specs/2026-10-01-enemy-power-spike-warnings-design.md

export interface LivePlayer {
  championName?: string;
  team?: string;
  level?: number;
  items?: { itemID: number; displayName?: string }[];
}

export type SpikeReport =
  | { champion: string; kind: 'level'; level: number }
  | { champion: string; kind: 'item'; itemId: number; name: string };

const LEVEL_SPIKE = 6;

export class EnemySpikeTracker {
  private _baselined = false;
  private _levelDone = new Set<string>();
  private _itemsSeen = new Map<string, Set<number>>();

  get isBaselined(): boolean {
    return this._baselined;
  }

  reset(): void {
    this._baselined = false;
    this._levelDone.clear();
    this._itemsSeen.clear();
  }

  /** Changes since the last call. The first call that sees any enemy only records state (baseline). */
  update(players: LivePlayer[], myTeam: string): SpikeReport[] {
    const recordOnly = !this._baselined;
    const reports: SpikeReport[] = [];
    let sawEnemy = false;
    for (const p of players) {
      if (!p.championName || !p.team || p.team === myTeam) continue;
      sawEnemy = true;
      const champ = p.championName;
      const level = Number(p.level);
      if (!isNaN(level) && level >= LEVEL_SPIKE && !this._levelDone.has(champ)) {
        this._levelDone.add(champ);
        if (!recordOnly) reports.push({ champion: champ, kind: 'level', level });
      }
      const seen = this._itemsSeen.get(champ) ?? new Set<number>();
      for (const it of p.items ?? []) {
        const id = Number(it.itemID);
        if (isNaN(id) || seen.has(id)) continue;
        seen.add(id);
        if (!recordOnly) reports.push({ champion: champ, kind: 'item', itemId: id, name: it.displayName ?? '' });
      }
      this._itemsSeen.set(champ, seen);
    }
    if (sawEnemy) this._baselined = true;
    return reports;
  }
}
