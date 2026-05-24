// Minimal WebSocket client wrapper for consistent logging and usage

export type WSOp = 'game_start' | 'event' | 'game_end' | 'ping';

/**
 * League of Legends GEP `kill` event → WebSocket `event` payload fields (merged with `{ op: "event" }` on send).
 * `multikill` is normalized for easy server parsing; `gep_kill_label` is the raw GEP string when known.
 */
export type KillEventWSPayload = {
  name: 'kill';
  multikill: 'single' | 'double' | 'triple' | 'quadra' | 'penta';
  /** Raw GEP `label` when present; `"unknown"` if missing (never null). */
  gep_kill_label: string;
  /** GEP `count` for this kill tier in the match; `0` if missing. */
  gep_kill_type_count: number;
  /** GEP `totalKills` for the match; `0` if missing. */
  gep_total_champion_kills_match: number;
  /** Consecutive champion kills since last death (local player). */
  killstreak: number;
  /** Unix ms at emission (same convention as `ping`). */
  ts: number;
};

/** LoL GEP `death` event → WebSocket `event` payload (local player only). */
export type DeathEventWSPayload = {
  name: 'death';
  /** Deaths this match from GEP `count`; `0` if missing. */
  death_count: number;
  gep_death_count: number;
  ts: number;
};

/** LoL GEP `respawn` event → WebSocket `event` payload (local player only). */
export type RespawnEventWSPayload = {
  name: 'respawn';
  /** Deaths so far this match (unchanged since last death). */
  death_count: number;
  ts: number;
};

export class WSClient {
    private _ws: WebSocket | null = null;
    private _ready: boolean = false;
    private _url: string;

    constructor(url: string) {
        this._url = url;
    }

    public connect(onOpen?: () => void, onClose?: () => void): void {
        console.log('[WS] Connecting to', this._url);
        this._ws = new WebSocket(this._url);
        this._ready = false;

        this._ws.addEventListener('open', () => {
            this._ready = true;
            console.log('[WS] Connected. readyState=', this._ws?.readyState);
            onOpen && onOpen();
        });

        this._ws.addEventListener('close', (ev) => {
            this._ready = false;
            console.log('[WS] Disconnected. code=', (ev as any)?.code, 'reason=', (ev as any)?.reason);
            onClose && onClose();
        });

        this._ws.addEventListener('error', (err) => {
            console.error('[WS] Error:', err);
        });

        this._ws.addEventListener('message', (msg) => {
            console.log('[WS] Message from server:', msg.data);
        });
    }

    public sendOp(op: WSOp, payload?: any): void {
        try {
            if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                if (!this._ready) {
                    console.warn('[WS] readyState OPEN but _ready=false. Forcing true.');
                    this._ready = true;
                }
                const message = payload ? { op, ...payload } : { op };
                console.log('[WS] Sending op:', op, 'payload:', payload ?? {});
                this._ws.send(JSON.stringify(message));
                console.log('[WS] Sent op:', op);
            } else {
                console.warn('[WS] Not ready to send. op=', op, 'ready=', this._ready, 'state=', this._ws?.readyState);
            }
        } catch (e) {
            console.error('[WS] sendOp error:', e);
        }
    }

    public get isReady(): boolean {
        return this._ready;
    }
}

