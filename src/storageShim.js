// Drop-in replacement for the window.storage API the game code expects
// (get/set/delete/list with a `shared` flag), backed by real HTTP calls to
// our own Vercel serverless function, which reads/writes Upstash Redis.
//
// This must be imported and finish setting `window.storage` BEFORE the game
// component mounts, since it reads window.storage inside a useEffect on load.

function getUid() {
  return window.__TG_USER__?.id ? String(window.__TG_USER__.id) : window.__ANON_ID__ || 'anon';
}

async function call(body) {
  const res = await fetch('/api/kv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, uid: getUid(), initData: window.__TG_INIT_DATA__ || '' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`storage request failed: ${res.status} ${text}`);
  }
  return res.json();
}

window.storage = {
  async get(key, shared = false) {
    return call({ action: 'get', key, shared }); // null, or { key, value, shared }
  },

  async set(key, value, shared = false) {
    const prefix = key.includes(':') ? key.split(':')[0] + ':' : null;
    return call({ action: 'set', key, value, shared, prefix });
  },

  async delete(key, shared = false) {
    return call({ action: 'delete', key, shared });
  },

  async list(prefix, shared = false) {
    return call({ action: 'list', prefix: prefix || '', shared });
  },
};
