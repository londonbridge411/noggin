// Noggin game rules. Runs on the server (api/room.js). Players only ever get the
// per-player view that viewFor() builds, so nobody can peek at their own card.
// A Room is plain data plus methods: it's loaded from Redis for each request,
// changed, and saved back.

import '../decks.js';

const DECKS = globalThis.DECKS;

const randInt = (n) => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
};

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const newCode = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[randInt(letters.length)]).join('');
};

const newId = () => {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
};

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);

// Custom deck lines: "Name", "https://image.url", or "Answer | https://image.url" (either order).
export function parseCustom(text) {
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

export class Room {
  constructor(code, saved) {
    Object.assign(this, saved || {
      code,
      hostId: null,
      players: [], // { id, key, name, score } — key is the player's secret, never sent to others
      settings: {
        mode: 'hotseat', // 'hotseat' | 'mystery'
        decks: ['animals', 'characters'],
        custom: '',
        seconds: 60,
        rounds: 2,
      },
      phase: 'lobby',
      game: null,
    });
  }

  toJSON() {
    const { code, hostId, players, settings, phase, game } = this;
    return { code, hostId, players, settings, phase, game };
  }

  // ---------- players ----------

  addPlayer(name) {
    const player = { id: newId(), key: newId(), name: String(name || '').trim().slice(0, 20) || 'Player', score: 0 };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    if (this.phase === 'mystery') this.dealMystery(player);
    return player;
  }

  find(id) {
    return this.players.find((p) => p.id === id);
  }

  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const g = this.game;
    const wasGuesser = g?.order && this.guesserId() === id;
    const [gone] = this.players.splice(idx, 1);
    if (this.hostId === gone.id) this.hostId = this.players[0]?.id ?? null;
    if (g?.hands) {
      delete g.hands[gone.id];
      if (this.phase === 'mystery') this.checkMysteryDone();
    }
    if (g?.order) {
      // The next player in line slides into the removed player's slot.
      g.order = g.order.filter((pid) => pid !== gone.id);
      if (!g.order.length) this.phase = 'final';
      else if (wasGuesser && (this.phase === 'turn' || this.phase === 'summary')) this.phase = 'ready';
    }
  }

  // ---------- decks ----------

  buildDeck() {
    let cards = [];
    for (const key of this.settings.decks) if (DECKS[key]) cards = cards.concat(DECKS[key].cards);
    return shuffle(cards.concat(parseCustom(this.settings.custom)));
  }

  draw() {
    const g = this.game;
    if (!g.deck.length) g.deck = shuffle(g.discard.splice(0));
    const card = g.deck.pop();
    g.discard.push(card);
    return card;
  }

  startGame() {
    const deck = this.buildDeck();
    if (!deck.length) return 'Pick at least one deck or add custom cards.';
    if (this.players.length < 2) return 'You need at least 2 players.';
    for (const p of this.players) p.score = 0;
    this.game = { deck, discard: [], round: 1 };
    if (this.settings.mode === 'hotseat') {
      Object.assign(this.game, { order: shuffle(this.players.map((p) => p.id)), turn: 0 });
      this.phase = 'ready';
    } else {
      this.startMysteryRound();
    }
    return null;
  }

  // ---------- hot seat: one guesser, everyone else sees the card ----------

  guesserId() {
    const g = this.game;
    return g.order[g.turn % g.order.length];
  }

  beginTurn() {
    const g = this.game;
    g.card = this.draw();
    g.seq = 1;
    g.results = [];
    g.endsAt = Date.now() + this.settings.seconds * 1000;
    this.phase = 'turn';
  }

  // There's no server running between requests, so the clock is checked whenever
  // the room is touched. Phones send a 'tick' when their countdown hits zero.
  expire() {
    if (this.phase === 'turn' && Date.now() >= this.game.endsAt) this.phase = 'summary';
  }

  nextTurn() {
    const g = this.game;
    // Pick up players who joined mid-game so they get a turn too.
    for (const p of this.players) if (!g.order.includes(p.id)) g.order.push(p.id);
    g.turn++;
    if (g.turn >= g.order.length * this.settings.rounds) {
      this.phase = 'final';
      return;
    }
    g.round = Math.floor(g.turn / g.order.length) + 1;
    this.phase = 'ready';
  }

  // ---------- mystery: everyone has a card, sees everyone else's ----------

  dealMystery(player) {
    this.game.hands[player.id] = { card: this.draw(), status: 'guessing', points: 0 };
  }

  startMysteryRound() {
    const g = this.game;
    g.hands = {};
    g.solvedCount = 0;
    for (const p of this.players) this.dealMystery(p);
    g.askerIdx = randInt(this.players.length);
    this.phase = 'mystery';
  }

  checkMysteryDone() {
    if (Object.values(this.game.hands).every((h) => h.status !== 'guessing')) this.phase = 'reveal';
  }

  // ---------- per-player view ----------

  viewFor(meId, online) {
    const g = this.game;
    const view = {
      code: this.code,
      me: meId,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      customCount: parseCustom(this.settings.custom).length,
      players: this.players.map(({ id, name, score }) => ({ id, name, score, online: online.has(id) })),
      serverNow: Date.now(),
    };
    if (!g) return view;
    view.round = g.round;
    if (this.settings.mode === 'hotseat') {
      view.guesserId = this.guesserId();
      view.turnNumber = g.turn + 1;
      view.totalTurns = g.order.length * this.settings.rounds;
      if (this.phase === 'turn') {
        view.endsAt = g.endsAt;
        view.seq = g.seq;
        view.got = g.results.filter((r) => r.ok).length;
        if (meId !== view.guesserId) view.card = g.card;
      }
      if (this.phase === 'summary') view.results = g.results;
    } else if (g.hands) {
      view.askerId = this.players[g.askerIdx % this.players.length]?.id;
      view.hands = {};
      for (const [id, h] of Object.entries(g.hands)) {
        const hidden = id === meId && h.status === 'guessing' && this.phase === 'mystery';
        view.hands[id] = { status: h.status, points: h.points, card: hidden ? null : h.card };
      }
    }
    return view;
  }

  // ---------- actions ----------

  // Returns an error message, or null.
  act(playerId, a) {
    const player = this.find(playerId);
    if (!player) return 'You are not in this room.';
    this.expire();
    return this.apply(player, a || {});
  }

  apply(player, a) {
    const isHost = player.id === this.hostId;
    const g = this.game;
    switch (a.type) {
      case 'tick':
        return null; // expire() already ran
      case 'settings': {
        if (!isHost || this.phase !== 'lobby') return 'Only the host can change settings.';
        const s = this.settings;
        const n = a.settings || {};
        if (n.mode === 'hotseat' || n.mode === 'mystery') s.mode = n.mode;
        if (Array.isArray(n.decks)) s.decks = n.decks.filter((k) => DECKS[k]);
        if (typeof n.custom === 'string') s.custom = n.custom.slice(0, 200000);
        if (n.seconds) s.seconds = Math.min(300, Math.max(15, Number(n.seconds) || 60));
        if (n.rounds) s.rounds = Math.min(10, Math.max(1, Number(n.rounds) || 1));
        return null;
      }
      case 'rename': {
        const name = String(a.name || '').trim().slice(0, 20);
        if (name) player.name = name;
        return null;
      }
      case 'start':
        if (!isHost) return 'Only the host can start.';
        if (this.phase !== 'lobby') return null;
        return this.startGame();
      case 'begin': // guesser (or host) starts the clock
        if (this.phase !== 'ready') return null;
        if (player.id !== this.guesserId() && !isHost) return 'Waiting for the guesser.';
        this.beginTurn();
        return null;
      case 'correct':
      case 'pass': {
        if (this.phase !== 'turn' || a.seq !== g.seq) return null; // stale double-tap
        if (player.id !== this.guesserId()) return 'Only the guesser can mark cards.';
        const ok = a.type === 'correct';
        g.results.push({ card: g.card, ok });
        if (ok) {
          const guesser = this.find(this.guesserId());
          if (guesser) guesser.score++;
        }
        g.card = this.draw();
        g.seq++;
        return null;
      }
      case 'endTurn':
        if (this.phase === 'turn' && (isHost || player.id === this.guesserId())) this.phase = 'summary';
        return null;
      case 'skipTurn': // guesser missing or doesn't want to go
        if (this.phase === 'ready' && (isHost || player.id === this.guesserId())) this.nextTurn();
        return null;
      case 'nextTurn':
        if (this.phase === 'summary' && (isHost || player.id === this.guesserId())) this.nextTurn();
        return null;
      case 'confirm': {
        // Someone else says "yes, that's you!"
        if (this.phase !== 'mystery' || a.target === player.id) return null;
        const h = g.hands[a.target];
        if (!h || h.status !== 'guessing') return null;
        h.status = 'solved';
        h.points = Math.max(1, this.players.length - g.solvedCount);
        g.solvedCount++;
        const target = this.find(a.target);
        if (target) target.score += h.points;
        this.checkMysteryDone();
        return null;
      }
      case 'giveUp': {
        if (this.phase !== 'mystery') return null;
        const h = g.hands[a.target && isHost ? a.target : player.id];
        if (h && h.status === 'guessing') h.status = 'gaveup';
        this.checkMysteryDone();
        return null;
      }
      case 'nextAsker':
        if (this.phase === 'mystery') {
          // Skip players who are already done.
          for (let i = 0; i < this.players.length; i++) {
            g.askerIdx = (g.askerIdx + 1) % this.players.length;
            if (g.hands[this.players[g.askerIdx].id]?.status === 'guessing') break;
          }
        }
        return null;
      case 'nextRound':
        if (!isHost || this.phase !== 'reveal') return null;
        if (g.round >= this.settings.rounds) this.phase = 'final';
        else {
          g.round++;
          this.startMysteryRound();
        }
        return null;
      case 'endGame':
        if (!isHost || this.phase === 'lobby') return null;
        this.phase = 'final';
        return null;
      case 'lobby':
        if (!isHost) return null;
        this.phase = 'lobby';
        this.game = null;
        return null;
      case 'kick':
        if (!isHost || a.target === player.id) return null;
        this.removePlayer(a.target);
        return null;
      case 'leave': // the host role passes to the next player
        this.removePlayer(player.id);
        return null;
      default:
        return 'Unknown action.';
    }
  }
}
