// Noggin: a forehead guessing party game. Zero dependencies: plain Node http,
// Server-Sent Events for pushing state, JSON POSTs for player actions.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const DECKS = require('./decks');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const HOST_HANDOFF_MS = 15000;
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;

const rooms = new Map();

// ---------- helpers ----------

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const newCode = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
};

const newId = () => crypto.randomBytes(9).toString('base64url');

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);

// Custom deck lines: "Name", "https://image.url", or "Answer | https://image.url" (either order).
function parseCustom(text) {
  const cards = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
    const url = parts.find(isUrl);
    const label = parts.filter((p) => !isUrl(p)).join(' ');
    if (url) cards.push({ text: label.slice(0, 80), img: url.slice(0, 2000) });
    else cards.push({ text: label.slice(0, 80) });
    if (cards.length >= 500) break;
  }
  return cards;
}

// Best guess at the Wi-Fi/LAN address first. VPNs (Tailscale, ZeroTier) and
// virtual adapters (VirtualBox, Hyper-V, WSL) come last; their addresses often end in .1.
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let score = 0;
      if (/^192\.168\./.test(a.address)) score += 3;
      else if (/^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 2;
      if (/wi-?fi|wlan|wireless|^en|^eth|^ethernet$/i.test(name)) score += 1;
      if (/\.1$/.test(a.address)) score -= 3;
      if (/tailscale|zerotier|vpn|virtual|vbox|vmware|hyper-v|vethernet|wsl|docker|loopback/i.test(name)) score -= 5;
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)) score -= 5; // CGNAT range used by Tailscale
      out.push({ address: a.address, score });
    }
  }
  return out.sort((x, y) => y.score - x.score).map((x) => x.address);
}

// ---------- rooms ----------

function createRoom() {
  const room = {
    code: newCode(),
    hostId: null,
    players: [],
    settings: {
      mode: 'hotseat', // 'hotseat' | 'mystery'
      decks: ['animals', 'characters'],
      custom: '',
      seconds: 60,
      rounds: 2,
    },
    phase: 'lobby',
    game: null,
    touched: Date.now(),
    timer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, name) {
  const player = {
    id: newId(),
    name: String(name || '').trim().slice(0, 20) || 'Player',
    score: 0,
    streams: new Set(),
    lastSeen: Date.now(),
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  if (room.phase === 'mystery') dealMystery(room, player);
  return player;
}

const online = (p) => p.streams.size > 0;

function buildDeck(room) {
  let cards = [];
  for (const key of room.settings.decks) if (DECKS[key]) cards = cards.concat(DECKS[key].cards);
  cards = cards.concat(parseCustom(room.settings.custom));
  return shuffle(cards);
}

function draw(room) {
  const g = room.game;
  if (!g.deck.length) g.deck = shuffle(g.discard.splice(0));
  const card = g.deck.pop();
  g.discard.push(card);
  return card;
}

// ---------- hot seat: one guesser, everyone else sees the card ----------

function startGame(room) {
  const deck = buildDeck(room);
  if (!deck.length) return 'Pick at least one deck or add custom cards.';
  if (room.players.length < 2) return 'You need at least 2 players.';
  for (const p of room.players) p.score = 0;
  room.game = { deck, discard: [], round: 1 };
  if (room.settings.mode === 'hotseat') {
    Object.assign(room.game, { order: shuffle(room.players.map((p) => p.id)), turn: 0 });
    room.phase = 'ready';
  } else {
    startMysteryRound(room);
  }
  return null;
}

const guesserId = (room) => {
  const g = room.game;
  return g.order[g.turn % g.order.length];
};

function beginTurn(room) {
  const g = room.game;
  g.card = draw(room);
  g.seq = 1;
  g.results = [];
  g.endsAt = Date.now() + room.settings.seconds * 1000;
  room.phase = 'turn';
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endTurn(room), room.settings.seconds * 1000 + 300);
}

function endTurn(room) {
  if (room.phase !== 'turn') return;
  clearTimeout(room.timer);
  room.phase = 'summary';
  broadcast(room);
}

function nextTurn(room) {
  const g = room.game;
  // Pick up players who joined mid-game so they get a turn too.
  for (const p of room.players) if (!g.order.includes(p.id)) g.order.push(p.id);
  g.turn++;
  if (g.turn >= g.order.length * room.settings.rounds) {
    room.phase = 'final';
    return;
  }
  g.round = Math.floor(g.turn / g.order.length) + 1;
  room.phase = 'ready';
}

// ---------- mystery: everyone has a card, sees everyone else's ----------

function dealMystery(room, player) {
  room.game.hands[player.id] = { card: draw(room), status: 'guessing', points: 0 };
}

function startMysteryRound(room) {
  const g = room.game;
  g.hands = {};
  g.solvedCount = 0;
  for (const p of room.players) dealMystery(room, p);
  g.askerIdx = crypto.randomInt(room.players.length);
  room.phase = 'mystery';
}

function checkMysteryDone(room) {
  const hands = Object.values(room.game.hands);
  if (hands.every((h) => h.status !== 'guessing')) room.phase = 'reveal';
}

// ---------- per-player view ----------

function viewFor(room, me) {
  const g = room.game;
  const view = {
    code: room.code,
    me: me.id,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    customCount: parseCustom(room.settings.custom).length,
    players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, online: online(p) })),
    serverNow: Date.now(),
  };
  if (!g) return view;
  view.round = g.round;
  if (room.settings.mode === 'hotseat') {
    view.guesserId = guesserId(room);
    view.turnNumber = g.turn + 1;
    view.totalTurns = g.order.length * room.settings.rounds;
    if (room.phase === 'turn') {
      view.endsAt = g.endsAt;
      view.seq = g.seq;
      view.got = g.results.filter((r) => r.ok).length;
      if (me.id !== view.guesserId) view.card = g.card;
    }
    if (room.phase === 'summary') view.results = g.results;
  } else if (g.hands) {
    view.askerId = room.players[g.askerIdx % room.players.length]?.id;
    view.hands = {};
    for (const [id, h] of Object.entries(g.hands)) {
      const hidden = id === me.id && h.status === 'guessing' && room.phase === 'mystery';
      view.hands[id] = { status: h.status, points: h.points, card: hidden ? null : h.card };
    }
  }
  return view;
}

