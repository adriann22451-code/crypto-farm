import { TonConnectUI } from '@tonconnect/ui';
import { beginCell } from '@ton/core';

let tonConnectUI = null;

// Lazily create a single shared TonConnectUI instance. Must be called after
// the DOM has a place to mount the (invisible, we build our own buttons)
// connect modal — safe to call anytime after app mount.
export function getTonConnectUI() {
  if (!tonConnectUI) {
    tonConnectUI = new TonConnectUI({
      manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
    });
  }
  return tonConnectUI;
}

export function getConnectedWallet() {
  const ui = getTonConnectUI();
  return ui.wallet; // null if not connected
}

export async function connectWallet() {
  const ui = getTonConnectUI();
  await ui.openModal();
}

export async function disconnectWallet() {
  const ui = getTonConnectUI();
  await ui.disconnect();
}

// Sends a one-way TON payment to our receiving address with a text comment
// (the order id) so the backend can match it to the right pending order.
// Returns once the wallet has signed & broadcast — does NOT wait for
// on-chain confirmation, that's what the backend polling is for.
export async function sendTonPayment({ toAddress, amountNano, comment }) {
  const ui = getTonConnectUI();
  if (!ui.connected) {
    throw new Error('Wallet not connected');
  }
  const payload = beginCell().storeUint(0, 32).storeStringTail(comment).endCell().toBoc().toString('base64');
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 300, // 5 minute validity
    messages: [
      {
        address: toAddress,
        amount: amountNano,
        payload,
      },
    ],
  });
}
