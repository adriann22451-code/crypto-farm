import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ================== Deterministic market simulation ==================
   Same function drives the ticker, every sparkline, AND prediction grading.
   Given an asset id and a timestamp, priceIndexAt() always returns the same
   value — so a prediction locked at time A and graded at time B is judged
   against a real, reproducible market path, not a fresh coin flip.
======================================================================= */
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
const BUCKET_SEC = 6; // resolution of the underlying random walk
function priceIndexAt(assetId, timeMs) {
  const seed = hashStr(assetId);
  const t = timeMs / 1000 / BUCKET_SEC;
  const i0 = Math.floor(t);
  const i1 = i0 + 1;
  const frac = t - i0;
  // smoothstep interpolation for a less jagged path
  const s = frac * frac * (3 - 2 * frac);
  const n0 = noiseAt(seed, i0);
  const n1 = noiseAt(seed, i1);
  const base = n0 + (n1 - n0) * s;
  // add a slower drift wave per-asset so trends persist longer than one bucket
  const drift = Math.sin(timeMs / 1000 / 90 + seed % 100) * 0.15;
  return base + drift; // roughly -0.15..1.15
}

/* In-game simulated price display. This is NOT a real market feed — it's the
   same priceIndexAt() engine mapped onto a realistic-looking base price per
   asset, purely so the ticker/market feel like they reference an actual
   number instead of just a bare percentage. */
const ASSET_BASE_PRICE = { btc: 68000, eth: 3400, sol: 145, ada: 0.62, dot: 6.8, avax: 28 };
const ASSET_VOLATILITY = { btc: 0.18, eth: 0.22, sol: 0.35, ada: 0.3, dot: 0.28, avax: 0.32 };
function getDisplayPrice(assetId, timeMs) {
  const idx = priceIndexAt(assetId, timeMs);
  const base = ASSET_BASE_PRICE[assetId] || 100;
  const vol = ASSET_VOLATILITY[assetId] || 0.2;
  return base * (1 + idx * vol);
}
function fmtPrice(price) {
  if (price >= 1000) return price.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

/* ---------------- Game data ---------------- */
/* Grow duration scales with seed price: pricier seeds = longer wait, so the
   cost of a seed is felt in time invested, not just currency spent.
   Fastest crop is floored at 1 minute so nothing feels instant. */
const CROPS = {
  gandum:   { id: 'gandum',   icon: '🌾', name: 'Gandum Cahaya', tier: 'ETH-tier', asset: 'eth', growSec: 60,  baseValue: 70,  seedCost: 40, seedCurrency: 'coins' },
  jagung:   { id: 'jagung',   icon: '🌽', name: 'Jagung Neon',   tier: 'ADA-tier', asset: 'ada', growSec: 95,  baseValue: 95,  seedCost: 55, seedCurrency: 'coins' },
  stroberi: { id: 'stroberi', icon: '🍓', name: 'Stroberi Kilat',tier: 'DOT-tier', asset: 'dot', growSec: 130, baseValue: 115, seedCost: 65, seedCurrency: 'coins' },
  semangka: { id: 'semangka', icon: '🍉', name: 'Semangka Beku', tier: 'BTC-tier', asset: 'btc', growSec: 180, baseValue: 140, seedCost: 80, seedCurrency: 'coins' },
  anggur:   { id: 'anggur',   icon: '🍇', name: 'Anggur Malam',  tier: 'SOL-tier', asset: 'sol', growSec: 310, baseValue: 210, seedCost: 120, seedCurrency: 'coins' },
  nanas:    { id: 'nanas',    icon: '🍍', name: 'Nanas Prima',   tier: 'AVAX-tier',asset: 'avax', growSec: 580, baseValue: 220, seedCost: 6, seedCurrency: 'gems' },
};

/* Seasonal crops: a rotating pool where only ONE is purchasable per real-world
   day (deterministic from the calendar date, so it's the same for everyone
   and genuinely rotates away at midnight). Definitions stay around permanently
   so a plant started while featured still resolves correctly after rotation
   moves on — only the "available to buy" gate is time-limited. Econ is
   noticeably better than regular crops to justify the FOMO. */
const SEASONAL_CROPS = {
  melon_emas:    { id: 'melon_emas',    icon: '🍈', name: 'Melon Emas',     tier: 'BTC-tier', asset: 'btc', growSec: 240, baseValue: 260, seedCost: 100, seedCurrency: 'coins', seasonal: true },
  kelapa_kilau:  { id: 'kelapa_kilau',  icon: '🥥', name: 'Kelapa Kilau',   tier: 'ETH-tier', asset: 'eth', growSec: 150, baseValue: 165, seedCost: 65,  seedCurrency: 'coins', seasonal: true },
  markisa_petir: { id: 'markisa_petir', icon: '🫐', name: 'Markisa Petir', tier: 'SOL-tier', asset: 'sol', growSec: 200, baseValue: 195, seedCost: 75,  seedCurrency: 'coins', seasonal: true },
  leci_neon:     { id: 'leci_neon',     icon: '🍒', name: 'Leci Neon',     tier: 'ADA-tier', asset: 'ada', growSec: 120, baseValue: 130, seedCost: 50,  seedCurrency: 'coins', seasonal: true },
  kurma_prisma:  { id: 'kurma_prisma',  icon: '🌰', name: 'Kurma Prisma',  tier: 'DOT-tier', asset: 'dot', growSec: 170, baseValue: 175, seedCost: 68,  seedCurrency: 'coins', seasonal: true },
};
const SEASONAL_ROTATION = Object.keys(SEASONAL_CROPS);
function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}
function getTodaysSeasonalCrop(now = Date.now()) {
  const d = new Date(now);
  const idx = dayOfYear(d) % SEASONAL_ROTATION.length;
  const crop = SEASONAL_CROPS[SEASONAL_ROTATION[idx]];
  const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
  return { crop, endOfDay };
}
function getCrop(id) {
  return CROPS[id] || SEASONAL_CROPS[id];
}


const TIMEFRAMES = [
  { key: '1m', label: '1 Menit', sec: 60, multiplier: 1.0 },
  { key: '3m', label: '3 Menit', sec: 180, multiplier: 1.3 },
  { key: '5m', label: '5 Menit', sec: 300, multiplier: 1.6 },
  { key: '15m', label: '15 Menit', sec: 900, multiplier: 2.5 },
];

/* Leverage: stake extra coins upfront for a bigger reward multiplier, at the
   cost of a much harsher downside if the guess is wrong. 1x is the default,
   free option with no upfront stake (same behavior as before leverage existed). */
const LEVERAGE_OPTIONS = [
  { key: '1x', label: '1×', stakePct: 0, rewardMult: 1, lossMult: 0.1, desc: 'Normal, tanpa taruhan tambahan' },
  { key: '2x', label: '2×', stakePct: 0.5, rewardMult: 2, lossMult: 0, desc: 'Taruhan 50% nilai dasar' },
  { key: '3x', label: '3×', stakePct: 1.0, rewardMult: 3, lossMult: 0, desc: 'Taruhan 100% nilai dasar' },
];

/* Insurance: pay a small non-refundable premium upfront (charged regardless of
   outcome, like real insurance) in exchange for a bigger guaranteed floor if
   the guess turns out wrong. Stacks on top of whatever leverage tier was
   picked — it only raises the loss-multiplier, capped so it never approaches
   the win payout. */
const INSURANCE_OPTIONS = [
  { key: 'none', label: 'Tanpa Asuransi', costPct: 0, lossBonus: 0, desc: 'Nggak ada perlindungan tambahan' },
  { key: 'basic', label: 'Dasar', costPct: 0.15, lossBonus: 0.2, desc: 'Premi 15% · +20% jaminan balik kalau meleset' },
  { key: 'premium', label: 'Premium', costPct: 0.3, lossBonus: 0.4, desc: 'Premi 30% · +40% jaminan balik kalau meleset' },
];

