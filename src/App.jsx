import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ICON_COIN, ICON_GEM, ICON_LIGHTNING, ICON_LOCK, ICON_STAR, ICON_LOGO } from './icons.js';
import { getTonConnectUI, connectWallet, sendTonPayment } from './tonconnect.js';

function Icon({ src, size = 14, style }) {
  return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle', ...style }} />;
}

/* ================== Deterministic "market mood" engine ==================
   Drives the ticker visuals AND now actually affects sell prices at the
   Market: selling into a tier that's currently "up" nets a bit more,
   selling into a "down" tier nets a bit less. Same value for everyone at a
   given moment (seeded by timestamp), so it feels alive without needing a
   real price feed.
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
const BUCKET_SEC = 6;
function moodIndexAt(assetId, timeMs) {
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
  return base + drift; // roughly -0.15..1.15
}
function priceMultiplierFromMood(idx) {
  const clamped = Math.max(0, Math.min(1, idx));
  return 0.85 + clamped * 0.3; // 0.85x .. 1.15x
}

/* ---------------- Game data ---------------- */
const CROPS = {
  gandum:   { id: 'gandum',   icon: '🌾', name: 'Wheat',            tier: 'ETH-tier', asset: 'eth', growSec: 60,  baseValue: 70,  seedCost: 40, seedCurrency: 'coins' },
  jagung:   { id: 'jagung',   icon: '🌽', name: 'Corn',             tier: 'ADA-tier', asset: 'ada', growSec: 95,  baseValue: 95,  seedCost: 55, seedCurrency: 'coins' },
  stroberi: { id: 'stroberi', icon: '🍓', name: 'Strawberry',       tier: 'DOT-tier', asset: 'dot', growSec: 130, baseValue: 115, seedCost: 65, seedCurrency: 'coins' },
  semangka: { id: 'semangka', icon: '🍉', name: 'Watermelon',       tier: 'BTC-tier', asset: 'btc', growSec: 180, baseValue: 140, seedCost: 80, seedCurrency: 'coins' },
  anggur:   { id: 'anggur',   icon: '🍇', name: 'Grapes',           tier: 'SOL-tier', asset: 'sol', growSec: 310, baseValue: 210, seedCost: 120, seedCurrency: 'coins' },
  nanas:    { id: 'nanas',    icon: '🍍', name: 'Pineapple',        tier: 'AVAX-tier',asset: 'avax', growSec: 580, baseValue: 220, seedCost: 6, seedCurrency: 'gems' },
};

const SEASONAL_CROPS = {
  melon_emas:    { id: 'melon_emas',    icon: '🍈', name: 'Gold Melon',     tier: 'BTC-tier', asset: 'btc', growSec: 240, baseValue: 260, seedCost: 100, seedCurrency: 'coins', seasonal: true },
  kelapa_kilau:  { id: 'kelapa_kilau',  icon: '🥥', name: 'Coconut',        tier: 'ETH-tier', asset: 'eth', growSec: 150, baseValue: 165, seedCost: 65,  seedCurrency: 'coins', seasonal: true },
  markisa_petir: { id: 'markisa_petir', icon: '🫐', name: 'Passionfruit',   tier: 'SOL-tier', asset: 'sol', growSec: 200, baseValue: 195, seedCost: 75,  seedCurrency: 'coins', seasonal: true },
  leci_neon:     { id: 'leci_neon',     icon: '🍒', name: 'Lychee',         tier: 'ADA-tier', asset: 'ada', growSec: 120, baseValue: 130, seedCost: 50,  seedCurrency: 'coins', seasonal: true },
  kurma_prisma:  { id: 'kurma_prisma',  icon: '🌰', name: 'Date',           tier: 'DOT-tier', asset: 'dot', growSec: 170, baseValue: 175, seedCost: 68,  seedCurrency: 'coins', seasonal: true },
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

/* Animals: bought once into a pen, then produce on a repeating cycle
   forever (unlike crops, which are consumed on harvest). */
const ANIMALS = {
  chicken: { id: 'chicken', icon: '🐔', name: 'Chicken', cycleSec: 45,  seedCost: 60,  seedCurrency: 'coins', productId: 'egg' },
  goat:    { id: 'goat',    icon: '🐐', name: 'Goat',    cycleSec: 90,  seedCost: 150, seedCurrency: 'coins', productId: 'wool' },
  cow:     { id: 'cow',     icon: '🐄', name: 'Cow',     cycleSec: 150, seedCost: 300, seedCurrency: 'coins', productId: 'milk' },
};
function getAnimal(id) {
  return ANIMALS[id];
}

/* Every sellable good — crop harvests and animal products — in one catalog
   so the Market's Sell tab and the Warehouse can look any of them up the
   same way. */
const ANIMAL_PRODUCTS = {
  egg:  { id: 'egg',  icon: '🥚', name: 'Egg',  tier: 'ADA-tier', asset: 'ada', baseValue: 22 },
  wool: { id: 'wool', icon: '🧶', name: 'Wool', tier: 'DOT-tier', asset: 'dot', baseValue: 58 },
  milk: { id: 'milk', icon: '🥛', name: 'Milk', tier: 'SOL-tier', asset: 'sol', baseValue: 95 },
};
function getItem(id) {
  return CROPS[id] || SEASONAL_CROPS[id] || ANIMAL_PRODUCTS[id];
}

const PLOT_COUNT = 9;
const PEN_COUNT = 3;
const STORAGE_KEY = 'kebun-kripto-state-v5';
const PROFILE_KEY = 'kebun-kripto-profile';
const TUTORIAL_SEEN_KEY = 'kebun-kripto-tutorial-seen';

function emptyPlots() {
  return Array.from({ length: PLOT_COUNT }, (_, i) => ({ id: i, cropId: null, plantedAt: null }));
}
function emptyPens() {
  return Array.from({ length: PEN_COUNT }, (_, i) => ({ id: i, animalId: null, readyAt: null }));
}
function defaultState() {
  return {
    coins: 480,
    gems: 12,
    plots: emptyPlots(),
    pens: emptyPens(),
    warehouse: {},
    tx: [],
    xp: 0,
    demandEvents: [],
    stats: { totalHarvests: 0, totalPlanted: 0, totalCoinsEarned: 0, demandWins: 0 },
    unlockedAchievements: [],
    dailyLogin: { lastClaimDay: null, streak: 0 },
  };
}
function getDateKey(timeMs) {
  const d = new Date(timeMs);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function getDailyBonusAmount(streak) {
  return Math.min(20 + (streak - 1) * 15, 150);
}

/* Demand events: sometimes an asset tier goes "High Demand" for a while,
   boosting the SELL price of any matching item while it's active. */
const DEMAND_ASSETS = ['btc', 'eth', 'sol', 'ada', 'dot', 'avax'];
const ASSET_TIER_NAMES = { btc: 'BTC-tier', eth: 'ETH-tier', sol: 'SOL-tier', ada: 'ADA-tier', dot: 'DOT-tier', avax: 'AVAX-tier' };
function getActiveDemandForAsset(demandEvents, asset, now) {
  return (demandEvents || []).find((e) => e.asset === asset && now >= e.startAt && now < e.endAt) || null;
}

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
  return 1800 + (level - 6) * 700;
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

const ACHIEVEMENTS = [
  { id: 'first_harvest', icon: '🌱', name: 'First Harvest', desc: 'Harvest or collect your first item', reward: 2, check: (s) => s.totalHarvests >= 1 },
  { id: 'harvest_10', icon: '🎯', name: 'Green Thumb', desc: 'Harvest/collect 10 items', reward: 5, check: (s) => s.totalHarvests >= 10 },
  { id: 'harvest_50', icon: '🏹', name: 'Master Grower', desc: 'Harvest/collect 50 items', reward: 15, check: (s) => s.totalHarvests >= 50 },
  { id: 'harvest_100', icon: '📈', name: 'Consistent', desc: 'Harvest/collect 100 items', reward: 40, check: (s) => s.totalHarvests >= 100 },
  { id: 'planted_25', icon: '🌾', name: 'Busy Hands', desc: 'Plant 25 seeds total', reward: 10, check: (s) => s.totalPlanted >= 25 },
  { id: 'demand_hunter', icon: '⚡', name: 'Perfect Timing', desc: 'Sell 5 items during a High Demand event', reward: 15, check: (s) => s.demandWins >= 5 },
  { id: 'earn_2000', icon: '💰', name: 'Getting Rich', desc: 'Total earnings of 2,000 coins', reward: 20, check: (s) => s.totalCoinsEarned >= 2000 },
  { id: 'earn_5000', icon: '👑', name: 'Farm Sultan', desc: 'Total earnings of 5,000 coins', reward: 30, check: (s) => s.totalCoinsEarned >= 5000 },
];

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

/* ---------------- Sparkline driven by the mood engine ---------------- */
function Sparkline({ assetId, now, windowSec = 90, height = '100%', opacity = 0.55, strokeWidth = 2.5 }) {
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
      values.push(moodIndexAt(assetId, t));
    }
    const min = Math.min(...values), max = Math.max(...values);
    const range = Math.max(0.05, max - min);
    const positive = values[values.length - 1] >= values[0];
    ctx.strokeStyle = positive ? 'rgba(74,255,176,0.55)' : 'rgba(255,107,92,0.45)';
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
  }, [assetId, now, windowSec]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height, opacity }} />;
}

function fmtGrowDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function genPlayerId() {
  return 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
function genNickname(id) {
  return 'Farmer#' + id.slice(-4).toUpperCase();
}

/* ---------------- Main App ---------------- */
export default function KebunKripto() {
  const [state, setState] = useState(defaultState());
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState(null);
  const [claimedReferrals, setClaimedReferrals] = useState([]);
  const autoClaimAttempted = useRef(false);
  const [screen, setScreen] = useState('kebun');
  const [showTutorial, setShowTutorial] = useState(false);
  const tutorialChecked = useRef(false);
  const dailyBonusChecked = useRef(false);
  const [rewardEffect, setRewardEffect] = useState(null);
  const [now, setNow] = useState(Date.now());
  const animatedCoins = useCountUp(state.coins);
  const animatedGems = useCountUp(state.gems);
  const [seedPickerPlot, setSeedPickerPlot] = useState(null);
  const [animalPickerPen, setAnimalPickerPen] = useState(null);
  const [walletSheet, setWalletSheet] = useState(null);
  const [payingPackage, setPayingPackage] = useState(null);
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
      } catch (e) {}
      try {
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

  useEffect(() => {
    if (!loaded || !profile) return;
    (async () => {
      let existingReferrals = 0;
      try {
        const existing = await window.storage?.get(`leaderboard:${profile.playerId}`, true);
        if (existing && existing.value) existingReferrals = JSON.parse(existing.value).referrals || 0;
      } catch (e) {}
      const level = getLevelInfo(state.xp || 0).level;
      const entry = { nickname: profile.nickname, coins: state.coins, xp: state.xp || 0, level, referrals: existingReferrals, updatedAt: Date.now() };
      window.storage?.set(`leaderboard:${profile.playerId}`, JSON.stringify(entry), true).catch(() => {});
    })();
  }, [state.coins, state.xp, profile, loaded]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  async function claimReferral(codeInput) {
    const code = (codeInput || '').trim();
    if (!code) return;
    if (!profile) return;
    if (code === profile.playerId) {
      showToast("✗ Can't use your own code");
      return;
    }
    if (claimedReferrals.includes(code)) {
      showToast('✗ This code was already claimed');
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
      showToast('✗ Referral code not found');
      return;
    }
    setState((s) => ({
      ...s,
      gems: s.gems + 30,
      tx: [{ icon: '🎁', title: `Claimed referral code ${code}`, value: '+30', dir: 'in', time: 'Just now' }, ...s.tx].slice(0, 20),
    }));
    const newClaimed = [...claimedReferrals, code];
    setClaimedReferrals(newClaimed);
    const newProfile = { ...profile, claimedReferrals: newClaimed };
    setProfile(newProfile);
    window.storage.set(PROFILE_KEY, JSON.stringify(newProfile), false).catch(() => {});
    try {
      referrerEntry.referrals = (referrerEntry.referrals || 0) + 1;
      window.storage.set(`leaderboard:${code}`, JSON.stringify(referrerEntry), true).catch(() => {});
    } catch (e) {}
    showToast('✓ Code claimed! +30 gems for you');
  }

  useEffect(() => {
    if (!loaded || tutorialChecked.current) return;
    tutorialChecked.current = true;
    (async () => {
      try {
        const res = await window.storage?.get(TUTORIAL_SEEN_KEY, false);
        if (!res || !res.value) {
          setShowTutorial(true);
          window.storage?.set(TUTORIAL_SEEN_KEY, '1', false).catch(() => {});
        }
      } catch (e) {
        setShowTutorial(true);
        window.storage?.set(TUTORIAL_SEEN_KEY, '1', false).catch(() => {});
      }
    })();
  }, [loaded]);

  useEffect(() => {
    if (!loaded || dailyBonusChecked.current) return;
    dailyBonusChecked.current = true;
    const nowT = Date.now();
    const todayKey = getDateKey(nowT);
    const yesterdayKey = getDateKey(nowT - 86400000);
    const daily = state.dailyLogin || { lastClaimDay: null, streak: 0 };
    if (daily.lastClaimDay === todayKey) return;
    const newStreak = daily.lastClaimDay === yesterdayKey ? daily.streak + 1 : 1;
    const bonus = getDailyBonusAmount(newStreak);
    setState((s) => ({
      ...s,
      coins: s.coins + bonus,
      dailyLogin: { lastClaimDay: todayKey, streak: newStreak },
      tx: [{ icon: '📅', title: `Daily login bonus · Day ${newStreak}`, value: `+${bonus}`, dir: 'in', time: 'Just now' }, ...s.tx].slice(0, 20),
    }));
    showToast(`📅 Daily bonus! Day ${newStreak} streak · +${bonus} coins`);
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !profile || autoClaimAttempted.current) return;
    const startParam = window.__TG_START_PARAM__;
    if (startParam && startParam !== profile.playerId && !claimedReferrals.includes(startParam)) {
      autoClaimAttempted.current = true;
      claimReferral(startParam);
    } else {
      autoClaimAttempted.current = true;
    }
  }, [loaded, profile, claimedReferrals]);

  // master clock: growth/production progress + demand event spawn/expiry
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const s = stateRef.current;

      const activeEvents = (s.demandEvents || []).filter((e) => t < e.endAt);
      const busyAssets = new Set(activeEvents.map((e) => e.asset));
      const freeAssets = DEMAND_ASSETS.filter((a) => !busyAssets.has(a));
      let spawned = null;
      if (freeAssets.length > 0 && Math.random() < 0.006) {
        const asset = freeAssets[Math.floor(Math.random() * freeAssets.length)];
        const duration = 60 + Math.floor(Math.random() * 60);
        const multiplier = 1.3 + Math.random() * 0.5;
        spawned = { asset, multiplier, startAt: t, endAt: t + duration * 1000 };
      }
      if (spawned || activeEvents.length !== (s.demandEvents || []).length) {
        const nextEvents = spawned ? [...activeEvents, spawned] : activeEvents;
        setState((prev) => ({ ...prev, demandEvents: nextEvents }));
        if (spawned) {
          showToast(`⚡ ${ASSET_TIER_NAMES[spawned.asset]} is in High Demand! Sell prices ×${spawned.multiplier.toFixed(1)} for ${Math.round((spawned.endAt - spawned.startAt) / 1000)}s`);
        }
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
  function penProgress(pen) {
    if (!pen.animalId) return null;
    const animal = getAnimal(pen.animalId);
    const cycleStart = pen.readyAt - animal.cycleSec * 1000;
    const elapsed = (now - cycleStart) / 1000;
    const pct = Math.min(100, Math.floor((elapsed / animal.cycleSec) * 100));
    return { pct, ready: now >= pen.readyAt, animal };
  }

  function buyDirect(cropId) {
    const unlockedCount = getLevelInfo(state.xp || 0).plots;
    const firstEmpty = state.plots.find((p) => !p.cropId && p.id < unlockedCount);
    if (!firstEmpty) {
      showToast('✗ All plots are full or still locked');
      return;
    }
    plantSeed(firstEmpty.id, cropId);
  }

  function plantSeed(plotId, cropId) {
    const crop = getCrop(cropId);
    if (crop.seasonal && getTodaysSeasonalCrop().crop.id !== cropId) {
      showToast("✗ This seasonal seed isn't available today anymore");
      return;
    }
    const cost = crop.seedCost;
    const currency = crop.seedCurrency;
    if (state[currency] < cost) {
      showToast(`✗ Not enough ${currency === 'coins' ? 'coins' : 'gems'}`);
      return;
    }
    setState((s) => ({
      ...s,
      [currency]: s[currency] - cost,
      plots: s.plots.map((p) => (p.id === plotId ? { ...p, cropId, plantedAt: Date.now() } : p)),
      stats: { ...(s.stats || {}), totalPlanted: (s.stats?.totalPlanted || 0) + 1 },
    }));
    setSeedPickerPlot(null);
    showToast(`✓ ${crop.name} planted`);
  }

  function buyAnimal(penId, animalId) {
    const animal = getAnimal(animalId);
    const cost = animal.seedCost;
    const currency = animal.seedCurrency;
    if (state[currency] < cost) {
      showToast(`✗ Not enough ${currency === 'coins' ? 'coins' : 'gems'}`);
      return;
    }
    setState((s) => ({
      ...s,
      [currency]: s[currency] - cost,
      pens: s.pens.map((p) => (p.id === penId ? { ...p, animalId, readyAt: Date.now() + animal.cycleSec * 1000 } : p)),
      stats: { ...(s.stats || {}), totalPlanted: (s.stats?.totalPlanted || 0) + 1 },
    }));
    setAnimalPickerPen(null);
    showToast(`✓ ${animal.name} moved into the ranch`);
  }

  function addToWarehouseAndProgress(itemId, xpGain) {
    setState((s) => {
      const stats = { ...(s.stats || { totalHarvests: 0, totalPlanted: 0, totalCoinsEarned: 0, demandWins: 0 }) };
      stats.totalHarvests = (stats.totalHarvests || 0) + 1;
      const prevLevel = getLevelInfo(s.xp || 0).level;
      const newXp = (s.xp || 0) + xpGain;
      const newLevel = getLevelInfo(newXp).level;
      const alreadyUnlocked = new Set(s.unlockedAchievements || []);
      const newlyUnlocked = ACHIEVEMENTS.filter((a) => !alreadyUnlocked.has(a.id) && a.check(stats));
      let gems = s.gems;
      newlyUnlocked.forEach((a) => {
        gems += a.reward;
        alreadyUnlocked.add(a.id);
      });
      if (newlyUnlocked.length > 0) {
        const a = newlyUnlocked[0];
        showToast(`🏆 Achievement: ${a.name}! +${a.reward} gems${newlyUnlocked.length > 1 ? ` (+${newlyUnlocked.length - 1} more)` : ''}`);
      } else if (newLevel > prevLevel) {
        showToast(`🎉 Leveled up to Level ${newLevel}! New farm slot unlocked`);
      }
      const item = getItem(itemId);
      return {
        ...s,
        gems,
        xp: newXp,
        stats,
        unlockedAchievements: Array.from(alreadyUnlocked),
        warehouse: { ...s.warehouse, [itemId]: (s.warehouse[itemId] || 0) + 1 },
        tx: [{ icon: item.icon, title: `${item.name} → stored in Warehouse`, value: '+1', dir: 'in', time: 'Just now' }, ...s.tx].slice(0, 20),
      };
    });
  }

  function harvestPlot(plot) {
    const crop = getCrop(plot.cropId);
    const xpGain = Math.round(6 + crop.baseValue / 25);
    addToWarehouseAndProgress(crop.id, xpGain);
    setState((s) => ({ ...s, plots: s.plots.map((p) => (p.id === plot.id ? { id: p.id, cropId: null, plantedAt: null } : p)) }));
    showToast(`✓ ${crop.name} harvested → Warehouse`);
  }

  function collectPen(pen) {
    const animal = getAnimal(pen.animalId);
    const xpGain = Math.round(6 + animal.cycleSec / 15);
    addToWarehouseAndProgress(animal.productId, xpGain);
    setState((s) => ({ ...s, pens: s.pens.map((p) => (p.id === pen.id ? { ...p, readyAt: Date.now() + animal.cycleSec * 1000 } : p)) }));
    showToast(`✓ Collected ${getItem(animal.productId).name} → Warehouse`);
  }

  function sellItem(itemId, quantity) {
    const item = getItem(itemId);
    const have = state.warehouse[itemId] || 0;
    if (quantity <= 0 || have < quantity) return;
    const demand = getActiveDemandForAsset(state.demandEvents, item.asset, now);
    const demandMult = demand ? demand.multiplier : 1.0;
    const moodMult = priceMultiplierFromMood(moodIndexAt(item.asset, now));
    const unitPrice = Math.max(1, Math.round(item.baseValue * demandMult * moodMult));
    const total = unitPrice * quantity;

    setState((s) => {
      const warehouse = { ...s.warehouse };
      warehouse[itemId] = (warehouse[itemId] || 0) - quantity;
      if (warehouse[itemId] <= 0) delete warehouse[itemId];
      const stats = { ...(s.stats || {}) };
      stats.totalCoinsEarned = (stats.totalCoinsEarned || 0) + total;
      if (demandMult > 1) stats.demandWins = (stats.demandWins || 0) + 1;
      const prevLevel = getLevelInfo(s.xp || 0).level;
      const alreadyUnlocked = new Set(s.unlockedAchievements || []);
      const newlyUnlocked = ACHIEVEMENTS.filter((a) => !alreadyUnlocked.has(a.id) && a.check(stats));
      let gems = s.gems;
      newlyUnlocked.forEach((a) => {
        gems += a.reward;
        alreadyUnlocked.add(a.id);
      });
      if (newlyUnlocked.length > 0) {
        const a = newlyUnlocked[0];
        showToast(`🏆 Achievement: ${a.name}! +${a.reward} gems`);
      }
      return {
        ...s,
        coins: s.coins + total,
        gems,
        warehouse,
        stats,
        unlockedAchievements: Array.from(alreadyUnlocked),
        tx: [
          {
            icon: item.icon,
            title: `Sold ${quantity}× ${item.name}${demandMult > 1 ? ` · ⚡×${demandMult.toFixed(1)} demand` : ''}`,
            value: `+${total}`,
            dir: 'in',
            time: 'Just now',
          },
          ...s.tx,
        ].slice(0, 20),
      };
    });
    setRewardEffect({ icon: 'coin', amount: total });
  }

  function topUp(amount) {
    setState((s) => ({
      ...s,
      coins: s.coins + amount,
      tx: [{ icon: '💳', title: `Top up ${amount.toLocaleString('en-US')} coins`, value: `+${amount}`, dir: 'in', time: 'Just now' }, ...s.tx].slice(0, 20),
    }));
    setWalletSheet(null);
    showToast(`✓ ${amount.toLocaleString('en-US')} coins added`);
    setRewardEffect({ icon: 'coin', amount });
  }

  async function buyWithStars(packageKey) {
    if (!profile) return;
    setPayingPackage(packageKey);
    try {
      const res = await fetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: profile.playerId, packageKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.link) {
        showToast('✗ Could not start payment, try again');
        setPayingPackage(null);
        return;
      }
      const tg = window.Telegram?.WebApp;
      if (!tg?.openInvoice) {
        showToast('✗ Payments only work inside Telegram');
        setPayingPackage(null);
        return;
      }
      tg.openInvoice(data.link, async (status) => {
        setPayingPackage(null);
        if (status === 'paid') {
          showToast('✓ Payment received! Updating your balance…');
          const packageCoins = { small: 100, medium: 300, large: 750, jumbo: 2000 };
          setRewardEffect({ icon: 'coin', amount: packageCoins[packageKey] || 0 });
          try {
            const stateRes = await window.storage.get(STORAGE_KEY, false);
            if (stateRes && stateRes.value) {
              const parsed = JSON.parse(stateRes.value);
              setState((s) => ({ ...s, ...parsed }));
            }
          } catch (e) {}
          setWalletSheet(null);
        } else if (status === 'failed') {
          showToast('✗ Payment failed');
        } else if (status === 'cancelled') {
          showToast('Payment cancelled');
        }
      });
    } catch (e) {
      showToast('✗ Could not start payment, try again');
      setPayingPackage(null);
    }
  }

  async function buyWithTon(packageKey) {
    if (!profile) return;
    const ui = getTonConnectUI();
    if (!ui.connected) {
      showToast('Connect your TON wallet first');
      return;
    }
    setPayingPackage(packageKey);
    try {
      const orderRes = await fetch('/api/create-ton-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: profile.playerId, packageKey }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok || !order.orderId) {
        showToast('✗ Could not start payment, try again');
        setPayingPackage(null);
        return;
      }
      try {
        await sendTonPayment({ toAddress: order.toAddress, amountNano: order.amountNano, comment: order.comment });
      } catch (e) {
        showToast('Payment cancelled');
        setPayingPackage(null);
        return;
      }
      showToast('✓ Payment sent — confirming on-chain, this can take a moment…');
      const maxAttempts = 24;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const verifyRes = await fetch('/api/verify-ton-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.orderId }),
          });
          const result = await verifyRes.json();
          if (result.status === 'paid') {
            showToast('✓ Payment confirmed! Updating your balance…');
            setRewardEffect({ icon: 'coin', amount: order.coins });
            try {
              const stateRes = await window.storage.get(STORAGE_KEY, false);
              if (stateRes && stateRes.value) {
                const parsed = JSON.parse(stateRes.value);
                setState((s) => ({ ...s, ...parsed }));
              }
            } catch (e) {}
            setPayingPackage(null);
            setWalletSheet(null);
            return;
          }
        } catch (e) {}
      }
      showToast("Still waiting for confirmation — check back in Wallet shortly, it'll credit automatically once found.");
      setPayingPackage(null);
    } catch (e) {
      showToast('✗ Could not start payment, try again');
      setPayingPackage(null);
    }
  }

  const GEM_RATE = 15;
  function exchangeGems(gemAmount) {
    if (state.gems < gemAmount) {
      showToast('✗ Not enough gems');
      return;
    }
    const coinsGained = gemAmount * GEM_RATE;
    setState((s) => ({
      ...s,
      gems: s.gems - gemAmount,
      coins: s.coins + coinsGained,
      tx: [{ icon: '✦', title: `Exchange ${gemAmount} gems → coins`, value: `+${coinsGained}`, dir: 'in', time: 'Just now' }, ...s.tx].slice(0, 20),
    }));
    setWalletSheet(null);
    showToast(`✓ ${gemAmount} gems exchanged for ${coinsGained} coins`);
    setRewardEffect({ icon: 'coin', amount: coinsGained });
  }

  const screenLabels = { kebun: 'Harvest Season 04', pasar: 'Market Watch', gudang: 'Warehouse', dompet: 'Balance Summary', papan: 'Leaderboard' };

  if (!loaded) {
    return (
      <div style={styles.body}>
        <div style={{ ...styles.device, alignItems: 'center', justifyContent: 'center', color: '#8FA69C', fontFamily: 'Inter, sans-serif' }}>Loading farm…</div>
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
        @keyframes kkBurstIconPop {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.15); opacity: 1; }
          70% { transform: scale(0.95); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes kkBurstParticle {
          0% { opacity: 1; transform: rotate(var(--angle, 0deg)) translateY(0px); }
          100% { opacity: 0; transform: rotate(var(--angle, 0deg)) translateY(-70px); }
        }
        @keyframes kkBurstFadeOut {
          0%, 65% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes kkBurstLabelRise {
          0% { transform: translateY(10px); opacity: 0; }
          40% { transform: translateY(0); opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateY(-8px); opacity: 0; }
        }
        .kk-burst-icon { animation: kkBurstIconPop 0.5s cubic-bezier(.2,.9,.3,1.4) both, kkBurstFadeOut 1.4s ease both; }
        .kk-burst-particle { animation: kkBurstParticle 0.7s ease-out both; }
        .kk-burst-label { animation: kkBurstLabelRise 1.3s ease both; }
        @keyframes kkFireflyDrift {
          0% { transform: translate(0, 0); }
          25% { transform: translate(calc(var(--drift, 20px) * 0.6), calc(var(--drift, 20px) * -0.8)); }
          50% { transform: translate(calc(var(--drift, 20px) * -0.4), calc(var(--drift, 20px) * -0.3)); }
          75% { transform: translate(calc(var(--drift, 20px) * 0.3), calc(var(--drift, 20px) * 0.6)); }
          100% { transform: translate(0, 0); }
        }
        @keyframes kkFireflyTwinkle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.9; }
        }
        .kk-firefly { animation-name: kkFireflyDrift, kkFireflyTwinkle; animation-timing-function: ease-in-out, ease-in-out; animation-iteration-count: infinite, infinite; }
        @keyframes kkPlantSway {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        .kk-plant-sway { display: inline-block; transform-origin: bottom center; animation: kkPlantSway 3.4s ease-in-out infinite; }
        @keyframes kkIdleBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .kk-idle-bob { display: inline-block; animation: kkIdleBob 2.6s ease-in-out infinite; }
        @keyframes kkHarvestPop {
          0% { transform: scale(1) translateY(0); opacity: 1; }
          35% { transform: scale(1.35) translateY(-6px); opacity: 1; }
          100% { transform: scale(0.3) translateY(-30px); opacity: 0; }
        }
        .kk-harvest-pop { animation: kkHarvestPop 0.42s cubic-bezier(.3,.6,.4,1) both; }
      `}</style>
      <div style={styles.device}>
        <div style={styles.topbar}>
          <div style={styles.brand}>
            <div style={styles.brandMark}><img src={ICON_LOGO} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div>
            <div>
              <div style={styles.brandText}>Crypto Farm</div>
              <div style={styles.brandSub}>
                {screenLabels[screen]}
                {(state.dailyLogin?.streak || 0) > 1 && ` · 📅 Day ${state.dailyLogin.streak}`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ ...styles.pill, color: '#E8C468' }}>
              <span style={{ ...styles.dot, background: 'rgba(232,196,104,0.15)' }}><Icon src={ICON_COIN} size={11} /></span>
              {animatedCoins.toLocaleString('en-US')}
            </div>
            <div style={{ ...styles.pill, color: '#4AFFB0' }}>
              <span style={{ ...styles.dot, background: 'rgba(74,255,176,0.15)' }}><Icon src={ICON_GEM} size={11} /></span>
              {animatedGems}
            </div>
            <button onClick={() => setShowTutorial(true)} style={styles.helpBtn}>?</button>
          </div>
        </div>

        {screen === 'kebun' && <Ticker now={now} demandEvents={state.demandEvents} />}
        {screen === 'kebun' && <LevelBar levelInfo={getLevelInfo(state.xp || 0)} />}

        {screen === 'kebun' && (
          <FarmScreen
            plots={state.plots}
            pens={state.pens}
            now={now}
            unlockedPlots={getLevelInfo(state.xp || 0).plots}
            plotProgress={plotProgress}
            penProgress={penProgress}
            onEmptyClick={(plotId) => setSeedPickerPlot(plotId)}
            onEmptyPenClick={(penId) => setAnimalPickerPen(penId)}
            onHarvest={harvestPlot}
            onCollect={collectPen}
          />
        )}
        {screen === 'pasar' && (
          <MarketScreen
            now={now}
            warehouse={state.warehouse}
            demandEvents={state.demandEvents}
            onBuySeed={(cropId) => setSeedPickerPlot('any-' + cropId)}
            onBuySeedDirect={buyDirect}
            onBuyAnimal={(animalId) => setAnimalPickerPen('any-' + animalId)}
            onSell={sellItem}
          />
        )}
        {screen === 'gudang' && <WarehouseScreen tx={state.tx} unlockedAchievements={state.unlockedAchievements} warehouse={state.warehouse} />}
        {screen === 'dompet' && <WalletScreen coins={animatedCoins} gems={animatedGems} tx={state.tx} onTopUp={() => setWalletSheet('topup')} onExchange={() => setWalletSheet('exchange')} />}
        {screen === 'papan' && <LeaderboardScreen profile={profile} onClaim={claimReferral} showToast={showToast} />}

        <div style={styles.bottomNav}>
          {[
            ['kebun', '🌿', 'Farm'],
            ['pasar', '📊', 'Market'],
            ['gudang', '🎒', 'Storage'],
            ['dompet', '👛', 'Wallet'],
            ['papan', '🏆', 'Board'],
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
                showToast('✗ All plots are full or still locked');
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

      {animalPickerPen !== null && (
        <AnimalPickerSheet
          coins={state.coins}
          gems={state.gems}
          onPick={(animalId) => {
            if (typeof animalPickerPen === 'string' && animalPickerPen.startsWith('any-')) {
              const firstEmpty = state.pens.find((p) => !p.animalId);
              if (!firstEmpty) {
                showToast('✗ All ranch pens are full');
                setAnimalPickerPen(null);
                return;
              }
              buyAnimal(firstEmpty.id, animalId);
            } else {
              buyAnimal(animalPickerPen, animalId);
            }
          }}
          onClose={() => setAnimalPickerPen(null)}
        />
      )}

      {walletSheet === 'topup' && <TopUpSheet onPickStars={buyWithStars} onPickTon={buyWithTon} payingPackage={payingPackage} onClose={() => setWalletSheet(null)} />}
      {walletSheet === 'exchange' && <ExchangeSheet gems={state.gems} rate={GEM_RATE} onPick={exchangeGems} onClose={() => setWalletSheet(null)} />}

      {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}

      {rewardEffect && <RewardBurst effect={rewardEffect} onDone={() => setRewardEffect(null)} />}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

/* ---------------- Sub components ---------------- */

function Ticker({ now, demandEvents }) {
  const assets = [
    { asset: 'btc', name: 'BTC-tier' },
    { asset: 'eth', name: 'ETH-tier' },
    { asset: 'sol', name: 'SOL-tier' },
    { asset: 'ada', name: 'ADA-tier' },
    { asset: 'dot', name: 'DOT-tier' },
    { asset: 'avax', name: 'AVAX-tier' },
  ];
  const items = assets.map((a) => {
    const prev = moodIndexAt(a.asset, now - 60000);
    const curr = moodIndexAt(a.asset, now);
    const pct = ((curr - prev) / Math.max(0.05, Math.abs(prev))) * 100;
    const event = getActiveDemandForAsset(demandEvents, a.asset, now);
    return { ...a, pct, up: pct >= 0, event };
  });
  return (
    <div style={styles.ticker}>
      <div style={styles.tickerLabel}>Mood</div>
      <div style={{ overflow: 'hidden', flex: 1, maskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)' }}>
        <div className="kk-ticker-track" style={{ display: 'flex', gap: 22, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, whiteSpace: 'nowrap', width: 'max-content' }}>
          {[...items, ...items].map((t, i) => (
            <span key={i} style={{ color: t.event ? '#E8C468' : (t.up ? '#4AFFB0' : '#FF6B5C'), fontWeight: t.event ? 700 : 600 }}>
              {t.event && <Icon src={ICON_LIGHTNING} size={11} style={{ marginRight: 3 }} />}{t.name} {t.up ? '+' : ''}{t.pct.toFixed(1)}%
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
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8FA69C' }}>{isMaxPlots ? 'All farm slots unlocked' : `Next slot at Level ${level + 1}`}</span>
          <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#5C7268' }}>{xpIntoLevel}/{xpForNext} XP</span>
        </div>
        <div style={styles.xpTrack}>
          <div style={{ ...styles.xpFill, width: `${progressPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function FireflyLayer({ count = 14 }) {
  const fireflies = React.useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: 10 + Math.random() * 80,
        size: 2 + Math.random() * 2.5,
        duration: 6 + Math.random() * 6,
        delay: Math.random() * 6,
        drift: 20 + Math.random() * 40,
      })),
    [count]
  );
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {fireflies.map((f) => (
        <div
          key={f.id}
          className="kk-firefly"
          style={{
            position: 'absolute', left: `${f.left}%`, top: `${f.top}%`, width: f.size, height: f.size, borderRadius: '50%',
            background: '#4AFFB0', boxShadow: '0 0 6px 2px rgba(74,255,176,0.7)',
            '--drift': `${f.drift}px`, animationDuration: `${f.duration}s, ${2.5 + Math.random() * 2}s`, animationDelay: `${f.delay}s, ${f.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function FarmScreen({ plots, pens, now, unlockedPlots, plotProgress, penProgress, onEmptyClick, onEmptyPenClick, onHarvest, onCollect }) {
  const [view, setView] = useState('crops');
  const filled = plots.filter((p) => p.cropId).length;
  const filledPens = pens.filter((p) => p.animalId).length;
  const [harvestingId, setHarvestingId] = useState(null);

  function triggerHarvest(plot) {
    if (harvestingId !== null) return;
    setHarvestingId('plot-' + plot.id);
    setTimeout(() => {
      onHarvest(plot);
      setHarvestingId(null);
    }, 420);
  }
  function triggerCollect(pen) {
    if (harvestingId !== null) return;
    setHarvestingId('pen-' + pen.id);
    setTimeout(() => {
      onCollect(pen);
      setHarvestingId(null);
    }, 420);
  }

  return (
    <>
      <div style={{ padding: '18px 18px 0', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div onClick={() => setView('crops')} style={{ ...styles.tfBtn, flex: 1, textAlign: 'center', ...(view === 'crops' ? styles.tfBtnActive : {}) }}>🌾 Farm</div>
          <div onClick={() => setView('animals')} style={{ ...styles.tfBtn, flex: 1, textAlign: 'center', ...(view === 'animals' ? styles.tfBtnActive : {}) }}>🐄 Ranch</div>
        </div>
      </div>

      {view === 'crops' ? (
        <>
          <div style={styles.sectionHead}>
            <div style={styles.sectionTitle}>Your Farm</div>
            <div style={styles.sectionMeta}>{filled} / {unlockedPlots} plots</div>
          </div>
          <div style={{ position: 'relative' }}>
            <FireflyLayer />
            <div style={{ ...styles.farmGrid, position: 'relative', zIndex: 1 }}>
              {plots.map((plot) => {
                const locked = plot.id >= unlockedPlots;
                if (locked) {
                  const levelNeeded = LEVELS.find((l) => l.plots > plot.id)?.level ?? 6;
                  return (
                    <div key={plot.id} style={{ ...styles.soilMound, opacity: 0.4, filter: 'saturate(0.3)' }}>
                      <Icon src={ICON_LOCK} size={20} />
                      <div style={{ fontSize: 9, color: '#5C7268', marginTop: 4, textAlign: 'center' }}>Requires Level {levelNeeded}</div>
                    </div>
                  );
                }
                const prog = plotProgress(plot);
                if (!prog) {
                  return (
                    <div key={plot.id} style={styles.soilMound} onClick={() => onEmptyClick(plot.id)}>
                      <div className="kk-empty-plus" style={{ fontSize: 22, color: '#5C7268', fontWeight: 300 }}>+</div>
                      <div style={{ fontSize: 9.5, color: '#5C7268', marginTop: 4 }}>Plant</div>
                    </div>
                  );
                }
                const growScale = prog.ready ? 1 : 0.5 + (prog.pct / 100) * 0.5;
                const growOpacity = prog.ready ? 1 : 0.5 + (prog.pct / 100) * 0.5;
                const isHarvesting = harvestingId === 'plot-' + plot.id;
                const canSway = prog.pct > 15 && !prog.ready;
                return (
                  <div
                    key={plot.id}
                    className={prog.ready && !isHarvesting ? 'kk-ready-plot' : ''}
                    style={{ ...styles.soilMound, ...(prog.ready ? styles.soilMoundReady : {}) }}
                    onClick={() => prog.ready && !isHarvesting && triggerHarvest(plot)}
                  >
                    <div className={isHarvesting ? 'kk-harvest-pop' : ''} style={{ transform: `scale(${growScale})`, opacity: growOpacity, transition: 'transform 0.4s ease, opacity 0.4s ease', position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div className={canSway ? 'kk-plant-sway' : ''} style={{ fontSize: 30, filter: 'drop-shadow(0 0 10px rgba(74,255,176,0.35))' }}>{prog.crop.icon}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, marginTop: 6, color: '#8FA69C' }}>{prog.crop.name}</div>
                    </div>
                    {prog.ready ? <div className="kk-ready-badge" style={styles.readyBadge}>Harvest</div> : <div style={styles.plotTimer}>{prog.pct}%</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={styles.sectionHead}>
            <div style={styles.sectionTitle}>Your Ranch</div>
            <div style={styles.sectionMeta}>{filledPens} / {pens.length} pens</div>
          </div>
          <div style={{ position: 'relative' }}>
            <FireflyLayer count={8} />
            <div style={{ ...styles.farmGrid, gridTemplateColumns: 'repeat(3, 1fr)', position: 'relative', zIndex: 1 }}>
              {pens.map((pen) => {
                const prog = penProgress(pen);
                if (!prog) {
                  return (
                    <div key={pen.id} style={styles.soilMound} onClick={() => onEmptyPenClick(pen.id)}>
                      <div className="kk-empty-plus" style={{ fontSize: 22, color: '#5C7268', fontWeight: 300 }}>+</div>
                      <div style={{ fontSize: 9.5, color: '#5C7268', marginTop: 4 }}>Raise</div>
                    </div>
                  );
                }
                const isHarvesting = harvestingId === 'pen-' + pen.id;
                return (
                  <div
                    key={pen.id}
                    className={prog.ready && !isHarvesting ? 'kk-ready-plot' : ''}
                    style={{ ...styles.soilMound, ...(prog.ready ? styles.soilMoundReady : {}) }}
                    onClick={() => prog.ready && !isHarvesting && triggerCollect(pen)}
                  >
                    <div className={isHarvesting ? 'kk-harvest-pop' : ''} style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div className="kk-idle-bob" style={{ fontSize: 30, filter: 'drop-shadow(0 0 10px rgba(74,255,176,0.35))' }}>{prog.animal.icon}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, marginTop: 6, color: '#8FA69C' }}>{prog.animal.name}</div>
                    </div>
                    {prog.ready ? <div className="kk-ready-badge" style={styles.readyBadge}>Collect</div> : <div style={styles.plotTimer}>{prog.pct}%</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ padding: '0 18px 10px', fontSize: 10.5, color: '#5C7268', position: 'relative', zIndex: 2 }}>
            Animals stay in their pen and keep producing — no need to buy again after collecting.
          </div>
        </>
      )}
    </>
  );
}

function MarketScreen({ now, warehouse, demandEvents, onBuySeed, onBuySeedDirect, onBuyAnimal, onSell }) {
  const [tab, setTab] = useState('sell');
  const cropList = Object.values(CROPS);
  const animalList = Object.values(ANIMALS);
  const { crop: seasonalCrop, endOfDay } = getTodaysSeasonalCrop(now);
  const warehouseEntries = Object.entries(warehouse || {}).filter(([, count]) => count > 0);

  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Market Mood</div>
        <div style={styles.sectionMeta}>live</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={styles.card}>
          {cropList.slice(0, 4).map((c, i) => {
            const prev = moodIndexAt(c.asset, now - 60000);
            const curr = moodIndexAt(c.asset, now);
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
                  <Sparkline assetId={c.asset} now={now} windowSec={60} opacity={1} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: up ? '#4AFFB0' : '#FF6B5C' }}>{up ? '+' : ''}{pct.toFixed(1)}%</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 7 }}>
          {[['sell', '💰 Sell'], ['seeds', '🌾 Crops'], ['animals', '🐄 Animals']].map(([key, label]) => (
            <div key={key} onClick={() => setTab(key)} style={{ ...styles.tfBtn, flex: 1, padding: '9px 0', fontSize: 11.5, textAlign: 'center', ...(tab === key ? styles.tfBtnActive : {}) }}>{label}</div>
          ))}
        </div>
      </div>

      {tab === 'sell' && (
        <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
          {warehouseEntries.length === 0 ? (
            <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>
              Your warehouse is empty. Harvest crops or collect from the ranch first, then come back here to sell.
            </div>
          ) : (
            <div style={styles.card}>
              {warehouseEntries.map(([itemId, count], i) => {
                const item = getItem(itemId);
                const demand = getActiveDemandForAsset(demandEvents, item.asset, now);
                const demandMult = demand ? demand.multiplier : 1.0;
                const moodMult = priceMultiplierFromMood(moodIndexAt(item.asset, now));
                const unitPrice = Math.max(1, Math.round(item.baseValue * demandMult * moodMult));
                return (
                  <div key={itemId} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={styles.rowIcon}>{item.icon}</div>
                      <div>
                        <div style={styles.rowTitle}>{item.name} × {count}</div>
                        <div style={styles.rowSub}>
                          {unitPrice} coins each{demandMult > 1 ? ` · ⚡×${demandMult.toFixed(1)}` : ''}
                        </div>
                      </div>
                    </div>
                    <button style={styles.btnMint} onClick={() => onSell(itemId, count)}>Sell all · {unitPrice * count}</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'seeds' && (
        <>
          <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
            <div style={styles.seasonalCard}>
              <div style={{ fontSize: 34 }}>{seasonalCrop.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14 }}>{seasonalCrop.name}</div>
                <div style={{ fontSize: 10.5, color: '#E8C468', marginTop: 2 }}>{seasonalCrop.tier} · ~{seasonalCrop.baseValue} coins/harvest · {fmtGrowDuration(seasonalCrop.growSec)} grow</div>
                <div style={{ fontSize: 9.5, color: '#8FA69C', marginTop: 2 }}>Only available today — a different seed rotates in tomorrow</div>
              </div>
              <button style={styles.btnMint} onClick={() => onBuySeedDirect(seasonalCrop.id)}>{seasonalCrop.seedCost} coins</button>
            </div>
          </div>
          <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
            <div style={styles.card}>
              {cropList.map((c, i) => (
                <div key={c.id} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={styles.rowIcon}>{c.icon}</div>
                    <div>
                      <div style={styles.rowTitle}>{c.name}</div>
                      <div style={styles.rowSub}>{fmtGrowDuration(c.growSec)} grow · ~{c.baseValue} coins/harvest</div>
                    </div>
                  </div>
                  <button style={styles.btnGhost} onClick={() => onBuySeed(c.id)}>{c.seedCost} {c.seedCurrency === 'coins' ? 'coins' : 'gems'}</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'animals' && (
        <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
          <div style={styles.card}>
            {animalList.map((a, i) => (
              <div key={a.id} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={styles.rowIcon}>{a.icon}</div>
                  <div>
                    <div style={styles.rowTitle}>{a.name}</div>
                    <div style={styles.rowSub}>Produces {getItem(a.productId).icon} {getItem(a.productId).name} every {fmtGrowDuration(a.cycleSec)}</div>
                  </div>
                </div>
                <button style={styles.btnGhost} onClick={() => onBuyAnimal(a.id)}>{a.seedCost} coins</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function WarehouseScreen({ tx, unlockedAchievements, warehouse }) {
  const historyTx = tx.filter((t) => t.title.includes('→') || t.title.startsWith('Sold') || t.title.startsWith('Daily') || t.title.startsWith('Claimed'));
  const unlockedSet = new Set(unlockedAchievements || []);
  const unlockedCount = ACHIEVEMENTS.filter((a) => unlockedSet.has(a.id)).length;
  const warehouseEntries = Object.entries(warehouse || {}).filter(([, count]) => count > 0);

  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>🎒 Inventory</div>
        <div style={styles.sectionMeta}>{warehouseEntries.length} item types</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        {warehouseEntries.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '20px 16px' }}>
            Nothing stored yet. Harvest crops or collect from the ranch to fill your warehouse.
          </div>
        ) : (
          <div style={styles.whGrid}>
            {warehouseEntries.map(([itemId, count]) => {
              const item = getItem(itemId);
              return (
                <div key={itemId} style={styles.whItem}>
                  <div style={styles.whCount}>{count}</div>
                  <div style={{ fontSize: 22 }}>{item.icon}</div>
                  <div style={{ fontSize: 8.5, color: '#5C7268', textAlign: 'center', padding: '0 4px', marginTop: 2 }}>{item.name}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={styles.sectionHead}>
        <div style={{ ...styles.sectionTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon src={ICON_STAR} size={18} /> Achievements
        </div>
        <div style={styles.sectionMeta}>{unlockedCount} / {ACHIEVEMENTS.length}</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={styles.card}>
          {ACHIEVEMENTS.map((a, i) => {
            const unlocked = unlockedSet.has(a.id);
            return (
              <div key={a.id} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none', opacity: unlocked ? 1 : 0.45 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ ...styles.rowIcon, background: unlocked ? 'rgba(74,255,176,0.12)' : '#182B25' }}>{unlocked ? a.icon : <Icon src={ICON_LOCK} size={16} />}</div>
                  <div>
                    <div style={styles.rowTitle}>{a.name}</div>
                    <div style={styles.rowSub}>{a.desc}</div>
                  </div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: unlocked ? '#4AFFB0' : '#5C7268' }}>
                  {unlocked ? '✓' : <>+{a.reward}<Icon src={ICON_GEM} size={11} style={{ marginLeft: 2 }} /></>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Activity History</div>
        <div style={styles.sectionMeta}>{historyTx.length} entries</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {historyTx.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '28px 16px' }}>No activity yet.</div>
        ) : (
          <div style={styles.card}>
            {historyTx.map((t, i) => (
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

function WalletScreen({ coins, gems, tx, onTopUp, onExchange }) {
  return (
    <>
      <div style={styles.balanceHero}>
        <div style={{ fontSize: 11, color: '#8FA69C', letterSpacing: '0.03em', position: 'relative', zIndex: 2 }}>Total Balance</div>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 34, marginTop: 6, position: 'relative', zIndex: 2 }}>
          {coins.toLocaleString('en-US')} <span style={{ fontSize: 16, color: '#8FA69C', fontWeight: 500 }}>coins</span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: '#4AFFB0', marginTop: 4, position: 'relative', zIndex: 2 }}>{gems} gems available</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, position: 'relative', zIndex: 2 }}>
          <button style={{ ...styles.btnMint, flex: 1 }} onClick={onTopUp}>Top Up</button>
          <button style={{ ...styles.btnGhost, flex: 1 }} onClick={onExchange}>Exchange Gems</button>
        </div>
      </div>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>History</div>
        <div style={styles.sectionMeta}>{tx.length} transactions</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {tx.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '28px 16px' }}>No transactions yet.</div>
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

function LeaderboardScreen({ profile, onClaim, showToast }) {
  const [rows, setRows] = useState(null);
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
  function shareCode() {
    if (!profile) return;
    const botUsername = window.__BOT_USERNAME__;
    if (!botUsername) {
      copyCode();
      showToast('Bot username not configured — code copied instead, share it manually.');
      return;
    }
    const deepLink = `https://t.me/${botUsername}?startapp=${profile.playerId}`;
    const text = `Come farm crypto with me on Crypto Farm 🌱 Use my link and we both get a bonus!`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(text)}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  }

  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Referral Code</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={styles.card}>
          <div style={{ fontSize: 11, color: '#8FA69C', marginBottom: 8 }}>Share this code with friends. When they claim it, you get +1 referral (shown on the board).</div>
          <div style={{ background: '#182B25', border: '1px solid #223530', borderRadius: 10, padding: '9px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: '#4AFFB0', letterSpacing: '0.05em', marginBottom: 8 }}>
            {profile?.playerId || '...'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={copyCode} style={{ ...styles.btnGhostSm, flex: 1 }}>{copied ? '✓ Copied' : 'Copy Code'}</button>
            <button onClick={shareCode} style={{ ...styles.btnMint, flex: 1 }}>Share Link</button>
          </div>
          <div style={{ height: 1, background: '#223530', margin: '14px 0' }} />
          <div style={{ fontSize: 11, color: '#8FA69C', marginBottom: 8 }}>Got a code from a friend? Claim it here (+30 gems, one-time use per code):</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Enter a friend's code" style={styles.codeInput} />
            <button onClick={() => { onClaim(codeInput); setCodeInput(''); }} style={styles.btnMint}>Claim</button>
          </div>
        </div>
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Leaderboard</div>
        <div style={{ ...styles.sectionMeta, cursor: 'pointer' }} onClick={() => setRefreshKey((k) => k + 1)}>↻ Refresh</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {rows === null ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>Loading leaderboard…</div>
        ) : rows.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>No other players yet. Be the first!</div>
        ) : (
          <div style={styles.card}>
            {rows.slice(0, 15).map((r, i) => {
              const isMe = r.playerId === profile?.playerId;
              return (
                <div key={r.playerId} style={{ ...styles.listRow, borderTop: i > 0 ? '1px solid #223530' : 'none', opacity: isMe ? 1 : 0.9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ ...styles.rowIcon, background: isMe ? 'rgba(74,255,176,0.15)' : '#182B25', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700 }}>{i + 1}</div>
                    <div>
                      <div style={{ ...styles.rowTitle, color: isMe ? '#4AFFB0' : '#EAF3EE' }}>{r.nickname}{isMe ? ' (You)' : ''}</div>
                      <div style={styles.rowSub}>Lv{r.level} · {r.referrals || 0} referrals</div>
                    </div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: '#E8C468', display: 'flex', alignItems: 'center', gap: 4 }}><Icon src={ICON_COIN} size={13} /> {r.coins.toLocaleString('en-US')}</div>
                </div>
              );
            })}
          </div>
        )}
        {myRank > 15 && <div style={{ fontSize: 10.5, color: '#5C7268', textAlign: 'center', marginTop: 10 }}>Your current rank: #{myRank}</div>}
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
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 16 }}>Choose a Seed</div>
            <button onClick={onClose} style={styles.closeBtn}>✕</button>
          </div>
          <div style={{ fontSize: 9.5, color: '#5C7268', marginBottom: 10, lineHeight: 1.4 }}>Harvested crops go to your Warehouse — sell them at the Market whenever you like.</div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 20px 12px' }}>
          {cropList.map((c, i) => {
            const balance = c.seedCurrency === 'coins' ? coins : gems;
            const affordable = balance >= c.seedCost;
            return (
              <div key={c.id} style={{ ...styles.seedRow, borderTop: i > 0 ? '1px solid #1B2823' : 'none', opacity: affordable ? 1 : 0.4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={styles.rowIconSm}>{c.icon}</div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 9.5, color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace", marginTop: 1 }}>{fmtGrowDuration(c.growSec)} grow</div>
                  </div>
                </div>
                <button style={{ ...styles.btnGhostSm, opacity: affordable ? 1 : 0.5, cursor: affordable ? 'pointer' : 'not-allowed' }} onClick={() => affordable && onPick(c.id)} disabled={!affordable}>
                  {c.seedCost} {c.seedCurrency === 'coins' ? 'coins' : 'gems'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AnimalPickerSheet({ coins, gems, onPick, onClose }) {
  const animalList = Object.values(ANIMALS);
  return (
    <div style={styles.sheetBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...styles.sheet, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '18px 0 0' }}>
        <div style={{ padding: '0 20px' }}>
          <div style={styles.sheetHandle} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 16 }}>Choose an Animal</div>
            <button onClick={onClose} style={styles.closeBtn}>✕</button>
          </div>
          <div style={{ fontSize: 9.5, color: '#5C7268', marginBottom: 10, lineHeight: 1.4 }}>Bought once — keeps producing on a cycle forever, no need to re-buy after collecting.</div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 20px 12px' }}>
          {animalList.map((a, i) => {
            const balance = a.seedCurrency === 'coins' ? coins : gems;
            const affordable = balance >= a.seedCost;
            const product = getItem(a.productId);
            return (
              <div key={a.id} style={{ ...styles.seedRow, borderTop: i > 0 ? '1px solid #1B2823' : 'none', opacity: affordable ? 1 : 0.4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={styles.rowIconSm}>{a.icon}</div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: 9.5, color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace", marginTop: 1 }}>{product.icon} every {fmtGrowDuration(a.cycleSec)}</div>
                  </div>
                </div>
                <button style={{ ...styles.btnGhostSm, opacity: affordable ? 1 : 0.5, cursor: affordable ? 'pointer' : 'not-allowed' }} onClick={() => affordable && onPick(a.id)} disabled={!affordable}>
                  {a.seedCost} coins
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TopUpSheet({ onPickStars, onPickTon, payingPackage, onClose }) {
  const [method, setMethod] = useState('stars');
  const [tonWallet, setTonWallet] = useState(null);

  useEffect(() => {
    const ui = getTonConnectUI();
    setTonWallet(ui.wallet);
    const unsubscribe = ui.onStatusChange((wallet) => setTonWallet(wallet));
    return () => unsubscribe && unsubscribe();
  }, []);

  const starPackages = [
    { key: 'small', coins: 100, price: '⭐ 20', note: 'Small Pack' },
    { key: 'medium', coins: 300, price: '⭐ 50', note: 'Medium Pack', badge: 'Popular' },
    { key: 'large', coins: 750, price: '⭐ 100', note: 'Large Pack' },
    { key: 'jumbo', coins: 2000, price: '⭐ 250', note: 'Jumbo Pack' },
  ];
  const tonPackages = [
    { key: 'small', coins: 100, price: '0.5 TON', note: 'Small Pack' },
    { key: 'medium', coins: 300, price: '1.2 TON', note: 'Medium Pack', badge: 'Popular' },
    { key: 'large', coins: 750, price: '2.5 TON', note: 'Large Pack' },
    { key: 'jumbo', coins: 2000, price: '6 TON', note: 'Jumbo Pack' },
  ];
  const packages = method === 'stars' ? starPackages : tonPackages;
  const onPick = method === 'stars' ? onPickStars : onPickTon;

  return (
    <div style={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modalCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 17 }}>Top Up Coins</div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 7, margin: '10px 0 14px' }}>
          <div onClick={() => setMethod('stars')} style={{ ...styles.tfBtn, textAlign: 'center', ...(method === 'stars' ? styles.tfBtnActive : {}) }}>⭐ Stars</div>
          <div onClick={() => setMethod('ton')} style={{ ...styles.tfBtn, textAlign: 'center', ...(method === 'ton' ? styles.tfBtnActive : {}) }}>💎 TON</div>
        </div>
        {method === 'stars' && <div style={{ fontSize: 11.5, color: '#8FA69C', marginBottom: 16 }}>Paid with Telegram Stars — Telegram's built-in payment method.</div>}
        {method === 'ton' && (
          <>
            <div style={{ fontSize: 11.5, color: '#8FA69C', marginBottom: 12 }}>Pay directly from a TON wallet (Tonkeeper, etc). One-way purchase — coins are virtual and not redeemable.</div>
            {!tonWallet ? (
              <button onClick={connectWallet} style={{ ...styles.btnMint, width: '100%', padding: '11px 0', marginBottom: 16 }}>Connect TON Wallet</button>
            ) : (
              <div style={{ ...styles.card, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace" }}>✓ {tonWallet.account.address.slice(0, 4)}…{tonWallet.account.address.slice(-4)}</span>
                <span style={{ fontSize: 10, color: '#5C7268' }}>Connected</span>
              </div>
            )}
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, opacity: method === 'ton' && !tonWallet ? 0.4 : 1, pointerEvents: method === 'ton' && !tonWallet ? 'none' : 'auto' }}>
          {packages.map((p) => {
            const isPaying = payingPackage === p.key;
            const disabled = payingPackage && !isPaying;
            return (
              <button key={p.key} onClick={() => !payingPackage && onPick(p.key)} style={{ ...styles.topupCard, opacity: disabled ? 0.4 : 1, cursor: payingPackage ? 'default' : 'pointer' }}>
                {p.badge && <div style={styles.topupBadge}>{p.badge}</div>}
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 600, color: '#E8C468', display: 'flex', alignItems: 'center', gap: 5 }}><Icon src={ICON_COIN} size={17} /> {p.coins.toLocaleString('en-US')}</div>
                <div style={{ fontSize: 10.5, color: '#8FA69C', marginTop: 3 }}>{p.note}</div>
                <div style={{ fontSize: 12, color: '#4AFFB0', marginTop: 6, fontWeight: 600 }}>{isPaying ? 'Processing…' : p.price}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExchangeSheet({ gems, rate, onPick, onClose }) {
  const options = [1, 5, 10, gems].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i).sort((a, b) => a - b);
  return (
    <div style={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modalCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 17 }}>Exchange Gems</div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={{ fontSize: 11.5, color: '#8FA69C', marginBottom: 16 }}>
          Current rate: <span style={{ color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace" }}>1 gem = {rate} coins</span> · You have {gems} gems
        </div>
        {gems === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>You're out of gems. Earn some from achievements first.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.map((amt) => (
              <button key={amt} onClick={() => onPick(amt)} style={styles.exchangeRow} disabled={amt > gems}>
                <span>{amt === gems ? `All (${amt} gems)` : `${amt} gems`}</span>
                <span style={{ color: '#E8C468', fontFamily: "'IBM Plex Mono', monospace" }}>→ {(amt * rate).toLocaleString('en-US')} coins</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RewardBurst({ effect, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1400);
    return () => clearTimeout(t);
  }, [onDone]);
  const icon = effect.icon === 'gem' ? ICON_GEM : ICON_COIN;
  const particles = Array.from({ length: 10 }, (_, i) => i);
  return (
    <div style={styles.burstBackdrop}>
      <div style={{ position: 'relative', width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {particles.map((i) => {
          const angle = (360 / particles.length) * i;
          return (
            <div key={i} className="kk-burst-particle" style={{ position: 'absolute', width: 6, height: 6, borderRadius: '50%', background: effect.icon === 'gem' ? '#4AFFB0' : '#E8C468', '--angle': `${angle}deg`, animationDelay: `${i * 0.02}s` }} />
          );
        })}
        <div className="kk-burst-icon" style={{ position: 'relative', zIndex: 2 }}>
          <img src={icon} alt="" style={{ width: 88, height: 88, objectFit: 'contain', filter: `drop-shadow(0 0 24px ${effect.icon === 'gem' ? 'rgba(74,255,176,0.6)' : 'rgba(232,196,104,0.6)'})` }} />
        </div>
        {effect.amount > 0 && <div className="kk-burst-label" style={styles.burstLabel}>+{effect.amount.toLocaleString('en-US')}</div>}
      </div>
    </div>
  );
}

const TUTORIAL_STEPS = [
  { emoji: '🌱', title: 'Welcome to Crypto Farm', body: 'Grow crops and raise animals, collect what they produce, then sell it at the Market. No guessing, no risk — every sale pays out.' },
  { emoji: '🌾', title: '1. Farm crops', body: 'Buy a seed at the Market, plant it on a plot. It grows on its own — even while the app is closed. Harvesting a crop clears the plot and stores the item in your Warehouse.' },
  { emoji: '🐄', title: '2. Raise animals', body: 'Switch to the Ranch tab, buy a Chicken, Goat, or Cow once — it keeps producing Eggs, Wool, or Milk on a repeating cycle forever, no need to buy again.' },
  { emoji: '🎒', title: '3. Warehouse', body: 'Everything you harvest or collect sits in your Warehouse first — nothing becomes coins automatically.' },
  { emoji: '💰', title: '4. Sell at the Market', body: 'Go to Market → Sell tab to turn your stored goods into coins. Prices move with Market Mood, and ⚡ High Demand events pay extra — timing your sale matters.' },
  { emoji: '⭐', title: 'Level up & achievements', body: 'Every harvest/collection earns XP — leveling up unlocks more farm plots. Achievements hand out bonus gems. Check the Board tab for the leaderboard and your referral code.' },
];

function TutorialModal({ onClose }) {
  const [step, setStep] = useState(0);
  const isLast = step === TUTORIAL_STEPS.length - 1;
  const current = TUTORIAL_STEPS[step];
  return (
    <div style={styles.sheetBackdrop}>
      <div style={{ ...styles.sheet, paddingBottom: 24 }}>
        <div style={styles.sheetHandle} />
        <div style={{ textAlign: 'center', padding: '8px 8px 4px' }}>
          <div style={{ fontSize: 46, marginBottom: 10 }}>{current.emoji}</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 10 }}>{current.title}</div>
          <div style={{ fontSize: 13, color: '#8FA69C', lineHeight: 1.6, padding: '0 4px' }}>{current.body}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '20px 0' }}>
          {TUTORIAL_STEPS.map((_, i) => (
            <div key={i} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 100, background: i === step ? '#4AFFB0' : '#223530', transition: 'all 0.2s ease' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 0 && <button onClick={() => setStep((s) => s - 1)} style={{ ...styles.btnGhost, flex: 1 }}>Back</button>}
          <button onClick={() => (isLast ? onClose() : setStep((s) => s + 1))} style={{ ...styles.btnMint, flex: step > 0 ? 1 : undefined, width: step > 0 ? undefined : '100%', padding: '11px 0' }}>
            {isLast ? "Let's play!" : 'Next'}
          </button>
        </div>
        {!isLast && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <span onClick={onClose} style={{ fontSize: 11.5, color: '#5C7268', cursor: 'pointer', textDecoration: 'underline' }}>Skip</span>
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
  brandMark: { width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: 'drop-shadow(0 0 10px rgba(74,255,176,0.35))' },
  brandText: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16.5, letterSpacing: '-0.01em' },
  brandSub: { fontSize: 10, color: '#5C7268', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: -1 },
  pill: { display: 'flex', alignItems: 'center', gap: 6, background: '#131F1B', border: '1px solid #223530', padding: '7px 11px 7px 8px', borderRadius: 100, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 600 },
  dot: { width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 },
  helpBtn: { width: 26, height: 26, borderRadius: '50%', background: '#131F1B', border: '1px solid #223530', color: '#8FA69C', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ticker: { margin: '8px 18px 4px', background: '#131F1B', border: '1px solid #223530', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2, overflow: 'hidden' },
  tickerLabel: { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#5C7268', fontWeight: 600, whiteSpace: 'nowrap' },
  sectionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '22px 18px 10px', position: 'relative', zIndex: 2 },
  sectionTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 18 },
  sectionMeta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#8FA69C' },
  farmGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '4px 18px 18px', position: 'relative', zIndex: 2 },
  levelBar: { display: 'flex', alignItems: 'center', gap: 10, margin: '10px 18px 0', background: '#131F1B', border: '1px solid #223530', borderRadius: 14, padding: '10px 14px', position: 'relative', zIndex: 2 },
  levelBadge: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, color: '#06231A', background: '#4AFFB0', borderRadius: 8, padding: '4px 9px', flexShrink: 0 },
  xpTrack: { width: '100%', height: 6, background: '#182B25', borderRadius: 100, overflow: 'hidden' },
  xpFill: { height: '100%', background: 'linear-gradient(90deg, #2A6B54, #4AFFB0)', borderRadius: 100, transition: 'width 0.5s ease' },
  plot: { aspectRatio: 0.92, background: '#131F1B', border: '1px solid #223530', borderRadius: 18, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  soilMound: {
    aspectRatio: 0.92,
    background: 'radial-gradient(ellipse at 50% 85%, #1C2E24 0%, #131F1B 60%, #0F1815 100%)',
    border: '1px solid #223530',
    borderRadius: '42% 42% 34% 34% / 50% 50% 30% 30%',
    position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    boxShadow: 'inset 0 -8px 14px rgba(0,0,0,0.35)',
  },
  soilMoundReady: { borderColor: '#4AFFB0' },
  readyBadge: { position: 'absolute', bottom: 8, left: '50%', background: '#4AFFB0', color: '#06231A', fontSize: 9, fontWeight: 700, letterSpacing: '0.03em', padding: '3px 9px', borderRadius: 100, textTransform: 'uppercase', zIndex: 3 },
  plotTimer: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, color: '#5C7268', position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 3 },
  card: { background: '#131F1B', border: '1px solid #223530', borderRadius: 18, padding: '14px 16px' },
  seasonalCard: { display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, rgba(232,196,104,0.12), rgba(74,255,176,0.05))', border: '1px solid #4A3A20', borderRadius: 18, padding: '14px 16px' },
  listRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0' },
  seedRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid #1B2823' },
  rowIcon: { fontSize: 20, width: 38, height: 38, background: '#182B25', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  rowIconSm: { fontSize: 16, width: 32, height: 32, background: '#182B25', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowTitle: { fontSize: 13, fontWeight: 600 },
  rowSub: { fontSize: 10.5, color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace", marginTop: 1 },
  whGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 },
  whItem: { aspectRatio: 1, background: '#131F1B', border: '1px solid #223530', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, position: 'relative' },
  whCount: { position: 'absolute', top: 5, right: 5, background: '#182B25', border: '1px solid #223530', fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, padding: '1px 5px', borderRadius: 100, color: '#4AFFB0', fontWeight: 700 },
  btnGhost: { background: '#182B25', color: '#EAF3EE', border: '1px solid #223530', borderRadius: 12, padding: '7px 12px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 11.5, cursor: 'pointer' },
  btnGhostSm: { background: '#182B25', color: '#EAF3EE', border: '1px solid #223530', borderRadius: 10, padding: '6px 10px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 10.5, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' },
  btnMint: { background: '#4AFFB0', color: '#06231A', border: 'none', borderRadius: 12, padding: '9px 14px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 12.5, cursor: 'pointer' },
  codeInput: { flex: 1, background: '#182B25', border: '1px solid #223530', borderRadius: 10, padding: '9px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: '#EAF3EE', outline: 'none' },
  balanceHero: { margin: '4px 18px 8px', background: 'linear-gradient(150deg, #16302A 0%, #0F211D 100%)', border: '1px solid #223530', borderRadius: 22, padding: '22px 20px', position: 'relative', overflow: 'hidden' },
  bottomNav: { marginTop: 'auto', display: 'flex', justifyContent: 'space-around', padding: '12px 10px 20px', background: 'linear-gradient(180deg, rgba(19,31,27,0) 0%, #101B17 30%)', borderTop: '1px solid #223530', position: 'sticky', bottom: 0, zIndex: 10 },
  navItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '4px 14px', position: 'relative', cursor: 'pointer', background: 'none', border: 'none', fontFamily: "'Inter', sans-serif" },
  navIndicator: { position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', width: 18, height: 2.5, background: '#4AFFB0', borderRadius: 4, boxShadow: '0 0 8px rgba(74,255,176,0.6)' },
  sheetBackdrop: { position: 'fixed', inset: 0, background: 'rgba(4,8,7,0.7)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 },
  sheet: { width: '100%', maxWidth: 430, background: '#131F1B', borderTop: '1px solid #223530', borderRadius: '24px 24px 0 0', padding: '22px 20px calc(26px + env(safe-area-inset-bottom))' },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(4,8,7,0.7)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '0 20px' },
  modalCard: { width: '100%', maxWidth: 400, background: '#131F1B', border: '1px solid #223530', borderRadius: 22, padding: '22px 20px 24px' },
  burstBackdrop: { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, pointerEvents: 'none' },
  burstLabel: { position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20, color: '#E8C468', textShadow: '0 0 16px rgba(232,196,104,0.7)', whiteSpace: 'nowrap' },
  sheetHandle: { width: 36, height: 4, background: '#223530', borderRadius: 10, margin: '0 auto 18px' },
  closeBtn: { width: 28, height: 28, borderRadius: '50%', background: '#182B25', border: '1px solid #223530', color: '#8FA69C', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tfBtn: { flex: 1, padding: '10px 0', borderRadius: 12, border: '1px solid #223530', background: '#182B25', color: '#8FA69C', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s ease' },
  tfBtnActive: { borderColor: '#4AFFB0', color: '#06231A', background: '#4AFFB0', fontWeight: 700 },
  topupCard: { position: 'relative', background: '#182B25', border: '1px solid #223530', borderRadius: 14, padding: '16px 12px', textAlign: 'left', cursor: 'pointer' },
  topupBadge: { position: 'absolute', top: -8, right: 10, background: '#4AFFB0', color: '#06231A', fontSize: 8.5, fontWeight: 700, padding: '2px 8px', borderRadius: 100, textTransform: 'uppercase' },
  exchangeRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#182B25', border: '1px solid #223530', borderRadius: 12, padding: '13px 15px', fontSize: 13, fontWeight: 600, color: '#EAF3EE', cursor: 'pointer' },
  toast: { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#182B25', border: '1px solid #223530', color: '#EAF3EE', padding: '10px 16px', borderRadius: 12, fontSize: 12.5, fontWeight: 600, zIndex: 60 },
};
