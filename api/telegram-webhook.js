import { answerPreCheckoutQuery, sendMessage } from './lib/telegramApi.js';
import { creditCoins, alreadyProcessed, markProcessed } from './lib/credit.js';
import { redis } from './lib/redis.js';
import { getLevelInfo } from './lib/gameData.js';

const STATE_KEY = 'kebun-kripto-state-v5';
const MINI_APP_URL = process.env.MINI_APP_URL; // e.g. https://your-app.vercel.app

function openAppButton(label = '🌱 Open Crypto Farm') {
  if (!MINI_APP_URL) return undefined;
  return { inline_keyboard: [[{ text: label, web_app: { url: MINI_APP_URL } }]] };
}

async function handleStart(chatId) {
  const text = [
    '🌱 <b>Welcome to Crypto Farm!</b>',
    '',
    'Plant crypto-themed crops, let them grow, and harvest for coins — every',
    'harvest pays out, no guessing or risk involved. Level up to unlock more',
    'farm plots, and watch for High Demand events for bonus rewards.',
    '',
    'Tap the button below to start playing.',
  ].join('\n');
  await sendMessage(chatId, text, openAppButton());
}

async function handleBalance(chatId, uid) {
  const raw = await redis.get(`user:${uid}:${STATE_KEY}`);
  if (!raw) {
    await sendMessage(chatId, "You haven't started farming yet — tap below to jump in!", openAppButton());
    return;
  }
  let state;
  try {
    state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    await sendMessage(chatId, "Couldn't read your data right now, try again in a bit.");
    return;
  }
  const level = getLevelInfo(state.xp || 0).level;
  const growing = (state.plots || []).filter((p) => p.cropId).length;
  const text = [
    '📊 <b>Your Crypto Farm balance</b>',
    '',
    `◆ Coins: <b>${(state.coins || 0).toLocaleString('en-US')}</b>`,
    `✦ Gems: <b>${state.gems || 0}</b>`,
    `Level: <b>${level}</b>`,
    growing > 0 ? `Crops growing: <b>${growing}</b>` : null,
  ]
    .filter(Boolean)
    .join('\n');
  await sendMessage(chatId, text, openAppButton());
}

// Telegram sends every bot update here (payments + text commands). Register
// this URL with setWebhook — see README for the exact command. If
// WEBHOOK_SECRET is set, Telegram includes it in a header on every request
// so we can verify the request really came from Telegram.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok'); // Telegram just needs 200s

  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (expectedSecret) {
    const gotSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (gotSecret !== expectedSecret) {
      return res.status(401).json({ error: 'bad secret token' });
    }
  }

  const update = req.body || {};

  try {
    // Step 1: Telegram asks "is this order still valid?" — we have ~10
    // seconds to answer, or the payment is auto-cancelled.
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const validPayload = typeof q.invoice_payload === 'string' && q.invoice_payload.startsWith('topup:');
      await answerPreCheckoutQuery(q.id, validPayload, validPayload ? undefined : 'Invalid order, please try again.');
      return res.status(200).json({ ok: true });
    }

    // Step 2: payment actually completed — this is the ONLY place coins
    // should be granted for a real purchase.
    const successfulPayment = update.message?.successful_payment;
    if (successfulPayment) {
      const chargeId = successfulPayment.telegram_payment_charge_id;
      if (await alreadyProcessed(chargeId)) {
        return res.status(200).json({ ok: true, note: 'already processed' });
      }

      const [, uid, coinsStr] = successfulPayment.invoice_payload.split(':');
      const coins = parseInt(coinsStr, 10);
      if (uid && Number.isFinite(coins) && coins > 0) {
        await creditCoins(uid, coins, `Top up ${coins} coins (${successfulPayment.total_amount} ⭐)`);
        await markProcessed(chargeId);
      }
      return res.status(200).json({ ok: true });
    }

    // Step 3: plain text commands like /start and /balance.
    const message = update.message;
    if (message?.text && message.chat?.id && message.from?.id) {
      const text = message.text.trim();
      const chatId = message.chat.id;
      const uid = String(message.from.id);

      if (text === '/start' || text.startsWith('/start ')) {
        await handleStart(chatId);
        return res.status(200).json({ ok: true });
      }
      if (text === '/balance') {
        await handleBalance(chatId, uid);
        return res.status(200).json({ ok: true });
      }
      if (text === '/help') {
        await sendMessage(
          chatId,
          ['<b>Commands</b>', '/start — welcome message + open the app', '/balance — check your coins, gems, and level without opening the app'].join('\n'),
          openAppButton()
        );
        return res.status(200).json({ ok: true });
      }
    }

    // Anything else, just acknowledge so Telegram stops retrying.
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    // Still return 200 for non-payment errors so Telegram doesn't hammer
    // retries indefinitely; payment-path errors are logged for follow-up.
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}

