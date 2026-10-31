// Noggin client. Whoever creates a room hosts it: the game runs in their tab
// (game.js) and other players connect to it peer-to-peer through PeerJS.
// Everyone, host included, just renders the per-player view they're handed.

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const PEER_PREFIX = 'noggin-party-v1-';
const SESSION_KEY = 'noggin-session'; // { code, id, host }
const ROOM_KEY = 'noggin-host-room'; // the host's saved game, so a refresh doesn't end it

let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let state = null;
let net = null; // { act(action) -> Promise<error|null>, close() }
let linkDown = false;
const info = {
  decks: Object.entries(window.DECKS).map(([key, d]) => ({ key, name: d.name, kind: d.kind, count: d.cards.length })),
};
let clockOffset = 0;
let screenKey = null;
let pendingSettings = {};
let settingsTimer = null;
let lastBeepSecond = null;

const MODES = {
  hotseat: {
    name: 'Hot Seat',
    blurb: 'One guesser at a time. Everyone else sees the card and gives clues against the clock.',
  },
  mystery: {
    name: 'Mystery Guest',
    blurb: 'Everyone gets a secret card they can\'t see. Take turns asking yes/no questions.',
  },
};

// ---------- tiny DOM helper ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function show(key, build) {
  if (key === screenKey) return false;
  screenKey = key;
  app.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
  window.scrollTo(0, 0);
  return true;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 3000);
}

// ---------- sound & buzz ----------

let audio;
function beep(freq, ms = 120, type = 'sine') {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch {}
}
const buzz = (ms) => navigator.vibrate?.(ms);

// ---------- networking ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function act(action) {
  return net ? net.act(action).then((err) => (err ? toast(err) : null)) : Promise.resolve();
}

function receive(view) {
  state = view;
  clockOffset = view.serverNow - Date.now();
  render();
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  history.replaceState(null, '', `?room=${session.code}`);
}

function setLinkDown(down) {
  linkDown = down;
  document.body.classList.toggle('link-down', down);
}

// Opens a Peer under a fixed ID. 'unavailable-id' means someone holds it: another
// room with that code, or our own previous tab that the server hasn't dropped yet.
function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, { debug: 0 });
    peer.once('open', () => resolve(peer));
    peer.once('error', (err) => {
      peer.destroy();
      reject(err);
    });
  });
}

async function hostRoom(name, saved) {
  let peer;
  let code = saved?.code;
  if (code) {
    // Reclaiming our room after a refresh; the old connection can take a moment to clear.
    for (let tries = 0; !peer; tries++) {
      try {
        peer = await openPeer(PEER_PREFIX + code);
      } catch (err) {
        if (err.type !== 'unavailable-id' || tries > 20) throw err;
        await wait(3000);
      }
    }
  } else {
    for (let tries = 0; !peer; tries++) {
      code = Noggin.newCode();
      try {
        peer = await openPeer(PEER_PREFIX + code);
      } catch (err) {
        if (err.type !== 'unavailable-id' || tries > 5) throw err;
      }
    }
  }

  const conns = new Map(); // playerId -> DataConnection
  let me;
  const room = new Noggin.Room(code, () => {
    localStorage.setItem(ROOM_KEY, JSON.stringify(room));
    for (const [pid, conn] of conns) {
      if (!room.find(pid)) {
        // Removed by the host.
        conn.send({ t: 'gone' });
        setTimeout(() => conn.close(), 500);
        conns.delete(pid);
      } else if (conn.open) conn.send({ t: 'state', view: room.viewFor(pid) });
    }
    if (me) receive(room.viewFor(me));
  }, saved?.room);

  peer.on('connection', (conn) => {
    conn.on('data', (msg) => {
      if (msg?.t === 'join') {
        let p = msg.id && room.find(msg.id);
        if (!p && msg.id) return conn.send({ t: 'gone' });
        if (!p && room.players.length >= 30) return conn.send({ t: 'error', error: 'Room is full.' });
        if (!p) p = room.addPlayer(msg.name);
        const old = conns.get(p.id);
        if (old && old !== conn) old.close();
        conns.set(p.id, conn);
        conn.pid = p.id;
        conn.send({ t: 'joined', id: p.id, code });
        room.setOnline(p.id, true);
        conn.send({ t: 'state', view: room.viewFor(p.id) });
      } else if (msg?.t === 'act' && conn.pid) {
        conn.send({ t: 'ack', n: msg.n, error: room.act(conn.pid, msg.action) });
      }
    });
    conn.on('close', () => {
      if (conn.pid && conns.get(conn.pid) === conn) {
        conns.delete(conn.pid);
        room.setOnline(conn.pid, false);
      }
    });
  });
  // Lost the signalling server (not the players): reconnect so new people can still join.
  peer.on('disconnected', () => setTimeout(() => !peer.destroyed && peer.reconnect(), 2000));
  peer.on('error', (err) => console.warn('peer error', err.type));

  if (saved?.id && room.find(saved.id)) me = saved.id;
  else me = room.addPlayer(name).id;
  room.setOnline(me, true);

  net = {
    act: async (action) => room.act(me, action),
    close: () => {
      for (const conn of conns.values()) if (conn.open) conn.send({ t: 'gone' });
      setTimeout(() => peer.destroy(), 300);
    },
  };
  session = { code, id: me, host: true };
  saveSession();
  receive(room.viewFor(me));
}

