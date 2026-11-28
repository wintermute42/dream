/* Dream – the worn devices in the panel (#277): a StickS3 on the wrist (its motion goes into the sensor input, its
   button – optionally – is the dance's clutch). One line per device – what it is, whether it is there, which way its
   packets come (#278: by radio over the USB receiver, or over the Wi-Fi), how many values a second and how late, its
   battery, its last press – and the owner's word: "Allow the clutch" (once; Dream gives the device a token it keeps) or
   "Revoke". #278: one line per USB receiver – its channel, its light as a dot of the same colour, the wristbands that
   are there by radio, and "Pair a wristband" (its pairing window, as when its button is held). Under the clutch's
   button a line says whether the wrist (or the receiver's button) can move the clutch right now, and that a device
   that is gone leaves the clutch as it was.
   Dream (wearables.py, receiver.py) does the rest; the page never learns a token, an address or a port.

     const card = WearCard.mount({ list, stat, clutch, send: msg => … });
     card.show(wear);          // {"wear": …} of Dream
     card.pressed(on);         // the clutch was moved on the wrist (the watch taps)

   `items`, `receiverItems`, `statusText`, `clutchLine`, `lastText` and `delayText` are pure (tests/js/wearcard.test.mjs).
   A global `WearCard`. */
(function (root) {
  'use strict';
  const T = (text, vars) => (root.I18N ? root.I18N.t(text, vars) : vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);
  const clean = v => (Number.isFinite(+v) ? +v : 0);

  const battery = (b, low) => (Number.isFinite(b) && b >= 0 ? T('battery {p} %', { p: Math.round(b) }) + (low ? ' ⚠' : '') : '');   // low: Dream's word
  // how long ago, said plainly
  const ago = s => (s == null ? T('not seen since Dream started') : s < 90 ? T('gone for {n} s', { n: Math.round(s) }) : T('gone for {n} min', { n: Math.round(s / 60) }));
  // the last press on a stick Dream took: {on, ago} → "Last press: engaged, 12 s ago"
  function lastText(last) {
    if (!last || typeof last !== 'object') return '';
    const s = Math.max(0, Math.round(clean(last.ago)));
    return T('Last press: {c}, {t} ago', { c: last.on ? T('engaged') : T('released'), t: s < 90 ? T('{n} s', { n: s }) : T('{n} min', { n: Math.round(s / 60) }) });
  }

  // #278: the delay of a packet from the wrist to Dream (ms, half the way there and back): "≈ 4 ms" – the goal is under 10
  function delayText(ms) {
    if (ms == null || !Number.isFinite(+ms) || +ms < 0) return '';
    return T('≈ {n} ms', { n: +ms < 10 ? (Math.round(+ms * 10) / 10).toLocaleString(root.I18N && root.I18N.lang === 'de' ? 'de-DE' : 'en-US') : Math.round(+ms) });
  }
  const LINKS = { radio: () => T('by radio'), wifi: () => T('over the Wi-Fi') };

  // what each device's line says and offers: devices – the list of Dream (wearables.Wearables.listing); a kind the
  // panel does not know is not shown
  function items(devices) {
    return (Array.isArray(devices) ? devices : []).filter(d => d && typeof d.id === 'string' && d.kind === 'sticks3').map(d => {
      const parts = [];
      if (d.live) {
        if (LINKS[d.link]) parts.push(LINKS[d.link]());
        parts.push(T('{n} values/s', { n: Math.round(clean(d.rate)) }));
        const lat = delayText(d.latency); if (lat) parts.push(lat);
        const b = battery(d.battery, d.low); if (b) parts.push(b);
      } else parts.push(ago(d.seen));
      let note, action, warn = !!(d.live && d.low);
      if (!d.paired) {
        action = d.live ? 'allow' : null;
        note = d.refused > 0 ? T('Its button was pressed {n}× – not allowed yet, the clutch did not move.', { n: d.refused })
          : T('Its motion counts; its button moves the clutch only once you allow it.');
        warn = warn || d.refused > 0;
      } else {
        action = 'revoke';
        note = !d.live ? T('Gone – the clutch stays as it was.') : d.ready ? T('Its button engages and releases the clutch.')
          : d.waiting ? T('Allowed – waiting for the device to confirm …') : T('The device did not get its key – revoke and allow it again.');
        warn = warn || !d.live || (!d.ready && !d.waiting);
      }
      return { id: d.id, kind: 'sticks3', icon: '⌚', name: String(d.name || d.id).slice(0, 40), role: T('on the wrist: motion and the clutch'),
        live: !!d.live, state: parts.join(' · '), note, action, warn, last: lastText(d.last) };
    });
  }

  // #278: each USB receiver's line: its channel, its light, the wristbands there by radio, the pairing window
  const LED = { g: () => T('green: wristband there, clutch engaged'), b: () => T('blue: wristband there, clutch released'), r: () => T('red: no wristband') };
  function receiverItems(receivers) {
    return (Array.isArray(receivers) ? receivers : []).filter(r => r && typeof r.id === 'string').map(r => {
      const sticks = (Array.isArray(r.sticks) ? r.sticks : []).map(n => String(n).slice(0, 40));
      const led = LED[r.led] ? r.led : 'r', pairing = Math.max(0, Math.round(clean(r.pairing)));
      const parts = [T('USB · channel {c}', { c: Math.round(clean(r.channel)) || '?' })];
      parts.push(sticks.length ? T('by radio: {d}', { d: sticks.join(', ') }) : T('no wristband by radio'));
      let note;
      if (!r.live) note = T('It does not answer – plug it in again (README: Worn devices).');
      else if (pairing) note = T('Pairing open for {n} s – switch the wristband on near the receiver.', { n: pairing });
      else if (!sticks.length) note = clean(r.peers) ? T('Its wristband is not there – switched off, too far away or on the Wi-Fi.')
        : T('No wristband paired yet – “Pair a wristband” (or hold its button 2 s), then switch the wristband on near it.');
      else note = T('Its button engages and releases the clutch.');
      return { id: r.id, kind: 'receiver', icon: '📡', name: String(r.name || r.id).slice(0, 40), role: T('on the Mac’s USB: the wristband by radio'),
        live: !!r.live, state: parts.join(' · '), note, led,
        ledText: T('Its light: {l}', { l: pairing ? T('blinking white: waiting for a wristband') : LED[led]() }),
        action: r.live ? 'pairing' : null, busy: pairing > 0, warn: !r.live, last: '' };
    });
  }

  // the line under the list: what Dream listens on, or what to do when nothing is there
  function statusText(w) {
    const s = w || {}, n = (s.devices || []).length, rx = (s.receivers || []).length;
    if (!s.lan) return rx ? T('The USB receiver works as it is; for a wristband over the Wi-Fi, start Dream with --lan.')
      : T('Dream listens only on this Mac – start it with --lan so devices in the Wi-Fi reach it (README: Worn devices).');
    const where = s.advert ? T('Port {p}, announced in the Wi-Fi (mDNS)', { p: s.port }) : T('Port {p} – enter this Mac’s address in the device’s setup', { p: s.port });
    return n || rx ? where : T('No worn device yet – switch one on in the same Wi-Fi (README: Worn devices).') + ' ' + where;
  }

  // under the clutch's button: whether the wrist can move the clutch now (only allowed StickS3s count)
  // receivers (#278): its button is a clutch too, while it answers
  function clutchLine(devices, receivers) {
    const sticks = (Array.isArray(devices) ? devices : []).filter(d => d && d.kind === 'sticks3' && d.paired);
    const rx = (Array.isArray(receivers) ? receivers : []).filter(r => r && r.live);
    const extra = rx.length ? T('📡 The receiver’s button too.') : '';
    const join = (a, b) => [a, b].filter(Boolean).join(' ');
    if (!sticks.length) return { text: extra, warn: false };
    const live = sticks.filter(d => d.live && d.ready);
    if (live.length) return { text: join(T('⌚ {d}: the button on the wrist engages and releases.', { d: live.map(d => d.name).join(', ') }), extra), warn: false };
    return { text: join(T('⌚ {d} is gone – the clutch stays as it is; release it here if needed.', { d: sticks.map(d => d.name).join(', ') }), extra), warn: true };
  }

  function mount({ list, stat, clutch, send }) {
    let drawn = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    function draw(rows) {
      const key = JSON.stringify(rows);
      if (key === drawn) return;
      drawn = key;
      const keep = document.activeElement && list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
      list.textContent = '';
      list.hidden = !rows.length;
      for (const r of rows) {
        const li = el('div', 'wearitem' + (r.live ? ' live' : ' gone') + (r.warn ? ' warn' : '') + (r.busy ? ' pairing' : ''));
        li.setAttribute('role', 'listitem'); li.dataset.kind = r.kind;
        const icon = el('span', 'wearicon', r.icon); icon.setAttribute('aria-hidden', 'true');
        const text = el('div', 'weartext'), head = el('div', 'wearhead');
        const dot = el('i', 'weardot'); dot.setAttribute('aria-hidden', 'true');
        head.append(dot, el('b', '', r.name));
        if (r.led) {                                // #278: the receiver's light, as it glows on the Mac (the words in the title and below)
          const led = el('i', 'wearled'); led.dataset.led = r.led; led.title = r.ledText; led.setAttribute('aria-hidden', 'true');
          head.append(led);
        }
        // there: "there · by radio · 50 values/s · ≈ 4 ms · battery 80 %"; gone: how long (the state says it)
        text.append(head, el('div', 'wearrole muted', r.role), el('div', 'muted', r.live ? [T('there'), r.state].filter(Boolean).join(' · ') : r.state));
        if (r.note) text.append(el('div', 'wearnote', r.note));
        if (r.ledText && r.live) text.append(el('div', 'wearlast muted', r.ledText));
        if (r.last) text.append(el('div', 'wearlast muted', r.last));
        li.append(icon, text);
        if (r.action) {
          const words = { allow: T('Allow the clutch'), revoke: T('Revoke'), pairing: r.busy ? T('Pairing …') : T('Pair a wristband') };
          const b = el('button', 'btn' + (r.action === 'allow' ? ' on' : ''), words[r.action]);
          b.type = 'button'; b.dataset.id = r.id;
          b.setAttribute('aria-label', b.textContent + ': ' + r.name);   // the visible words first, then which device
          b.title = { allow: T('Once: Dream gives the device a key of its own; from then on its button is a clutch like key K or a MIDI button.'),
            revoke: T('The device’s button moves nothing any more; allow it again at any time.'),
            pairing: T('The receiver waits 30 s for a wristband: switch it on near the receiver. Its motion counts at once, its button is the clutch.') }[r.action];
          if (r.busy) b.setAttribute('aria-disabled', 'true');
          b.onclick = () => { if (!r.busy) send({ wear: { op: r.action, id: r.id } }); };
          li.append(b);
        }
        list.append(li);
      }
      if (keep) { const again = list.querySelector(`button[data-id="${keep}"]`); if (again) again.focus(); }
    }
    return {
      show(w) {
        const s = w || {};
        draw(receiverItems(s.receivers).concat(items(s.devices)));
        const t = statusText(s); if (stat.textContent !== t) stat.textContent = t;
        if (clutch) {
          const c = clutchLine(s.devices, s.receivers);
          if (clutch.textContent !== c.text) clutch.textContent = c.text;
          clutch.hidden = !c.text; clutch.classList.toggle('warn', c.warn);
        }
      },
      // the clutch was moved on the wrist (kind "sticks3") or on the receiver (#278: "receiver"): the icon of that line
      // taps once (only transform moves)
      pressed(kind = 'sticks3') {
        for (const icon of list.querySelectorAll(`.wearitem[data-kind="${kind === 'receiver' ? 'receiver' : 'sticks3'}"].live .wearicon`)) {
          if (icon.animate && !(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
            icon.animate([{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-14deg) scale(1.25)' }, { transform: 'rotate(8deg) scale(1.1)' }, { transform: 'rotate(0) scale(1)' }], { duration: 420, easing: 'ease-out' });
          }
        }
      },
    };
  }

  const api = { mount, items, receiverItems, statusText, clutchLine, lastText, delayText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WearCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
