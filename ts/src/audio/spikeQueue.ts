// FIFO for enemy power-spike lines: one at a time, never overlapping, and a line that waited
// longer than maxAgeMs (stale news) is dropped. Pure -- playback is injected.

interface QueuedLine {
    url: string;
    text: string;
    enqueuedAt: number;
}

export class SpikeQueue {
    private _queue: QueuedLine[] = [];
    private _playing = false;

    constructor(
        private _play: (url: string, onDone: () => void) => void,
        private _now: () => number = Date.now,
        private _maxAgeMs: number = 20000,
    ) {}

    enqueue(url: string, text: string): void {
        this._queue.push({ url, text, enqueuedAt: this._now() });
        this._next();
    }

    clear(): void {
        this._queue = [];
    }

    private _next(): void {
        if (this._playing) return;
        while (this._queue.length > 0) {
            const line = this._queue.shift()!;
            if (this._now() - line.enqueuedAt > this._maxAgeMs) {
                console.log(`[EnemySpike] dropped stale line: ${line.text}`);
                continue;
            }
            this._playing = true;
            console.log(`[EnemySpike] playing: ${line.text}`);
            this._play(line.url, () => {
                this._playing = false;
                this._next();
            });
            return;
        }
    }
}