function joinRoom(code, name, id) {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    const pending = new Map();
    let n = 0;
    let conn = null;
    let joined = false;
    let closed = false;

    const fail = (msg) => {
      if (joined) return;
      closed = true;
      peer.destroy();
      reject(new Error(msg));
    };
    const giveUp = setTimeout(() => fail('Couldn\'t reach that room. Check the code, and make sure the host still has Noggin open.'), 20000);
    const retry = (ms) => setTimeout(() => {
      if (closed) return;
      if (peer.disconnected) peer.reconnect();
      else connect();
    }, ms);

    function connect() {
      if (closed) return;
      const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      conn = c;
      c.on('open', () => c.send({ t: 'join', name, id }));
      c.on('data', (msg) => {
        if (msg.t === 'joined') {
          id = msg.id;
          setLinkDown(false);
          if (!joined) {
            joined = true;
            clearTimeout(giveUp);
            session = { code, id, host: false };
            saveSession();
            resolve();
          }
        } else if (msg.t === 'state') receive(msg.view);
        else if (msg.t === 'ack') {
          pending.get(msg.n)?.(msg.error);
          pending.delete(msg.n);
        } else if (msg.t === 'error') fail(msg.error);
        else if (msg.t === 'gone') {
          closed = true;
          peer.destroy();
          if (joined) {
            leave();
            toast('The room has ended, or you were removed.');
          } else reject(new Error('That room has ended.'));
        }
      });
      c.on('close', () => {
        if (closed || c !== conn) return;
        setLinkDown(true);
        retry(2000);
      });
    }

    peer.on('open', connect);
    peer.on('error', (err) => {
      // peer-unavailable: the host isn't there. Before joining that's a bad code;
      // after, the host is probably refreshing, so keep trying.
      if (err.type === 'peer-unavailable') {
        if (joined) {
          setLinkDown(true);
          retry(3000);
        } else fail('No room with that code. Check it and try again.');
      } else if (!joined && ['browser-incompatible', 'ssl-unavailable', 'server-error', 'socket-error', 'network'].includes(err.type)) {
        fail('Couldn\'t connect. Check your internet connection.');
      }
    });
    peer.on('disconnected', () => !closed && retry(2000));

    net = {
      act: (action) => {
        if (!conn?.open) return Promise.resolve('Not connected to the host right now.');
        const k = ++n;
        conn.send({ t: 'act', n: k, action });
        return new Promise((res) => pending.set(k, res));
      },
      close: () => {
        closed = true;
        peer.destroy();
      },
    };
  });
}

function leave() {
  net?.close();
  net = null;
  session = null;
  state = null;
  setLinkDown(false);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(ROOM_KEY);
  history.replaceState(null, '', location.pathname);
  screenKey = null;
  render();
}

// ---------- shared bits ----------

