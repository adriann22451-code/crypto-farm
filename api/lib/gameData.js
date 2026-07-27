// Mirrors the pure (non-React) game logic from src/App.jsx so the server can
// resolve predictions and compute rewards identically to the client.
//
// IMPORTANT: if you change crop stats, timeframe multipliers, leverage,
// insurance, level curve, or achievements in src/App.jsx, mirror the same
// change here — this duplication is the trade-off for keeping the client a
// plain browser app while still letting the server resolve things while the
// Mini App is closed.

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noiseAt(assetSeed, bucketIndex) {
  return mulberry32((assetSeed ^ (bucketIndex * 2654435761)) >>> 0)();
}
const BUCKET_SEC = 6;
export function priceIndexAt(assetId, timeMs) {
  const seed = hashStr(assetId);
  const t = timeMs / 1000 / BUCKET_SEC;
  const i0 = Math.floor(t);
  const i1 = i0 + 1;
  const frac = t - i0;
  const s = frac * frac * (3 - 2 * frac);
  const n0 = noiseAt(seed, i0);
  const n1 = noiseAt(seed, i1);
  const base = n0 + (n1 - n0) * s;
  const drift = Math.sin(timeMs / 1000 / 90 + (seed % 100)) * 0.15;
  return base + drift;
}

export const CROPS = {
  gandum:   { id: 'gandum',   icon: '🌾', name: 'Glowing Wheat', asset: 'eth', baseValue: 70 },
  jagung:   { id: 'jagung',   icon: '🌽', name: 'Neon Corn', asset: 'ada', baseValue: 95 },
  stroberi: { id: 'stroberi', icon: '🍓', name: 'Flash Strawberry', asset: 'dot', baseValue: 115 },
  semangka: { id: 'semangka', icon: '🍉', name: 'Frozen Watermelon', asset: 'btc', baseValue: 140 },
  anggur:   { id: 'anggur',   icon: '🍇', name: 'Night Grapes', asset: 'sol', baseValue: 210 },
  nanas:    { id: 'nanas',    icon: '🍍', name: 'Prime Pineapple', asset: 'avax', baseValue: 220 },
  melon_emas:    { id: 'melon_emas',    icon: '🍈', name: 'Gold Melon', asset: 'btc', baseValue: 260 },
  kelapa_kilau:  { id: 'kelapa_kilau',  icon: '🥥', name: 'Shimmer Coconut', asset: 'eth', baseValue: 165 },
  markisa_petir: { id: 'markisa_petir', icon: '🫐', name: 'Thunder Passionfruit', asset: 'sol', baseValue: 195 },
  leci_neon:     { id: 'leci_neon',     icon: '🍒', name: 'Neon Lychee', asset: 'ada', baseValue: 130 },
  kurma_prisma:  { id: 'kurma_prisma',  icon: '🌰', name: 'Prism Date', asset: 'dot', baseValue: 175 },
};
export function getCrop(id) {
  return CROPS[id];
}

export const STREAK_BONUS_PER_LEVEL = 0.1;
export const STREAK_BONUS_CAP = 5;

export const LEVELS = [
  { level: 1, xp: 0, plots: 4 },
  { level: 2, xp: 150, plots: 5 },
  { level: 3, xp: 400, plots: 6 },
  { level: 4, xp: 750, plots: 7 },
  { level: 5, xp: 1200, plots: 8 },
  { level: 6, xp: 1800, plots: 9 },
];
function xpForLevel(level) {
  if (level <= 6) return LEVELS[level - 1].xp;
  return 1800 + (level - 6) * 700;
}
export function getLevelInfo(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level };
}

export const ACHIEVEMENTS = [
  { id: 'first_guess', name: 'First Harvest', reward: 2, check: (s) => s.totalPredictions >= 1 },
  { id: 'correct_10', name: 'Sharp Shooter', reward: 5, check: (s) => s.totalCorrect >= 10 },
  { id: 'correct_50', name: 'Eagle Eye', reward: 15, check: (s) => s.totalCorrect >= 50 },
  { id: 'streak_5', name: 'On Fire', reward: 10, check: (s) => s.bestStreak >= 5 },
  { id: 'streak_10', name: 'Unstoppable', reward: 25, check: (s) => s.bestStreak >= 10 },
  { id: 'event_hunter', name: 'Volatility Hunter', reward: 15, check: (s) => s.eventWins >= 5 },
  { id: 'earn_2000', name: 'Getting Rich', reward: 20, check: (s) => s.totalCoinsEarned >= 2000 },
  { id: 'earn_5000', name: 'Farm Sultan', reward: 30, check: (s) => s.totalCoinsEarned >= 5000 },
  { id: 'consistent_100', name: 'Consistent', reward: 40, check: (s) => s.totalPredictions >= 100 },
];

