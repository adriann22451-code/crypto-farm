import { redis } from './lib/redis.js';
import { verifyInitData } from './lib/verifyTelegram.js';

// Key scheme:
//   personal (shared=false): user:{uid}:{key}
//   shared   (shared=true):  shared:{key}
// For shared keys under a prefix (e.g. "leaderboard:"), we also maintain an
// index SET at sharedidx:{prefix} so `list` can find them — Redis has no
// native "list keys by prefix" over its REST API, so we track it ourselves.

function personalKey(uid, key) {
  return `user:${uid}:${key}`;
}
function sharedKey(key) {
  return `shared:${key}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'use POST' });
  }
  try {
    const { action, key, value, shared, prefix, initData } = req.body || {};
    let { uid } = req.body || {};

    // If a bot token is configured, verify initData and trust ONLY the
    // verified Telegram user id — this stops anyone from spoofing another
    // player's uid to read/write their coins or leaderboard entry.
    // Without BOT_TOKEN set, the client-supplied uid is trusted as-is
    // (fine for local dev, not recommended once this is live for real users).
    const botToken = process.env.BOT_TOKEN;
    if (botToken && initData) {
      const verifiedUser = verifyInitData(initData, botToken);
      if (verifiedUser?.id) uid = String(verifiedUser.id);
    }

    if (!uid && action !== 'list') {
      return res.status(400).json({ error: 'uid required' });
    }

    if (action === 'get') {
      if (!key) return res.status(400).json({ error: 'key required' });
      const redisKey = shared ? sharedKey(key) : personalKey(uid, key);
      const val = await redis.get(redisKey);
      if (val === null || val === undefined) return res.status(200).json(null);
      const strValue = typeof val === 'string' ? val : JSON.stringify(val);
      return res.status(200).json({ key, value: strValue, shared: !!shared });
    }

    if (action === 'set') {
      if (!key) return res.status(400).json({ error: 'key required' });
      const redisKey = shared ? sharedKey(key) : personalKey(uid, key);
      await redis.set(redisKey, value);
      if (shared && prefix) {
        await redis.sadd(`sharedidx:${prefix}`, key);
      }
      return res.status(200).json({ key, value, shared: !!shared });
    }

    if (action === 'delete') {
      if (!key) return res.status(400).json({ error: 'key required' });
      const redisKey = shared ? sharedKey(key) : personalKey(uid, key);
      await redis.del(redisKey);
      return res.status(200).json({ key, deleted: true, shared: !!shared });
    }

    if (action === 'list') {
      if (!shared) {
        return res.status(400).json({ error: 'list is only supported for shared keys in this demo backend' });
      }
      const members = (await redis.smembers(`sharedidx:${prefix || ''}`)) || [];
      return res.status(200).json({ keys: members, prefix: prefix || '', shared: true });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
