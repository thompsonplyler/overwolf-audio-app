/**
 * Local WebSocket listener matching in_game.ts (ws://127.0.0.1:5001/api/ws).
 * Run: npm run verify:ws
 * Then launch Overwolf + LoL; die, respawn, and get kills to validate event shapes.
 */
'use strict';

const { WebSocketServer } = require('ws');

const PORT = 5001;

function checkKill(msg) {
  return (
    typeof msg.multikill === 'string' &&
    ['single', 'double', 'triple', 'quadra', 'penta'].includes(msg.multikill) &&
    typeof msg.gep_kill_label === 'string' &&
    typeof msg.killstreak === 'number' &&
    msg.killstreak >= 1
  );
}

function checkDeath(msg) {
  return (
    typeof msg.death_count === 'number' &&
    msg.death_count >= 1 &&
    typeof msg.gep_death_count === 'number'
  );
}

function checkRespawn(msg) {
  return typeof msg.death_count === 'number' && msg.death_count >= 0;
}

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
    if (msg && msg.op === 'event') {
      if (msg.name === 'kill') {
        console.log('[verify-ws] KILL', JSON.stringify(msg));
        console.log('[verify-ws] kill shape:', checkKill(msg) ? 'PASS' : 'FAIL');
        return;
      }
      if (msg.name === 'death') {
        console.log('[verify-ws] DEATH', JSON.stringify(msg));
        console.log('[verify-ws] death shape:', checkDeath(msg) ? 'PASS' : 'FAIL');
        return;
      }
      if (msg.name === 'respawn') {
        console.log('[verify-ws] RESPAWN', JSON.stringify(msg));
        console.log('[verify-ws] respawn shape:', checkRespawn(msg) ? 'PASS' : 'FAIL');
        return;
      }
    }
    console.log('[verify-ws] message', JSON.stringify(msg));
  });

  socket.on('close', (code, reason) => {
    console.log('[verify-ws] closed', code, String(reason || ''));
  });
});

console.log('[verify-ws] listening on ws://127.0.0.1:' + PORT + ' (any path, e.g. /api/ws)');
