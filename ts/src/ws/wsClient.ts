// Minimal WebSocket client wrapper for consistent logging and usage

export type WSOp = 'game_start' | 'event' | 'game_end' | 'ping';

export class WSClient {
    private _ws: WebSocket | null = null;
    private _ready: boolean = false;
    private _url: string;

    constructor(url: string) {
        this._url = url;
    }

    public connect(onOpen?: () => void): void {
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

