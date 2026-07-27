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
