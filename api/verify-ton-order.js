import { redis } from './lib/redis.js';
import { findIncomingTonPayment } from './lib/ton.js';

const STATE_KEY = 'kebun-kripto-state-v4';

function stateRedisKey(uid) {
  return `user:${uid}:${STATE_KEY}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const raw = await redis.get(`ton_order:${orderId}`);
    if (!raw) return res.status(200).json({ status: 'not_found' });
    const order = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (order.processed) {
      return res.status(200).json({ status: 'paid', coins: order.coins });
    }

    const toAddress = process.env.TON_RECEIVE_ADDRESS;
    const result = await findIncomingTonPayment(toAddress, orderId, order.amountNano);

    if (!result.found) {
      return res.status(200).json({ status: 'pending' });
    }

    // Credit coins directly in Redis — same pattern as the Stars webhook.
    const key = stateRedisKey(order.uid);
    const stateRaw = await redis.get(key);
    let state;
    try {
      state = stateRaw ? (typeof stateRaw === 'string' ? JSON.parse(stateRaw) : stateRaw) : {};
    } catch (e) {
      state = {};
    }
    state.coins = (state.coins || 0) + order.coins;
    state.tx = [
      { icon: '💎', title: `Top up ${order.coins} coins (TON payment)`, value: `+${order.coins}`, dir: 'in', time: 'Just now' },
      ...(state.tx || []),
    ].slice(0, 20);
    await redis.set(key, JSON.stringify(state));

    order.processed = true;
    await redis.set(`ton_order:${orderId}`, JSON.stringify(order), { ex: 60 * 60 * 24 }); // keep a day for audit/idempotency

    return res.status(200).json({ status: 'paid', coins: order.coins });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
