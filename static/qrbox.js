// The lightbox of the QR codes (#206), shared by the panel (index.html) and Dream Control (remote.html): one modal
// dialog that shows a code large on white, its text below and "Close". The code is loaded when the dialog opens and
// thrown away when it closes, so a key is on the screen no longer than needed. It closes with Esc, a click beside it
// or its button; the focus stays inside and returns to the button that opened it. Styles: qrbox.css.
//
//   QrBox.open({ id: 'eyes', title, alt, trigger: button, key: 'q', fill(box, info) { box.code('eyes'); box.say(text); } })
//
// fill gets the answer of /remote-info and a box: code(what, alt) shows /qr.svg?for=what (null: no code), say(...parts)
// sets the text (strings as plain text, or nodes), html(markup) sets a translated text with markup, button(label, fn)
// adds a button above "Close", reset() empties text and buttons (for the next step in the same dialog).
window.QrBox = (() => {
  'use strict';
  let dlg, img, tile, title, text, actions, closeBtn;
  let last = null, trigger = null, run = 0;

  function build() {
    dlg = document.createElement('dialog');
    dlg.id = 'qrbox';
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'qrbox-title'); dlg.setAttribute('aria-describedby', 'qrbox-text');
    dlg.innerHTML = '<div class="qrbox-in"><div id="qrbox-title"></div><div class="qrbox-code"><img id="qrbox-img" alt=""></div>'
      + '<div id="qrbox-text" aria-live="polite"></div><div class="qrbox-actions"></div><button type="button" class="btn qrbox-close"></button></div>';
    document.body.append(dlg);
    img = dlg.querySelector('#qrbox-img'); tile = dlg.querySelector('.qrbox-code'); title = dlg.querySelector('#qrbox-title');
    text = dlg.querySelector('#qrbox-text'); actions = dlg.querySelector('.qrbox-actions'); closeBtn = dlg.querySelector('.qrbox-close');
    closeBtn.textContent = T('Close');
    closeBtn.onclick = close;
    img.onerror = () => { if (img.getAttribute('src')) fail(); };
    let downOn = null;                              // a drag that selects the link and ends beside the box does not close it
    dlg.addEventListener('pointerdown', e => { downOn = e.target; });
    dlg.addEventListener('click', e => { if (e.target === dlg && downOn === dlg) close(); });   // the dialog itself is only its backdrop
    dlg.addEventListener('keydown', e => {
      e.stopPropagation();                            // the page's own keys (pause, fullscreen …) rest while the dialog is open
      if (last && last.key && e.key.toLowerCase() === last.key && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('button, a[href]')].filter(el => !el.disabled && !el.hidden);
      const first = f[0], end = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dlg.contains(document.activeElement))) { e.preventDefault(); end.focus(); }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
    });
    dlg.addEventListener('close', () => {             // also after Esc: the code and its key leave the page
      run++; empty(); title.textContent = '';
      const back = trigger; last = trigger = null;
      if (back && back.isConnected) back.focus();
    });
  }
  function empty() { img.removeAttribute('src'); img.alt = ''; tile.hidden = true; text.textContent = ''; actions.textContent = ''; }
  function fail() { img.removeAttribute('src'); tile.hidden = true; actions.textContent = ''; text.textContent = T('Address not available – is Dream still running?'); }

  async function render() {
    const opts = last, mine = ++run, live = () => mine === run && dlg.open;
    empty();
    title.textContent = opts.title;
    const box = {
      code(what, alt) {
        if (!live()) return;
        tile.hidden = !what;
        if (!what) { img.removeAttribute('src'); return; }
        img.alt = alt || opts.alt || '';
        img.src = '/qr.svg?for=' + encodeURIComponent(what) + '&t=' + Date.now();
      },
      say(...parts) { if (live()) text.replaceChildren(...parts); },
      html(markup) { if (live()) text.innerHTML = markup; },
      button(label, fn) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.textContent = label; b.onclick = fn;
        if (live()) actions.append(b);
        return b;
      },
      reset() { if (live()) { text.textContent = ''; actions.textContent = ''; } },
    };
    try {
      const info = await (await fetch('/remote-info')).json();
      if (!live()) return;
      if (!info.lan) { box.html(T('Only when Dream is reachable in the Wi-Fi: restart it with <code>./dream.sh --lan</code>.')); return; }
      opts.fill(box, info);
    } catch (e) { if (live()) fail(); }
  }

  function open(opts) {
    if (!dlg) build();
    if (!dlg.open) { trigger = opts.trigger || document.activeElement; }
    last = opts;
    if (!dlg.open) dlg.showModal();
    closeBtn.focus();
    render();
  }
  function close() { if (dlg && dlg.open) dlg.close(); }
  // the code that is shown, loaded anew (its key changed)
  function refresh() { if (dlg && dlg.open && last) render(); }

  return { open, close, refresh, get showing() { return dlg && dlg.open && last ? last.id : null; } };
})();