const me = () => state.players.find((p) => p.id === state.me);
const isHost = () => state.hostId === state.me;
const nameOf = (id) => state.players.find((p) => p.id === id)?.name ?? '???';
const now = () => Date.now() + clockOffset;

function cardView(card, cls = '') {
  if (!card) return h('div', { class: `card mystery ${cls}` }, h('div', { class: 'word' }, '❓'));
  const kids = [];
  if (card.img) {
    const img = h('img', { src: card.img, alt: card.text || 'Picture card', referrerpolicy: 'no-referrer' });
    img.onerror = () => img.replaceWith(h('div', { class: 'imgfail' }, 'Image didn\'t load: ', card.img));
    kids.push(img);
  }
  if (card.text) kids.push(h('div', { class: 'word' }, card.text));
  return h('div', { class: `card ${cls}` }, kids);
}

function topbar(extra) {
  return h('div', { class: 'topbar' },
    h('span', {}, `Room ${state.code}`, extra ? ` · ${extra}` : ''),
    h('span', { class: 'row' },
      isHost() && !['lobby', 'final'].includes(state.phase)
        ? h('button', { class: 'tiny-link', onclick: () => confirm('End the game for everyone?') && act({ type: 'endGame' }) }, 'End game')
        : null,
      h('button', {
        class: 'tiny-link',
        onclick: () => confirm(session.host ? 'You\'re the host: leaving ends the room for everyone. Leave?' : 'Leave this room?') && leave(),
      }, 'Leave')));
}

function scoreList(highlight = true) {
  const sorted = state.players.slice().sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score;
  return h('ol', { class: 'scores' }, sorted.map((p) =>
    h('li', { class: highlight && p.score === top && top > 0 ? 'first' : '' },
      p.id === state.me ? `${p.name} (you)` : p.name,
      p.online ? null : h('span', { class: 'badge' }, 'offline'),
      h('span', { class: 'pts' }, p.score))));
}

function roundLabel() {
  return `Round ${state.round} of ${state.settings.rounds}`;
}

// ---------- home ----------

function renderHome() {
  const params = new URLSearchParams(location.search);
  const roomFromUrl = (params.get('room') || '').toUpperCase();
  show(`home:${roomFromUrl}`, () => {
    const name = h('input', {
      placeholder: 'Your name',
      maxlength: 20,
      value: localStorage.getItem('noggin-name') || '',
      autocomplete: 'off',
    });
    const code = h('input', { class: 'code', placeholder: 'CODE', maxlength: 4, value: roomFromUrl, autocomplete: 'off' });
    const joinBtn = h('button', {}, 'Join');
    const busy = (fn) => async (e) => {
      const btn = e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : joinBtn;
      if (!name.value.trim()) {
        name.focus();
        return toast('Enter your name first.');
      }
      localStorage.setItem('noggin-name', name.value.trim());
      btn.disabled = true;
      try {
        await fn();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    };
    const join = busy(async () => {
      if (code.value.trim().length < 4) throw new Error('Enter the 4-letter room code.');
      await joinRoom(code.value.trim().toUpperCase(), name.value.trim());
    });
    const create = busy(async () => {
      try {
        await hostRoom(name.value.trim());
      } catch {
        throw new Error('Couldn\'t create a room. Check your internet connection.');
      }
    });
    joinBtn.addEventListener('click', join);
    code.addEventListener('keydown', (e) => e.key === 'Enter' && join());

    setTimeout(() => (name.value ? (roomFromUrl ? null : code) : name)?.focus(), 50);
    return [
      h('div', { class: 'logo' },
        h('span', { class: 'face' }, '🤔'),
        h('h1', {}, 'Nog', h('span', {}, 'gin')),
        h('p', { class: 'muted' }, 'The guess-what\'s-on-your-forehead party game')),
      h('div', { class: 'panel' }, h('h3', {}, 'Your name'), name),
      h('div', { class: 'panel' },
        h('h3', {}, 'Join a room'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, code), joinBtn),
        roomFromUrl ? null : [
          h('p', { class: 'center muted' }, '— or —'),
          h('button', { class: 'blue wide', onclick: create }, 'Create a new room'),
        ]),
    ];
  });
}

