// TON packages — same coin amounts as the Stars packages, priced in TON.
// 1 TON = 1,000,000,000 nanoTON (the unit TonConnect transactions use).
export const TON_PACKAGES = {
  small: { coins: 100, ton: 0.5 },
  medium: { coins: 300, ton: 1.2 },
  large: { coins: 750, ton: 2.5 },
  jumbo: { coins: 2000, ton: 6 },
};

export function tonToNano(ton) {
  return Math.round(ton * 1_000_000_000).toString();
}
