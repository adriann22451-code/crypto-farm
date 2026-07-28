# Kebun Kripto — Telegram Mini App

Game "Kebun Kripto" dibungkus jadi Telegram Mini App beneran, dengan saldo dan
leaderboard tersimpan di Redis (Upstash), bukan cuma di local storage.

## 1. Setup Upstash Redis

1. Buka https://upstash.com → daftar (gratis).
2. Bikin database Redis baru (region terdekat, misal Singapore).
3. Di tab **REST API**, catat `UPSTASH_REDIS_REST_URL` dan
   `UPSTASH_REDIS_REST_TOKEN`.

## 2. Setup Bot Telegram

1. Chat **@BotFather** di Telegram.
2. `/newbot` → ikuti instruksinya → catat **token bot**-nya.
3. Setelah project ini dideploy dan kamu punya URL live (langkah 4), balik ke
   BotFather:
   - `/mybots` → pilih bot kamu → **Bot Settings** → **Menu Button** →
     **Configure Menu Button** → masukin URL Vercel kamu (contoh:
     `https://kebun-kripto.vercel.app`).
   - Ini yang bikin tombol "Buka App" muncul di chat bot kamu.

## 3. Deploy ke Vercel

1. Push folder ini ke GitHub repo baru.
2. Di https://vercel.com → **New Project** → import repo itu.
3. Di **Environment Variables**, tambahin:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `BOT_TOKEN` (token dari BotFather — disarankan diisi, lihat catatan
     keamanan di bawah)
4. Deploy. Vercel otomatis jalanin `npm run build` dan host `dist/` + folder
   `api/` sebagai serverless functions.
5. Setelah selesai, kamu dapat URL kayak `https://nama-project.vercel.app` —
   inilah yang dipasang di Menu Button BotFather (langkah 2.3).

## 4. Test

- Buka bot kamu di Telegram → tap tombol menu → app harus kebuka, tampilan
  sama persis kayak preview sebelumnya, tapi sekarang saldo & progress
  beneran ke-save di Redis per akun Telegram kamu.
- Kalau ditutup dan dibuka lagi (bahkan dari HP lain, asal login akun
  Telegram yang sama), progress harus tetap ada.
- Tab **Papan** (leaderboard) sekarang bakal beneran keisi kalau ada lebih
  dari satu orang yang main.

## 5. Enable Telegram Stars payments (Top Up)

Top Up now uses real Telegram Stars ⭐ instead of a simulated button. One more
setup step is needed so Telegram knows where to send payment events:

1. In Vercel, add `WEBHOOK_SECRET` to your environment variables — any long
   random string you make up (e.g. `openssl rand -hex 32`).
2. Redeploy so the new env vars take effect.
3. Register the webhook by visiting this URL once in your browser (replace
   the placeholders):

   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-vercel-domain>/api/telegram-webhook&secret_token=<WEBHOOK_SECRET>
   ```

   You should get back `{"ok":true,"result":true,...}`.
4. Test it: open the app, go to **Wallet → Top Up**, pick a package. It
   should open Telegram's native Stars payment sheet. After paying, your
   coin balance updates within a couple seconds.

### How it works

- The app asks `/api/create-invoice` for a payment link for the package you
  picked.
- That calls Telegram's `createInvoiceLink` API and embeds who's paying and
  how many coins in the invoice's `payload` field.
- `Telegram.WebApp.openInvoice()` opens Telegram's own payment UI — your
  app never touches card details or Stars balances directly.
- When payment completes, Telegram calls **your bot's webhook**
  (`/api/telegram-webhook`), which is the only place coins actually get
  credited — this can't be faked from the client, since the client never
  gets to say "I paid" and be believed.

If you ever need to check the webhook status: `https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo`

## 6. Enable "notify when prediction resolves" (works even with the app closed)

Predictions used to only resolve while the app was open (the browser tab has
to be running the countdown). Now a server-side job checks for due
predictions and DMs the player through the bot — but this needs a scheduler
to actually trigger it.

**⚠️ Important Vercel Hobby (free) plan limitation:** Vercel's free plan
only allows Cron Jobs to run **once per day**, which is far too infrequent —
predictions can resolve in as little as 1 minute. `vercel.json` in this
project does **not** include a `crons` block by default, because Vercel
rejects the entire deployment if it finds a sub-daily schedule on a Hobby
account. If you're on Hobby, skip straight to Option B below.

### Option A — Vercel Pro
1. Make sure `CRON_SECRET` is set in your environment variables.
2. Add this to `vercel.json`:
   ```json
   "crons": [{ "path": "/api/cron-resolve", "schedule": "*/5 * * * *" }]
   ```
3. Deploy — Vercel automatically calls `/api/cron-resolve` every 5 minutes,
   with its own auth, no further setup needed.

### Option B — Free external pinger (works on Vercel Hobby)
1. Make sure `CRON_SECRET` is set in your environment variables and
   redeployed.
2. Go to a free scheduler like https://cron-job.org (or GitHub Actions'
   `schedule` trigger, or https://www.easycron.com).
3. Set it to call this URL every 1–5 minutes:
   ```
   https://<your-vercel-domain>/api/cron-resolve?secret=<CRON_SECRET>
   ```
4. That's it — no code changes needed, the endpoint works the same either
   way.

### What the player sees

When their prediction resolves while the app is closed, they get a normal
Telegram message from your bot like:

```
🌾 Your predictions just resolved:

