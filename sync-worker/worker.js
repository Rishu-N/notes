// Dump sync server — a Cloudflare Worker with one KV namespace bound as `DUMP`.
//
// It only ever stores ENCRYPTED blobs. The app encrypts your notes with a key derived from
// your passphrase before sending them, so this server (and Cloudflare) can't read them.
// Your "sync space" is identified by a 64-hex-char id that is also derived from the passphrase.
//
// API
//   GET  /            -> { ok, app: "dump-sync", v: 1 }           (health check)
//   GET  /v1/note     -> { rev, data, updated } or 404            header: X-Dump-Id
//   PUT  /v1/note     -> body { baseRev, data } -> { rev, updated }
//                        409 { rev, data } if baseRev is not the latest (the app then merges and retries)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Dump-Id',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') return json({ ok: true, app: 'dump-sync', v: 1 });
    if (url.pathname !== '/v1/note') return json({ error: 'not found' }, 404);
    if (!env.DUMP) return json({ error: 'KV binding "DUMP" is missing — add it under Settings → Bindings' }, 500);

    const id = request.headers.get('X-Dump-Id') || '';
    if (!/^[a-f0-9]{64}$/.test(id)) return json({ error: 'bad id' }, 400);
    const key = 'note:' + id;

    if (request.method === 'GET') {
      const current = await env.DUMP.get(key, 'json');
      return current ? json(current) : json({ error: 'empty' }, 404);
    }

    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!body || typeof body.data !== 'string' || body.data.length > 5_000_000 || !Number.isInteger(body.baseRev)) {
        return json({ error: 'bad body' }, 400);
      }
      const current = await env.DUMP.get(key, 'json');
      const currentRev = current ? current.rev : 0;
      if (currentRev !== body.baseRev) return json({ error: 'conflict', ...current }, 409);

      const next = { rev: currentRev + 1, data: body.data, updated: Date.now() };
      await env.DUMP.put(key, JSON.stringify(next));
      return json({ rev: next.rev, updated: next.updated });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
