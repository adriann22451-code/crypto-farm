const BASE = 'https://api.telegram.org/bot';

async function callTelegram(method, body) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set');
  const res = await fetch(`${BASE}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API ${method} failed: ${JSON.stringify(data)}`);
  return data.result;
}

// Creates a payable link for Telegram Stars (currency "XTR"). Stars have no
// decimal subdivision, so `amount` is just the integer number of Stars.
export async function createStarsInvoiceLink({ title, description, payload, amountStars }) {
  return callTelegram('createInvoiceLink', {
    title,
    description,
    payload,
    currency: 'XTR',
    prices: [{ label: title, amount: amountStars }],
  });
}

export async function answerPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage) {
  return callTelegram('answerPreCheckoutQuery', {
    pre_checkout_query_id: preCheckoutQueryId,
    ok,
    ...(errorMessage ? { error_message: errorMessage } : {}),
  });
}

export async function sendMessage(chatId, text, replyMarkup) {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}
