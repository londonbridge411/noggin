// Noggin's only server endpoint. Every request is POST /api/room with { op, ... }:
//   create { name }                        -> { code, id, key, view, v, sig }
//   join   { code, name } or { code, id, key } (rejoin)
//   act    { code, id, key, action }       -> { error, view, v, sig }
//   poll   { code, id, key, v, sig }       -> { same: true } or { view, v, sig }
// Any of them can answer { gone: true }: the room ended or the player was removed.
//
// Rooms live in Upstash Redis (add it from the Vercel dashboard's Storage tab):
//   noggin:CODE:room  the Room as JSON
//   noggin:CODE:ver   a counter bumped on every save, so phones can skip unchanged polls
//   noggin:CODE:seen  hash of playerId -> last poll time, for the online/offline badges

import { Room, newCode } from '../lib/game.js';
import { BUILD } from '../lib/build.js';

// Vercel's Upstash integration names these KV_REST_API_URL / KV_REST_API_TOKEN, or
// UPSTASH_REDIS_REST_URL / _TOKEN, sometimes with a custom prefix (STORAGE_KV_...).
const envEnding = (...suffixes) => {
  const name = Object.keys(process.env).find((k) => suffixes.some((s) => k.endsWith(s)));
  return name && process.env[name];
};
const REDIS_URL = envEnding('KV_REST_API_URL', 'REDIS_REST_URL');
const REDIS_TOKEN = envEnding('KV_REST_API_TOKEN', 'REDIS_REST_TOKEN');

const TTL = 6 * 60 * 60; // idle rooms disappear after 6 hours
const ONLINE_WINDOW = 8000; // ms since a player's last poll before they show as offline
const MAX_PLAYERS = 30;

const keys = (code) => [`noggin:${code}:ver`, `noggin:${code}:room`, `noggin:${code}:seen`];

async function redis(...command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(command.map(String)),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result;
}

// Save only if nobody else saved since we loaded (expected '' = room must not exist yet).
// Returns the new version, or 0 if we lost the race.
const SAVE = `
local cur = redis.call('GET', KEYS[1]) or ''
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
local v = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return v`;

// Marks the player as seen and returns the room only if it, or who's online, changed.
const POLL = `
local ver = redis.call('GET', KEYS[1])
if not ver then return {'gone'} end
redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
for i = 1, 3 do redis.call('EXPIRE', KEYS[i], ARGV[5]) end
local seen = redis.call('HGETALL', KEYS[3])
local cutoff = tonumber(ARGV[2]) - tonumber(ARGV[6])
local on = {}
for i = 1, #seen, 2 do
  if tonumber(seen[i + 1]) >= cutoff then on[#on + 1] = seen[i] end
end
table.sort(on)
local sig = table.concat(on, ',')
if ver == ARGV[3] and sig == ARGV[4] then return {'same'} end
return {'room', ver, sig, redis.call('GET', KEYS[2])}`;

const save = (code, expected, room) => redis('EVAL', SAVE, 2, ...keys(code).slice(0, 2), expected, JSON.stringify(room), TTL);

async function poll(code, id, key, v, sig) {
  const [kind, ver, onlineSig, json] = await redis('EVAL', POLL, 3, ...keys(code), id, Date.now(), String(v ?? ''), String(sig ?? ''), TTL, ONLINE_WINDOW);
  if (kind === 'gone') return { gone: true };
  if (kind === 'same') return { same: true };
  const room = new Room(code, JSON.parse(json));
  const player = room.find(id);
  if (!player || player.key !== key) return { gone: true };
  return { view: room.viewFor(id, new Set(onlineSig ? onlineSig.split(',') : [])), v: Number(ver), sig: onlineSig };
}

// Load, change, save, retrying if two phones acted at the same moment.
// fn(room) returns the result to send back, or { gone: true }.
async function mutate(code, fn) {
  for (let tries = 0; tries < 10; tries++) {
    const [ver, json] = await redis('MGET', ...keys(code).slice(0, 2));
    if (!ver || !json) return { gone: true };
    const room = new Room(code, JSON.parse(json));
    const result = fn(room);
    if (result.gone) return result;
    if (!room.players.length) {
      await redis('DEL', ...keys(code));
      return { gone: true };
    }
    const after = JSON.stringify(room);
    if (after === json || (await save(code, ver, room))) return result;
  }
  throw new Error('Too many people acting at once.');
}

const validCode = (code) => (/^[A-Z]{4}$/.test(code) ? code : null);

const ops = {
  async create({ name }) {
    for (let tries = 0; tries < 10; tries++) {
      const code = newCode();
      const room = new Room(code);
      const p = room.addPlayer(name);
      if (await save(code, '', room)) return { code, id: p.id, key: p.key, ...(await poll(code, p.id, p.key)) };
    }
    throw new Error('Couldn\'t find a free room code.');
  },

  async join({ code, name, id, key }) {
    code = validCode(String(code || '').toUpperCase());
    if (!code) return { error: 'Enter the 4-letter room code.' };
    let player;
    const result = await mutate(code, (room) => {
      if (id) {
        player = room.find(id);
        return player && player.key === key ? {} : { gone: true };
      }
      if (room.players.length >= MAX_PLAYERS) return { error: 'Room is full.' };
      player = room.addPlayer(name);
      return {};
    });
    if (result.gone) return id ? result : { error: 'No room with that code. Check it and try again.' };
    if (result.error) return result;
    return { code, id: player.id, key: player.key, ...(await poll(code, player.id, player.key)) };
  },

  async act({ code, id, key, action }) {
    code = validCode(code);
    if (!code) return { gone: true };
    const result = await mutate(code, (room) => {
      const p = room.find(id);
      if (!p || p.key !== key) return { gone: true };
      return { error: room.act(id, action) };
    });
    if (result.gone || action?.type === 'leave') return { gone: true };
    return { ...result, ...(await poll(code, id, key)) };
  },

  poll({ code, id, key, v, sig }) {
    code = validCode(code);
    return code ? poll(code, String(id), key, v, sig) : { gone: true };
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Noggin-Build', BUILD); // phones on an older build reload (see app.js)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!REDIS_URL || !REDIS_TOKEN) {
    // Variable names only (never values), to help spot a naming mismatch.
    const seen = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/.test(k));
    return res.status(500).json({
      error: 'The server has no database yet. Connect Upstash Redis to this project in Vercel, then redeploy.',
      found: seen,
    });
  }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
  const op = ops[body.op];
  if (!op) return res.status(400).json({ error: 'Unknown request.' });
  try {
    res.status(200).json(await op(body));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
  }
}
