// Languages of the pages (#132). The code and the markup are written in English; static/i18n/<lang>.json maps an
// English text to its translation (German: de.json). A text missing there stays English (and is reported once in the
// console), so nothing ever shows empty. The language is chosen per device (header switch), first by the browser.
window.I18N = (() => {
  'use strict';
  const LANGS = { de: 'Deutsch', en: 'English' };
  let lang;
  try { lang = localStorage.getItem('dream-lang'); } catch (e) { lang = null; }
  if (!LANGS[lang]) lang = (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
  document.documentElement.lang = lang;
  document.cookie = 'dream-lang=' + lang + '; path=/; max-age=31536000; SameSite=Strict';   // the server answers in it too
  let dict = {}, names = {};
  try {                                               // synchronous on purpose: every script after this one can use T()
    const r = new XMLHttpRequest();
    r.open('GET', '/static/i18n/' + lang + '.json', false); r.send();
    if (r.status === 200) {
      dict = JSON.parse(r.responseText);
      names = dict._names || {}; delete dict._names;   // names of built-in things (playlists) that are German data
    }
  } catch (e) { /* stays English */ }
  if (lang === 'en') dict = {};
  const missing = new Set();
  // T('Saved {n} pictures', { n: 3 }) – the English text is the key; {name} fills in values
  function t(text, vars) {
    let s = text;
    if (lang !== 'en') {
      if (Object.prototype.hasOwnProperty.call(dict, text)) s = dict[text];
      else if (!missing.has(text)) { missing.add(text); console.warn('[i18n] no ' + lang + ' text for:', text); }
    }
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  }
  // the shown name of a built-in playlist ("Feuer" → "Fire"); names of your own stay as they are
  function name(n) {
    if (Object.prototype.hasOwnProperty.call(names, n)) return names[n];
    const pre = Object.keys(names).find(k => k.endsWith(': ') && n.startsWith(k));   // "KI: " → "AI: "
    return pre ? names[pre] + n.slice(pre.length) : n;
  }
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'label'];
  // translates the page's own texts: every text node and the attributes above whose (trimmed) text is a key
  function apply(root) {
    if (lang === 'en') return;
    if (!root && Object.prototype.hasOwnProperty.call(dict, document.title)) document.title = dict[document.title];
    root = root || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentNode && (/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName) || n.parentNode.closest('[translate="no"]'))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });   // translate="no": a name (the brand)
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const raw = n.nodeValue, key = raw.trim().replace(/\s+/g, ' ');
      if (key && Object.prototype.hasOwnProperty.call(dict, key)) n.nodeValue = raw.replace(raw.trim(), dict[key]);
    }
    (root.querySelectorAll ? [root, ...root.querySelectorAll('*')] : []).forEach(el => {
      for (const a of ATTRS) {
        const v = el.getAttribute && el.getAttribute(a);
        if (v && Object.prototype.hasOwnProperty.call(dict, v)) el.setAttribute(a, dict[v]);
      }
    });
  }
  function setLang(l) {
    if (!LANGS[l] || l === lang) return;
    try { localStorage.setItem('dream-lang', l); } catch (e) { /* the cookie still remembers it */ }
    document.cookie = 'dream-lang=' + l + '; path=/; max-age=31536000; SameSite=Strict';
    location.reload();
  }
  return { t, name, apply, setLang, LANGS, get lang() { return lang; }, get missing() { return [...missing]; } };
})();
window.T = window.I18N.t;
// what comes after the page's scripts (e.g. a dialog at the end of the page) is translated once the page is complete
document.addEventListener('DOMContentLoaded', () => window.I18N.apply());
