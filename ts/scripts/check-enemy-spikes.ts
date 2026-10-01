// Run: see the twitch-overlay-2025 plan (tsc to .spike_check/, then node). The app's tsconfig has no Node
// types, so assert is loaded via require to keep `tsc --noEmit -p .` clean.
declare const require: (m: string) => any;
const assert = require('assert');
import { EnemySpikeTracker } from '../src/in_game/enemySpikes';
import { SpikeQueue } from '../src/audio/spikeQueue';

const ORDER = 'ORDER', CHAOS = 'CHAOS';
const p = (championName: string, team: string, level: number, items: number[]) =>
  ({ championName, team, level, items: items.map(itemID => ({ itemID, displayName: `item${itemID}` })) });

// 1. First snapshot with enemies = baseline only, nothing announced (app reload mid-game).
let t = new EnemySpikeTracker();
assert.deepStrictEqual(t.update([p('Yone', CHAOS, 7, [1001, 3089]), p('Evelynn', ORDER, 7, [3020])], ORDER), []);
assert.strictEqual(t.isBaselined, true);
// 2. Already-level-6 at baseline is never announced later.
assert.deepStrictEqual(t.update([p('Yone', CHAOS, 8, [1001, 3089])], ORDER), []);

// 3. Level crossing announced once; new items announced; allies ignored.
t = new EnemySpikeTracker();
t.update([p('Yone', CHAOS, 5, [1001]), p('Ahri', ORDER, 5, [])], ORDER);
assert.deepStrictEqual(t.update([p('Yone', CHAOS, 6, [1001, 3020]), p('Ahri', ORDER, 6, [3089])], ORDER), [
  { champion: 'Yone', kind: 'level', level: 6 },
  { champion: 'Yone', kind: 'item', itemId: 3020, name: 'item3020' },
]);
assert.deepStrictEqual(t.update([p('Yone', CHAOS, 7, [3020])], ORDER), []);
// 4. Selling and re-buying the same item is not re-announced.
assert.deepStrictEqual(t.update([p('Yone', CHAOS, 7, [3020, 1001])], ORDER), []);

// 5. A snapshot with no enemies (teams not populated yet) must NOT lock in the baseline.
t = new EnemySpikeTracker();
assert.deepStrictEqual(t.update([p('Evelynn', ORDER, 1, [])], ORDER), []);
assert.strictEqual(t.isBaselined, false);
assert.deepStrictEqual(t.update([p('Yone', CHAOS, 1, [1055])], ORDER), []); // this is the real baseline
assert.strictEqual(t.isBaselined, true);

// 6. reset() starts a new match.
t.reset();
assert.strictEqual(t.isBaselined, false);

// 7. SpikeQueue: one at a time, FIFO, stale lines dropped.
let now = 0;
const played: string[] = [];
let finish: (() => void) | null = null;
const q = new SpikeQueue((url, done) => { played.push(url); finish = done; }, () => now, 20000);
q.enqueue('a', 'A'); q.enqueue('b', 'B');
assert.deepStrictEqual(played, ['a']);
now = 5000; finish!();
assert.deepStrictEqual(played, ['a', 'b']);
q.enqueue('c', 'C'); now = 30000; finish!();   // 'c' waited 25 s: dropped
assert.deepStrictEqual(played, ['a', 'b']);
q.enqueue('d', 'D');
assert.deepStrictEqual(played, ['a', 'b', 'd']);
q.clear();
console.log('enemy spike checks: OK');
