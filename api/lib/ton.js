// Queries toncenter.com's public API for recent incoming transactions to our
// receiving wallet, looking for one whose comment matches our order id and
// whose value covers the expected amount. This is how we verify a TON
// payment actually happened on-chain, without trusting the client.
const TONCENTER_BASE = 'https://toncenter.com/api/v2';

export async function findIncomingTonPayment(toAddress, orderId, minNano) {
  const apiKey = process.env.TONCENTER_API_KEY; // optional, raises rate limits
  const url = `${TONCENTER_BASE}/getTransactions?address=${encodeURIComponent(toAddress)}&limit=30&archival=false${apiKey ? `&api_key=${apiKey}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`toncenter request failed: ${res.status}`);
  const data = await res.json();
  const txs = data?.result || [];

  for (const tx of txs) {
    const inMsg = tx.in_msg;
    if (!inMsg || !inMsg.value) continue;
    const comment = extractComment(inMsg);
    if (comment !== orderId) continue;
    const value = BigInt(inMsg.value);
    if (value >= BigInt(minNano)) {
      return { found: true, txHash: tx.transaction_id?.hash, value: inMsg.value };
    }
  }
  return { found: false };
}

function extractComment(inMsg) {
  // toncenter returns decoded text comments in msg_data.text for simple
  // text-comment transfers (the same format our frontend constructs).
  if (inMsg.msg_data?.['@type'] === 'msg.dataText' && inMsg.message) {
    return inMsg.message;
  }
  // Some responses expose it directly as `comment`.
  if (typeof inMsg.comment === 'string') return inMsg.comment;
  return null;
}
