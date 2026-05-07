/*!
 * Pipelineflow Engagement — drop-in JS source (v1)
 *
 * Drop this snippet on every page you want to instrument. The first call
 * starts a queue; this script then drains the queue and replaces `window.pfe`
 * with the real implementation.
 *
 * <script>
 *   var pfe = pfe || [];
 *   (function () {
 *     var fn = function (f) {
 *       return function () {
 *         pfe.push([f].concat(Array.prototype.slice.call(arguments, 0)));
 *       };
 *     };
 *     var methods = ['init','identify','track','page','group','alias','reset','setAnonymousId'];
 *     for (var i = 0; i < methods.length; i++) pfe[methods[i]] = fn(methods[i]);
 *     var s = document.createElement('script');
 *     s.async = true;
 *     s.id = 'pfe-tracker';
 *     s.setAttribute('data-write-key', 'pfe_tok_xxxx.yyyy');
 *     s.setAttribute('data-api-host', 'https://engagement.example.com');
 *     s.setAttribute('data-auto-page', 'true');
 *     s.src = 'https://engagement.example.com/pfe/v1.js';
 *     var first = document.getElementsByTagName('script')[0];
 *     first.parentNode.insertBefore(s, first);
 *   })();
 * </script>
 *
 * The write key is your `pfe_tok_…` ingest token. Treat it as semi-public —
 * the same trust model as Customer.io's `site_id`. Use a token scoped to
 * `engagement:ingest` only, and rotate it from Settings → API tokens if
 * you ever see abuse.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  // Re-load guard: a second copy of the script must not re-bind the API or
  // re-hook history, otherwise pageviews fire twice per navigation.
  if (window.__pfe_loaded__) return;
  window.__pfe_loaded__ = true;

  var VERSION = '1.0.0';
  var STORAGE_PREFIX = 'pfe_';
  var ANON_KEY = STORAGE_PREFIX + 'anon_id';
  var USER_KEY = STORAGE_PREFIX + 'user_id';

  // ── Config from <script id="pfe-tracker"> data-attrs ────────────────────
  var script =
    document.getElementById('pfe-tracker') ||
    document.currentScript ||
    null;

  function attr(name, fallback) {
    if (!script) return fallback;
    var v = script.getAttribute('data-' + name);
    return v == null ? fallback : v;
  }

  var config = {
    writeKey: attr('write-key', ''),
    apiHost: String(attr('api-host', '')).replace(/\/+$/, ''),
    autoPage: attr('auto-page', 'true') !== 'false',
    debug: attr('debug', 'false') === 'true',
  };

  function log() {
    if (!config.debug || !window.console) return;
    var args = ['[pfe]'].concat(Array.prototype.slice.call(arguments, 0));
    try { console.log.apply(console, args); } catch (_) { /* ignore */ }
  }

  // ── Storage (graceful when localStorage is unavailable / blocked) ───────
  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (_) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (_) { /* ignore */ }
  }
  function lsRemove(k) {
    try { window.localStorage.removeItem(k); } catch (_) { /* ignore */ }
  }

  // ── UUID v4 (RFC 4122) ──────────────────────────────────────────────────
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var b = new Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      var u8 = new Uint8Array(16);
      window.crypto.getRandomValues(u8);
      for (var i = 0; i < 16; i++) b[i] = u8[i];
    } else {
      for (var j = 0; j < 16; j++) b[j] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = [];
    for (var k = 0; k < 16; k++) {
      hex.push((b[k] < 16 ? '0' : '') + b[k].toString(16));
    }
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10).join('')
    );
  }

  function ensureAnonId() {
    var id = lsGet(ANON_KEY);
    if (!id) {
      id = uuid();
      lsSet(ANON_KEY, id);
    }
    return id;
  }

  // ── Identity state ──────────────────────────────────────────────────────
  // We don't persist traits between sessions: identify() sends what the
  // caller passed to the server, and that's the source of truth. Local
  // caching of merged traits would only matter if we attached them to
  // subsequent track/page calls — which Segment-style SDKs don't do either.
  var anonymousId = ensureAnonId();
  var userId = lsGet(USER_KEY) || null;

  // ── Context (Segment-shape) ─────────────────────────────────────────────
  function buildContext() {
    var ctx = {
      page: {
        url: location.href,
        path: location.pathname,
        search: location.search || undefined,
        title: document.title || undefined,
        referrer: document.referrer || undefined,
      },
      userAgent: navigator.userAgent,
      locale: navigator.language,
      library: { name: 'pfe-js', version: VERSION },
    };
    try {
      ctx.screen = { width: screen.width, height: screen.height };
    } catch (_) { /* some embedded contexts forbid screen */ }
    if (Intl && Intl.DateTimeFormat) {
      try {
        ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch (_) { /* ignore */ }
    }
    return ctx;
  }

  // ── Send ────────────────────────────────────────────────────────────────
  function endpointFor(type) {
    return config.apiHost + '/api/public/' + type;
  }

  function send(type, extra) {
    if (!config.writeKey || !config.apiHost) {
      log('skipped (missing writeKey or apiHost)', type);
      return;
    }
    var body = {
      messageId: uuid(),
      timestamp: new Date().toISOString(),
      context: buildContext(),
      anonymousId: anonymousId,
    };
    if (userId) body.userId = userId;
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] != null) {
          body[k] = extra[k];
        }
      }
    }
    var url = endpointFor(type);
    var json = JSON.stringify(body);
    log(type, body);
    try {
      var p = window.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.writeKey,
        },
        body: json,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      });
      if (p && typeof p.then === 'function') {
        p.then(function (r) {
          if (!r.ok) log('non-2xx', type, r.status);
        }).catch(function (e) {
          log('fetch failed', type, e && e.message);
        });
      }
    } catch (e) {
      log('fetch threw', type, e && e.message);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function init(opts) {
    if (!opts || typeof opts !== 'object') return;
    if (typeof opts.writeKey === 'string') config.writeKey = opts.writeKey;
    if (typeof opts.apiHost === 'string') {
      config.apiHost = opts.apiHost.replace(/\/+$/, '');
    }
    if (typeof opts.autoPage === 'boolean') config.autoPage = opts.autoPage;
    if (typeof opts.debug === 'boolean') config.debug = opts.debug;
  }

  function identify(idOrTraits, traits) {
    var nextId = null;
    var nextTraits = null;
    if (typeof idOrTraits === 'string' || typeof idOrTraits === 'number') {
      nextId = String(idOrTraits);
      if (traits && typeof traits === 'object') nextTraits = traits;
    } else if (idOrTraits && typeof idOrTraits === 'object') {
      nextTraits = idOrTraits;
      // Use null-coalescing semantics so a literal `0` userId is preserved
      // — `traits.id || traits.userId` would skip it as falsy.
      var idFromTraits = nextTraits.id != null ? nextTraits.id : nextTraits.userId;
      if (idFromTraits != null) nextId = String(idFromTraits);
    }
    if (nextId) {
      userId = nextId;
      lsSet(USER_KEY, userId);
    }
    if (!userId && !anonymousId) return;
    send('identify', { traits: nextTraits || undefined });
  }

  function track(name, properties) {
    if (!name) return;
    send('track', {
      event: String(name),
      properties: (properties && typeof properties === 'object') ? properties : undefined,
    });
  }

  function page(nameOrProps, properties) {
    var name;
    var props;
    if (typeof nameOrProps === 'string') {
      name = nameOrProps;
      props = (properties && typeof properties === 'object') ? properties : null;
    } else if (nameOrProps && typeof nameOrProps === 'object') {
      props = nameOrProps;
      name = null;
    }
    send('page', {
      name: name || undefined,
      properties: props || undefined,
    });
  }

  function group(groupId, traits) {
    if (!groupId) return;
    send('group', {
      groupId: String(groupId),
      traits: (traits && typeof traits === 'object') ? traits : undefined,
    });
  }

  function alias(newUserId, previousId) {
    if (!newUserId) return;
    var prev = previousId || userId || anonymousId;
    if (!prev) return;
    if (!config.writeKey || !config.apiHost) {
      log('alias skipped (missing config)');
      return;
    }
    var body = {
      messageId: uuid(),
      timestamp: new Date().toISOString(),
      context: buildContext(),
      userId: String(newUserId),
      previousId: String(prev),
    };
    log('alias', body);
    try {
      window.fetch(endpointFor('alias'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.writeKey,
        },
        body: JSON.stringify(body),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function () { /* swallow */ });
    } catch (_) { /* swallow */ }
    userId = String(newUserId);
    lsSet(USER_KEY, userId);
  }

  function reset() {
    userId = null;
    lsRemove(USER_KEY);
    // Rotate the anonymous id on logout so the freshly-signed-out browser
    // doesn't keep stitching events to the just-departed user's pre-identify
    // anonymous trail.
    anonymousId = uuid();
    lsSet(ANON_KEY, anonymousId);
  }

  function setAnonymousId(id) {
    if (!id) return;
    anonymousId = String(id);
    lsSet(ANON_KEY, anonymousId);
  }

  function getAnonymousId() { return anonymousId; }
  function getUserId() { return userId; }

  // ── Auto pageview tracking ──────────────────────────────────────────────
  // Hooks history.pushState / replaceState so single-page-app navigations
  // emit a `page` event the same way a full reload would. The hook is
  // installed once per page; the re-load guard above prevents doubles.
  function installAutoPage() {
    if (!config.autoPage) return;
    var lastPath = location.pathname + location.search + location.hash;
    function maybeFire() {
      var current = location.pathname + location.search + location.hash;
      if (current === lastPath) return;
      lastPath = current;
      try { page(); } catch (_) { /* ignore */ }
    }
    var origPush = history.pushState;
    var origReplace = history.replaceState;
    history.pushState = function () {
      var r = origPush.apply(this, arguments);
      maybeFire();
      return r;
    };
    history.replaceState = function () {
      var r = origReplace.apply(this, arguments);
      maybeFire();
      return r;
    };
    window.addEventListener('popstate', maybeFire);
    // Initial pageview.
    try { page(); } catch (_) { /* ignore */ }
  }

  var api = {
    init: init,
    identify: identify,
    track: track,
    page: page,
    group: group,
    alias: alias,
    reset: reset,
    setAnonymousId: setAnonymousId,
    getAnonymousId: getAnonymousId,
    getUserId: getUserId,
    VERSION: VERSION,
  };

  // ── Drain the snippet queue, swap in the real API ───────────────────────
  var queued = window.pfe;
  window.pfe = api;
  if (queued && Object.prototype.toString.call(queued) === '[object Array]') {
    for (var i = 0; i < queued.length; i++) {
      var call = queued[i];
      if (!call || Object.prototype.toString.call(call) !== '[object Array]' || !call.length) continue;
      var method = call[0];
      var args = Array.prototype.slice.call(call, 1);
      if (typeof api[method] === 'function') {
        try { api[method].apply(null, args); }
        catch (e) { log('queued call failed', method, e && e.message); }
      } else {
        log('unknown queued method', method);
      }
    }
  }

  installAutoPage();
})();
