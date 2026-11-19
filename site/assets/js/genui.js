/*!
 * genui.js — site integration for the real GenUI renderer.
 *
 * Owns: loading artifacts.json, mounting every demo on the page through
 * window.GenuiBridge, the surfaces scrollytelling, the playground editor,
 * the component atlas wall, and reacting to the site language switch.
 *
 * The bridge (genui-bridge.js) is technology; this file is the page.
 */
(function () {
  'use strict';

  var B = window.GenuiBridge;
  if (!B) {
    console.warn('[genui] bridge missing — demos stay as skeletons');
    return;
  }

  var ARTIFACTS_URL = 'assets/genui/artifacts.json';
  var COMPONENTS_URL = 'content/components.json';

  /** @type {{data:object|null, byId:Object, components:Object|null}} */
  var store = { data: null, byId: Object.create(null), components: null };

  var HEAVY_ASSETS = ['mermaid', 'three', 'maplibre', 'echarts-full'];

  /** The composition gallery is curated: these eight read best at 590px wide. */
  var CURATED_SHOWCASE = [
    'showcase-bento',
    'showcase-compare',
    'showcase-explain',
    'showcase-pr',
    'showcase-kpi',
    'showcase-timeline',
    'showcase-risk',
    'showcase-charts',
  ];

  function lang() {
    var value = (document.documentElement.lang || 'zh').toLowerCase();
    return value.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  function isEn() {
    return lang() === 'en';
  }

  B.configure({ base: 'assets/genui/', locale: lang() });

  /* ---------------------------------------------------------------- data -- */

  function ensureData() {
    if (store.data !== null) return Promise.resolve(store.data);
    return fetch(ARTIFACTS_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('artifacts.json: HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        store.data = data;
        (data.specs || []).forEach(function (record) {
          store.byId[record.id] = record;
        });
        return data;
      });
  }

  function record(id) {
    return store.byId[id];
  }

  function specJson(id, locale) {
    var rec = record(id);
    if (!rec) return null;
    var artifact = rec.artifacts[locale] || rec.artifacts.zh || rec.artifacts.en;
    if (!artifact) return null;
    return artifact.spec;
  }

  function ensureComponents() {
    if (store.components !== null) return Promise.resolve(store.components);
    return fetch(COMPONENTS_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('components.json: HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        store.components = data;
        return data;
      })
      .catch(function () {
        store.components = { types: [], typesByType: {} };
        return store.components;
      });
  }

  /* ---------------------------------------------------------------- hero -- */

  function initHero() {
    var host = document.querySelector('[data-hero-ui]');
    if (!host) return;
    ensureData()
      .then(function () {
        var rec = record('hero-answer');
        if (!rec) throw new Error('hero-answer spec missing');
        return B.mount(host, rec, { showLoading: false });
      })
      .then(function () {
        document.dispatchEvent(new CustomEvent('genui:hero-ready'));
      })
      .catch(function (error) {
        console.warn('[genui] hero mount failed', error);
        host.innerHTML = '<p class="genui-fallback">' + (isEn() ? 'The renderer could not start in this browser.' : '当前浏览器未能启动渲染器。') + '</p>';
      });
  }

  /* ------------------------------------------------------------ surfaces -- */

  function initSurfaces() {
    var track = document.querySelector('[data-scrolly]');
    if (!track) return;
    var pin = track.querySelector('.scrolly__pin');
    var steps = Array.prototype.slice.call(track.querySelectorAll('[data-step]'));
    var panes = Array.prototype.slice.call(track.querySelectorAll('[data-pane]'));
    var narrow = window.matchMedia('(max-width: 900px)');
    var current = -1;
    var handles = Object.create(null);
    var mountedPanes = Object.create(null);

    function mountPane(index) {
      if (mountedPanes[index]) return;
      var pane = panes[index];
      if (!pane) return;
      var mount = pane.querySelector('[data-genui-spec]');
      if (!mount) return;
      mountedPanes[index] = true;
      ensureData()
        .then(function () {
          var id = mount.getAttribute('data-genui-spec');
          var rec = record(id);
          if (!rec) throw new Error('missing spec ' + id);
          return B.mount(mount, rec, { showLoading: true });
        })
        .then(function (handle) {
          handles[index] = handle;
        })
        .catch(function (error) {
          mountedPanes[index] = false;
          console.warn('[genui] surface mount failed', error);
        });
    }

    function setStep(index) {
      if (index === current) return;
      current = index;
      steps.forEach(function (step) {
        step.classList.toggle('is-active', Number(step.getAttribute('data-step')) === index);
      });
      panes.forEach(function (pane) {
        pane.classList.toggle('is-active', Number(pane.getAttribute('data-pane')) === index);
      });
      mountPane(index);
    }

    var ticking = false;
    function sync() {
      ticking = false;
      if (narrow.matches) return;
      var rect = track.getBoundingClientRect();
      var total = track.offsetHeight - (pin ? pin.offsetHeight : 0);
      if (total <= 0) return;
      var progress = Math.min(1, Math.max(0, -rect.top / total));
      setStep(progress < 0.34 ? 0 : progress < 0.68 ? 1 : 2);
    }

    window.addEventListener(
      'scroll',
      function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(sync);
      },
      { passive: true },
    );
    window.addEventListener('resize', sync, { passive: true });

    if (narrow.matches) {
      // stacked layout: mount all three panes when the section approaches
      if (typeof IntersectionObserver === 'function') {
        var io = new IntersectionObserver(
          function (entries) {
            if (entries.some(function (entry) { return entry.isIntersecting })) {
              [0, 1, 2].forEach(mountPane);
              io.disconnect();
            }
          },
          { rootMargin: '300px 0px' },
        );
        io.observe(track);
      } else {
        [0, 1, 2].forEach(mountPane);
      }
      return;
    }
    sync();
  }

  /* ---------------------------------------------------------- playground -- */

  function countNodes(value) {
    var count = 0;
    (function walk(node) {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      if (typeof node.type === 'string') count += 1;
      Object.keys(node).forEach(function (key) {
        var child = node[key];
        if (child !== null && typeof child === 'object') walk(child);
      });
    })(value);
    return count;
  }

  function initPlayground() {
    var root = document.querySelector('[data-playground]');
    if (!root) return;
    var code = root.querySelector('[data-pg-code]');
    var stage = root.querySelector('[data-pg-stage]');
    var status = root.querySelector('[data-pg-status]');
    var copyButton = root.querySelector('[data-pg-copy]');
    var resetButton = root.querySelector('[data-pg-reset]');
    var presetButtons = Array.prototype.slice.call(root.querySelectorAll('[data-preset]'));
    if (!code || !stage || !status) return;

    var handle = null;
    var currentPreset = 'preset-dashboard';
    var dirty = false;
    var timer = 0;
    var lastError = null;

    var editorPanel = root.querySelector('.pg__panel--editor');
    var previewPanel = root.querySelector('.pg__panel--preview');

    function setStatus(kind, text) {
      status.className = 'pg__status mono' + (kind === 'ok' ? '' : ' is-' + kind);
      status.textContent = text;
      if (editorPanel) editorPanel.classList.toggle('is-error', kind === 'error');
      if (previewPanel) previewPanel.classList.toggle('is-stale', kind === 'error');
    }

    function localeSpec(id) {
      return specJson(id, lang());
    }

    function fillPreset(id, silent) {
      var spec = localeSpec(id);
      if (!spec) return false;
      code.value = JSON.stringify(spec, null, 2);
      dirty = false;
      presetButtons.forEach(function (button) {
        button.classList.toggle('is-active', button.getAttribute('data-preset') === id);
      });
      if (!silent) render();
      return true;
    }

    function unmountCurrent() {
      if (handle && typeof handle.unmount === 'function') {
        try {
          handle.unmount();
        } catch (error) {
          console.warn('[genui] playground unmount failed', error);
        }
      }
      handle = null;
    }

    function render() {
      window.clearTimeout(timer);
      var text = code.value.trim();
      if (text === '') {
        setStatus('error', isEn() ? 'empty spec' : '规格为空');
        return;
      }
      var spec;
      try {
        spec = JSON.parse(text);
      } catch (error) {
        lastError = error;
        setStatus('error', (isEn() ? 'JSON error: ' : 'JSON 有误：') + error.message.split('\n')[0]);
        return;
      }
      if (spec === null || typeof spec !== 'object' || !Array.isArray(spec.items)) {
        setStatus('error', isEn() ? 'a spec needs an "items" array' : '规格需要一个 "items" 数组');
        return;
      }
      lastError = null;
      setStatus('busy', isEn() ? 'rendering…' : '渲染中…');
      unmountCurrent();
      var artifact = {
        format: 'dsh-genui',
        version: 1,
        spec: spec,
        presentation: { locale: lang(), theme: 'dark' },
      };
      B.mount(stage, artifact, { showLoading: true })
        .then(function (nextHandle) {
          handle = nextHandle;
          var nodes = countNodes(spec);
          setStatus('ok', (isEn() ? 'valid · ' : '合法 · ') + nodes + (isEn() ? ' nodes' : ' 个节点'));
        })
        .catch(function (error) {
          setStatus('error', (isEn() ? 'renderer rejected it: ' : '渲染器拒绝了这段规格：') + String(error.message || error).split('\n')[0]);
        });
    }

    function scheduleRender() {
      window.clearTimeout(timer);
      timer = window.setTimeout(render, 420);
    }

    code.addEventListener('input', function () {
      dirty = true;
      presetButtons.forEach(function (button) { button.classList.remove('is-active'); });
      scheduleRender();
    });

    code.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      var start = code.selectionStart;
      var end = code.selectionEnd;
      code.value = code.value.slice(0, start) + '  ' + code.value.slice(end);
      code.selectionStart = code.selectionEnd = start + 2;
      dirty = true;
      scheduleRender();
    });

    presetButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        currentPreset = button.getAttribute('data-preset');
        if (!fillPreset(currentPreset)) {
          setStatus('error', isEn() ? 'preset not available' : '预设暂不可用');
        }
      });
    });

    if (resetButton) {
      resetButton.addEventListener('click', function () {
        fillPreset(currentPreset);
      });
    }

    if (copyButton) {
      copyButton.addEventListener('click', function () {
        var text = '```dsh-ui\n' + code.value.trim() + '\n```';
        var label = copyButton.querySelector('[data-copy-label]') || copyButton;
        if (!navigator.clipboard || !navigator.clipboard.writeText) return;
        navigator.clipboard.writeText(text).then(function () {
          if (label.dataset.original === undefined) label.dataset.original = label.textContent;
          label.textContent = isEn() ? 'Copied' : '已复制';
          copyButton.classList.add('is-copied');
          window.clearTimeout(copyButton._timer);
          copyButton._timer = window.setTimeout(function () {
            label.textContent = label.dataset.original;
            copyButton.classList.remove('is-copied');
          }, 1600);
        });
      });
    }

    document.addEventListener('site:lang', function () {
      if (dirty) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        if (fillPreset(currentPreset)) setStatus('ok', isEn() ? 'preset loaded' : '已载入预设');
      }, 60);
    });

    ensureData()
      .then(function () {
        if (!fillPreset(currentPreset)) {
          setStatus('error', isEn() ? 'specs unavailable' : '规格不可用');
          return;
        }
        setStatus('ok', isEn() ? 'preset loaded' : '已载入预设');
        // first render only when the section is close to the viewport
        if (!('IntersectionObserver' in window)) return render();
        var io = new IntersectionObserver(
          function (entries) {
            if (!entries.some(function (entry) { return entry.isIntersecting })) return;
            io.disconnect();
            render();
          },
          { rootMargin: '400px 0px' },
        );
        io.observe(root);
      })
      .catch(function (error) {
        console.warn('[genui] playground specs failed', error);
        setStatus('error', isEn() ? 'specs unavailable' : '规格不可用');
      });
  }

  /* --------------------------------------------------------------- atlas -- */

  /** Resolve the content inventory entry for a node type (two known shapes). */
  function componentEntry(type) {
    var inventory = store.components;
    if (!inventory) return null;
    if (inventory.typesByType && inventory.typesByType[type]) return inventory.typesByType[type];
    var list = inventory.components || inventory.types || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].type === type) return list[i];
    }
    return null;
  }

  function groupOf(type) {
    var entry = componentEntry(type);
    return (entry && entry.group) || 'display';
  }

  function labelOf(type) {
    var entry = componentEntry(type);
    if (!entry) return type;
    return (isEn() ? entry.enLabel : entry.zhLabel) || entry.zhLabel || type;
  }

  function isHeavy(rec) {
    var assets = rec.requiredAssets || [];
    return assets.some(function (name) { return HEAVY_ASSETS.indexOf(name) !== -1; });
  }

  function initAtlas() {
    var wall = document.querySelector('[data-atlas-wall]');
    var showcaseWall = document.querySelector('[data-atlas-showcase]');
    if (!wall) return;
    var filterBar = document.querySelector('[data-atlas-filters]');
    var mounted = Object.create(null);
    var handles = [];
    var observer = null;
    var cards = [];
    var nodeItems = [];
    var expanded = false;
    var activeFilter = 'all';
    var moreButton = document.querySelector('[data-atlas-more]');
    var moreLabel = moreButton && moreButton.querySelector('[data-atlas-more-label]');
    var narrow = window.matchMedia('(max-width: 720px)').matches;
    var PREVIEW_COUNT = narrow ? 8 : 16;

    function typeOf(rec) {
      var match = /^atlas-(.+)$/.exec(rec.id);
      return match ? match[1] : rec.id.replace(/^showcase-/, '');
    }

    function showcaseTitle(rec) {
      var artifact = rec.artifacts[lang()] || rec.artifacts.zh || rec.artifacts.en;
      return (artifact && artifact.spec && artifact.spec.title) || rec.id.replace(/^showcase-/, '');
    }

    function makeCard(rec, wide) {
      var id = rec.id;
      var type = typeOf(rec);
      var isShowcase = rec.category === 'showcase';
      var group = isShowcase ? 'showcase' : groupOf(type);
      var label = isShowcase ? showcaseTitle(rec) : labelOf(type);
      var card = document.createElement('figure');
      card.className = 'specimen' + (wide ? ' is-wide' : '');
      card.setAttribute('data-group', group);
      card.setAttribute('data-id', id);
      var stage = document.createElement('div');
      stage.className = 'specimen__stage is-empty';
      var hint = document.createElement('span');
      hint.className = 'specimen__hint';
      hint.innerHTML = '<i></i>' + (isEn() ? 'render on scroll' : '滚动到此处渲染');
      stage.append(hint);
      card.append(stage);

      var caption = document.createElement('figcaption');
      var name = document.createElement('span');
      name.textContent = label;
      var code = document.createElement('span');
      code.className = 'mono';
      code.textContent = isHeavy(rec) ? type + ' · heavy' : type;
      caption.append(name, code);
      card.append(caption);

      var drawer = document.createElement('div');
      drawer.className = 'specimen__code';
      var pre = document.createElement('pre');
      var artifact = rec.artifacts[lang()] || rec.artifacts.zh || rec.artifacts.en;
      pre.textContent = JSON.stringify(artifact.spec, null, 2);
      drawer.append(pre);
      card.append(drawer);

      caption.setAttribute('role', 'button');
      caption.setAttribute('tabindex', '0');
      caption.setAttribute('aria-expanded', 'false');
      caption.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        card.classList.toggle('is-open');
        caption.setAttribute('aria-expanded', String(card.classList.contains('is-open')));
      });
      caption.addEventListener('click', function () {
        var open = card.classList.toggle('is-open');
        caption.setAttribute('aria-expanded', String(open));
      });
      caption.style.cursor = 'pointer';
      caption.setAttribute('title', isEn() ? 'Show the dsh-ui source' : '查看 dsh-ui 写法');

      return { card: card, stage: stage, rec: rec, heavy: isHeavy(rec), wide: !!wide };
    }

    function mountSpecimen(item) {
      if (mounted[item.rec.id]) return;
      mounted[item.rec.id] = true;
      item.stage.classList.remove('is-empty');
      if (item.heavy) {
        item.stage.replaceChildren();
        var deferred = B.mountDeferred(item.stage, item.rec, {
          title: isEn() ? 'needs an extra engine' : '需要额外引擎',
          meta: (item.rec.requiredAssets || []).join(' + '),
          label: isEn() ? 'Render' : '渲染',
          // curated compositions sit far below the fold: by the time they are
          // visible, loading their engine is exactly what the reader wants
          trigger: item.wide ? 'visible' : 'click',
        });
        handles.push(deferred);
        return;
      }
      B.mount(item.stage, item.rec, { showLoading: false })
        .then(function (handle) {
          handles.push(handle);
          window.setTimeout(function () {
            var stage = item.stage;
            var painted = stage.querySelector('svg, canvas, img, input, textarea, video, table, button, [class*="stat"], [class*="text"]');
            if (painted) return;
            if (stage.textContent.trim() !== '') return;
            // The vendored renderer predates this node type. CI rebuilds the plugin
            // before vendoring, so this only happens on a stale local build.
            var note = document.createElement('p');
            note.className = 'specimen__fallback';
            note.textContent = isEn()
              ? 'This node needs a newer renderer build — CI rebuilds it on deploy.'
              : '此节点需要更新一版渲染器构建；CI 部署时会重新构建。';
            stage.append(note);
          }, 700);
        })
        .catch(function (error) {
          console.warn('[genui] atlas mount failed', item.rec.id, error);
          mounted[item.rec.id] = false;
        });
    }

    function observeItems(items) {
      if (!('IntersectionObserver' in window)) {
        items.slice(0, 12).forEach(mountSpecimen);
        return;
      }
      items.forEach(function (item) { observer.observe(item.card); });
    }

    function build() {
      handles.forEach(function (handle) {
        if (handle && typeof handle.cancel === 'function') handle.cancel();
        else if (handle && typeof handle.unmount === 'function') handle.unmount();
      });
      handles = [];
      mounted = Object.create(null);
      wall.replaceChildren();
      if (showcaseWall) showcaseWall.replaceChildren();
      if (observer) observer.disconnect();
      observer = 'IntersectionObserver' in window
        ? new IntersectionObserver(
            function (entries) {
              entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var item = cards.filter(function (candidate) { return candidate.card === entry.target })[0];
                if (item) mountSpecimen(item);
                observer.unobserve(entry.target);
              });
            },
            { rootMargin: '280px 0px' },
          )
        : null;

      var specs = store.data.specs || [];
      nodeItems = specs
        .filter(function (rec) { return rec.category === 'atlas'; })
        .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 })
        .map(function (rec) { return makeCard(rec, false); });
      var curated = narrow ? CURATED_SHOWCASE.slice(0, 4) : CURATED_SHOWCASE;
      var showItems = curated.map(function (id) {
        return specs.filter(function (rec) { return rec.id === id; })[0];
      })
        .filter(Boolean)
        .map(function (rec) { return makeCard(rec, true); });

      cards = nodeItems.concat(showItems);
      nodeItems.forEach(function (item) { wall.append(item.card); });
      if (showcaseWall) showItems.forEach(function (item) { showcaseWall.append(item.card); });

      observeItems(nodeItems);
      showItems.forEach(mountSpecimen);
      applyVisibility();
    }

    function applyVisibility() {
      nodeItems.forEach(function (item, index) {
        var matches = activeFilter === 'all' || item.card.getAttribute('data-group') === activeFilter;
        var withinPreview = activeFilter !== 'all' || expanded || index < PREVIEW_COUNT;
        item.card.hidden = !(matches && withinPreview);
      });
      if (moreButton) {
        moreButton.hidden = activeFilter !== 'all' || nodeItems.length <= PREVIEW_COUNT;
        moreButton.setAttribute('aria-expanded', String(expanded));
        if (moreLabel) {
          if (isEn()) moreLabel.textContent = expanded ? 'Show less' : 'Show all 60 nodes';
          else moreLabel.textContent = expanded ? '收起' : '展开全部 60 个节点';
        }
      }
    }

    if (moreButton) {
      moreButton.addEventListener('click', function () {
        expanded = !expanded;
        applyVisibility();
        if (!expanded) {
          var section = document.querySelector('#atlas');
          if (section) {
            var top = section.getBoundingClientRect().top + window.scrollY - 90;
            window.scrollTo({ top: top, behavior: prefersReduced() ? 'auto' : 'smooth' });
          }
        }
      });
    }

    if (filterBar) {
      filterBar.addEventListener('click', function (event) {
        var button = event.target.closest('[data-filter]');
        if (!button) return;
        Array.prototype.forEach.call(filterBar.querySelectorAll('[data-filter]'), function (candidate) {
          var active = candidate === button;
          candidate.classList.toggle('is-active', active);
          candidate.setAttribute('aria-selected', String(active));
        });
        activeFilter = button.getAttribute('data-filter') || 'all';
        applyVisibility();
      });
    }

    function prefersReduced() {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    window.__ATLAS_REBUILD__ = build;

    ensureData()
      .then(function () { return ensureComponents(); })
      .then(build)
      .catch(function (error) {
        console.warn('[genui] atlas failed', error);
      });
  }

  /* ------------------------------------------------------------- locale -- */

  function onLanguage(next) {
    B.setLocale(next);
    if (typeof window.__ATLAS_REBUILD__ === 'function') window.__ATLAS_REBUILD__();
  }

  /* --------------------------------------------------------------- boot -- */

  function boot() {
    initHero();
    initSurfaces();
    initPlayground();
    initAtlas();
    document.addEventListener('site:lang', function (event) {
      onLanguage(event.detail && event.detail.lang === 'en' ? 'en' : 'zh');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
