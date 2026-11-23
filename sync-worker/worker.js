// Dump sync server — a Cloudflare Worker.
//
// It only ever stores ENCRYPTED blobs. The app encrypts your notes with a key derived from
// your passphrase before sending them, so this server (and Cloudflare) can't read them.
// Your "sync space" is identified by a 64-hex-char id that is also derived from the passphrase.
//
// Storage: one Durable Object per sync space (binding `NOTES`). Durable Objects are strongly
// consistent, so two devices can never both save "version 5" — the second one gets a 409 and
// merges. If `NOTES` isn't bound (an older hand-pasted setup), it falls back to the KV binding
// `DUMP`, and data already in KV is copied into the Durable Object the first time it's read.
//
// API
//   GET  /v1/health   -> { ok, app: "dump-sync", v: 2 }
//   GET  /v1/note     -> { rev, data, updated } or 404            header: X-Dump-Id
//   PUT  /v1/note     -> body { baseRev, data } -> { rev, updated }
//                        409 { rev, data } if baseRev is not the latest (the app then merges and retries)
//   Anything else is the app itself (static assets), when deployed with the repo's wrangler.jsonc.

import { DurableObject } from 'cloudflare:workers';

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

/** One sync space. All reads and writes for it run here, one at a time, so they can't race. */
export class NoteBox extends DurableObject {
  async read(legacyKey) {
    let note = await this.ctx.storage.get('note');
    if (!note && legacyKey && this.env.DUMP) {
      const old = await this.env.DUMP.get(legacyKey, 'json');   // migrate from the KV setup
      if (old && typeof old.data === 'string') {
        note = { rev: old.rev, data: old.data, updated: old.updated || Date.now() };
        await this.ctx.storage.put('note', note);
      }
    }
    return note || null;
  }

  async write(legacyKey, baseRev, data) {
    const current = await this.read(legacyKey);
    const currentRev = current ? current.rev : 0;
    if (currentRev !== baseRev) return { conflict: true, ...(current || { rev: 0 }) };
    const next = { rev: currentRev + 1, data, updated: Date.now() };
    await this.ctx.storage.put('note', next);
    return next;
  }
}

// Fallback store for setups without the Durable Object binding.
const kvStore = env => ({
  async read(key) { return env.DUMP.get(key, 'json'); },
  async write(key, baseRev, data) {
    const current = await env.DUMP.get(key, 'json');
    const currentRev = current ? current.rev : 0;
    if (currentRev !== baseRev) return { conflict: true, ...(current || { rev: 0 }) };
    const next = { rev: currentRev + 1, data, updated: Date.now() };
    await env.DUMP.put(key, JSON.stringify(next));
    return next;
  },
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/v1/health') return json({ ok: true, app: 'dump-sync', v: 2 });
    // Deployed together with the app: everything that isn't the sync API is the app itself.
    if (!url.pathname.startsWith('/v1/') && env.ASSETS) return env.ASSETS.fetch(request);
    if (url.pathname === '/' || url.pathname === '') return json({ ok: true, app: 'dump-sync', v: 2 });
    if (url.pathname !== '/v1/note') return json({ error: 'not found' }, 404);

    const id = request.headers.get('X-Dump-Id') || '';
    if (!/^[a-f0-9]{64}$/.test(id)) return json({ error: 'bad id' }, 400);
    const key = 'note:' + id;

    let store;
    if (env.NOTES) {
      const stub = env.NOTES.get(env.NOTES.idFromName(id));
      store = { read: k => stub.read(k), write: (k, r, d) => stub.write(k, r, d) };
    } else if (env.DUMP) {
      store = kvStore(env);
    } else {
      return json({ error: 'No storage bound — see DEPLOY.md' }, 500);
    }

    if (request.method === 'GET') {
      const current = await store.read(key);
      return current ? json(current) : json({ error: 'empty' }, 404);
    }

    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!body || typeof body.data !== 'string' || body.data.length > 5_000_000 || !Number.isInteger(body.baseRev)) {
        return json({ error: 'bad body' }, 400);
      }
      const result = await store.write(key, body.baseRev, body.data);
      if (result.conflict) {
        const { conflict, ...current } = result;
        return json({ error: 'conflict', ...current }, 409);
      }
      return json({ rev: result.rev, updated: result.updated });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