const PLOT_COUNT = 9;
const STORAGE_KEY = 'kebun-kripto-state-v3';
const PROFILE_KEY = 'kebun-kripto-profile';
function genPlayerId() {
  return 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
function genNickname(id) {
  return 'Petani#' + id.slice(-4).toUpperCase();
}

function emptyPlots() {
  return Array.from({ length: PLOT_COUNT }, (_, i) => ({ id: i, cropId: null, plantedAt: null }));
}
function defaultState() {
  return {
    coins: 480,
    gems: 12,
    plots: emptyPlots(),
    tx: [],
    predictions: [],
    streak: 0,
    xp: 0,
    marketEvents: [],
    stats: { totalPredictions: 0, totalCorrect: 0, bestStreak: 0, totalCoinsEarned: 0, eventWins: 0 },
    unlockedAchievements: [],
  };
}

const ACHIEVEMENTS = [
  { id: 'first_guess', icon: '🌱', name: 'Panen Pertama', desc: 'Selesaikan 1 tebakan', reward: 2, check: (s) => s.totalPredictions >= 1 },
  { id: 'correct_10', icon: '🎯', name: 'Penebak Jitu', desc: '10 tebakan benar', reward: 5, check: (s) => s.totalCorrect >= 10 },
  { id: 'correct_50', icon: '🏹', name: 'Mata Elang', desc: '50 tebakan benar', reward: 15, check: (s) => s.totalCorrect >= 50 },
  { id: 'streak_5', icon: '🔥', name: 'Lagi Panas', desc: 'Streak 5 tebakan benar beruntun', reward: 10, check: (s) => s.bestStreak >= 5 },
  { id: 'streak_10', icon: '💥', name: 'Tak Terhentikan', desc: 'Streak 10 tebakan benar beruntun', reward: 25, check: (s) => s.bestStreak >= 10 },
  { id: 'event_hunter', icon: '⚡', name: 'Pemburu Volatile', desc: 'Menang 5x saat event volatile aktif', reward: 15, check: (s) => s.eventWins >= 5 },
  { id: 'earn_2000', icon: '💰', name: 'Mulai Kaya', desc: 'Total penghasilan 2.000 koin', reward: 20, check: (s) => s.totalCoinsEarned >= 2000 },
  { id: 'earn_5000', icon: '👑', name: 'Sultan Kebun', desc: 'Total penghasilan 5.000 koin', reward: 30, check: (s) => s.totalCoinsEarned >= 5000 },
  { id: 'consistent_100', icon: '📈', name: 'Konsisten', desc: 'Selesaikan 100 tebakan', reward: 40, check: (s) => s.totalPredictions >= 100 },
];


const EVENT_ASSETS = ['btc', 'eth', 'sol', 'ada', 'dot', 'avax'];
const ASSET_TIER_NAMES = { btc: 'BTC-tier', eth: 'ETH-tier', sol: 'SOL-tier', ada: 'ADA-tier', dot: 'DOT-tier', avax: 'AVAX-tier' };
function getActiveEventForAsset(marketEvents, asset, now) {
  return (marketEvents || []).find((e) => e.asset === asset && now >= e.startAt && now < e.endAt) || null;
}

/* Level curve: cumulative XP needed to REACH each level, plus how many farm
   plots are unlocked at that level. Starts at 4 plots, unlocks the rest as
   you level up, capping at all 9 by level 6. Levels beyond 6 still grow XP
   for a sense of ongoing progress, with a bonus gem every level. */
const LEVELS = [
  { level: 1, xp: 0, plots: 4 },
  { level: 2, xp: 150, plots: 5 },
  { level: 3, xp: 400, plots: 6 },
  { level: 4, xp: 750, plots: 7 },
  { level: 5, xp: 1200, plots: 8 },
  { level: 6, xp: 1800, plots: 9 },
];
function xpForLevel(level) {
  if (level <= 6) return LEVELS[level - 1].xp;
  return 1800 + (level - 6) * 700; // keeps growing past max plot unlock
}
function getLevelInfo(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const currentFloor = xpForLevel(level);
  const nextCeil = xpForLevel(level + 1);
  const plots = level >= 6 ? 9 : LEVELS[level - 1].plots;
  return {
    level,
    plots,
    xpIntoLevel: xp - currentFloor,
    xpForNext: nextCeil - currentFloor,
    progressPct: Math.min(100, Math.round(((xp - currentFloor) / (nextCeil - currentFloor)) * 100)),
  };
}

const STREAK_BONUS_PER_LEVEL = 0.1; // +10% reward per consecutive correct guess
const STREAK_BONUS_CAP = 5; // caps at +50% (streak of 6+)

/* ---------------- Sparkline driven by the real price engine ---------------- */
function Sparkline({ assetId, now, windowSec = 90, height = '100%', opacity = 0.55, strokeWidth = 2.5, forceColor = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = (canvas.width = canvas.offsetWidth * 2);
    const h = (canvas.height = canvas.offsetHeight * 2);
    ctx.clearRect(0, 0, w, h);
    const points = 24;
    const values = [];
    for (let i = 0; i <= points; i++) {
      const t = now - windowSec * 1000 + (windowSec * 1000 * i) / points;
      values.push(priceIndexAt(assetId, t));
    }
    const min = Math.min(...values), max = Math.max(...values);
    const range = Math.max(0.05, max - min);
    const positive = values[values.length - 1] >= values[0];
    ctx.strokeStyle = forceColor || (positive ? 'rgba(74,255,176,0.55)' : 'rgba(255,107,92,0.45)');
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (w / points) * i;
      const norm = (v - min) / range;
      const y = h * 0.85 - norm * h * 0.7;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [assetId, now, windowSec, forceColor]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height, opacity }} />;
}