// ---------- lobby ----------

function joinPanel() {
  const link = `${location.origin}${location.pathname}?room=${state.code}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Join my Noggin game', url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast('Link copied!');
      }
    } catch {}
  };
  return h('div', { class: 'joinurl muted' },
    'Friends open ', h('b', {}, link), h('br'),
    h('button', { class: 'secondary small', onclick: share }, navigator.share ? 'Share link' : 'Copy link'));
}

function renderLobby() {
  show('lobby', () => [
    topbar(),
    h('div', { class: 'panel' },
      h('h3', { class: 'center' }, 'Room code'),
      h('div', { class: 'roomcode' }, state.code),
      joinPanel()),
    h('div', { class: 'panel' }, h('h3', { id: 'player-count' }), h('div', { class: 'players', id: 'players' })),
    h('div', { id: 'settings' }),
    h('div', { id: 'start' }),
  ]);

  document.getElementById('player-count').textContent = `Players (${state.players.length})`;
  document.getElementById('players').replaceChildren(...state.players.map((p) =>
    h('span', { class: `chip ${p.id === state.me ? 'me' : ''} ${p.online ? '' : 'off'}` },
      p.id === state.hostId ? '👑' : '🙂', p.name,
      isHost() && p.id !== state.me
        ? h('button', { class: 'x', title: 'Remove', onclick: () => confirm(`Remove ${p.name}?`) && act({ type: 'kick', target: p.id }) }, '✕')
        : null)));

  // Don't rebuild the host's form while they're typing in it.
  const settingsEl = document.getElementById('settings');
  if (!(isHost() && settingsEl.contains(document.activeElement))) {
    settingsEl.replaceChildren(isHost() ? settingsForm() : settingsSummary());
  }

  const canStart = state.players.length >= 2;
  document.getElementById('start').replaceChildren(isHost()
    ? h('div', { class: 'stack' },
      h('button', { class: 'good huge wide', disabled: !canStart, onclick: () => { beep(660); act({ type: 'start' }); } }, 'Start game'),
      canStart ? null : h('p', { class: 'center muted' }, 'Waiting for at least one more player…'),
      h('p', { class: 'center muted' }, 'You\'re hosting: the game runs on this device, so keep this tab open and the screen on.'))
    : h('p', { class: 'center muted' }, `Waiting for ${nameOf(state.hostId)} to start…`));
}

function currentSettings() {
  return { ...state.settings, ...pendingSettings };
}

function changeSettings(patch, delay = 0) {
  Object.assign(pendingSettings, patch);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const sending = pendingSettings;
    await act({ type: 'settings', settings: sending });
    if (pendingSettings === sending) pendingSettings = {};
  }, delay);
  if (!delay) {
    screenKey = 'lobby';
    document.getElementById('settings').replaceChildren(settingsForm());
  }
}

function settingsForm() {
  const s = currentSettings();
  const toggleDeck = (key) => changeSettings({
    decks: s.decks.includes(key) ? s.decks.filter((k) => k !== key) : [...s.decks, key],
  });
  const deckGroup = (kind, title) => [
    h('h3', {}, title),
    h('div', { class: 'decks' }, info.decks.filter((d) => d.kind === kind).map((d) =>
      h('button', { class: `deck ${s.decks.includes(d.key) ? 'on' : ''}`, onclick: () => toggleDeck(d.key) },
        d.name, h('small', {}, `${d.count} cards`)))),
  ];
  const custom = h('textarea', {
    placeholder: 'One card per line. Examples:\nGandalf\nhttps://example.com/dragon.png\nMount Fuji | https://example.com/fuji.jpg',
    oninput: (e) => changeSettings({ custom: e.target.value }, 500),
  });
  custom.value = s.custom;
  const num = (key, label, min, max, step) => h('label', {}, label,
    h('input', {
      type: 'number', min, max, step, value: s[key], inputmode: 'numeric',
      onchange: (e) => changeSettings({ [key]: Number(e.target.value) }),
    }));

  return h('div', { class: 'stack' },
    h('div', { class: 'panel' },
      h('h3', {}, 'Game mode'),
      h('div', { class: 'modes' }, Object.entries(MODES).map(([key, m]) =>
        h('button', { class: `mode ${s.mode === key ? 'on' : ''}`, onclick: () => changeSettings({ mode: key }) },
          h('b', {}, m.name), h('small', {}, m.blurb))))),
    h('div', { class: 'panel' },
      deckGroup('names', 'Name decks'),
      deckGroup('pictures', 'Picture decks'),
      h('h3', {}, 'Custom cards'),
      h('p', { class: 'muted' }, 'Names, image URLs, or "Answer | image URL". Mixed in with any decks picked above.'),
      custom),
    h('div', { class: 'panel' },
      h('div', { class: 'nums' },
        s.mode === 'hotseat' ? num('seconds', 'Seconds per turn', 15, 300, 15) : null,
        num('rounds', s.mode === 'hotseat' ? 'Turns each' : 'Rounds', 1, 10, 1))));
}

function settingsSummary() {
  const s = state.settings;
  const decks = s.decks.map((k) => info.decks.find((d) => d.key === k)?.name).filter(Boolean);
  if (state.customCount) decks.push(`${state.customCount} custom cards`);
  return h('div', { class: 'panel' },
    h('h3', {}, 'Game'),
    h('p', {}, h('b', {}, MODES[s.mode].name), ' — ', MODES[s.mode].blurb),
    h('p', { class: 'muted' }, 'Decks: ', decks.join(', ') || 'none yet'),
    h('p', { class: 'muted' }, s.mode === 'hotseat'
      ? `${s.seconds}s turns · ${s.rounds} turn${s.rounds > 1 ? 's' : ''} each`
      : `${s.rounds} round${s.rounds > 1 ? 's' : ''}`));
}

// ---------- hot seat ----------

function renderReady() {
  const guesser = state.guesserId;
  const mine = guesser === state.me;
  const canControl = mine || isHost();
  show(`ready:${state.turnNumber}:${guesser}:${isHost()}`, () => [
    topbar(`Turn ${state.turnNumber} of ${state.totalTurns}`),
    h('div', { class: 'grow stack center', style: 'justify-content:center' },
      h('div', { style: 'font-size:4rem' }, mine ? '🫵' : '🗣️'),
      h('h1', {}, mine ? 'You\'re up!' : `${nameOf(guesser)} is guessing`),
      h('p', { class: 'muted' }, mine
        ? 'Everyone else will see the card. Listen to their clues and shout your guesses!'
        : 'You\'ll see the card. Give clues, but don\'t say the word!'),
      canControl ? h('button', { class: 'good huge wide', onclick: () => { beep(880); act({ type: 'begin' }); } },
        mine ? 'I\'m ready — go!' : `Start ${nameOf(guesser)}'s turn`) : null,
      canControl ? h('button', { class: 'tiny-link', onclick: () => act({ type: 'skipTurn' }) }, 'Skip this turn') : null),
    scoreList(),
  ]);
}

