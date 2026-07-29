import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ICON_COIN, ICON_GEM, ICON_LIGHTNING, ICON_LOCK, ICON_STAR, ICON_LOGO } from './icons.js';
import { getTonConnectUI, connectWallet, sendTonPayment } from './tonconnect.js';

function Icon({ src, size = 14, style }) {
  return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle', ...style }} />;
}

/* ================== Deterministic "market mood" engine ==================
   Purely decorative now — there is no wager tied to this anymore. It just
   drives the ticker/sparkline visuals and gates when a "High Demand" event
   gives a harvest bonus. Same value for everyone at a given moment (seeded
   by timestamp), so it feels alive without needing a real price feed.
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
  return base + drift;
}

/* ---------------- Game data ---------------- */
/* Grow duration scales with seed price: pricier seeds = longer wait, so the
   cost of a seed is felt in time invested, not just currency spent.
   Fastest crop is floored at 1 minute so nothing feels instant. Harvesting
   ALWAYS pays out — there is no losing outcome, just bigger or smaller crops. */
const CROPS = {
  gandum:   { id: 'gandum',   icon: '🌾', name: 'Glowing Wheat', tier: 'ETH-tier', asset: 'eth', growSec: 60,  baseValue: 70,  seedCost: 40, seedCurrency: 'coins' },
  jagung:   { id: 'jagung',   icon: '🌽', name: 'Neon Corn',   tier: 'ADA-tier', asset: 'ada', growSec: 95,  baseValue: 95,  seedCost: 55, seedCurrency: 'coins' },
  stroberi: { id: 'stroberi', icon: '🍓', name: 'Flash Strawberry',tier: 'DOT-tier', asset: 'dot', growSec: 130, baseValue: 115, seedCost: 65, seedCurrency: 'coins' },
  semangka: { id: 'semangka', icon: '🍉', name: 'Frozen Watermelon', tier: 'BTC-tier', asset: 'btc', growSec: 180, baseValue: 140, seedCost: 80, seedCurrency: 'coins' },
  anggur:   { id: 'anggur',   icon: '🍇', name: 'Night Grapes',  tier: 'SOL-tier', asset: 'sol', growSec: 310, baseValue: 210, seedCost: 120, seedCurrency: 'coins' },
  nanas:    { id: 'nanas',    icon: '🍍', name: 'Prime Pineapple',   tier: 'AVAX-tier',asset: 'avax', growSec: 580, baseValue: 220, seedCost: 6, seedCurrency: 'gems' },
};

