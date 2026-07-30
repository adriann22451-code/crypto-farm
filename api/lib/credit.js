import { redis } from './redis.js';

const STATE_KEY = 'kebun-kripto-state-v5';

function stateRedisKey(uid) {
  return `user:${uid}:${STATE_KEY}`;
}

// Credits coins onto a player's saved state and appends a transaction entry,
// directly in Redis — used by the payment webhook, which is the only place
// that should be trusted to grant coins for a real Stars payment.
export async function creditCoins(uid, amount, txTitle) {
  const key = stateRedisKey(uid);
  const raw = await redis.get(key);
  let state;
  try {
    state = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
  } catch (e) {
    state = {};
  }
  state.coins = (state.coins || 0) + amount;
  state.tx = [
    { icon: '⭐', title: txTitle, value: `+${amount}`, dir: 'in', time: 'Just now' },
    ...(state.tx || []),
  ].slice(0, 20);
  await redis.set(key, JSON.stringify(state));
  return state;
}

// Idempotency guard: Telegram can redeliver webhook updates, so we track
// which payment charge ids have already been credited.
export async function alreadyProcessed(chargeId) {
  const seen = await redis.get(`processed_payment:${chargeId}`);
  return !!seen;
}
export async function markProcessed(chargeId) {
  // 30 day expiry is plenty — Telegram won't redeliver older than that.
  await redis.set(`processed_payment:${chargeId}`, '1', { ex: 60 * 60 * 24 * 30 });
}