function answerButtons(huge) {
  const send = (type) => {
    if (type === 'correct') { beep(988, 150); buzz(40); } else { beep(220, 180, 'square'); buzz([20, 40, 20]); }
    app.classList.remove('flash-good', 'flash-bad');
    void app.offsetWidth;
    app.classList.add(type === 'correct' ? 'flash-good' : 'flash-bad');
    act({ type, seq: state.seq });
  };
  return h('div', { class: 'answer-buttons' },
    h('button', { class: `bad ${huge ? '' : 'huge'}`, onclick: () => send('pass') }, '✗ Pass'),
    h('button', { class: `good ${huge ? '' : 'huge'}`, onclick: () => send('correct') }, '✓ Got it'));
}

function renderTurn() {
  const mine = state.guesserId === state.me;
  const key = `turn:${state.seq}:${mine}`;
  show(key, () => [
    topbar(`${nameOf(state.guesserId)} · ${state.got} correct`),
    h('div', { class: 'bar' }, h('div', { id: 'bar' })),
    h('div', { class: 'timer', id: 'timer' }),
    mine
      ? h('div', { class: 'guesser-view' },
        h('div', { class: 'card mystery' }, h('div', { class: 'word' }, '🙈'), h('p', {}, 'No peeking — the others can see it')),
        answerButtons(true))
      : [
        h('p', { class: 'center muted' }, `Get ${nameOf(state.guesserId)} to say:`),
        cardView(state.card),
        answerButtons(false),
      ],
    mine || isHost()
      ? h('button', { class: 'tiny-link', onclick: () => act({ type: 'endTurn' }) }, 'End turn early')
      : null,
  ]);
  tick();
}