✅ 🍉 Frozen Watermelon: correct! +140 coins

🎉 Leveled up to Level 3! New farm slot unlocked.

Open Crypto Farm to keep playing 🌱
```

Reopening the app afterward shows the same updated state — the client just
pulls whatever the server already resolved.

## 7. 1-tap referral sharing (deep link)

Referral codes can now be shared as a real Telegram link instead of copy-paste
text.

1. Add `VITE_BOT_USERNAME` to your environment variables — your bot's
   `@username` without the `@`. Redeploy afterward (it's a build-time var).
2. In the app's **Board** tab, tapping **Share Link** opens Telegram's native
   share sheet with a link like `https://t.me/your_bot?startapp=p1a2b3c4`
   pre-filled.
3. When a friend taps that link, Telegram opens the Mini App directly and
   the code gets **claimed automatically** — no typing, no manual "Claim"
   button needed. They still see the usual toast confirming the +30 gems.
4. The old manual "Enter a friend's code" box is still there too, for people
   who got a code as plain text some other way (e.g. screenshot, voice call).

## 8. Bot commands (/start, /balance, /help)

The bot now replies to text commands directly in chat — useful for checking
your balance without even opening the Mini App.

1. Add `MINI_APP_URL` to your environment variables (your deployed URL, no
   trailing slash) and redeploy.
2. That's it for the code side — the webhook you already set up in section 5
   handles these automatically. Try sending your bot `/start`, `/balance`,
   or `/help`.

### Make them show up in Telegram's command menu (optional but nice)

Run this once (replace `<BOT_TOKEN>`) so the little "/" menu button next to
the message box lists these commands with descriptions:

```
https://api.telegram.org/bot<BOT_TOKEN>/setMyCommands?commands=[{"command":"start","description":"Welcome + open the app"},{"command":"balance","description":"Check your coins, gems, and level"},{"command":"help","description":"List available commands"}]
```

Paste that URL in your browser once — you should get `{"ok":true,"result":true}` back.

### What it looks like

```
/balance

📊 Your Crypto Farm balance

◆ Coins: 1,240
✦ Gems: 18
Level: 4
Current streak: 2
Predictions in progress: 1

[🌱 Open Crypto Farm]
```

## Catatan keamanan

Tanpa `BOT_TOKEN` diisi di environment variables, server percaya begitu saja
`uid` yang dikirim dari browser — cukup aman buat testing sendiri, tapi kalau
mau dirilis ke banyak orang, **isi `BOT_TOKEN`**. Dengan itu diisi, server
mem-verifikasi `initData` Telegram pakai HMAC (algoritma resmi dari
dokumentasi Telegram) sebelum percaya identitas siapa yang request — jadi
orang lain nggak bisa nyamar jadi pemain lain buat ngerusak saldo/leaderboard
mereka.

## Struktur project

```
index.html              — entry HTML, load SDK Telegram
src/main.jsx            — inisialisasi Telegram + storage shim, render App
src/telegram.js         — setup Telegram WebApp SDK, ambil identitas user
src/storageShim.js      — polyfill window.storage → panggil /api/kv
src/App.jsx             — seluruh game (logic sama persis kayak sebelumnya)
api/kv.js               — serverless function: get/set/delete/list ke Redis
api/lib/redis.js        — client Upstash Redis
api/lib/verifyTelegram.js — verifikasi HMAC initData Telegram
```

## Development lokal

```bash
npm install
npm run dev
```

Buka di browser biasa (bukan Telegram) — otomatis pakai id anonim yang
disimpan di localStorage, jadi tetap bisa dites tanpa perlu buka lewat
Telegram. `vercel dev` juga bisa dipakai kalau mau sekalian nge-test folder
`api/` secara lokal.
