// Shared light/dark theme switch for the reference pages.
// - Persisted in localStorage ("colibri.theme"); first visit follows the OS
//   preference (prefers-color-scheme).
// - Sets data-theme on <html>: Stoplight Elements ships a full dark palette
//   keyed off that attribute; ws.html adds its own [data-theme="dark"] CSS.
// Include in <head> so the attribute is set before first paint (no flash).
(() => {
  "use strict";
  const KEY = "colibri.theme";

  const preferred = () =>
    localStorage.getItem(KEY) ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");

  const apply = (t) => {
    document.documentElement.setAttribute("data-theme", t);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.textContent = t === "dark" ? "☀" : "🌙";
      btn.title = t === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }
  };

  apply(preferred());

  document.addEventListener("DOMContentLoaded", () => {
    apply(preferred());
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next =
        document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      apply(next);
    });
  });
})();
