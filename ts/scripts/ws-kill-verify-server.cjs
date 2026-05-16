/**
 * Local WebSocket listener matching in_game.ts (ws://127.0.0.1:5001/api/ws).
 * Run: npm run verify:ws-kill
 * Then launch Overwolf + LoL with the app; champion kills should emit op "event" name "kill".
 */
'use strict';

const { WebSocketServer } = require('ws');

const PORT = 5001;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket, req) => {
  const url = req.url || '';
  console.log('[verify-ws] connection url=', url, 'remote=', req.socket.remoteAddress);

  socket.on('message', (data, isBinary) => {
    const text = isBinary ? data.toString('utf8') : String(data);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      console.log('[verify-ws] non-JSON message:', text.slice(0, 200));
      return;
    }
    if (msg && msg.op === 'event' && msg.name === 'kill') {
      console.log('[verify-ws] KILL EVENT', JSON.stringify(msg));
      const ok =
        typeof msg.multikill === 'string' &&
        ['single', 'double', 'triple', 'quadra', 'penta'].includes(msg.multikill) &&
        typeof msg.gep_kill_label === 'string';
      console.log('[verify-ws] shape check:', ok ? 'PASS' : 'FAIL', { multikill: msg.multikill, gep_kill_label: msg.gep_kill_label });
    } else {
      console.log('[verify-ws] message', JSON.stringify(msg));
    }
  });

  socket.on('close', (code, reason) => {
    console.log('[verify-ws] closed', code, String(reason || ''));
  });
});

console.log('[verify-ws] listening on ws://127.0.0.1:' + PORT + ' (any path, e.g. /api/ws)');