/**
 * Resolves every due (unresolved, past its resolveAt) prediction in a
 * player's state, mutating and returning a NEW state object plus a list of
 * plain-text result lines suitable for a Telegram message. Mirrors the
 * client's tick-effect resolution logic.
 */
export function resolveDuePredictions(state, now, graceMs = 20000) {
  const predictions = state.predictions || [];
  // Only touch predictions that are overdue by more than `graceMs` — if the
  // app happens to be open right at the exact resolve moment, this gives the
  // live client first chance to resolve it locally, reducing the odds of
  // both the client and this cron job racing to update the same prediction.
  const due = predictions.filter((p) => !p.resolved && now - p.resolveAt > graceMs);
  if (due.length === 0) return { state, resolvedLines: [], leveledUp: false, newAchievements: [] };

  let coins = state.coins || 0;
  let streak = state.streak || 0;
  let xp = state.xp || 0;
  const stats = {
    totalPredictions: 0,
    totalCorrect: 0,
    bestStreak: 0,
    totalCoinsEarned: 0,
    eventWins: 0,
    ...(state.stats || {}),
  };
  const prevLevel = getLevelInfo(xp).level;
  const newTx = [];
  const resolvedLines = [];
  const resultById = new Map();

  const orderedDue = [...due].sort((a, b) => a.resolveAt - b.resolveAt);
  orderedDue.forEach((p) => {
    const crop = getCrop(p.cropId);
    if (!crop) return; // unknown crop id, skip defensively
    const openIdx = priceIndexAt(crop.asset, p.lockedAt);
    const closeIdx = priceIndexAt(crop.asset, p.resolveAt);
    const actualUp = closeIdx >= openIdx;
    const correct = (p.direction === 'up') === actualUp;
    const mult = p.multiplier || 1.0;
    const eventMult = p.eventMultiplier || 1.0;
    const rewardMult = p.rewardMult || 1;
    const lossMult = p.lossMult != null ? p.lossMult : 0.1;

    let reward;
    let streakBonusPct = 0;
    if (correct) {
      streak += 1;
      streakBonusPct = Math.min(streak - 1, STREAK_BONUS_CAP) * STREAK_BONUS_PER_LEVEL;
      reward = Math.round(crop.baseValue * mult * eventMult * (1 + streakBonusPct) * rewardMult);
      xp += Math.round(12 * mult);
      stats.totalCorrect += 1;
      if (eventMult > 1) stats.eventWins += 1;
    } else {
      streak = 0;
      reward = Math.round(crop.baseValue * mult * eventMult * lossMult);
      xp += 3;
    }
    stats.totalPredictions += 1;
    stats.bestStreak = Math.max(stats.bestStreak, streak);
    stats.totalCoinsEarned += reward;
    coins += reward;

    const title = correct
      ? `Correct guess · ${crop.name} (${p.timeframeLabel})`
      : `Wrong guess · ${crop.name} (${p.timeframeLabel})`;
    newTx.push({ icon: correct ? '🎯' : crop.icon, title, value: `+${reward}`, dir: 'in', time: 'Just now' });
    resolvedLines.push(
      correct ? `✅ ${crop.icon} ${crop.name}: correct! +${reward} coins` : `❌ ${crop.icon} ${crop.name}: missed — +${reward} coins`
    );
    resultById.set(p.id, { correct, reward, actualUp });
  });

  const nextPredictions = predictions
    .map((p) => {
      const res = resultById.get(p.id);
      return res ? { ...p, resolved: true, ...res } : p;
    })
    .filter((p) => !p.resolved);

  const alreadyUnlocked = new Set(state.unlockedAchievements || []);
  const newAchievements = ACHIEVEMENTS.filter((a) => !alreadyUnlocked.has(a.id) && a.check(stats));
  let gems = state.gems || 0;
  newAchievements.forEach((a) => {
    gems += a.reward;
    alreadyUnlocked.add(a.id);
  });

  const newLevel = getLevelInfo(xp).level;

  const nextState = {
    ...state,
    coins,
    gems,
    streak,
    xp,
    stats,
    unlockedAchievements: Array.from(alreadyUnlocked),
    predictions: nextPredictions,
    tx: [...newTx, ...(state.tx || [])].slice(0, 20),
  };

  return {
    state: nextState,
    resolvedLines,
    leveledUp: newLevel > prevLevel,
    newLevel,
    newAchievements,
  };
}