function tick() {
  if (state?.phase !== 'turn') return;
  const left = Math.max(0, state.endsAt - now());
  const secs = Math.ceil(left / 1000);
  const timer = document.getElementById('timer');
  const bar = document.getElementById('bar');
  if (timer) {
    timer.textContent = secs;
    timer.classList.toggle('hurry', secs <= 10);
  }
  if (bar) bar.style.width = `${(left / (state.settings.seconds * 1000)) * 100}%`;
  if (secs <= 5 && secs > 0 && secs !== lastBeepSecond) {
    lastBeepSecond = secs;
    beep(secs === 1 ? 520 : 440, 90);
  }
}
setInterval(tick, 100);

function renderSummary() {
  const mine = state.guesserId === state.me;
  const got = state.results.filter((r) => r.ok).length;
  const isLast = state.turnNumber >= state.totalTurns;
  show(`summary:${state.turnNumber}:${isHost()}`, () => {
    beep(330, 400, 'triangle');
    return [
      topbar(`Turn ${state.turnNumber} of ${state.totalTurns}`),
      h('div', { class: 'center stack' },
        h('h3', {}, 'Time!'),
        h('h1', {}, `${mine ? 'You' : nameOf(state.guesserId)} got ${got}`)),
      h('ul', { class: 'results' }, state.results.length
        ? state.results.map((r) => h('li', { class: r.ok ? 'ok' : 'no' },
          r.ok ? '✓' : '✗',
          r.card.img ? h('img', { src: r.card.img, referrerpolicy: 'no-referrer', alt: '' }) : null,
          r.card.text || '(picture)'))
        : h('li', {}, 'No cards this turn.')),
      mine || isHost()
        ? h('button', { class: 'huge wide', onclick: () => act({ type: 'nextTurn' }) }, isLast ? 'Final scores' : 'Next player')
        : h('p', { class: 'center muted' }, 'Waiting for the next turn…'),
      h('h3', {}, 'Scores'),
      scoreList(),
    ];
  });
}

// ---------- mystery guest ----------

function renderMystery() {
  // Keyed on everything that changes the layout; the screen is cheap to rebuild.
  const key = `mystery:${JSON.stringify([state.hands, state.askerId, state.players, state.hostId])}`;
  show(key, () => {
    const myHand = state.hands[state.me];
    return [
      topbar(roundLabel()),
      h('div', { class: 'panel center' },
        h('h2', {}, state.askerId === state.me ? '🎤 Your turn to ask!' : `🎤 ${nameOf(state.askerId)} is asking`),
        h('p', { class: 'muted' }, 'Ask one yes/no question about your card. When someone says their answer, tap ✓ on their card.'),
        h('button', { class: 'secondary small', onclick: () => act({ type: 'nextAsker' }) }, 'Next person ➜')),
      h('div', { class: 'tiles' }, state.players.map((p) => {
        const hand = state.hands[p.id];
        if (!hand) return null;
        const isMe = p.id === state.me;
        const done = hand.status !== 'guessing';
        return h('div', { class: `tile ${p.id === state.askerId ? 'asking' : ''} ${done ? 'done' : ''}` },
          h('div', { class: 'who' }, isMe ? 'You' : p.name,
            hand.status === 'solved' ? h('span', { class: 'badge good' }, `+${hand.points}`)
              : hand.status === 'gaveup' ? h('span', { class: 'badge bad' }, 'gave up')
                : p.online ? null : h('span', { class: 'badge' }, 'offline')),
          cardView(hand.card, 'small'),
          !done && !isMe ? h('button', { class: 'good small', onclick: () => { beep(988); buzz(40); act({ type: 'confirm', target: p.id }); } }, '✓ They got it') : null,
          !done && !isMe && isHost() ? h('button', { class: 'tiny-link', onclick: () => confirm(`Mark ${p.name} as giving up?`) && act({ type: 'giveUp', target: p.id }) }, 'give up for them') : null,
          !done && isMe ? h('button', { class: 'secondary small', onclick: () => confirm('Give up and see your card?') && act({ type: 'giveUp' }) }, 'Give up') : null);
      })),
      myHand?.status === 'solved' ? h('p', { class: 'center' }, `🎉 You got it! +${myHand.points}. Keep helping the others.`) : null,
      h('h3', {}, 'Scores'),
      scoreList(),
    ];
  });
}

