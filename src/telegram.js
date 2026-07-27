// Initializes the Telegram Mini App SDK and exposes the launching user as
// window.__TG_USER__ so the rest of the app (and storageShim.js) can use it
// as a stable identity, without needing its own login system.
//
// Falls back gracefully to a persisted anonymous id when opened outside
// Telegram (e.g. testing in a normal desktop browser during development).

export function initTelegram() {
  const tg = window.Telegram?.WebApp;

  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor?.('#0B1210');
      tg.setBackgroundColor?.('#0B1210');
    } catch (e) {
      /* older client versions may not support these calls */
    }
    const user = tg.initDataUnsafe?.user || null;
    window.__TG_USER__ = user;
    window.__TG_INIT_DATA__ = tg.initData || '';
    // Present when the app was opened via a share/deep link like
    // https://t.me/<bot>?startapp=<code> — used to auto-claim a referral
    // code without the person having to type anything in.
    window.__TG_START_PARAM__ = tg.initDataUnsafe?.start_param || null;
  } else {
    window.__TG_USER__ = null;
  }

  if (!window.__TG_USER__) {
    // Dev/browser fallback: persist a random anonymous id in localStorage so
    // repeated visits during development keep the same identity.
    let anon = localStorage.getItem('kebun-kripto-anon-id');
    if (!anon) {
      anon = 'dev' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('kebun-kripto-anon-id', anon);
    }
    window.__ANON_ID__ = anon;
  }
}
