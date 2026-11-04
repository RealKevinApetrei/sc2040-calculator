/* Builds the keypad, wires mouse/touch/keyboard input, key-press trail,
 * scaling, help and fullscreen. */
(function () {
  'use strict';
  const { Calc } = window.CalcCore;

  const STORE_KEY = 'sc2040-state-v1';
  const PREF_KEY = 'sc2040-prefs-v1';
  const load = (k) => {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  };
  const save = (k, v) => {
    try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ }
  };

  // ---- key definitions ---------------------------------------------------
  // [id, label, shiftLabel, alphaLabel]
  const X = (s) => `x<sup>${s}</sup>`;
  const TOP_LEFT = [
    ['shift', 'SHIFT', '', '', 'k-shift'],
    ['alpha', 'ALPHA', '', '', 'k-alpha'],
    ['inv', X('−1'), 'x!', ''],
    ['ncr', '<i>n</i>C<i>r</i>', '<i>n</i>P<i>r</i>', ''],
  ];
  const TOP_RIGHT = [
    ['mode', 'MODE', 'CLR', '', 'k-mode'],
    ['on', 'ON', '', '', 'k-on'],
    ['pol', 'Pol(', 'Rec(', ''],
    ['cube', X('3'), '<sup>3</sup>√', ''],
  ];
  const FN_ROWS = [
    [
      ['frac', 'a<sup>b</sup>/<sub>c</sub>', 'd/c', ''],
      ['sqrt', '√', '', ''],
      ['sq', X('2'), '', ''],
      ['pow', '^', '<sup>x</sup>√', ''],
      ['log', 'log', '10<sup>x</sup>', ''],
      ['ln', 'ln', 'e<sup>x</sup>', ''],
    ],
    [
      ['neg', '(−)', '', 'A'],
      ['dms', '°&#8202;′&#8202;″', '←', 'B'],
      ['hyp', 'hyp', '', 'C'],
      ['sin', 'sin', 'sin<sup>−1</sup>', 'D'],
      ['cos', 'cos', 'cos<sup>−1</sup>', 'E'],
      ['tan', 'tan', 'tan<sup>−1</sup>', 'F'],
    ],
    [
      ['rcl', 'RCL', 'STO', ''],
      ['eng', 'ENG', '←', ''],
      ['lp', '(', '', ''],
      ['rp', ')', '', 'X'],
      ['comma', ',', ';', 'Y'],
      ['mplus', 'M+', 'M−', 'M'],
    ],
  ];
  const NUM_ROWS = [
    [['7', '7'], ['8', '8'], ['9', '9'], ['del', 'DEL', 'INS', '', 'k-red'], ['ac', 'AC', 'OFF', '', 'k-red']],
    [['4', '4'], ['5', '5'], ['6', '6'], ['mul', '×'], ['div', '÷']],
    [['1', '1', 'S-SUM'], ['2', '2', 'S-VAR'], ['3', '3'], ['add', '+'], ['sub', '−']],
    [['0', '0', 'Rnd'], ['dot', '·', 'Ran#'], ['exp', 'EXP', 'π'], ['ans', 'Ans', 'DRG▶'], ['eq', '=', '%']],
  ];

  const LABELS = {};
  const keyEls = {};

  function keyCell(def, cls) {
    const [id, label, sh = '', al = '', extra = ''] = def;
    LABELS[id] = { label, sh, al };
    const cell = document.createElement('div');
    cell.className = 'kc';
    const leg = document.createElement('div');
    leg.className = 'leg' + (sh && al ? '' : ' single');
    leg.innerHTML = `${sh ? `<span class="sh">${sh}</span>` : ''}${al ? `<span class="al">${al}</span>` : ''}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `key ${cls} ${extra}`.trim();
    b.dataset.k = id;
    b.innerHTML = `<span>${label}</span>`;
    b.setAttribute('aria-label', label.replace(/<[^>]+>/g, ''));
    cell.append(leg, b);
    keyEls[id] = b;
    return cell;
  }

  function buildKeypad() {
    const tl = document.getElementById('top-left');
    const tr = document.getElementById('top-right');
    TOP_LEFT.forEach((d) => tl.append(keyCell(d, 'fn')));
    TOP_RIGHT.forEach((d) => tr.append(keyCell(d, 'fn')));
    const fn = document.getElementById('fn-keys');
    FN_ROWS.flat().forEach((d) => fn.append(keyCell(d, 'fn')));
    const num = document.getElementById('num-keys');
    NUM_ROWS.flat().forEach((d) => num.append(keyCell(d, 'num')));
    ['up', 'down', 'left', 'right'].forEach((id) => {
      keyEls[id] = document.querySelector(`.dpad [data-k="${id}"]`);
      LABELS[id] = { label: { up: '▲', down: '▼', left: '◀', right: '▶' }[id], sh: '', al: '' };
    });
  }

  // ---- state -------------------------------------------------------------
  const calc = new Calc(load(STORE_KEY));
  window.__calc = calc;
  const prefs = Object.assign({ trail: true }, JSON.parse(load(PREF_KEY) || '{}'));
  let lcd;

  function render() {
    const d = calc.display();
    lcd.draw(d);
    keyEls.shift.classList.toggle('armed', calc.shift);
    keyEls.alpha.classList.toggle('armed', calc.alpha);
    keyEls.hyp.classList.toggle('armed', calc.hyp);
  }

  let blinkTimer;
  function restartBlink() {
    lcd.blinkOn = true;
    clearInterval(blinkTimer);
    blinkTimer = setInterval(() => {
      lcd.blinkOn = !lcd.blinkOn;
      lcd.draw(calc.display());
    }, 530);
  }

  function press(id) {
    const before = { shift: calc.shift, alpha: calc.alpha, hyp: calc.hyp };
    try {
      calc.press(id);
    } catch (e) {
      console.error(e);
      calc.allClear();
    }
    addTrail(id, before);
    save(STORE_KEY, calc.serialize());
    restartBlink();
    render();
  }

  // ---- key-press trail ---------------------------------------------------
  const trailList = () => document.getElementById('trail-list');
  function addTrail(id, before) {
    const L = LABELS[id];
    if (!L) return;
    let html = L.label;
    let cls = '';
    if (id === 'shift') cls = 'c-shift';
    else if (id === 'alpha') cls = 'c-alpha';
    else if (before.alpha && L.al) {
      html = L.al;
      cls = 'c-alpha';
    } else if (before.shift && L.sh) {
      html = L.sh;
      cls = 'c-shift';
    }
    if (before.hyp && ['sin', 'cos', 'tan'].includes(id)) html = html.replace(/(sin|cos|tan)/, '$1h');
    const list = trailList();
    const chip = document.createElement('span');
    chip.className = `chip ${cls}`;
    chip.innerHTML = html;
    list.append(chip);
    if (id === 'eq' && !before.shift) list.append(Object.assign(document.createElement('div'), { className: 'chip-break' }));
    while (list.children.length > 60) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
    const empty = document.getElementById('trail-empty');
    if (empty) empty.hidden = true;
  }

  // ---- pointer input -----------------------------------------------------
  function flash(id) {
    const el = keyEls[id];
    if (!el) return;
    el.classList.add('down');
    setTimeout(() => el.classList.remove('down'), 120);
  }
  function bindPointer() {
    document.querySelectorAll('[data-k]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.classList.add('down');
        press(el.dataset.k);
      });
      const up = () => el.classList.remove('down');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
      // keyboard activation for accessibility (Enter/Space on a focused key)
      el.addEventListener('click', (e) => {
        if (e.detail === 0) press(el.dataset.k);
      });
    });
  }

  // ---- keyboard input ----------------------------------------------------
  const KEYMAP = {
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
    '.': 'dot', ',': 'comma', '+': 'add', '-': 'sub', '*': 'mul', 'x': 'mul', '/': 'div', '^': 'pow',
    '(': 'lp', ')': 'rp', 'Enter': 'eq', '=': 'eq', 'Backspace': 'del', 'Escape': 'ac', 'Delete': 'ac',
    'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
    's': 'sin', 'c': 'cos', 't': 'tan', 'l': 'log', 'n': 'ln', 'r': 'sqrt', 'q': 'sq', 'h': 'hyp',
    'e': 'exp', 'a': 'ans', 'm': 'mplus', 'f': 'frac', 'd': 'dms', 'o': 'mode', 'i': 'inv',
  };
  const SHIFTED = { 'p': 'exp', 'P': 'exp', '!': 'inv', '%': 'eq' }; // π, x!, %
  let modifierAlone = null;

  function bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      if (!document.getElementById('help').hidden) {
        if (e.key === 'Escape') toggleHelp(false);
        return;
      }
      if (e.key === 'Shift' || e.key === 'Alt') {
        modifierAlone = e.key;
        return;
      }
      modifierAlone = null;
      if (e.key === '?') {
        toggleHelp(true);
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
      let id = null;
      if (SHIFTED[e.key]) {
        if (!calc.shift) press('shift');
        id = SHIFTED[e.key];
      } else id = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
      if (!id) return;
      e.preventDefault();
      flash(id);
      press(id);
    });
    window.addEventListener('keyup', (e) => {
      if (modifierAlone && e.key === modifierAlone) {
        const id = e.key === 'Shift' ? 'shift' : 'alpha';
        flash(id);
        press(id);
      }
      modifierAlone = null;
    });
  }

  // ---- layout scaling ----------------------------------------------------
  const BASE_W = 360, BASE_H = 724;
  function fit() {
    const stage = document.querySelector('.stage');
    const trailOn = prefs.trail && window.innerWidth >= 620;
    document.body.classList.toggle('trail-on', trailOn);
    const availW = window.innerWidth - 40 - (trailOn ? 250 : 0);
    const availH = window.innerHeight - 40 - 44; // top band reserved for toolbar
    const s = Math.max(0.4, Math.min(availW / BASE_W, availH / BASE_H, 2.6));
    stage.style.setProperty('--z', s.toFixed(4));
    lcd.resize();
    render();
  }

  // ---- toolbar / help ----------------------------------------------------
  function toggleHelp(show) {
    const h = document.getElementById('help');
    h.hidden = show === undefined ? !h.hidden : !show;
  }
  function bindToolbar() {
    document.getElementById('btn-trail').addEventListener('click', () => {
      prefs.trail = !prefs.trail;
      save(PREF_KEY, JSON.stringify(prefs));
      fit();
    });
    document.getElementById('btn-help').addEventListener('click', () => toggleHelp());
    document.getElementById('help-close').addEventListener('click', () => toggleHelp(false));
    document.getElementById('help').addEventListener('click', (e) => {
      if (e.target.id === 'help') toggleHelp(false);
    });
    document.getElementById('btn-full').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
    document.getElementById('trail-clear').addEventListener('click', () => {
      trailList().innerHTML = '';
      document.getElementById('trail-empty').hidden = false;
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    buildKeypad();
    lcd = new window.LCD(document.getElementById('lcd'));
    bindPointer();
    bindKeyboard();
    bindToolbar();
    window.addEventListener('resize', fit);
    fit();
    restartBlink();
    document.body.classList.add('ready');
  });
})();
