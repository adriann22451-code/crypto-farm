import { redis } from './lib/redis.js';
import { sendMessage } from './lib/telegramApi.js';
import { resolveDuePredictions } from './lib/gameData.js';

const STATE_KEY = 'kebun-kripto-state-v3';

function stateRedisKey(uid) {
  return `user:${uid}:${STATE_KEY}`;
}

// Runs on a schedule (Vercel Cron, or an external pinger — see README) and
// resolves any prediction whose timeframe has closed, EVEN IF the player
// never reopens the app, so they get notified in the chat instead of the
// result silently sitting there until their next visit.
export default async function handler(req, res) {
  // Accept either Vercel Cron's own auth header, or a manual secret query
  // param (for external pingers like cron-job.org that can't set headers
  // the same way). Either is fine as long as ONE of them matches.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  const querySecret = req.query?.secret;
  const authorized =
    !cronSecret || authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
  if (!authorized) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const uids = (await redis.smembers('idx:allUsers')) || [];
    const now = Date.now();
    let checked = 0;
    let resolvedCount = 0;
    let notified = 0;

    for (const uid of uids) {
      checked++;
      const key = stateRedisKey(uid);
      const raw = await redis.get(key);
      if (!raw) continue;
      let state;
      try {
        state = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        continue;
      }
      if (!state.predictions || state.predictions.length === 0) continue;

      const { state: nextState, resolvedLines, leveledUp, newLevel, newAchievements } = resolveDuePredictions(state, now);
      if (resolvedLines.length === 0) continue;

      await redis.set(key, JSON.stringify(nextState));
      resolvedCount += resolvedLines.length;

      const lines = ['🌾 <b>Your predictions just resolved:</b>', '', ...resolvedLines];
      if (leveledUp) lines.push('', `🎉 Leveled up to Level ${newLevel}! New farm slot unlocked.`);
      if (newAchievements.length > 0) {
        lines.push('', ...newAchievements.map((a) => `🏆 Achievement unlocked: ${a.name}! +${a.reward} gems`));
      }
      lines.push('', 'Open Crypto Farm to keep playing 🌱');

      try {
        await sendMessage(uid, lines.join('\n'));
        notified++;
      } catch (e) {
        console.error(`failed to notify ${uid}:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, checked, resolvedCount, notified });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