function fmtCountdown(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtGrowDuration(sec) {
  if (sec < 60) return `${sec}d`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}mnt` : `${m}mnt ${s}d`;
}

/* ---------------- Main App ---------------- */
function useCountUp(value, duration = 550) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;
    const startTime = performance.now();
    let raf;
    function tick(t) {
      const progress = Math.min(1, (t - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = end;
        setDisplay(end);
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

export default function KebunKripto() {
  const [state, setState] = useState(defaultState());
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState(null); // { playerId, nickname }
  const [claimedReferrals, setClaimedReferrals] = useState([]);
  const [screen, setScreen] = useState('kebun');
  const [now, setNow] = useState(Date.now());
  const animatedCoins = useCountUp(state.coins);
  const animatedGems = useCountUp(state.gems);
  const [sheetPlot, setSheetPlot] = useState(null);
  const [sheetTimeframe, setSheetTimeframe] = useState(null);
  const [sheetLeverage, setSheetLeverage] = useState(LEVERAGE_OPTIONS[0]);
  const [sheetInsurance, setSheetInsurance] = useState(INSURANCE_OPTIONS[0]);
  const [seedPickerPlot, setSeedPickerPlot] = useState(null);
  const [walletSheet, setWalletSheet] = useState(null); // null | 'topup' | 'exchange'
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage?.get(STORAGE_KEY, false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setState({ ...defaultState(), ...parsed });
        }
      } catch (e) {
        /* first run, no saved state */
      }
      try {
        // Identity comes from Telegram (set by main.jsx from initDataUnsafe.user),
        // not a locally generated random id — this way the leaderboard/referral
        // system is tied to the person's real Telegram account across devices.
        const tgUser = window.__TG_USER__ || null;
        const playerId = tgUser?.id ? String(tgUser.id) : genPlayerId();
        const nickname = tgUser?.username ? `@${tgUser.username}` : tgUser?.first_name || genNickname(playerId);

        const profRes = await window.storage?.get(PROFILE_KEY, false);
        if (profRes && profRes.value) {
          const parsedProf = JSON.parse(profRes.value);
          const mergedProfile = { ...parsedProf, playerId, nickname };
          setProfile(mergedProfile);
          setClaimedReferrals(parsedProf.claimedReferrals || []);
        } else {
          const newProfile = { playerId, nickname, claimedReferrals: [] };
          setProfile(newProfile);
          window.storage?.set(PROFILE_KEY, JSON.stringify(newProfile), false).catch(() => {});
        }
      } catch (e) {
        const playerId = genPlayerId();
        setProfile({ playerId, nickname: genNickname(playerId), claimedReferrals: [] });
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.storage?.set(STORAGE_KEY, JSON.stringify(state), false).catch(() => {});
  }, [state, loaded]);

  // sync this player's leaderboard entry to shared storage (visible to everyone using this artifact)
  useEffect(() => {
    if (!loaded || !profile) return;
    (async () => {
      let existingReferrals = 0;
      try {
        const existing = await window.storage?.get(`leaderboard:${profile.playerId}`, true);
        if (existing && existing.value) existingReferrals = JSON.parse(existing.value).referrals || 0;
      } catch (e) {
        /* no existing entry yet */
      }
      const level = getLevelInfo(state.xp || 0).level;
      const entry = {
        nickname: profile.nickname,
        coins: state.coins,
        xp: state.xp || 0,
        level,
        referrals: existingReferrals,
        updatedAt: Date.now(),
      };
      window.storage?.set(`leaderboard:${profile.playerId}`, JSON.stringify(entry), true).catch(() => {});
    })();
  }, [state.coins, state.xp, profile, loaded]);

  async function claimReferral(codeInput) {
    const code = (codeInput || '').trim();
    if (!code) return;
    if (!profile) return;
    if (code === profile.playerId) {
      showToast('✗ Nggak bisa pakai kode sendiri');
      return;
    }
    if (claimedReferrals.includes(code)) {
      showToast('✗ Kode ini udah pernah diklaim');
      return;
    }
    let referrerEntry = null;
    try {
      const res = await window.storage.get(`leaderboard:${code}`, true);
      if (res && res.value) referrerEntry = JSON.parse(res.value);
    } catch (e) {
      referrerEntry = null;
    }
    if (!referrerEntry) {
      showToast('✗ Kode referral nggak ditemukan');
      return;
    }
    setState((s) => ({
      ...s,
      gems: s.gems + 30,
      tx: [{ icon: '🎁', title: `Klaim kode referral ${code}`, value: '+30', dir: 'in', time: 'Baru saja' }, ...s.tx].slice(0, 20),
    }));
    const newClaimed = [...claimedReferrals, code];
    setClaimedReferrals(newClaimed);
    const newProfile = { ...profile, claimedReferrals: newClaimed };
    setProfile(newProfile);
    window.storage.set(PROFILE_KEY, JSON.stringify(newProfile), false).catch(() => {});
    try {
      referrerEntry.referrals = (referrerEntry.referrals || 0) + 1;
      window.storage.set(`leaderboard:${code}`, JSON.stringify(referrerEntry), true).catch(() => {});
    } catch (e) {
      /* best effort */
    }
    showToast('✓ Kode berhasil diklaim! +30 gem buat kamu');
  }

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // master clock: growth progress + prediction resolution
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const s = stateRef.current;

      // market events: expire old ones, occasionally spawn a new volatile event
      const activeEvents = (s.marketEvents || []).filter((e) => t < e.endAt);
      const busyAssets = new Set(activeEvents.map((e) => e.asset));
      const freeAssets = EVENT_ASSETS.filter((a) => !busyAssets.has(a));
      let spawned = null;
      if (freeAssets.length > 0 && Math.random() < 0.006) {
        const asset = freeAssets[Math.floor(Math.random() * freeAssets.length)];
        const duration = 60 + Math.floor(Math.random() * 60); // 60-120s
        const multiplier = 1.3 + Math.random() * 0.5; // 1.3x - 1.8x
        spawned = { asset, multiplier, startAt: t, endAt: t + duration * 1000 };
      }
      if (spawned || activeEvents.length !== (s.marketEvents || []).length) {
        const nextEvents = spawned ? [...activeEvents, spawned] : activeEvents;
        setState((prev) => ({ ...prev, marketEvents: nextEvents }));
        if (spawned) {
          showToast(`🔥 ${ASSET_TIER_NAMES[spawned.asset]} lagi Volatile! Reward ×${spawned.multiplier.toFixed(1)} selama ${Math.round((spawned.endAt - spawned.startAt) / 1000)}d`);
        }
      }

      const due = s.predictions.filter((p) => !p.resolved && t >= p.resolveAt);
      if (due.length > 0) {
        setState((prev) => {
          let coins = prev.coins;
          let streak = prev.streak || 0;
          let xp = prev.xp || 0;
          const prevLevel = getLevelInfo(xp).level;
          const newTx = [];
          const resultById = new Map();
          const stats = { ...(prev.stats || { totalPredictions: 0, totalCorrect: 0, bestStreak: 0, totalCoinsEarned: 0, eventWins: 0 }) };

          // process in the order the timeframes actually closed, so streak accumulates correctly
          const orderedDue = [...due].sort((a, b) => a.resolveAt - b.resolveAt);
          orderedDue.forEach((p) => {
            const crop = getCrop(p.cropId);
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
            newTx.push({
              icon: correct ? '🎯' : crop.icon,
              title: correct
                ? `Tebakan tepat · ${crop.name} (${p.timeframeLabel})${streakBonusPct > 0 ? ` · 🔥+${Math.round(streakBonusPct * 100)}%` : ''}${eventMult > 1 ? ` · ⚡×${eventMult.toFixed(1)}` : ''}${rewardMult > 1 ? ` · 🎲${p.leverageKey}` : ''}`
                : `Tebakan meleset · ${crop.name} (${p.timeframeLabel})${rewardMult > 1 ? ` · 🎲${p.leverageKey} taruhan hangus` : ''}${p.insuranceKey && p.insuranceKey !== 'none' ? ` · 🛡️ asuransi ${p.insuranceKey}` : ''}`,
              value: `+${reward}`,
              dir: 'in',
              time: 'Baru saja',
            });
            resultById.set(p.id, { correct, reward, actualUp });
          });

          const nextPredictions = prev.predictions.map((p) => {
            const res = resultById.get(p.id);
            return res ? { ...p, resolved: true, ...res } : p;
          });

          const alreadyUnlocked = new Set(prev.unlockedAchievements || []);
          const newlyUnlocked = ACHIEVEMENTS.filter((a) => !alreadyUnlocked.has(a.id) && a.check(stats));
          let gems = prev.gems;
          newlyUnlocked.forEach((a) => {
            gems += a.reward;
            alreadyUnlocked.add(a.id);
          });

          const newLevel = getLevelInfo(xp).level;
          if (newlyUnlocked.length > 0) {
            const a = newlyUnlocked[0];
            showToast(`🏆 Pencapaian: ${a.name}! +${a.reward} gem${newlyUnlocked.length > 1 ? ` (+${newlyUnlocked.length - 1} lainnya)` : ''}`);
          } else if (newLevel > prevLevel) {
            showToast(`🎉 Naik ke Level ${newLevel}! Slot kebun baru terbuka`);
          } else if (newTx.length > 0) {
            const summary = due.length === 1 ? newTx[0].title : `${due.length} tebakan selesai diresolusi`;
            showToast(`✓ ${summary}`);
          }
          return {
            ...prev,
            coins,
            gems,
            streak,
            xp,
            stats,
            unlockedAchievements: Array.from(alreadyUnlocked),
            predictions: nextPredictions.filter((p) => !p.resolved),
            tx: [...newTx, ...prev.tx].slice(0, 20),
          };
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [showToast]);

  function plotProgress(plot) {
    if (!plot.cropId) return null;
    const crop = getCrop(plot.cropId);
    const elapsed = (now - plot.plantedAt) / 1000;
    const pct = Math.min(100, Math.floor((elapsed / crop.growSec) * 100));
    return { pct, ready: pct >= 100, crop };
  }

  function topUp(amount) {
    setState((s) => ({
      ...s,
      coins: s.coins + amount,
      tx: [{ icon: '💳', title: `Top up ${amount.toLocaleString('id-ID')} koin`, value: `+${amount}`, dir: 'in', time: 'Baru saja' }, ...s.tx].slice(0, 20),
    }));
    setWalletSheet(null);
    showToast(`✓ ${amount.toLocaleString('id-ID')} koin ditambahkan`);
  }

  const GEM_RATE = 15; // 1 gem = 15 koin
  function exchangeGems(gemAmount) {
    if (state.gems < gemAmount) {
      showToast('✗ Gem tidak cukup');
      return;
    }
    const coinsGained = gemAmount * GEM_RATE;
    setState((s) => ({
      ...s,
      gems: s.gems - gemAmount,
      coins: s.coins + coinsGained,
      tx: [{ icon: '✦', title: `Tukar ${gemAmount} gem → koin`, value: `+${coinsGained}`, dir: 'in', time: 'Baru saja' }, ...s.tx].slice(0, 20),
    }));
    setWalletSheet(null);
    showToast(`✓ ${gemAmount} gem ditukar jadi ${coinsGained} koin`);
  }

  function buyDirect(cropId) {
    const unlockedCount = getLevelInfo(state.xp || 0).plots;
    const firstEmpty = state.plots.find((p) => !p.cropId && p.id < unlockedCount);
    if (!firstEmpty) {
      showToast('✗ Semua petak terisi atau masih terkunci');
      return;
    }
    plantSeed(firstEmpty.id, cropId);
  }

  function plantSeed(plotId, cropId) {
    const crop = getCrop(cropId);
    if (crop.seasonal && getTodaysSeasonalCrop().crop.id !== cropId) {
      showToast('✗ Bibit musiman ini udah nggak tersedia hari ini');
      return;
    }
    const cost = crop.seedCost;
    const currency = crop.seedCurrency;
    if (state[currency] < cost) {
      showToast(`✗ ${currency === 'coins' ? 'Koin' : 'Gem'} tidak cukup`);
      return;
    }
    setState((s) => ({
      ...s,
      [currency]: s[currency] - cost,
      plots: s.plots.map((p) => (p.id === plotId ? { ...p, cropId, plantedAt: Date.now() } : p)),
    }));
    setSeedPickerPlot(null);
    showToast(`✓ ${crop.name} ditanam`);
  }

  function lockPrediction(direction) {
    if (!sheetPlot || !sheetTimeframe) return;
    const crop = getCrop(sheetPlot.cropId);
    const lockedAt = Date.now();
    const resolveAt = lockedAt + sheetTimeframe.sec * 1000;
    const activeEvent = getActiveEventForAsset(state.marketEvents, crop.asset, lockedAt);
    const eventMultiplier = activeEvent ? activeEvent.multiplier : 1.0;
    const leverage = sheetLeverage || LEVERAGE_OPTIONS[0];
    const insurance = sheetInsurance || INSURANCE_OPTIONS[0];
    const stake = Math.round(crop.baseValue * leverage.stakePct);
    const insuranceCost = Math.round(crop.baseValue * insurance.costPct);
    const totalCost = stake + insuranceCost;
    if (totalCost > 0 && state.coins < totalCost) {
      showToast(`✗ Koin tidak cukup (butuh ${totalCost} buat taruhan + asuransi)`);
      return;
    }
    const effectiveLossMult = Math.min(0.9, leverage.lossMult + insurance.lossBonus);
    const prediction = {
      id: `${sheetPlot.id}-${lockedAt}`,
      plotId: sheetPlot.id,
      cropId: sheetPlot.cropId,
      direction,
      lockedAt,
      resolveAt,
      timeframeLabel: sheetTimeframe.label,
      multiplier: sheetTimeframe.multiplier,
      eventMultiplier,
      leverageKey: leverage.key,
      rewardMult: leverage.rewardMult,
      lossMult: effectiveLossMult,
      insuranceKey: insurance.key,
      stake,
      insuranceCost,
      resolved: false,
    };
    setState((s) => ({
      ...s,
      coins: s.coins - totalCost,
      predictions: [...s.predictions, prediction],
      plots: s.plots.map((p) => (p.id === sheetPlot.id ? { id: p.id, cropId: null, plantedAt: null } : p)),
    }));
    setSheetPlot(null);
    setSheetTimeframe(null);
    setSheetLeverage(LEVERAGE_OPTIONS[0]);
    setSheetInsurance(INSURANCE_OPTIONS[0]);
    const costNote = totalCost > 0 ? ` · dipotong ${totalCost} koin` : '';
    showToast(activeEvent ? `🔒 Dikunci · ${sheetTimeframe.label} · 🔥 bonus event ×${eventMultiplier.toFixed(1)}${costNote}` : `🔒 Tebakan dikunci · ${sheetTimeframe.label}${costNote}`);
  }

  const screenLabels = { kebun: 'Musim Panen 04', pasar: 'Pantauan Pasar', gudang: 'Penyimpanan Hasil', dompet: 'Ringkasan Saldo', papan: 'Papan Peringkat' };

  if (!loaded) {
    return (
      <div style={styles.body}>
        <div style={{ ...styles.device, alignItems: 'center', justifyContent: 'center', color: '#8FA69C', fontFamily: 'Inter, sans-serif' }}>
          Memuat kebun…
        </div>
      </div>
    );
  }

  return (
    <div style={styles.body}>
      <style>{`
        @keyframes kkPulseGlow {
          0%, 100% { box-shadow: 0 0 0 1px rgba(74,255,176,0.25), 0 0 16px rgba(74,255,176,0.10); }
          50% { box-shadow: 0 0 0 1px rgba(74,255,176,0.55), 0 0 34px rgba(74,255,176,0.35); }
        }
        @keyframes kkBadgePulse {
          0%, 100% { transform: translateX(-50%) scale(1); }
          50% { transform: translateX(-50%) scale(1.08); }
        }
        @keyframes kkBreathe {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.9; }
        }
        .kk-ready-plot { animation: kkPulseGlow 1.8s ease-in-out infinite; }
        .kk-ready-badge { animation: kkBadgePulse 1.8s ease-in-out infinite; }
        .kk-empty-plus { animation: kkBreathe 2.2s ease-in-out infinite; }
        @keyframes kkTickerScroll {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .kk-ticker-track { animation: kkTickerScroll 16s linear infinite; }
        button { outline: none; -webkit-tap-highlight-color: transparent; }
        button:focus { outline: none; }
      `}</style>
      <div style={styles.device}>
        <div style={styles.topbar}>
          <div style={styles.brand}>
            <div style={styles.brandMark}>🌱</div>
            <div>
              <div style={styles.brandText}>Kebun Kripto</div>
              <div style={styles.brandSub}>{screenLabels[screen]}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ ...styles.pill, color: '#E8C468' }}>
              <span style={{ ...styles.dot, background: 'rgba(232,196,104,0.15)' }}>◆</span>
              {animatedCoins.toLocaleString('id-ID')}
            </div>
            <div style={{ ...styles.pill, color: '#4AFFB0' }}>
              <span style={{ ...styles.dot, background: 'rgba(74,255,176,0.15)' }}>✦</span>
              {animatedGems}
            </div>
          </div>
        </div>

        {screen === 'kebun' && <Ticker now={now} marketEvents={state.marketEvents} />}

        {screen === 'kebun' && (
          <LevelBar levelInfo={getLevelInfo(state.xp || 0)} />
        )}

        {screen === 'kebun' && (
          <FarmScreen
            plots={state.plots}
            predictions={state.predictions}
            now={now}
            streak={state.streak || 0}
            unlockedPlots={getLevelInfo(state.xp || 0).plots}
            plotProgress={plotProgress}
            onEmptyClick={(plotId) => setSeedPickerPlot(plotId)}
            onReadyClick={(plot) => { setSheetPlot(plot); setSheetLeverage(LEVERAGE_OPTIONS[0]); setSheetInsurance(INSURANCE_OPTIONS[0]); }}
          />
        )}
        {screen === 'pasar' && <MarketScreen now={now} onBuy={(cropId) => setSeedPickerPlot('any-' + cropId)} onBuyDirect={buyDirect} />}
        {screen === 'gudang' && <WarehouseScreen tx={state.tx} unlockedAchievements={state.unlockedAchievements} />}
        {screen === 'dompet' && <WalletScreen coins={animatedCoins} gems={animatedGems} tx={state.tx} onTopUp={() => setWalletSheet('topup')} onExchange={() => setWalletSheet('exchange')} />}
        {screen === 'papan' && <LeaderboardScreen profile={profile} onClaim={claimReferral} showToast={showToast} />}

        <div style={styles.bottomNav}>
          {[
            ['kebun', '🌿', 'Kebun'],
            ['pasar', '📊', 'Pasar'],
            ['gudang', '🎒', 'Gudang'],
            ['dompet', '👛', 'Dompet'],
            ['papan', '🏆', 'Papan'],
          ].map(([key, icon, label]) => (
            <button key={key} onClick={() => setScreen(key)} style={{ ...styles.navItem, padding: '4px 8px', color: screen === key ? '#4AFFB0' : '#5C7268' }}>
              {screen === key && <div style={styles.navIndicator} />}
              <span style={{ fontSize: 18 }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {seedPickerPlot !== null && (
        <SeedPickerSheet
          coins={state.coins}
          gems={state.gems}
          onPick={(cropId) => {
            if (typeof seedPickerPlot === 'string' && seedPickerPlot.startsWith('any-')) {
              const unlockedCount = getLevelInfo(state.xp || 0).plots;
              const firstEmpty = state.plots.find((p) => !p.cropId && p.id < unlockedCount);
              if (!firstEmpty) {
                showToast('✗ Semua petak terisi atau masih terkunci');
                setSeedPickerPlot(null);
                return;
              }
              plantSeed(firstEmpty.id, cropId);
            } else {
              plantSeed(seedPickerPlot, cropId);
            }
          }}
          onClose={() => setSeedPickerPlot(null)}
        />
      )}

      {sheetPlot && (
        <PredictSheet
          crop={getCrop(sheetPlot.cropId)}
          now={now}
          timeframe={sheetTimeframe}
          leverage={sheetLeverage}
          onPickLeverage={setSheetLeverage}
          insurance={sheetInsurance}
          onPickInsurance={setSheetInsurance}
          coins={state.coins}
          streak={state.streak || 0}
          activeEvent={getActiveEventForAsset(state.marketEvents, getCrop(sheetPlot.cropId).asset, now)}
          onPickTimeframe={setSheetTimeframe}
          onLock={lockPrediction}
          onClose={() => {
            setSheetPlot(null);
            setSheetTimeframe(null);
            setSheetLeverage(LEVERAGE_OPTIONS[0]);
            setSheetInsurance(INSURANCE_OPTIONS[0]);
          }}
        />
      )}

      {walletSheet === 'topup' && <TopUpSheet onPick={topUp} onClose={() => setWalletSheet(null)} />}
      {walletSheet === 'exchange' && <ExchangeSheet gems={state.gems} rate={GEM_RATE} onPick={exchangeGems} onClose={() => setWalletSheet(null)} />}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

/* ---------------- Sub components ---------------- */

const TICKER_TIMEFRAMES = [
  { key: '1m', label: '1M', sec: 60 },
  { key: '5m', label: '5M', sec: 300 },
  { key: '15m', label: '15M', sec: 900 },
];

function Ticker({ now, marketEvents }) {
  const [tf, setTf] = useState(TICKER_TIMEFRAMES[0]);
  const assets = [
    { asset: 'btc', name: 'BTC-tier' },
    { asset: 'eth', name: 'ETH-tier' },
    { asset: 'sol', name: 'SOL-tier' },
    { asset: 'ada', name: 'ADA-tier' },
    { asset: 'dot', name: 'DOT-tier' },
    { asset: 'avax', name: 'AVAX-tier' },
  ];
  const items = assets.map((a) => {
    const prev = priceIndexAt(a.asset, now - tf.sec * 1000);
    const curr = priceIndexAt(a.asset, now);
    const pct = ((curr - prev) / Math.max(0.05, Math.abs(prev))) * 100;
    const price = getDisplayPrice(a.asset, now);
    const event = getActiveEventForAsset(marketEvents, a.asset, now);
    return { ...a, pct, price, up: pct >= 0, event };
  });
  return (
    <div style={styles.ticker}>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {TICKER_TIMEFRAMES.map((t) => (
          <div
            key={t.key}
            onClick={() => setTf(t)}
            style={{
              ...styles.tickerTfBtn,
              ...(tf.key === t.key ? styles.tickerTfBtnActive : {}),
            }}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div style={{ overflow: 'hidden', flex: 1, maskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)' }}>
        <div className="kk-ticker-track" style={{ display: 'flex', gap: 22, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, whiteSpace: 'nowrap', width: 'max-content' }}>
          {[...items, ...items].map((t, i) => (
            <span key={i} style={{ color: t.event ? '#E8C468' : (t.up ? '#4AFFB0' : '#FF6B5C'), fontWeight: t.event ? 700 : 600 }}>
              {t.event ? '⚡ ' : ''}{t.name} ${fmtPrice(t.price)} {t.up ? '+' : ''}{t.pct.toFixed(1)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LevelBar({ levelInfo }) {
  const { level, xpIntoLevel, xpForNext, progressPct, plots } = levelInfo;
  const isMaxPlots = plots >= 9;
  return (
    <div style={styles.levelBar}>
      <div style={styles.levelBadge}>Lv{level}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8FA69C' }}>
            {isMaxPlots ? 'Semua slot kebun terbuka' : `Slot berikutnya di Level ${level + 1}`}
          </span>
          <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#5C7268' }}>
            {xpIntoLevel}/{xpForNext} XP
          </span>
        </div>
        <div style={styles.xpTrack}>
          <div style={{ ...styles.xpFill, width: `${progressPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function FarmScreen({ plots, predictions, now, streak, unlockedPlots, plotProgress, onEmptyClick, onReadyClick }) {
  const filled = plots.filter((p) => p.cropId).length;
  const streakBonusPct = Math.min(Math.max(streak - 1, 0), STREAK_BONUS_CAP) * STREAK_BONUS_PER_LEVEL;
  return (
    <>
      {streak > 0 && (
        <div style={styles.streakBar}>
          <div style={{ fontSize: 18 }}>🔥</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Streak {streak} tebakan benar</div>
            <div style={{ fontSize: 10, color: '#8FA69C', marginTop: 1 }}>
              Bonus reward saat ini: <span style={{ color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace" }}>+{Math.round(streakBonusPct * 100)}%</span>
              {streak <= STREAK_BONUS_CAP ? ' · sekali meleset, reset ke 0' : ' · sudah maksimal'}
            </div>
          </div>
        </div>
      )}
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Kebunmu</div>
        <div style={styles.sectionMeta}>{filled} / {unlockedPlots} petak</div>
      </div>
      <div style={styles.farmGrid}>
        {plots.map((plot) => {
          const locked = plot.id >= unlockedPlots;
          if (locked) {
            const levelNeeded = LEVELS.find((l) => l.plots > plot.id)?.level ?? 6;
            return (
              <div key={plot.id} style={{ ...styles.plot, borderStyle: 'dashed', opacity: 0.45 }}>
                <div style={{ fontSize: 20 }}>🔒</div>
                <div style={{ fontSize: 9, color: '#5C7268', marginTop: 4, textAlign: 'center' }}>Butuh Level {levelNeeded}</div>
              </div>
            );
          }
          const prog = plotProgress(plot);
          if (!prog) {
            return (
              <div key={plot.id} style={{ ...styles.plot, borderStyle: 'dashed' }} onClick={() => onEmptyClick(plot.id)}>
                <div className="kk-empty-plus" style={{ fontSize: 22, color: '#5C7268', fontWeight: 300 }}>+</div>
                <div style={{ fontSize: 9.5, color: '#5C7268', marginTop: 4 }}>Tanam</div>
              </div>
            );
          }
          const growScale = prog.ready ? 1 : 0.55 + (prog.pct / 100) * 0.45;
          const growOpacity = prog.ready ? 1 : 0.45 + (prog.pct / 100) * 0.55;
          return (
            <div
              key={plot.id}
              className={prog.ready ? 'kk-ready-plot' : ''}
              style={{ ...styles.plot, ...(prog.ready ? styles.plotReady : {}) }}
              onClick={() => prog.ready && onReadyClick(plot)}
            >
              <Sparkline assetId={prog.crop.asset} now={now} />
              <div
                style={{
                  fontSize: 30,
                  position: 'relative',
                  zIndex: 2,
                  filter: 'drop-shadow(0 0 10px rgba(74,255,176,0.35))',
                  transform: `scale(${growScale})`,
                  opacity: growOpacity,
                  transition: 'transform 0.4s ease, opacity 0.4s ease',
                }}
              >
                {prog.crop.icon}
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, marginTop: 6, position: 'relative', zIndex: 2, color: '#8FA69C' }}>{prog.crop.name}</div>
              {prog.ready ? <div className="kk-ready-badge" style={styles.readyBadge}>Panen</div> : <div style={styles.plotTimer}>{prog.pct}%</div>}
            </div>
          );
        })}
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Prediksi Berjalan</div>
        <div style={styles.sectionMeta}>{predictions.length} terkunci</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {predictions.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '20px 16px' }}>
            Belum ada tebakan terkunci. Panen tanaman lalu pilih timeframe untuk mengunci prediksi.
          </div>
        ) : (
          <div style={styles.card}>
            {predictions.map((p, i) => {
              const crop = getCrop(p.cropId);
              const remaining = p.resolveAt - now;
              return (
                <div key={p.id} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={styles.rowIcon}>{crop.icon}</div>
                    <div>
                      <div style={styles.rowTitle}>{crop.name}</div>
                      <div style={styles.rowSub}>
                        {p.direction === 'up' ? '↑ Naik' : '↓ Turun'} · {p.timeframeLabel}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: '#E8C468' }}>{fmtCountdown(remaining)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

const MARKET_TIMEFRAMES = [
  { key: '1m', label: '1M', sec: 60 },
  { key: '3m', label: '3M', sec: 180 },
  { key: '5m', label: '5M', sec: 300 },
  { key: '15m', label: '15M', sec: 900 },
];

function MarketScreen({ now, onBuy, onBuyDirect }) {
  const [tf, setTf] = useState(MARKET_TIMEFRAMES[0]);
  const cropList = Object.values(CROPS);
  const { crop: seasonalCrop, endOfDay } = getTodaysSeasonalCrop(now);
  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>🌟 Bibit Musiman</div>
        <div style={styles.sectionMeta}>habis {fmtCountdown(endOfDay - now)}</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={styles.seasonalCard}>
          <div style={{ fontSize: 34 }}>{seasonalCrop.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14 }}>{seasonalCrop.name}</div>
            <div style={{ fontSize: 10.5, color: '#E8C468', marginTop: 2 }}>
              {seasonalCrop.tier} · benar {seasonalCrop.baseValue} koin (basis 1m) · {fmtGrowDuration(seasonalCrop.growSec)} tumbuh
            </div>
            <div style={{ fontSize: 9.5, color: '#8FA69C', marginTop: 2 }}>Cuma tersedia hari ini — besok ganti bibit lain</div>
          </div>
          <button style={styles.btnMint} onClick={() => onBuyDirect(seasonalCrop.id)}>{seasonalCrop.seedCost} koin</button>
        </div>
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Pasar Hari Ini</div>
        <div style={styles.sectionMeta}>live</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
          {MARKET_TIMEFRAMES.map((t) => (
            <div
              key={t.key}
              onClick={() => setTf(t)}
              style={{ ...styles.tfBtn, flex: 1, padding: '7px 0', fontSize: 11, textAlign: 'center', ...(tf.key === t.key ? styles.tfBtnActive : {}) }}
            >
              {t.label}
            </div>
          ))}
        </div>
        <div style={styles.card}>
          {cropList.map((c, i) => {
            const prev = priceIndexAt(c.asset, now - tf.sec * 1000);
            const curr = priceIndexAt(c.asset, now);
            const up = curr >= prev;
            const pct = ((curr - prev) / Math.max(0.05, Math.abs(prev))) * 100;
            return (
              <div key={c.id} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={styles.rowIcon}>{c.icon}</div>
                  <div>
                    <div style={styles.rowTitle}>{c.name}</div>
                    <div style={styles.rowSub}>{c.tier}</div>
                  </div>
                </div>
                <div style={{ position: 'relative', width: 56, height: 28 }}>
                  <Sparkline assetId={c.asset} now={now} windowSec={tf.sec} opacity={1} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: '#EAF3EE' }}>
                    ${fmtPrice(getDisplayPrice(c.asset, now))}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: up ? '#4AFFB0' : '#FF6B5C', marginTop: 1 }}>
                    {up ? '+' : ''}{pct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 9, color: '#5C7268', marginTop: 1 }}>{tf.label.toLowerCase()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Bibit Tersedia</div>
        <div style={styles.sectionMeta}>{cropList.length} varian</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        <div style={styles.card}>
          {cropList.map((c, i) => (
            <div key={c.id} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={styles.rowIcon}>{c.icon}</div>
                <div style={styles.rowTitle}>Bibit {c.name}</div>
              </div>
              <button style={styles.btnGhost} onClick={() => onBuy(c.id)}>
                {c.seedCost} {c.seedCurrency === 'coins' ? 'koin' : 'gem'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function WarehouseScreen({ tx, unlockedAchievements }) {
  const harvestTx = tx.filter((t) => t.title.includes('·'));
  const unlockedSet = new Set(unlockedAchievements || []);
  const unlockedCount = ACHIEVEMENTS.filter((a) => unlockedSet.has(a.id)).length;
  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Pencapaian</div>
        <div style={styles.sectionMeta}>{unlockedCount} / {ACHIEVEMENTS.length}</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={styles.card}>
          {ACHIEVEMENTS.map((a, i) => {
            const unlocked = unlockedSet.has(a.id);
            return (
              <div key={a.id} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none', opacity: unlocked ? 1 : 0.45 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ ...styles.rowIcon, background: unlocked ? 'rgba(74,255,176,0.12)' : '#182B25' }}>{unlocked ? a.icon : '🔒'}</div>
                  <div>
                    <div style={styles.rowTitle}>{a.name}</div>
                    <div style={styles.rowSub}>{a.desc}</div>
                  </div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: unlocked ? '#4AFFB0' : '#5C7268' }}>
                  {unlocked ? '✓' : `+${a.reward}✦`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Riwayat Panen</div>
        <div style={styles.sectionMeta}>{harvestTx.length} riwayat</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {harvestTx.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '28px 16px' }}>
            Belum ada hasil. Kunci dan menangkan prediksi untuk mengisi gudang.
          </div>
        ) : (
          <div style={styles.card}>
            {harvestTx.map((t, i) => (
              <div key={i} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={styles.rowIcon}>{t.icon}</div>
                  <div>
                    <div style={styles.rowTitle}>{t.title}</div>
                    <div style={styles.rowSub}>{t.time}</div>
                  </div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: '#4AFFB0' }}>{t.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function LeaderboardScreen({ profile, onClaim, showToast }) {
  const [rows, setRows] = useState(null); // null = loading
  const [refreshKey, setRefreshKey] = useState(0);
  const [codeInput, setCodeInput] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.storage.list('leaderboard:', true);
        const keys = list?.keys || [];
        const entries = await Promise.all(
          keys.map(async (k) => {
            try {
              const res = await window.storage.get(k, true);
              if (!res || !res.value) return null;
              const data = JSON.parse(res.value);
              return { playerId: k.replace('leaderboard:', ''), ...data };
            } catch (e) {
              return null;
            }
          })
        );
        if (!cancelled) {
          const valid = entries.filter(Boolean).sort((a, b) => b.coins - a.coins);
          setRows(valid);
        }
      } catch (e) {
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const myRank = rows ? rows.findIndex((r) => r.playerId === profile?.playerId) + 1 : 0;

  function copyCode() {
    if (!profile) return;
    navigator.clipboard?.writeText(profile.playerId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Kode Referral</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={styles.card}>
          <div style={{ fontSize: 11, color: '#8FA69C', marginBottom: 8 }}>Bagikan kode ini ke teman. Kalau mereka klaim, kamu dapat +1 referral (tercatat di papan).</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, background: '#182B25', border: '1px solid #223530', borderRadius: 10, padding: '9px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: '#4AFFB0', letterSpacing: '0.05em' }}>
              {profile?.playerId || '...'}
            </div>
            <button onClick={copyCode} style={styles.btnGhostSm}>{copied ? '✓ Disalin' : 'Salin'}</button>
          </div>
          <div style={{ height: 1, background: '#223530', margin: '14px 0' }} />
          <div style={{ fontSize: 11, color: '#8FA69C', marginBottom: 8 }}>Punya kode dari teman? Klaim di sini (+30 gem, sekali pakai per kode):</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Masukkan kode teman"
              style={styles.codeInput}
            />
            <button
              onClick={() => { onClaim(codeInput); setCodeInput(''); }}
              style={styles.btnMint}
            >
              Klaim
            </button>
          </div>
        </div>
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Papan Peringkat</div>
        <div style={{ ...styles.sectionMeta, cursor: 'pointer' }} onClick={() => setRefreshKey((k) => k + 1)}>↻ Refresh</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {rows === null ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>Memuat papan peringkat…</div>
        ) : rows.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>Belum ada pemain lain tercatat. Jadilah yang pertama!</div>
        ) : (
          <div style={styles.card}>
            {rows.slice(0, 15).map((r, i) => {
              const isMe = r.playerId === profile?.playerId;
              return (
                <div key={r.playerId} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none', opacity: isMe ? 1 : 0.9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ ...styles.rowIcon, background: isMe ? 'rgba(74,255,176,0.15)' : '#182B25', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700 }}>
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ ...styles.rowTitle, color: isMe ? '#4AFFB0' : '#EAF3EE' }}>{r.nickname}{isMe ? ' (Kamu)' : ''}</div>
                      <div style={styles.rowSub}>Lv{r.level} · {r.referrals || 0} referral</div>
                    </div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: '#E8C468' }}>◆ {r.coins.toLocaleString('id-ID')}</div>
                </div>
              );
            })}
          </div>
        )}
        {myRank > 15 && <div style={{ fontSize: 10.5, color: '#5C7268', textAlign: 'center', marginTop: 10 }}>Peringkat kamu saat ini: #{myRank}</div>}
      </div>
    </>
  );
}

function WalletScreen({ coins, gems, tx, onTopUp, onExchange }) {
  return (
    <>
      <div style={styles.balanceHero}>
        <div style={{ fontSize: 11, color: '#8FA69C', letterSpacing: '0.03em', position: 'relative', zIndex: 2 }}>Total Saldo</div>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 34, marginTop: 6, position: 'relative', zIndex: 2 }}>
          {coins.toLocaleString('id-ID')} <span style={{ fontSize: 16, color: '#8FA69C', fontWeight: 500 }}>koin</span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: '#4AFFB0', marginTop: 4, position: 'relative', zIndex: 2 }}>{gems} gem tersedia</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, position: 'relative', zIndex: 2 }}>
          <button style={{ ...styles.btnMint, flex: 1 }} onClick={onTopUp}>Top Up</button>
          <button style={{ ...styles.btnGhost, flex: 1 }} onClick={onExchange}>Tukar Gem</button>
        </div>
      </div>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Riwayat</div>
        <div style={styles.sectionMeta}>{tx.length} transaksi</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {tx.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '28px 16px' }}>
            Belum ada transaksi.
          </div>
        ) : (
          <div style={styles.card}>
            {tx.map((t, i) => (
              <div key={i} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ ...styles.rowIcon, background: t.dir === 'in' ? 'rgba(74,255,176,0.12)' : 'rgba(255,107,92,0.12)' }}>{t.icon}</div>
                  <div>
                    <div style={styles.rowTitle}>{t.title}</div>
                    <div style={styles.rowSub}>{t.time}</div>
                  </div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: t.dir === 'in' ? '#4AFFB0' : '#FF6B5C' }}>{t.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SeedPickerSheet({ coins, gems, onPick, onClose }) {
  const cropList = Object.values(CROPS);
  return (
    <div style={styles.sheetBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...styles.sheet, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '18px 0 0' }}>
        <div style={{ padding: '0 20px' }}>
          <div style={styles.sheetHandle} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 16 }}>Pilih Bibit</div>
            <button onClick={onClose} style={styles.closeBtn}>✕</button>
          </div>
          <div style={{ fontSize: 9.5, color: '#5C7268', marginBottom: 10, lineHeight: 1.4 }}>
            Angka di tiap bibit = reward benar / meleset untuk tiap timeframe. Makin panjang timeframe, makin besar reward-nya.
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 20px 12px' }}>
          {cropList.map((c, i) => {
            const balance = c.seedCurrency === 'coins' ? coins : gems;
            const affordable = balance >= c.seedCost;
            return (
              <div key={c.id} style={{ ...styles.seedRowCol, borderTop: i > 0 ? '1px solid #1B2823' : 'none', opacity: affordable ? 1 : 0.4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={styles.rowIconSm}>{c.icon}</div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 9.5, color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace", marginTop: 1 }}>{fmtGrowDuration(c.growSec)} tumbuh</div>
                    </div>
                  </div>
                  <button style={{ ...styles.btnGhostSm, opacity: affordable ? 1 : 0.5, cursor: affordable ? 'pointer' : 'not-allowed' }} onClick={() => affordable && onPick(c.id)} disabled={!affordable}>
                    {c.seedCost} {c.seedCurrency === 'coins' ? 'koin' : 'gem'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {TIMEFRAMES.map((tf) => (
                    <div key={tf.key} style={{ flex: 1, textAlign: 'center', background: '#182B25', borderRadius: 8, padding: '4px 2px' }}>
                      <div style={{ fontSize: 8, color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace" }}>{tf.label.replace(' Menit', 'm')}</div>
                      <div style={{ fontSize: 10, color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{Math.round(c.baseValue * tf.multiplier)}</div>
                      <div style={{ fontSize: 8, color: '#E8C468', fontFamily: "'IBM Plex Mono', monospace" }}>/{Math.round(c.baseValue * tf.multiplier * 0.1)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PredictSheet({ crop, now, timeframe, leverage, onPickLeverage, insurance, onPickInsurance, coins, streak, activeEvent, onPickTimeframe, onLock, onClose }) {
  const nextStreakBonusPct = Math.min(streak, STREAK_BONUS_CAP) * STREAK_BONUS_PER_LEVEL;
  const eventMult = activeEvent ? activeEvent.multiplier : 1.0;
  const lev = leverage || LEVERAGE_OPTIONS[0];
  const ins = insurance || INSURANCE_OPTIONS[0];
  const stake = Math.round(crop.baseValue * lev.stakePct);
  const insuranceCost = Math.round(crop.baseValue * ins.costPct);
  const totalCost = stake + insuranceCost;
  const canAffordStake = coins >= totalCost;
  const effectiveLossMult = Math.min(0.9, lev.lossMult + ins.lossBonus);
  return (
    <div style={styles.sheetBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.sheet}>
        <div style={styles.sheetHandle} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: '#182B25', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{crop.icon}</div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 17 }}>{crop.name}</div>
              <div style={{ fontSize: 11.5, color: '#8FA69C', marginTop: 1 }}>{crop.tier} · reward dasar {crop.baseValue} koin</div>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {activeEvent && (
          <div style={styles.eventBadge}>
            ⚡ Lagi Volatile — reward ×{eventMult.toFixed(1)} kalau dikunci sekarang ({fmtCountdown(activeEvent.endAt - now)} lagi)
          </div>
        )}

        <div style={{ position: 'relative', height: 70, margin: '14px 0 4px', background: '#182B25', borderRadius: 12, overflow: 'hidden' }}>
          <Sparkline assetId={crop.asset} now={now} windowSec={120} opacity={0.9} strokeWidth={2} />
        </div>

        <div style={{ fontSize: 12, color: '#5C7268', margin: '10px 0 14px' }}>1. Pilih timeframe candle yang jadi dasar tebakan:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7, marginBottom: timeframe ? 16 : 4 }}>
          {TIMEFRAMES.map((tf) => (
            <div
              key={tf.key}
              onClick={() => onPickTimeframe(tf)}
              style={{
                ...styles.tfBtn,
                textAlign: 'center',
                ...(timeframe?.key === tf.key ? styles.tfBtnActive : {}),
              }}
            >
              <div>{tf.label}</div>
              <div style={{ fontSize: 9.5, opacity: 0.75, marginTop: 2 }}>×{tf.multiplier.toFixed(1)}</div>
            </div>
          ))}
        </div>

        {timeframe && (
          <>
            <div style={{ fontSize: 12, color: '#5C7268', margin: '10px 0' }}>2. Pilih leverage (opsional, taruhan lebih besar = reward lebih besar):</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 16 }}>
              {LEVERAGE_OPTIONS.map((lv) => {
                const lvStake = Math.round(crop.baseValue * lv.stakePct);
                const affordable = coins >= lvStake;
                return (
                  <div
                    key={lv.key}
                    onClick={() => affordable && onPickLeverage(lv)}
                    style={{
                      ...styles.tfBtn,
                      textAlign: 'center',
                      opacity: affordable ? 1 : 0.4,
                      cursor: affordable ? 'pointer' : 'not-allowed',
                      ...(lev.key === lv.key ? styles.tfBtnActive : {}),
                    }}
                  >
                    <div>{lv.label}</div>
                    <div style={{ fontSize: 8.5, opacity: 0.75, marginTop: 2 }}>{lvStake > 0 ? `stake ${lvStake}` : 'gratis'}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 12, color: '#5C7268', margin: '10px 0' }}>3. Asuransi (opsional, kurangin sakit kalau meleset):</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 16 }}>
              {INSURANCE_OPTIONS.map((iv) => {
                const ivCost = Math.round(crop.baseValue * iv.costPct);
                const affordable = coins >= (stake + ivCost);
                return (
                  <div
                    key={iv.key}
                    onClick={() => affordable && onPickInsurance(iv)}
                    style={{
                      ...styles.tfBtn,
                      textAlign: 'center',
                      opacity: affordable ? 1 : 0.4,
                      cursor: affordable ? 'pointer' : 'not-allowed',
                      ...(ins.key === iv.key ? styles.tfBtnActive : {}),
                    }}
                  >
                    <div style={{ fontSize: 10.5 }}>{iv.label}</div>
                    <div style={{ fontSize: 8.5, opacity: 0.75, marginTop: 2 }}>{ivCost > 0 ? `premi ${ivCost}` : 'gratis'}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 12, color: '#5C7268', marginBottom: 10 }}>
              4. Tebak arah harga saat candle {timeframe.label} ini ditutup:
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...styles.predictBtn, opacity: canAffordStake ? 1 : 0.5 }} onClick={() => canAffordStake && onLock('up')}>
                <span style={{ fontSize: 19, color: '#4AFFB0' }}>↑</span>
                Naik
              </button>
              <button style={{ ...styles.predictBtn, opacity: canAffordStake ? 1 : 0.5 }} onClick={() => canAffordStake && onLock('down')}>
                <span style={{ fontSize: 19, color: '#FF6B5C' }}>↓</span>
                Turun
              </button>
            </div>
            <div style={{ textAlign: 'center', fontSize: 10.5, color: '#5C7268', marginTop: 14 }}>
              Terkunci {timeframe.label} · benar ={' '}
              <span style={{ color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace" }}>{Math.round(crop.baseValue * timeframe.multiplier * eventMult * (1 + nextStreakBonusPct) * lev.rewardMult)} koin</span>
              {' '}· meleset ={' '}
              <span style={{ color: '#E8C468', fontFamily: "'IBM Plex Mono', monospace" }}>{Math.round(crop.baseValue * timeframe.multiplier * eventMult * effectiveLossMult)} koin</span>
              {totalCost > 0 && (
                <div style={{ marginTop: 4, color: '#FF6B5C' }}>
                  🎲 {totalCost} koin dipotong di muka ({stake > 0 ? `taruhan ${stake}` : ''}{stake > 0 && insuranceCost > 0 ? ' + ' : ''}{insuranceCost > 0 ? `premi ${insuranceCost}` : ''}){!canAffordStake ? ' — koin tidak cukup' : ''}
                </div>
              )}
              {streak > 0 && (
                <div style={{ marginTop: 4, color: '#E8C468' }}>🔥 Sudah include bonus streak +{Math.round(nextStreakBonusPct * 100)}%</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TopUpSheet({ onPick, onClose }) {
  const packages = [
    { coins: 100, note: 'Paket Kecil' },
    { coins: 300, note: 'Paket Sedang', badge: 'Populer' },
    { coins: 750, note: 'Paket Besar' },
    { coins: 2000, note: 'Paket Jumbo' },
  ];
  return (
    <div style={styles.sheetBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.sheet}>
        <div style={styles.sheetHandle} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 17 }}>Top Up Koin</div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={{ fontSize: 11.5, color: '#8FA69C', marginBottom: 16 }}>Simulasi top-up — belum terhubung ke pembayaran asli.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {packages.map((p) => (
            <button key={p.coins} onClick={() => onPick(p.coins)} style={styles.topupCard}>
              {p.badge && <div style={styles.topupBadge}>{p.badge}</div>}
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 600, color: '#E8C468' }}>◆ {p.coins.toLocaleString('id-ID')}</div>
              <div style={{ fontSize: 10.5, color: '#8FA69C', marginTop: 3 }}>{p.note}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExchangeSheet({ gems, rate, onPick, onClose }) {
  const options = [1, 5, 10, gems].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i).sort((a, b) => a - b);
  return (
    <div style={styles.sheetBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.sheet}>
        <div style={styles.sheetHandle} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 17 }}>Tukar Gem</div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={{ fontSize: 11.5, color: '#8FA69C', marginBottom: 16 }}>
          Kurs saat ini: <span style={{ color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace" }}>1 gem = {rate} koin</span> · Kamu punya {gems} gem
        </div>
        {gems === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>Gem kamu habis. Kumpulkan gem dulu dari hasil panen premium.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.map((amt) => (
              <button key={amt} onClick={() => onPick(amt)} style={styles.exchangeRow} disabled={amt > gems}>
                <span>{amt === gems ? `Semua (${amt} gem)` : `${amt} gem`}</span>
                <span style={{ color: '#E8C468', fontFamily: "'IBM Plex Mono', monospace" }}>→ {(amt * rate).toLocaleString('id-ID')} koin</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Styles ---------------- */
const styles = {
  body: { background: 'radial-gradient(ellipse 120% 80% at 50% -10%, #16241F 0%, #0B1210 55%)', color: '#EAF3EE', fontFamily: "'Inter', sans-serif", display: 'flex', justifyContent: 'center', minHeight: '100vh' },
  device: { width: '100%', maxWidth: 430, minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 18px 10px', position: 'relative', zIndex: 2 },
  brand: { display: 'flex', alignItems: 'center', gap: 9 },
  brandMark: { width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg, #4AFFB0 0%, #1F8F6B 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, boxShadow: '0 0 18px rgba(74,255,176,0.35)' },
  brandText: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16.5, letterSpacing: '-0.01em' },
  brandSub: { fontSize: 10, color: '#5C7268', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: -1 },
  pill: { display: 'flex', alignItems: 'center', gap: 6, background: '#131F1B', border: '1px solid #223530', padding: '7px 11px 7px 8px', borderRadius: 100, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 600 },
  dot: { width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 },
  ticker: { margin: '8px 18px 4px', background: '#131F1B', border: '1px solid #223530', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2, overflow: 'hidden' },
  tickerLabel: { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#5C7268', fontWeight: 600, whiteSpace: 'nowrap' },
  tickerTfBtn: { background: 'transparent', border: '1px solid #223530', color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, fontWeight: 600, padding: '3px 7px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s ease' },
  tickerTfBtnActive: { borderColor: '#4AFFB0', color: '#06231A', background: '#4AFFB0', fontWeight: 700 },
  sectionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '22px 18px 10px', position: 'relative', zIndex: 2 },
  sectionTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 18 },
  sectionMeta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#8FA69C' },
  farmGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '4px 18px 18px', position: 'relative', zIndex: 2 },
  streakBar: { display: 'flex', alignItems: 'center', gap: 10, margin: '10px 18px 0', background: 'linear-gradient(135deg, rgba(232,196,104,0.12), rgba(74,255,176,0.08))', border: '1px solid #3A3020', borderRadius: 14, padding: '10px 14px', position: 'relative', zIndex: 2 },
  levelBar: { display: 'flex', alignItems: 'center', gap: 10, margin: '10px 18px 0', background: '#131F1B', border: '1px solid #223530', borderRadius: 14, padding: '10px 14px', position: 'relative', zIndex: 2 },
  levelBadge: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, color: '#06231A', background: '#4AFFB0', borderRadius: 8, padding: '4px 9px', flexShrink: 0 },
  xpTrack: { width: '100%', height: 6, background: '#182B25', borderRadius: 100, overflow: 'hidden' },
  xpFill: { height: '100%', background: 'linear-gradient(90deg, #2A6B54, #4AFFB0)', borderRadius: 100, transition: 'width 0.5s ease' },
  eventBadge: { background: 'linear-gradient(135deg, rgba(232,196,104,0.15), rgba(255,107,92,0.08))', border: '1px solid #4A3A20', borderRadius: 10, padding: '8px 12px', fontSize: 11, color: '#E8C468', marginBottom: 10, lineHeight: 1.4 },
  plot: { aspectRatio: 0.92, background: '#131F1B', border: '1px solid #223530', borderRadius: 18, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  plotReady: { borderColor: '#4AFFB0' },
  readyBadge: { position: 'absolute', bottom: 8, left: '50%', background: '#4AFFB0', color: '#06231A', fontSize: 9, fontWeight: 700, letterSpacing: '0.03em', padding: '3px 9px', borderRadius: 100, textTransform: 'uppercase', zIndex: 3 },
  plotTimer: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, color: '#5C7268', position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 3 },
  card: { background: '#131F1B', border: '1px solid #223530', borderRadius: 18, padding: '14px 16px' },
  seasonalCard: { display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, rgba(232,196,104,0.12), rgba(74,255,176,0.05))', border: '1px solid #4A3A20', borderRadius: 18, padding: '14px 16px' },
  listRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0' },
  seedRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid #1B2823' },
  seedRowCol: { padding: '10px 0', borderTop: '1px solid #1B2823' },
  rowIcon: { fontSize: 20, width: 38, height: 38, background: '#182B25', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  rowIconSm: { fontSize: 16, width: 32, height: 32, background: '#182B25', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  btnGhostSm: { background: '#182B25', color: '#EAF3EE', border: '1px solid #223530', borderRadius: 10, padding: '6px 10px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 10.5, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' },
  codeInput: { flex: 1, background: '#182B25', border: '1px solid #223530', borderRadius: 10, padding: '9px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: '#EAF3EE', outline: 'none' },
  rowTitle: { fontSize: 13, fontWeight: 600 },
  rowSub: { fontSize: 10.5, color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace", marginTop: 1 },
  btnGhost: { background: '#182B25', color: '#EAF3EE', border: '1px solid #223530', borderRadius: 12, padding: '7px 12px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 11.5, cursor: 'pointer' },
  btnMint: { background: '#4AFFB0', color: '#06231A', border: 'none', borderRadius: 12, padding: '9px 14px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 12.5, cursor: 'pointer' },
  balanceHero: { margin: '4px 18px 8px', background: 'linear-gradient(150deg, #16302A 0%, #0F211D 100%)', border: '1px solid #223530', borderRadius: 22, padding: '22px 20px', position: 'relative', overflow: 'hidden' },
  bottomNav: { marginTop: 'auto', display: 'flex', justifyContent: 'space-around', padding: '12px 10px 20px', background: 'linear-gradient(180deg, rgba(19,31,27,0) 0%, #101B17 30%)', borderTop: '1px solid #223530', position: 'sticky', bottom: 0, zIndex: 10 },
  navItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '4px 14px', position: 'relative', cursor: 'pointer', background: 'none', border: 'none', fontFamily: "'Inter', sans-serif" },
  navIndicator: { position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', width: 18, height: 2.5, background: '#4AFFB0', borderRadius: 4, boxShadow: '0 0 8px rgba(74,255,176,0.6)' },
  sheetBackdrop: { position: 'fixed', inset: 0, background: 'rgba(4,8,7,0.7)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 },
  sheet: { width: '100%', maxWidth: 430, background: '#131F1B', borderTop: '1px solid #223530', borderRadius: '24px 24px 0 0', padding: '22px 20px 26px' },
  sheetHandle: { width: 36, height: 4, background: '#223530', borderRadius: 10, margin: '0 auto 18px' },
  closeBtn: { width: 28, height: 28, borderRadius: '50%', background: '#182B25', border: '1px solid #223530', color: '#8FA69C', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  predictBtn: { flex: 1, padding: '16px 0', borderRadius: 14, border: '1px solid #223530', background: '#182B25', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14, cursor: 'pointer', color: '#EAF3EE' },
  tfBtn: { flex: 1, padding: '10px 0', borderRadius: 12, border: '1px solid #223530', background: '#182B25', color: '#8FA69C', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s ease' },
  tfBtnActive: { borderColor: '#4AFFB0', color: '#06231A', background: '#4AFFB0', fontWeight: 700 },
  topupCard: { position: 'relative', background: '#182B25', border: '1px solid #223530', borderRadius: 14, padding: '16px 12px', textAlign: 'left', cursor: 'pointer' },
  topupBadge: { position: 'absolute', top: -8, right: 10, background: '#4AFFB0', color: '#06231A', fontSize: 8.5, fontWeight: 700, padding: '2px 8px', borderRadius: 100, textTransform: 'uppercase' },
  exchangeRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#182B25', border: '1px solid #223530', borderRadius: 12, padding: '13px 15px', fontSize: 13, fontWeight: 600, color: '#EAF3EE', cursor: 'pointer' },
  toast: { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#182B25', border: '1px solid #223530', color: '#EAF3EE', padding: '10px 16px', borderRadius: 12, fontSize: 12.5, fontWeight: 600, zIndex: 60 },
};
