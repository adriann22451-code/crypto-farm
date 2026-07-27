import { createStarsInvoiceLink } from './lib/telegramApi.js';

// Coin packages priced in Telegram Stars. Adjust these to taste — Stars
// have no fixed real-world exchange rate you need to match, you're just
// picking what feels fair for the in-game economy.
export const STAR_PACKAGES = {
  small: { coins: 100, stars: 20, label: 'Small Pack' },
  medium: { coins: 300, stars: 50, label: 'Medium Pack' },
  large: { coins: 750, stars: 100, label: 'Large Pack' },
  jumbo: { coins: 2000, stars: 250, label: 'Jumbo Pack' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  try {
    const { uid, packageKey } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const pkg = STAR_PACKAGES[packageKey];
    if (!pkg) return res.status(400).json({ error: 'unknown packageKey' });

    // Payload is a plain string Telegram round-trips back to us in the
    // successful_payment update — this is how the webhook knows who to
    // credit and how much, without trusting anything the client claims.
    const payload = `topup:${uid}:${pkg.coins}:${Date.now()}`;

    const link = await createStarsInvoiceLink({
      title: `${pkg.label} — ${pkg.coins} coins`,
      description: `Top up ${pkg.coins} coins in Crypto Farm`,
      payload,
      amountStars: pkg.stars,
    });

    return res.status(200).json({ link });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
