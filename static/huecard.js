/* Dream – the Hue lamps in the panel's Output card (#272): the bridge's address (entered or found), pairing by the
   bridge's link button with a status that says what to do next, and the bridge's rooms, zones and lamps, each with a
   switch "dreams along". The markup is the page's (translated like everything else there); this file gives it its
   behaviour. Dream (hue.py) does the rest – the page never talks to the bridge and never learns its key, only whether
   Dream is paired.

     const card = HueCard.mount({ el: id => element, send: msg => … });
     card.show(status);        // {"hue": …} of Dream
     card.choose(sel);         // the setting hue_lamps_sel ("l:<id>+g:<id>")
     card.found(list);         // bridges found over mDNS

   `say`, `items`, `toggled` and `pairText` are pure (tests/js/huecard.test.mjs). A global `HueCard`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  // tables of words are Maps, read through `pick`: a word that came over the connection never reaches an object's own properties
  const pick = (table, key, otherwise = '') => { const f = table.get(key); return typeof f === 'function' ? f() : otherwise; };
  const KINDS = new Map([['room', () => T('Room')], ['zone', () => T('Zone')], ['light', () => '']]);
  const ICONS = new Map([['room', () => '🏠'], ['zone', () => '🔆'], ['light', () => '💡']]);
  const PAIR_ERRORS = new Map([
    ['nobutton', () => T('The button on the bridge was not pressed in time – press “Pair” again, then the button within 30 seconds.')],
    ['noanswer', () => T('The bridge did not answer while pairing – check the address and try again.')],
    ['refused', () => T('The bridge refused the pairing – try again.')],
    ['revoked', () => T('The bridge no longer knows Dream (removed in the Hue app?) – pair again.')]]);

  const chosen = sel => new Set(String(sel || '').split('+').filter(Boolean));
  // the choice with one item switched on or off – in the order the items came, nothing twice
  function toggled(sel, id, on) {
    const s = chosen(sel);
    if (on) s.add(id); else s.delete(id);
    return [...s].join('+');
  }

  // the status line: what Dream does with the bridge right now, and what the owner does next. on: the switch.
  function say(st, on, sel) {
    const s = st || {}, h = s.host || '', name = s.name || h;
    switch (s.st) {
      case 'nohost': return T('Enter the address of the Hue Bridge, or let Dream find it.');
      case 'looking': return T('Looking for {h} …', { h });
      case 'unknown': return T('{h} is not found in the network – check the address (README: Hue lamps).', { h });
      case 'public': return T('{h} is not in the home network – Dream talks to a bridge only there.', { h });
      case 'notbridge': return T('{h} does not answer like a Hue Bridge – check the address.', { h });
      case 'cert': return T('The device at {h} is not the paired bridge – Dream does not give it the key. A new bridge: pair again.', { h });
      case 'down': return T('{name} does not answer – Dream tries again by itself.', { name });
      case 'unpaired': return pick(PAIR_ERRORS, s.error, T('Not paired yet: press “Pair”, then the round button on the bridge.'));
      case 'pairing': return T('Now press the round button on the bridge … {s} s', { s: s.left == null ? '' : s.left });
      case 'wait': return T('Waiting for the picture of the stage …');
      case 'live': return s.n === 1 ? T('Live: one lamp of {name} dreams along', { name }) : T('Live: {n} lamps of {name} dream along', { n: s.n, name });
      case 'ready':
        if (!(s.lamps || []).some(it => chosen(sel).has(it.id))) return T('Paired with {name} – choose the lamps and rooms that dream along.', { name });
        return on ? T('Waiting for the picture of the stage …') : T('Paired with {name} – switch on to let the lamps dream along.', { name });
      default: return '';
    }
  }
  // the pair button: what it says and whether it can be pressed
  function pairText(st) {
    const s = st || {};
    if (s.st === 'pairing') return { text: T('Press the button on the bridge …'), disabled: true };
    const reachable = ['unpaired', 'ready', 'wait', 'live'].includes(s.st);
    return { text: s.paired ? T('🔗 Pair again') : T('🔗 Pair'), disabled: !reachable };
  }
  // the list's rows: [{id, label, kind, checked, colour}]
  function items(st, sel) {
    const c = chosen(sel);
    return ((st && st.lamps) || []).filter(it => it && typeof it.id === 'string').map(it => ({
      id: it.id, label: `${pick(ICONS, it.kind, '💡')} ${String(it.name || '')}`, kind: pick(KINDS, it.kind),
      checked: c.has(it.id), colour: it.colour !== false }));
  }

  function mount({ el, send }) {
    let st = { st: 'off' }, sel = '';
    const list = el('huelist'), stat = el('huestat'), pairBtn = el('huepair'), unpairBtn = el('hueunpair');
    function drawList() {
      const rows = items(st, sel), key = rows.map(r => `${r.id}|${r.label}|${r.kind}|${r.colour}`).join('\n');
      list.hidden = !rows.length;
      if (list.dataset.drawn !== key) {        // rebuilt only when the bridge's list changed: focus and hover stay
        list.dataset.drawn = key;
        list.replaceChildren(...rows.map(r => {
          const row = document.createElement('label'), box = document.createElement('input'), name = document.createElement('span');
          row.className = 'huelamp'; box.type = 'checkbox'; box.dataset.id = r.id; name.textContent = r.label;
          row.append(box, name);
          const note = r.kind || (r.colour ? '' : T('white only'));
          if (note) { const small = document.createElement('small'); small.className = 'muted'; small.textContent = note; row.append(small); }
          box.onchange = () => { sel = toggled(sel, r.id, box.checked); send({ set: { hue_lamps_sel: sel } }); update(); };
          return row;
        }));
      }
      for (const box of list.querySelectorAll('input[type=checkbox]')) box.checked = chosen(sel).has(box.dataset.id);
    }
    function update() {
      const on = el('hue_lamps').checked, p = pairText(st);
      el('huerow').classList.toggle('off', !on);
      el('v-hue_lamps_amt').textContent = Math.round(+el('hue_lamps_amt').value * 100) + ' %';
      pairBtn.textContent = p.text; pairBtn.disabled = p.disabled;
      pairBtn.classList.toggle('on', st.st === 'pairing');
      unpairBtn.hidden = !st.paired;
      drawList();
      const text = say(st, on, sel);
      if (stat.textContent !== text) stat.textContent = text;
    }
    el('hue_bridge').addEventListener('change', () => send({ set: { hue_bridge: el('hue_bridge').value.trim() } }));
    el('huefind').onclick = () => { el('huefind').disabled = true; el('huefind').textContent = T('🔍 Looking …'); send({ hue_find: true }); };
    pairBtn.onclick = () => { send({ hue_pair: true }); pairBtn.disabled = true; };
    unpairBtn.onclick = () => send({ hue_unpair: true });
    el('hue_lamps').addEventListener('change', update);
    el('hue_lamps_amt').addEventListener('input', update);
    return {
      show(s) { if (s && typeof s === 'object') { const { found, ...rest } = s; st = rest; } update(); },
      choose(v) { sel = String(v || ''); update(); },
      update,
      found(found) {
        const box = el('huefound'), btn = el('huefind');
        btn.disabled = false; btn.textContent = T('🔍 Find');
        box.replaceChildren(); box.hidden = false;
        if (!Array.isArray(found) || !found.length) {
          const none = document.createElement('span'); none.className = 'muted';
          none.textContent = T('No Hue Bridge answered – enter its IP address (README: Hue lamps).');
          box.append(none); return;
        }
        for (const d of found) {
          const b = document.createElement('button'), addr = String(d.ip || d.host || '');
          b.className = 'btn'; b.type = 'button'; b.textContent = `🌉 ${String(d.name || 'Hue Bridge')} · ${addr}`;
          b.title = T('Use this bridge');
          b.onclick = () => { el('hue_bridge').value = addr; send({ set: { hue_bridge: addr } }); box.hidden = true; el('hue_bridge').focus(); };
          box.append(b);
        }
        box.querySelector('button').focus();
      },
    };
  }

  const api = { mount, say, items, toggled, pairText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HueCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