const SEASONAL_CROPS = {
  melon_emas:    { id: 'melon_emas',    icon: '🍈', name: 'Gold Melon',     tier: 'BTC-tier', asset: 'btc', growSec: 240, baseValue: 260, seedCost: 100, seedCurrency: 'coins', seasonal: true },
  kelapa_kilau:  { id: 'kelapa_kilau',  icon: '🥥', name: 'Shimmer Coconut',   tier: 'ETH-tier', asset: 'eth', growSec: 150, baseValue: 165, seedCost: 65,  seedCurrency: 'coins', seasonal: true },
  markisa_petir: { id: 'markisa_petir', icon: '🫐', name: 'Thunder Passionfruit', tier: 'SOL-tier', asset: 'sol', growSec: 200, baseValue: 195, seedCost: 75,  seedCurrency: 'coins', seasonal: true },
  leci_neon:     { id: 'leci_neon',     icon: '🍒', name: 'Neon Lychee',     tier: 'ADA-tier', asset: 'ada', growSec: 120, baseValue: 130, seedCost: 50,  seedCurrency: 'coins', seasonal: true },
  kurma_prisma:  { id: 'kurma_prisma',  icon: '🌰', name: 'Prism Date',  tier: 'DOT-tier', asset: 'dot', growSec: 170, baseValue: 175, seedCost: 68,  seedCurrency: 'coins', seasonal: true },
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

const PLOT_COUNT = 9;
const STORAGE_KEY = 'kebun-kripto-state-v4';
const PROFILE_KEY = 'kebun-kripto-profile';
const TUTORIAL_SEEN_KEY = 'kebun-kripto-tutorial-seen';

function emptyPlots() {
  return Array.from({ length: PLOT_COUNT }, (_, i) => ({ id: i, cropId: null, plantedAt: null }));
}
function defaultState() {
  return {
    coins: 480,
    gems: 12,
    plots: emptyPlots(),
    tx: [],
    xp: 0,
    demandEvents: [],
    stats: { totalHarvests: 0, totalPlanted: 0, totalCoinsEarned: 0 },
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
   giving an automatic bonus to any harvest of crops tied to that tier while
   it's active. No lock-in, no choice, no downside — just a nice bonus if
   your timing happens to line up. */
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
  { id: 'first_harvest', icon: '🌱', name: 'First Harvest', desc: 'Harvest your first crop', reward: 2, check: (s) => s.totalHarvests >= 1 },
  { id: 'harvest_10', icon: '🎯', name: 'Green Thumb', desc: 'Harvest 10 crops', reward: 5, check: (s) => s.totalHarvests >= 10 },
  { id: 'harvest_50', icon: '🏹', name: 'Master Grower', desc: 'Harvest 50 crops', reward: 15, check: (s) => s.totalHarvests >= 50 },
  { id: 'harvest_100', icon: '📈', name: 'Consistent', desc: 'Harvest 100 crops', reward: 40, check: (s) => s.totalHarvests >= 100 },
  { id: 'planted_25', icon: '🌾', name: 'Busy Hands', desc: 'Plant 25 seeds total', reward: 10, check: (s) => s.totalPlanted >= 25 },
  { id: 'demand_hunter', icon: '⚡', name: 'Perfect Timing', desc: 'Harvest 5 crops during a High Demand event', reward: 15, check: (s) => s.demandWins >= 5 },
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

/* ---------------- Sparkline driven by the mood engine (decorative) ---------------- */
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
      } catch (e) {
        /* first run */
      }
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

  // master clock: growth progress + demand event spawn/expiry
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
          showToast(`⚡ ${ASSET_TIER_NAMES[spawned.asset]} is in High Demand! Harvest bonus ×${spawned.multiplier.toFixed(1)} for ${Math.round((spawned.endAt - spawned.startAt) / 1000)}s`);
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

  // Harvesting always pays out — no guess, no risk. Bigger crops just pay more.
  function harvestPlot(plot) {
    const crop = getCrop(plot.cropId);
    const demand = getActiveDemandForAsset(state.demandEvents, crop.asset, now);
    const demandMult = demand ? demand.multiplier : 1.0;
    const variance = 0.9 + Math.random() * 0.2; // small +/-10% natural variety
    const reward = Math.round(crop.baseValue * demandMult * variance);
    const xpGain = Math.round(8 + crop.baseValue / 20);

    setState((s) => {
      const stats = { ...(s.stats || { totalHarvests: 0, totalPlanted: 0, totalCoinsEarned: 0, demandWins: 0 }) };
      stats.totalHarvests = (stats.totalHarvests || 0) + 1;
      stats.totalCoinsEarned = (stats.totalCoinsEarned || 0) + reward;
      if (demandMult > 1) stats.demandWins = (stats.demandWins || 0) + 1;

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

      return {
        ...s,
        coins: s.coins + reward,
        gems,
        xp: newXp,
        stats,
        unlockedAchievements: Array.from(alreadyUnlocked),
        plots: s.plots.map((p) => (p.id === plot.id ? { id: p.id, cropId: null, plantedAt: null } : p)),
        tx: [
          {
            icon: crop.icon,
            title: `Harvested ${crop.name}${demandMult > 1 ? ` · ⚡×${demandMult.toFixed(1)} demand` : ''}`,
            value: `+${reward}`,
            dir: 'in',
            time: 'Just now',
          },
          ...s.tx,
        ].slice(0, 20),
      };
    });

    setRewardEffect({ icon: 'coin', amount: reward });
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

      // Poll for on-chain confirmation. TON blocks are quick, but public
      // indexers can lag a bit, so we retry for a couple minutes.
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
        } catch (e) {
          /* keep retrying */
        }
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

  const screenLabels = { kebun: 'Harvest Season 04', pasar: 'Market Watch', gudang: 'Storage', dompet: 'Balance Summary', papan: 'Leaderboard' };

  if (!loaded) {
    return (
      <div style={styles.body}>
        <div style={{ ...styles.device, alignItems: 'center', justifyContent: 'center', color: '#8FA69C', fontFamily: 'Inter, sans-serif' }}>
          Loading farm…
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
            now={now}
            unlockedPlots={getLevelInfo(state.xp || 0).plots}
            plotProgress={plotProgress}
            onEmptyClick={(plotId) => setSeedPickerPlot(plotId)}
            onHarvest={harvestPlot}
          />
        )}
        {screen === 'pasar' && <MarketScreen now={now} onBuy={(cropId) => setSeedPickerPlot('any-' + cropId)} onBuyDirect={buyDirect} />}
        {screen === 'gudang' && <WarehouseScreen tx={state.tx} unlockedAchievements={state.unlockedAchievements} />}
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

      {walletSheet === 'topup' && <TopUpSheet onPickStars={buyWithStars} onPickTon={buyWithTon} payingPackage={payingPackage} onClose={() => setWalletSheet(null)} />}
      {walletSheet === 'exchange' && <ExchangeSheet gems={state.gems} rate={GEM_RATE} onPick={exchangeGems} onClose={() => setWalletSheet(null)} />}

      {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}

      {rewardEffect && <RewardBurst effect={rewardEffect} onDone={() => setRewardEffect(null)} />}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

function genPlayerId() {
  return 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
function genNickname(id) {
  return 'Farmer#' + id.slice(-4).toUpperCase();
}

/* ---------------- Sub components ---------------- */

const MARKET_TIMEFRAMES = [
  { key: '1m', label: '1M', sec: 60 },
  { key: '5m', label: '5M', sec: 300 },
  { key: '15m', label: '15M', sec: 900 },
];

function Ticker({ now, demandEvents }) {
  const [tf, setTf] = useState(MARKET_TIMEFRAMES[0]);
  const assets = [
    { asset: 'btc', name: 'BTC-tier' },
    { asset: 'eth', name: 'ETH-tier' },
    { asset: 'sol', name: 'SOL-tier' },
    { asset: 'ada', name: 'ADA-tier' },
    { asset: 'dot', name: 'DOT-tier' },
    { asset: 'avax', name: 'AVAX-tier' },
  ];
  const items = assets.map((a) => {
    const prev = moodIndexAt(a.asset, now - tf.sec * 1000);
    const curr = moodIndexAt(a.asset, now);
    const pct = ((curr - prev) / Math.max(0.05, Math.abs(prev))) * 100;
    const event = getActiveDemandForAsset(demandEvents, a.asset, now);
    return { ...a, pct, up: pct >= 0, event };
  });
  return (
    <div style={styles.ticker}>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {MARKET_TIMEFRAMES.map((t) => (
          <div key={t.key} onClick={() => setTf(t)} style={{ ...styles.tickerTfBtn, ...(tf.key === t.key ? styles.tickerTfBtnActive : {}) }}>
            {t.label}
          </div>
        ))}
      </div>
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
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8FA69C' }}>
            {isMaxPlots ? 'All farm slots unlocked' : `Next slot at Level ${level + 1}`}
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

function FarmScreen({ plots, now, unlockedPlots, plotProgress, onEmptyClick, onHarvest }) {
  const filled = plots.filter((p) => p.cropId).length;
  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Your Farm</div>
        <div style={styles.sectionMeta}>{filled} / {unlockedPlots} plots</div>
      </div>
      <div style={styles.farmGrid}>
        {plots.map((plot) => {
          const locked = plot.id >= unlockedPlots;
          if (locked) {
            const levelNeeded = LEVELS.find((l) => l.plots > plot.id)?.level ?? 6;
            return (
              <div key={plot.id} style={{ ...styles.plot, borderStyle: 'dashed', opacity: 0.45 }}>
                <Icon src={ICON_LOCK} size={20} />
                <div style={{ fontSize: 9, color: '#5C7268', marginTop: 4, textAlign: 'center' }}>Requires Level {levelNeeded}</div>
              </div>
            );
          }
          const prog = plotProgress(plot);
          if (!prog) {
            return (
              <div key={plot.id} style={{ ...styles.plot, borderStyle: 'dashed' }} onClick={() => onEmptyClick(plot.id)}>
                <div className="kk-empty-plus" style={{ fontSize: 22, color: '#5C7268', fontWeight: 300 }}>+</div>
                <div style={{ fontSize: 9.5, color: '#5C7268', marginTop: 4 }}>Plant</div>
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
              onClick={() => prog.ready && onHarvest(plot)}
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
              {prog.ready ? <div className="kk-ready-badge" style={styles.readyBadge}>Harvest</div> : <div style={styles.plotTimer}>{prog.pct}%</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function MarketScreen({ now, onBuy, onBuyDirect }) {
  const [tf, setTf] = useState(MARKET_TIMEFRAMES[0]);
  const cropList = Object.values(CROPS);
  const { crop: seasonalCrop, endOfDay } = getTodaysSeasonalCrop(now);
  return (
    <>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>🌟 Seasonal Seed</div>
        <div style={styles.sectionMeta}>ends in {fmtCountdown(endOfDay - now)}</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={styles.seasonalCard}>
          <div style={{ fontSize: 34 }}>{seasonalCrop.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14 }}>{seasonalCrop.name}</div>
            <div style={{ fontSize: 10.5, color: '#E8C468', marginTop: 2 }}>
              {seasonalCrop.tier} · harvest ~{seasonalCrop.baseValue} coins · {fmtGrowDuration(seasonalCrop.growSec)} grow
            </div>
            <div style={{ fontSize: 9.5, color: '#8FA69C', marginTop: 2 }}>Only available today — a different seed rotates in tomorrow</div>
          </div>
          <button style={styles.btnMint} onClick={() => onBuyDirect(seasonalCrop.id)}>{seasonalCrop.seedCost} coins</button>
        </div>
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Market Mood</div>
        <div style={styles.sectionMeta}>live</div>
      </div>
      <div style={{ padding: '0 18px 10px', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
          {MARKET_TIMEFRAMES.map((t) => (
            <div key={t.key} onClick={() => setTf(t)} style={{ ...styles.tfBtn, flex: 1, padding: '7px 0', fontSize: 11, textAlign: 'center', ...(tf.key === t.key ? styles.tfBtnActive : {}) }}>
              {t.label}
            </div>
          ))}
        </div>
        <div style={styles.card}>
          {cropList.map((c, i) => {
            const prev = moodIndexAt(c.asset, now - tf.sec * 1000);
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
                  <Sparkline assetId={c.asset} now={now} windowSec={tf.sec} opacity={1} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: up ? '#4AFFB0' : '#FF6B5C' }}>
                    {up ? '+' : ''}{pct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 9, color: '#5C7268', marginTop: 1 }}>mood, {tf.label.toLowerCase()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>Available Seeds</div>
        <div style={styles.sectionMeta}>{cropList.length} varieties</div>
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
              <button style={styles.btnGhost} onClick={() => onBuy(c.id)}>
                {c.seedCost} {c.seedCurrency === 'coins' ? 'coins' : 'gems'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function WarehouseScreen({ tx, unlockedAchievements }) {
  const harvestTx = tx.filter((t) => t.title.startsWith('Harvested') || t.title.startsWith('Daily') || t.title.startsWith('Claimed'));
  const unlockedSet = new Set(unlockedAchievements || []);
  const unlockedCount = ACHIEVEMENTS.filter((a) => unlockedSet.has(a.id)).length;
  return (
    <>
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
        <div style={styles.sectionTitle}>Harvest History</div>
        <div style={styles.sectionMeta}>{harvestTx.length} entries</div>
      </div>
      <div style={{ padding: '0 18px 24px', position: 'relative', zIndex: 2 }}>
        {harvestTx.length === 0 ? (
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '28px 16px' }}>
            No results yet. Plant and harvest a crop to fill your storage.
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
                    <div style={{ ...styles.rowIcon, background: isMe ? 'rgba(74,255,176,0.15)' : '#182B25', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700 }}>
                      {i + 1}
                    </div>
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
          <div style={{ fontSize: 9.5, color: '#5C7268', marginBottom: 10, lineHeight: 1.4 }}>
            Every harvest pays out — bigger, pricier crops just pay more (and take longer to grow).
          </div>
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
                    <div style={{ fontSize: 9.5, color: '#8FA69C', marginTop: 2 }}>
                      ~<span style={{ color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace" }}>{c.baseValue}</span> coins per harvest
                    </div>
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

        {method === 'stars' && (
          <div style={{ fontSize: 11.5, color: '#8FA69C', marginBottom: 16 }}>Paid with Telegram Stars — Telegram's built-in payment method.</div>
        )}

        {method === 'ton' && (
          <>
            <div style={{ fontSize: 11.5, color: '#8FA69C', marginBottom: 12 }}>Pay directly from a TON wallet (Tonkeeper, etc). One-way purchase — coins are virtual and not redeemable.</div>
            {!tonWallet ? (
              <button onClick={connectWallet} style={{ ...styles.btnMint, width: '100%', padding: '11px 0', marginBottom: 16 }}>Connect TON Wallet</button>
            ) : (
              <div style={{ ...styles.card, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#4AFFB0', fontFamily: "'IBM Plex Mono', monospace" }}>
                  ✓ {tonWallet.account.address.slice(0, 4)}…{tonWallet.account.address.slice(-4)}
                </span>
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
          <div style={{ ...styles.card, textAlign: 'center', color: '#5C7268', fontSize: 12.5, padding: '24px 16px' }}>You're out of gems. Earn some from premium harvests first.</div>
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
            <div
              key={i}
              className="kk-burst-particle"
              style={{ position: 'absolute', width: 6, height: 6, borderRadius: '50%', background: effect.icon === 'gem' ? '#4AFFB0' : '#E8C468', '--angle': `${angle}deg`, animationDelay: `${i * 0.02}s` }}
            />
          );
        })}
        <div className="kk-burst-icon" style={{ position: 'relative', zIndex: 2 }}>
          <img src={icon} alt="" style={{ width: 88, height: 88, objectFit: 'contain', filter: `drop-shadow(0 0 24px ${effect.icon === 'gem' ? 'rgba(74,255,176,0.6)' : 'rgba(232,196,104,0.6)'})` }} />
        </div>
        {effect.amount > 0 && (
          <div className="kk-burst-label" style={styles.burstLabel}>+{effect.amount.toLocaleString('en-US')}</div>
        )}
      </div>
    </div>
  );
}

const TUTORIAL_STEPS = [
  { emoji: '🌱', title: 'Welcome to Crypto Farm', body: 'Plant crypto-themed crops, let them grow, then harvest for coins. No guessing, no risk — every harvest pays out.' },
  { emoji: '🌾', title: '1. Plant a seed', body: 'Go to the Market tab, buy a seed with coins. It grows on its own over time — even while the app is closed, so check back later.' },
  { emoji: '🎯', title: '2. Harvest', body: 'When a plot shows HARVEST, tap it to collect your reward right away. Bigger, pricier seeds grow slower but pay out more.' },
  { emoji: '⚡', title: 'High Demand events', body: "Watch the ticker for ⚡ High Demand — harvesting a matching crop while it's active gives an automatic bonus, no extra steps needed." },
  { emoji: '⭐', title: 'Level up & achievements', body: 'Every harvest earns XP — leveling up unlocks more farm plots (up to 9). Achievements hand out bonus gems. Check the Board tab for the leaderboard and your referral code.' },
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
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)} style={{ ...styles.btnGhost, flex: 1 }}>Back</button>
          )}
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

function fmtCountdown(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
  rowIcon: { fontSize: 20, width: 38, height: 38, background: '#182B25', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  rowIconSm: { fontSize: 16, width: 32, height: 32, background: '#182B25', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowTitle: { fontSize: 13, fontWeight: 600 },
  rowSub: { fontSize: 10.5, color: '#5C7268', fontFamily: "'IBM Plex Mono', monospace", marginTop: 1 },
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
