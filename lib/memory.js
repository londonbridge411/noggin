// Rooms kept in this process's memory, for `npm run dev` without a database
// (scripts/dev.js turns it on). It does what the Redis scripts in api/room.js do.
// Not for Vercel: every function instance there has its own memory, so two phones
// could land on different instances and never see the same room.

export function memoryStore(ttl, onlineWindow) {
  const rooms = new Map(); // code -> { ver, json, seen: Map(playerId -> last poll time), expires }

  const get = (code) => {
    const r = rooms.get(code);
    if (r && r.expires <= Date.now()) rooms.delete(code);
    return rooms.get(code);
  };
  const touch = (r) => {
    r.expires = Date.now() + ttl * 1000;
  };

  return {
    async save(code, expected, json) {
      let r = get(code);
      if (String(r?.ver ?? '') !== expected) return 0;
      if (!r) rooms.set(code, (r = { ver: 0, seen: new Map() }));
      r.json = json;
      r.ver++;
      touch(r);
      return r.ver;
    },

    async poll(code, id, v, sig) {
      const r = get(code);
      if (!r) return ['gone'];
      const now = Date.now();
      r.seen.set(id, now);
      touch(r);
      const online = [...r.seen].filter(([, at]) => at >= now - onlineWindow).map(([pid]) => pid).sort().join(',');
      if (String(r.ver) === v && online === sig) return ['same'];
      return ['room', String(r.ver), online, r.json];
    },

    async load(code) {
      const r = get(code);
      return r ? [String(r.ver), r.json] : [null, null];
    },

    async drop(code) {
      rooms.delete(code);
    },
  };
}
