import { redis } from './lib/redis.js';
import { TON_PACKAGES, tonToNano } from './lib/tonPackages.js';

function genOrderId() {
  return 'ord' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  try {
    const { uid, packageKey } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const pkg = TON_PACKAGES[packageKey];
    if (!pkg) return res.status(400).json({ error: 'unknown packageKey' });

    const toAddress = process.env.TON_RECEIVE_ADDRESS;
    if (!toAddress) return res.status(500).json({ error: 'TON_RECEIVE_ADDRESS not configured' });

    const orderId = genOrderId();
    const amountNano = tonToNano(pkg.ton);

    await redis.set(
      `ton_order:${orderId}`,
      JSON.stringify({ uid, coins: pkg.coins, amountNano, createdAt: Date.now(), processed: false }),
      { ex: 60 * 30 } // orders expire after 30 minutes if never paid
    );

    return res.status(200).json({ orderId, toAddress, amountNano, comment: orderId, coins: pkg.coins, ton: pkg.ton });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