function send(room, player) {
  const data = `data: ${JSON.stringify(viewFor(room, player))}\n\n`;
  for (const res of player.streams) res.write(data);
}

function broadcast(room) {
  room.touched = Date.now();
  for (const p of room.players) send(room, p);
}

// ---------- actions ----------

function act(room, player, a) {
  const isHost = player.id === room.hostId;
  const g = room.game;
  switch (a.type) {
    case 'settings': {
      if (!isHost || room.phase !== 'lobby') return 'Only the host can change settings.';
      const s = room.settings;
      const n = a.settings || {};
      if (n.mode === 'hotseat' || n.mode === 'mystery') s.mode = n.mode;
      if (Array.isArray(n.decks)) s.decks = n.decks.filter((k) => DECKS[k]);
      if (typeof n.custom === 'string') s.custom = n.custom.slice(0, 200000);
      if (n.seconds) s.seconds = Math.min(300, Math.max(15, Number(n.seconds) || 60));
      if (n.rounds) s.rounds = Math.min(10, Math.max(1, Number(n.rounds) || 1));
      return null;
    }
    case 'ping':
      return null;
    case 'rename': {
      const name = String(a.name || '').trim().slice(0, 20);
      if (name) player.name = name;
      return null;
    }
    case 'start':
      if (!isHost) return 'Only the host can start.';
      if (room.phase !== 'lobby') return null;
      return startGame(room);
    case 'begin': // guesser (or host) starts the clock
      if (room.phase !== 'ready') return null;
      if (player.id !== guesserId(room) && !isHost) return 'Waiting for the guesser.';
      beginTurn(room);
      return null;
    case 'correct':
    case 'pass': {
      if (room.phase !== 'turn' || a.seq !== g.seq) return null; // stale double-tap
      const ok = a.type === 'correct';
      g.results.push({ card: g.card, ok });
      if (ok) {
        const guesser = room.players.find((p) => p.id === guesserId(room));
        if (guesser) guesser.score++;
      }
      g.card = draw(room);
      g.seq++;
      return null;
    }
    case 'endTurn':
      if (room.phase === 'turn' && (isHost || player.id === guesserId(room))) endTurn(room);
      return null;
    case 'skipTurn': // guesser missing or doesn't want to go
      if (room.phase === 'ready' && (isHost || player.id === guesserId(room))) nextTurn(room);
      return null;
    case 'nextTurn':
      if (room.phase === 'summary' && (isHost || player.id === guesserId(room))) nextTurn(room);
      return null;
    case 'confirm': {
      // Someone else says "yes, that's you!"
      if (room.phase !== 'mystery' || a.target === player.id) return null;
      const h = g.hands[a.target];
      if (!h || h.status !== 'guessing') return null;
      h.status = 'solved';
      h.points = Math.max(1, room.players.length - g.solvedCount);
      g.solvedCount++;
      const target = room.players.find((p) => p.id === a.target);
      if (target) target.score += h.points;
      checkMysteryDone(room);
      return null;
    }
    case 'giveUp': {
      if (room.phase !== 'mystery') return null;
      const target = a.target && isHost ? a.target : player.id;
      const h = g.hands[target];
      if (h && h.status === 'guessing') h.status = 'gaveup';
      checkMysteryDone(room);
      return null;
    }
    case 'nextAsker':
      if (room.phase === 'mystery') {
        // Skip players who are already done.
        for (let i = 0; i < room.players.length; i++) {
          g.askerIdx = (g.askerIdx + 1) % room.players.length;
          const next = room.players[g.askerIdx];
          if (g.hands[next.id]?.status === 'guessing') break;
        }
      }
      return null;
    case 'nextRound':
      if (!isHost || room.phase !== 'reveal') return null;
      if (g.round >= room.settings.rounds) room.phase = 'final';
      else {
        g.round++;
        startMysteryRound(room);
      }
      return null;
    case 'endGame':
      if (!isHost || room.phase === 'lobby') return null;
      clearTimeout(room.timer);
      room.phase = 'final';
      return null;
    case 'lobby':
      if (!isHost) return null;
      clearTimeout(room.timer);
      room.phase = 'lobby';
      room.game = null;
      return null;
    case 'kick': {
      if (!isHost || a.target === player.id) return null;
      const idx = room.players.findIndex((p) => p.id === a.target);
      if (idx < 0) return null;
      const [gone] = room.players.splice(idx, 1);
      for (const res of gone.streams) res.end();
      if (g?.hands) {
        delete g.hands[gone.id];
        if (room.phase === 'mystery') checkMysteryDone(room);
      }
      if (g?.order) {
        // The next player in line slides into the removed player's slot.
        const wasGuesser = guesserId(room) === gone.id;
        g.order = g.order.filter((id) => id !== gone.id);
        if (wasGuesser && (room.phase === 'turn' || room.phase === 'summary')) {
          clearTimeout(room.timer);
          room.phase = 'ready';
        }
      }
      return null;
    }
    default:
      return 'Unknown action.';
  }
}