function renderReveal() {
  const last = state.round >= state.settings.rounds;
  show(`reveal:${state.round}:${isHost()}:${state.players.length}`, () => {
    beep(523, 150); setTimeout(() => beep(659, 150), 150); setTimeout(() => beep(784, 250), 300);
    return [
      topbar(roundLabel()),
      h('h1', { class: 'center' }, 'Round over!'),
      h('div', { class: 'tiles' }, state.players.map((p) => {
        const hand = state.hands[p.id];
        if (!hand) return null;
        return h('div', { class: 'tile' },
          h('div', { class: 'who' }, p.id === state.me ? 'You' : p.name,
            hand.status === 'solved' ? h('span', { class: 'badge good' }, `+${hand.points}`) : h('span', { class: 'badge bad' }, '+0')),
          cardView(hand.card, 'small'));
      })),
      isHost()
        ? h('button', { class: 'huge wide', onclick: () => act({ type: 'nextRound' }) }, last ? 'Final scores' : 'Next round')
        : h('p', { class: 'center muted' }, 'Waiting for the host…'),
      h('h3', {}, 'Scores'),
      scoreList(),
    ];
  });
}

// ---------- final ----------

function renderFinal() {
  show(`final:${isHost()}`, () => {
    const sorted = state.players.slice().sort((a, b) => b.score - a.score);
    const top = sorted[0]?.score ?? 0;
    const winners = sorted.filter((p) => p.score === top).map((p) => (p.id === state.me ? 'You' : p.name));
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 180), i * 140));
    return [
      topbar(),
      h('div', { class: 'center stack', style: 'margin-top:4vh' },
        h('div', { style: 'font-size:4.5rem' }, '🏆'),
        h('h3', {}, winners.length > 1 ? 'It\'s a tie!' : 'Winner'),
        h('h1', {}, winners.join(' & '))),
      scoreList(),
      isHost()
        ? h('button', { class: 'good huge wide', onclick: () => act({ type: 'lobby' }) }, 'Play again')
        : h('p', { class: 'center muted' }, 'The host can start another game.'),
    ];
  });
}

// ---------- router ----------

const SCREENS = {
  lobby: renderLobby,
  ready: renderReady,
  turn: renderTurn,
  summary: renderSummary,
  mystery: renderMystery,
  reveal: renderReveal,
  final: renderFinal,
};

function render() {
  if (!session) return renderHome();
  if (!state) return show('connecting', () => h('p', { class: 'center muted', style: 'margin-top:30vh' }, 'Connecting…'));
  if (state.phase !== 'lobby') pendingSettings = {};
  if (state.phase !== 'turn') lastBeepSecond = null;
  SCREENS[state.phase]?.();
}

// Keep phones awake while playing (only works on https or localhost; harmless otherwise).
async function stayAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && stayAwake());
document.addEventListener('click', stayAwake, { once: true });

(async function boot() {
  const urlRoom = new URLSearchParams(location.search).get('room')?.toUpperCase();
  if (session && urlRoom && urlRoom !== session.code) session = null; // following a link to a different room
  render();
  if (!session) return;
  try {
    if (session.host) {
      const room = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null');
      if (!room) throw new Error('That room has ended.');
      await hostRoom(null, { code: session.code, id: session.id, room });
    } else {
      await joinRoom(session.code, null, session.id);
    }
  } catch (err) {
    leave();
    toast(err.message || 'Couldn\'t get back into that room.');
  }
})();
