/**
 * theme-loader.js
 * ---------------------------------------------------------------
 * Was duplicated inline (as a `document.write` snippet) in index.html,
 * pages/login.html, and pages/settings.html. Extracted here so there's
 * one copy to maintain. Loaded as a plain, non-module, blocking <script>
 * (not deferred/async) — it has to run and inject the theme <link>
 * before first paint, or the page flashes the default theme.
 * ---------------------------------------------------------------
 */
(function () {
  var theme = 'default';
  try { theme = localStorage.getItem('waystone-preview-theme') || 'default'; } catch (e) {}
  document.write('<link rel="stylesheet" href="/style/' + theme + '.css" id="theme-css" />');
})();
