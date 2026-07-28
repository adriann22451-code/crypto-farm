// Shared level-curve logic, kept in sync with src/App.jsx's LEVELS/getLevelInfo.
// Used by the /balance bot command so it can report a player's level without
// needing the full client-side game logic.
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
export function getLevelInfo(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const plots = level >= 6 ? 9 : LEVELS[level - 1].plots;
  return { level, plots };
}
