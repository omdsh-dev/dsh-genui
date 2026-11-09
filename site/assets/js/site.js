/* ==========================================================================
   dsh-genui site — shell behaviour
   nav, reveals, language, plugin menu, hero morph orchestration, small utils
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ i18n -- */
const I18N = (() => {
  const DICT_URL = 'assets/i18n/en.json';
  const STORAGE_KEY = 'genui.lang';
  const zhText = new WeakMap(); // element -> original zh text/attr value
  let en = null;
  let lang = 'zh';

  function capture(el, prop, key) {
    const store = zhText.get(el) ?? {};
    if (!(key in store)) store[key] = el[prop];
    zhText.set(el, store);
  }

  function applyAttr(el) {
    const spec = el.dataset.i18nAttr;
    if (!spec) return;
    for (const pair of spec.split(',')) {
      const [attr, key] = pair.split(':').map((s) => s && s.trim());
      if (!attr || !key) continue;
      capture(el, attr, `attr:${attr}`);
      // dictionary keys use the "<attr>:<key>" form, e.g. "aria-label:nav.aria"
      const value = lang === 'en' ? en[`${attr}:${key}`] ?? en[key] : null;
      if (lang === 'en' && value) el.setAttribute(attr, value);
      else if (lang === 'zh') el.setAttribute(attr, zhText.get(el)[`attr:${attr}`]);
    }
  }

  function applyOne(el) {
    const key = el.dataset.i18n;
    if (key) {
      capture(el, 'textContent', 'text');
      const value = lang === 'en' ? en[key] : null;
      if (lang === 'en' && typeof value === 'string') el.textContent = value;
      else if (lang === 'zh') el.textContent = zhText.get(el).text;
    }
    applyAttr(el);
  }

  async function load() {
    if (en) return en;
    const res = await fetch(DICT_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`i18n ${res.status}`);
    en = await res.json();
    return en;
  }

  async function set(next) {
    if (next === lang) return;
    if (next === 'en') {
      try {
        await load();
      } catch (error) {
        console.warn('[site] English dictionary unavailable', error);
        return;
      }
    }
    lang = next;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    applyMeta();
    $$('[data-i18n], [data-i18n-attr]').forEach(applyOne);
    $$('[data-lang]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    });
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode */
    }
    document.dispatchEvent(new CustomEvent('site:lang', { detail: { lang } }));
  }

  const head = { title: document.title, description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '' };

  function applyMeta() {
    const description = document.querySelector('meta[name="description"]');
    if (lang === 'en') {
      if (en['meta.title']) document.title = en['meta.title'];
      if (description && en['meta.description']) description.setAttribute('content', en['meta.description']);
    } else {
      document.title = head.title;
      if (description && head.description) description.setAttribute('content', head.description);
    }
  }

  function init() {
    $$('[data-lang]').forEach((button) => {
      button.addEventListener('click', () => set(button.dataset.lang));
    });
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    const browserLang = (navigator.language || 'zh').toLowerCase();
    const initial = saved ?? (browserLang.startsWith('zh') ? 'zh' : 'en');
    if (initial === 'en') set('en');
  }

  return { init, set, get lang() { return lang; } };
})();

/* ------------------------------------------------------------------- nav -- */
function initNav() {
  const nav = $('#nav');
  if (!nav) return;
  let ticking = false;
  const sync = () => {
    nav.classList.toggle('is-scrolled', window.scrollY > 8);
    ticking = false;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(sync);
    },
    { passive: true },
  );
  sync();

  // plugin dropdown
  const group = $('[data-plugin-menu]');
  if (group) {
    const trigger = $('.nav__plugin-btn', group);
    const setOpen = (open) => {
      group.dataset.open = String(open);
      trigger.setAttribute('aria-expanded', String(open));
    };
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(group.dataset.open !== 'true');
    });
    document.addEventListener('click', (event) => {
      if (!group.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
  }

  // mobile sheet
  const menu = $('.nav__menu');
  const sheet = $('#nav-sheet');
  if (menu && sheet) {
    const setOpen = (open) => {
      menu.setAttribute('aria-expanded', String(open));
      sheet.dataset.open = String(open);
      document.body.style.overflow = open ? 'hidden' : '';
    };
    menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
    $$('a', sheet).forEach((link) => link.addEventListener('click', () => setOpen(false)));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') setOpen(false);
    });
    window.matchMedia('(min-width: 1081px)').addEventListener('change', (event) => {
      if (event.matches) setOpen(false);
    });
  }
}

/* ---------------------------------------------------------------- reveals -- */
function initReveals() {
  const items = $$('[data-reveal]');
  if (!items.length) return;
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
  );
  items.forEach((el) => io.observe(el));
}

/* -------------------------------------------------------------- hero morph -- */
function initHero() {
  const reply = $('[data-hero-reply]');
  if (!reply) return;
  const buttons = $$('[data-hero-mode]', reply);
  let userTouched = false;
  let autoTimer = 0;

  const setMode = (mode, { user = false } = {}) => {
    if (user) userTouched = true;
    reply.dataset.mode = mode;
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.heroMode === mode));
    });
    document.dispatchEvent(new CustomEvent('site:hero-mode', { detail: { mode } }));
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.heroMode, { user: true }));
  });

  const morphToUi = () => {
    if (userTouched || prefersReducedMotion) {
      if (prefersReducedMotion) setMode('ui');
      return;
    }
    setMode('ui');
  };

  // The real interface is mounted by assets/js/genui.js. Morph once it is ready,
  // or after a generous fallback so the page never stalls in text mode.
  document.addEventListener(
    'genui:hero-ready',
    () => {
      window.clearTimeout(autoTimer);
      autoTimer = window.setTimeout(morphToUi, 1500);
    },
    { once: true },
  );
  autoTimer = window.setTimeout(morphToUi, 4200);
}

/* ------------------------------------------------------------------ stars -- */
async function initStars() {
  const targets = $$('[data-repo-stars]');
  if (!targets.length) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://api.github.com/repos/omdsh-dev/dsh-genui', {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = await res.json();
    const stars = Number(data.stargazers_count);
    if (!Number.isFinite(stars)) return;
    const label = stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : String(stars);
    targets.forEach((el) => {
      el.textContent = label;
    });
  } catch {
    /* keep the baked value */
  }
}

/* ------------------------------------------------------------------ misc -- */
function initCopy() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const source = document.getElementById(button.dataset.copy);
    const text = source ? source.textContent.trim() : button.dataset.copyText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const label = button.querySelector('[data-copy-label]') ?? button;
      if (label.dataset.original === undefined) label.dataset.original = label.textContent;
      label.textContent = I18N.lang === 'en' ? 'Copied' : '已复制';
      button.classList.add('is-copied');
      clearTimeout(button._copyTimer);
      button._copyTimer = setTimeout(() => {
        label.textContent = label.dataset.original;
        button.classList.remove('is-copied');
      }, 1600);
    } catch {
      /* clipboard unavailable */
    }
  });
}

function initYear() {
  $$('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
}

/* ------------------------------------------------------------------ boot -- */
function boot() {
  I18N.init();
  initNav();
  initReveals();
  initHero();
  initStars();
  initCopy();
  initYear();

  // lets the genui bridge know when to start loading, and keeps the panel sized
  document.documentElement.classList.add('site-ready');
  window.__SITE__ = { lang: () => I18N.lang, prefersReducedMotion };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