// If the host drops off for a while, hand hosting to someone still connected.
function checkHost(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  if (host && online(host)) return;
  if (host && Date.now() - host.lastSeen < HOST_HANDOFF_MS) return;
  const next = room.players.find(online);
  if (next && next.id !== room.hostId) {
    room.hostId = next.id;
    broadcast(room);
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    checkHost(room);
    if (Date.now() - room.touched > ROOM_IDLE_MS && !room.players.some(online)) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
    }
  }
}, 5000);

// ---------- http ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('Too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function findPlayer(code, id) {
  const room = rooms.get(String(code || '').toUpperCase());
  const player = room?.players.find((p) => p.id === id);
  return { room, player };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/api/info') {
      const decks = Object.entries(DECKS).map(([key, d]) => ({
        key,
        name: d.name,
        kind: d.kind,
        count: d.cards.length,
      }));
      return json(res, 200, { decks, addresses: lanAddresses(), port: PORT });
    }

    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readBody(req);
      const room = createRoom();
      const player = addPlayer(room, body.name);
      return json(res, 200, { code: room.code, id: player.id });
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readBody(req);
      const room = rooms.get(String(body.code || '').trim().toUpperCase());
      if (!room) return json(res, 404, { error: 'No room with that code.' });
      if (room.players.length >= 30) return json(res, 400, { error: 'Room is full.' });
      const player = addPlayer(room, body.name);
      broadcast(room);
      return json(res, 200, { code: room.code, id: player.id });
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const { room, player } = findPlayer(url.searchParams.get('code'), url.searchParams.get('id'));
      if (!player) return json(res, 404, { error: 'Not in that room.' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 1500\n\n');
      player.streams.add(res);
      player.lastSeen = Date.now();
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        player.streams.delete(res);
        player.lastSeen = Date.now();
        if (rooms.has(room.code)) broadcast(room);
      });
      checkHost(room);
      broadcast(room);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      const { room, player } = findPlayer(body.code, body.id);
      if (!player) return json(res, 404, { error: 'Not in that room.' });
      player.lastSeen = Date.now();
      const error = act(room, player, body.action || {});
      broadcast(room);
      return json(res, error ? 400 : 200, error ? { error } : { ok: true });
    }

    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const file = path.normalize(path.join(PUBLIC, rel));
      if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
      return fs.readFile(file, (err, data) => {
        if (err) return json(res, 404, { error: 'Not found' });
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    }

    json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    json(res, 400, { error: e.message || 'Bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Noggin is running!\n');
  const [best, ...others] = lanAddresses();
  console.log(`  On this computer:  http://localhost:${PORT}`);
  if (best) console.log(`  Phones on Wi-Fi:   http://${best}:${PORT}`);
  if (others.length) console.log(`  (if that fails, try: ${others.map((ip) => `http://${ip}:${PORT}`).join('  ')})`);
  console.log('\n  Phones must be on the same Wi-Fi. Press Ctrl+C to stop.\n');
});
