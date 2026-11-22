/*
 * Safety net for errors that happen before (or outside) React. If the app
 * fails to draw, show what went wrong and ways to recover instead of a blank
 * screen. Plain script (no build step), loaded before the app.
 */
(function () {
  var shown = false;
  function show(message) {
    var root = document.getElementById('root');
    if (shown || !root || root.childElementCount > 0) return;
    shown = true;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'font:16px/1.5 system-ui,-apple-system,sans-serif;padding:calc(env(safe-area-inset-top) + 48px) 24px 24px;max-width:36rem;margin:0 auto;color:#2b211a';
    box.innerHTML =
      '<h1 style="font-size:24px;margin:0 0 8px">Pilot couldn’t start</h1>' +
      '<p style="margin:0 0 16px;color:#6b5a4c">Your data is safe. Try reloading; if that doesn’t help, reset the app files (this keeps your check-ins).</p>' +
      '<pre style="white-space:pre-wrap;background:#f4e9da;padding:12px;border-radius:12px;font-size:13px;margin:0 0 16px"></pre>' +
      '<button data-a="reload" style="font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#2b211a;color:#fff;margin-right:8px">Reload</button>' +
      '<button data-a="reset" style="font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#f4e9da;color:#2b211a">Reset app files</button>';
    box.querySelector('pre').textContent = String(message).slice(0, 800);
    box.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'reload') location.reload();
      if (a === 'reset') window.__pilotResetAppFiles();
    });
    root.appendChild(box);
  }
  // Clears the service worker and its cached app files (not IndexedDB, so unsynced check-ins survive).
  window.__pilotResetAppFiles = function () {
    var jobs = [];
    if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
  };
  window.__pilotShowFatal = show;
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) show('Couldn’t load ' + (t.src || t.href) + ' (the app files may be out of date).');
    else show((e.error && (e.error.stack || e.error.message)) || e.message || 'Unknown error');
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    setTimeout(function () { show((r && (r.stack || r.message)) || String(r)); }, 1500);
  });
  // If nothing has drawn after a while, say so rather than leaving a blank page.
  setTimeout(function () { show('Pilot took too long to start. Check your connection, then reload.'); }, 15000);
})();
