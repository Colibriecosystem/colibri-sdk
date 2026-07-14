// Copy helpers for the reference pages (dependency-free, works on both the
// Stoplight Elements and AsyncAPI React trees WITHOUT mutating their DOM):
//  - hovering any <pre> (request/response samples, examples, curl) shows a
//    floating "Copy" chip that copies the block's text;
//  - clicking a bare URL (the operation URL bar, the server base URL) copies it.
// The chip lives on document.body — nothing is injected into the component
// trees, so React reconciliation is never disturbed.
(() => {
  "use strict";

  const chip = document.createElement("button");
  chip.type = "button";
  chip.textContent = "Copy";
  chip.style.cssText =
    "position:fixed;z-index:2147483647;display:none;padding:3px 10px;" +
    'font:600 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;' +
    "background:#4f7cff;border:0;border-radius:4px;cursor:pointer;" +
    "box-shadow:0 1px 4px rgba(0,0,0,.35)";
  const mount = () => document.body && document.body.appendChild(chip);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  let targetPre = null;
  let hideTimer = 0;
  let resetTimer = 0;

  const flash = (x, y) => {
    clearTimeout(resetTimer);
    chip.textContent = "Copied ✓";
    if (x !== undefined) {
      chip.style.display = "block";
      chip.style.top = Math.max(4, y - 30) + "px";
      chip.style.left = x + "px";
    }
    resetTimer = setTimeout(() => {
      chip.textContent = "Copy";
      if (x !== undefined) chip.style.display = "none";
    }, 1100);
  };

  const showOnPre = (pre) => {
    targetPre = pre;
    const r = pre.getBoundingClientRect();
    chip.style.display = "block";
    chip.style.top = Math.max(4, r.top + 6) + "px";
    chip.style.left = Math.max(4, r.right - chip.offsetWidth - 10) + "px";
  };

  document.addEventListener("mouseover", (e) => {
    const t = e.target;
    if (t === chip) {
      clearTimeout(hideTimer);
      return;
    }
    const pre = t.closest ? t.closest("pre") : null;
    clearTimeout(hideTimer);
    if (pre) {
      showOnPre(pre);
    } else {
      hideTimer = setTimeout(() => {
        chip.style.display = "none";
        targetPre = null;
      }, 250);
      // Hint that bare URLs are click-to-copy.
      const urlish = urlNodeFor(t);
      if (urlish) urlish.style.cursor = "copy";
    }
  });

  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!targetPre) return;
    navigator.clipboard.writeText(targetPre.innerText).then(() => flash());
  });

  // Resolve the widest element whose whole text is one bare URL — clicking any
  // segment of the operation URL bar (server + path) copies the full URL.
  const URL_RE = /^(https?|wss?):\/\/\S+$/;
  function urlNodeFor(start) {
    let el = start && start.closest ? start.closest("div,span,code") : null;
    if (!el) return null;
    while (
      el.parentElement &&
      el.parentElement.textContent.trim() === el.textContent.trim() &&
      el.parentElement !== document.body
    ) {
      el = el.parentElement;
    }
    return URL_RE.test(el.textContent.trim()) ? el : null;
  }

  document.addEventListener(
    "click",
    (e) => {
      if (e.target === chip) return;
      const node = urlNodeFor(e.target);
      if (!node) return;
      navigator.clipboard
        .writeText(node.textContent.trim())
        .then(() => flash(e.clientX, e.clientY));
    },
    true,
  );
})();
