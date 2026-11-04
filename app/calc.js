/*
 * SC2040 key-handling state machine. Consumes physical key ids, produces a
 * display description consumed by the LCD renderer.
 */
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.Engine;
  const { T, G } = E;

  const MAX_STEPS = 79;
  const VAR_KEYS = { neg: 'A', dms: 'B', hyp: 'C', sin: 'D', cos: 'E', tan: 'F', rp: 'X', comma: 'Y', mplus: 'M' };
  const CONTINUE_KINDS = ['op', 'post', 'pow', 'perm', 'pct'];

  const DEFAULT_SETTINGS = { mode: 'COMP', regType: 'Lin', angle: 'D', disp: 'norm', dispN: 1, fracDisp: 'abc', comma: false };
  const emptyVars = () => ({ A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 });

  // Menus: each page = [label, action][]
  function menuPages(id, calc) {
    const s = calc.s;
    const quad = s.regType === 'Quad';
    const ins = (tok) => () => calc.insert(tok);
    switch (id) {
      case 'mode':
        return [
          [['COMP', () => calc.setMode('COMP')], ['SD', () => calc.setMode('SD')], ['REG', () => calc.openMenu('reg')]],
          [['Deg', () => calc.setAngle('D')], ['Rad', () => calc.setAngle('R')], ['Gra', () => calc.setAngle('G')]],
          [['Fix', () => calc.prompt('Fix 0~9?', 'fix')], ['Sci', () => calc.prompt('Sci 0~9?', 'sci')], ['Norm', () => calc.prompt('Norm 1~2?', 'norm')]],
          [['Disp', () => calc.openMenu('disp')]],
        ];
      case 'reg':
        return [
          [['Lin', () => calc.setMode('REG', 'Lin')], ['Log', () => calc.setMode('REG', 'Log')], ['Exp', () => calc.setMode('REG', 'Exp')]],
          [['Pwr', () => calc.setMode('REG', 'Pwr')], ['Inv', () => calc.setMode('REG', 'Inv')], ['Quad', () => calc.setMode('REG', 'Quad')]],
        ];
      case 'disp':
        return [
          [['ab/c', () => calc.setSetting('fracDisp', 'abc')], ['d/c', () => calc.setSetting('fracDisp', 'dc')]],
          [['Dot', () => calc.setSetting('comma', false)], ['Comma', () => calc.setSetting('comma', true)]],
        ];
      case 'clr':
        return [[
          [s.mode === 'COMP' ? 'Mcl' : 'Scl', () => calc.clear(s.mode === 'COMP' ? 'mcl' : 'scl')],
          ['Mode', () => calc.clear('mode')],
          ['All', () => calc.clear('all')],
        ]];
      case 'drg':
        return [[['D', ins('degU')], ['R', ins('radU')], ['G', ins('graU')]]];
      case 'ssum': {
        const p = [[['Σx²', ins('s:sumx2')], ['Σx', ins('s:sumx')], ['n', ins('s:n')]]];
        if (s.mode === 'REG') {
          p.push([['Σy²', ins('s:sumy2')], ['Σy', ins('s:sumy')], ['Σxy', ins('s:sumxy')]]);
          if (quad) p.push([['Σx³', ins('s:sumx3')], ['Σx²y', ins('s:sumx2y')], ['Σx⁴', ins('s:sumx4')]]);
        }
        return p;
      }
      case 'svar': {
        const p = [[[G.XBAR, ins('s:mean')], ['xσn', ins('s:sdn')], ['xσn-1', ins('s:sdn1')]]];
        if (s.mode === 'REG') {
          p.push([[G.YBAR, ins('s:ymean')], ['yσn', ins('s:ysdn')], ['yσn-1', ins('s:ysdn1')]]);
          p.push(quad
            ? [['A', ins('s:rA')], ['B', ins('s:rB')], ['C', ins('s:rC')]]
            : [['A', ins('s:rA')], ['B', ins('s:rB')], ['r', ins('s:rr')]]);
          p.push(quad
            ? [[G.XHAT + '1', ins('xhat1')], [G.XHAT + '2', ins('xhat2')], [G.YHAT, ins('yhat')]]
            : [[G.XHAT, ins('xhat')], [G.YHAT, ins('yhat')]]);
        }
        return p;
      }
    }
    return [[]];
  }

  class Calc {
    constructor(saved) {
      this.s = Object.assign({}, DEFAULT_SETTINGS);
      this.vars = emptyVars();
      this.ans = 0;
      this.data = [];
      this.hist = [];
      if (saved) this.restore(saved);
      this.rand = Math.random;
      this.resetInput();
      this.bottom = { value: 0 };
      this.off = false;
    }

    // ---- persistence ----
    serialize() {
      return JSON.stringify({ s: this.s, vars: this.vars, ans: this.ans, data: this.data, hist: this.hist.slice(-30) });
    }
    restore(json) {
      try {
        const o = typeof json === 'string' ? JSON.parse(json) : json;
        if (o.s) Object.assign(this.s, o.s);
        if (o.vars) Object.assign(this.vars, o.vars);
        if (typeof o.ans === 'number') this.ans = o.ans;
        if (Array.isArray(o.data)) this.data = o.data;
        if (Array.isArray(o.hist)) this.hist = o.hist.filter((h) => h && Array.isArray(h.toks) && h.toks.every((t) => T[t]));
      } catch (e) { /* ignore corrupt state */ }
    }

    resetInput() {
      this.toks = [];
      this.cur = 0;
      this.scroll = 0;
      this.insertMode = false;
      this.phase = 'edit'; // edit | result | menu | prompt | error | msg | view
      this.shift = false;
      this.alpha = false;
      this.hyp = false;
      this.sto = false;
      this.rcl = false;
      this.menu = null;
      this.err = null;
      this.msg = null;
      this.last = null;
      this.view = null;
      this.hIdx = null;
      this.dataView = null;
      this.editTarget = null;
    }

    ctx() {
      return {
        angle: this.s.angle, vars: this.vars, ans: this.ans, rand: this.rand,
        settings: this.s, data: this.data, mode: this.s.mode, regType: this.s.regType,
      };
    }

    // ---- main entry ----
    press(k) {
      if (this.off) {
        if (k === 'on') this.powerOn();
        return;
      }
      if (k === 'on') return this.powerOn();
      if (k === 'shift') {
        this.shift = !this.shift;
        this.alpha = false;
        return;
      }
      if (k === 'alpha') {
        this.alpha = !this.alpha;
        this.shift = false;
        return;
      }
      const sh = this.shift, al = this.alpha;
      this.shift = false;
      this.alpha = false;

      if (k === 'ac') {
        if (sh) return this.powerOff();
        return this.allClear();
      }
      if (this.sto || this.rcl) {
        const v = VAR_KEYS[k];
        const which = this.sto ? 'sto' : 'rcl';
        this.sto = this.rcl = false;
        if (v && !sh) {
          if (which === 'sto') this.store(v);
          else this.recall(v);
        }
        return;
      }
      if (this.phase === 'menu') return this.menuKey(k);
      if (this.phase === 'prompt') return this.promptKey(k);
      if (this.phase === 'error') {
        if (k === 'left' || k === 'right') {
          this.toks = this.err.toks.slice();
          this.cur = Math.max(0, Math.min(this.err.pos, this.toks.length));
          this.phase = 'edit';
          this.err = null;
        }
        return;
      }
      if (this.phase === 'msg') {
        this.phase = 'edit';
        this.msg = null;
        this.toks = [];
        this.cur = 0;
        if (this.dataView) this.dataView = null;
        if (k === 'eq' && !sh) return;
      }
      if (this.phase === 'view') return this.viewKey(k, sh, al);
      this.normalKey(k, sh, al);
    }

    powerOn() {
      this.off = false;
      this.resetInput();
      this.bottom = { value: 0 };
    }
    powerOff() {
      this.resetInput();
      this.off = true;
    }
    allClear() {
      this.resetInput();
      this.bottom = { value: 0 };
    }

    normalKey(k, sh, al) {
      const statMode = this.s.mode !== 'COMP';
      if (al) {
        const v = VAR_KEYS[k];
        if (v) this.insert('v:' + v);
        return;
      }
      if (k === 'hyp') {
        this.hyp = true;
        return;
      }
      const hyp = this.hyp;
      if (['sin', 'cos', 'tan'].includes(k)) {
        this.hyp = false;
        return this.insert((sh ? 'a' : '') + k + (hyp ? 'h' : '') + '(');
      }
      this.hyp = false;

      if (sh) {
        switch (k) {
          case 'inv': return this.insert('fact');
          case 'ncr': return this.insert('nPr');
          case 'pol': return this.insert('Rec(');
          case 'cube': return this.insert('cbrt(');
          case 'pow': return this.insert('xrt(');
          case 'log': return this.insert('pow10(');
          case 'ln': return this.insert('expe(');
          case 'frac': return this.toggleImproper();
          case 'dms': return this.dmsBack();
          case 'rcl': this.sto = true; return;
          case 'eng': return this.eng(-1);
          case 'comma': return this.insert(';');
          case 'mplus': return statMode ? this.dataDelete() : this.memAdd(-1);
          case 'del':
            if (this.phase === 'edit') this.insertMode = !this.insertMode;
            return;
          case 'mode': return this.openMenu('clr');
          case '1': if (statMode) this.openMenu('ssum'); return;
          case '2': if (statMode) this.openMenu('svar'); return;
          case '0':
            if (this.phase === 'result') {
              this.toks = ['Rnd(', 'Ans'];
              this.phase = 'edit';
              return this.equals();
            }
            return this.insert('Rnd(');
          case 'dot': return this.insert('Ran#');
          case 'exp': return this.insert('π');
          case 'ans': return this.openMenu('drg');
          case 'eq': return this.percent();
          case 'up': case 'down': case 'left': case 'right':
            return this.arrow(k);
        }
        return;
      }

      switch (k) {
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
          return this.insert(k);
        case 'dot': return this.insert('.');
        case 'exp': return this.insert('EXP');
        case 'add': return this.insert('+');
        case 'sub': return this.insert('-');
        case 'mul': return this.insert('×');
        case 'div': return this.insert('÷');
        case 'neg': return this.insert('NEG');
        case 'lp': return this.insert('(');
        case 'rp': return this.insert(')');
        case 'comma': return this.insert(',');
        case 'inv': return this.insert('inv');
        case 'ncr': return this.insert('nCr');
        case 'pol': return this.insert('Pol(');
        case 'cube': return this.insert('cube');
        case 'sqrt': return this.insert('sqrt(');
        case 'sq': return this.insert('sq');
        case 'pow': return this.insert('^(');
        case 'log': return this.insert('log(');
        case 'ln': return this.insert('ln(');
        case 'frac':
          if (this.phase === 'result') return this.toggleFrac();
          return this.insert('┘');
        case 'dms':
          if (this.phase === 'result') return this.toggleDMS();
          return this.insert('°');
        case 'rcl': this.rcl = true; return;
        case 'eng': return this.eng(1);
        case 'mplus': return statMode ? this.dataInput() : this.memAdd(1);
        case 'ans': return this.insert('Ans');
        case 'eq': return this.equals();
        case 'del': return this.del();
        case 'mode': return this.openMenu('mode');
        case 'up': case 'down': case 'left': case 'right':
          return this.arrow(k);
      }
    }

    // ---- editing ----
    insert(id) {
      const tk = T[id];
      if (this.phase === 'menu') this.phase = 'edit';
      if (this.phase !== 'edit') {
        const cont = CONTINUE_KINDS.includes(tk.kind) && this.phase === 'result';
        this.toks = cont ? ['Ans', id] : [id];
        this.cur = this.toks.length;
        this.phase = 'edit';
        this.hIdx = null;
        this.insertMode = false;
        return;
      }
      if (this.toks.length === 0 && CONTINUE_KINDS.includes(tk.kind) && !this.editTarget) {
        this.toks = ['Ans', id];
        this.cur = 2;
        return;
      }
      if (this.insertMode || this.cur >= this.toks.length) {
        if (this.toks.length >= MAX_STEPS) return;
        this.toks.splice(this.cur, 0, id);
      } else {
        this.toks[this.cur] = id;
      }
      this.cur++;
    }

    del() {
      if (this.phase !== 'edit') return;
      if (!this.insertMode && this.cur < this.toks.length) {
        this.toks.splice(this.cur, 1);
      } else if (this.cur > 0) {
        this.toks.splice(this.cur - 1, 1);
        this.cur--;
      }
    }

    arrow(k) {
      const statMode = this.s.mode !== 'COMP';
      if (k === 'left' || k === 'right') {
        if (this.phase === 'result' && this.last) {
          this.toks = this.last.toks.slice();
          this.cur = k === 'left' ? this.toks.length : 0;
          this.phase = 'edit';
          this.hIdx = null;
          this.insertMode = false;
          return;
        }
        if (this.phase === 'edit') {
          if (k === 'left') this.cur = Math.max(0, this.cur - 1);
          else this.cur = Math.min(this.toks.length, this.cur + 1);
        }
        return;
      }
      // up / down
      if (statMode) {
        if (this.phase === 'edit' && this.toks.length) return;
        return this.openDataView(k === 'down' ? 0 : -1);
      }
      if (!this.hist.length) return;
      if (this.phase === 'edit' && this.toks.length) return;
      let idx;
      if (this.hIdx === null) {
        if (k === 'down') return;
        idx = this.phase === 'result' ? this.hist.length - 2 : this.hist.length - 1;
        if (idx < 0) return;
      } else {
        idx = this.hIdx + (k === 'up' ? -1 : 1);
        if (idx < 0 || idx >= this.hist.length) return;
      }
      this.hIdx = idx;
      const h = this.hist[idx];
      this.showResult(h);
    }

    // ---- evaluation ----
    run(toks) {
      try {
        const r = E.evaluate(toks, this.ctx());
        Object.assign(this.vars, r.side);
        return Object.assign({ toks: toks.slice() }, r);
      } catch (e) {
        if (!(e instanceof E.CalcError)) throw e;
        this.phase = 'error';
        this.err = { type: e.type, pos: e.pos, toks: toks.slice() };
        return null;
      }
    }

    equals() {
      if (this.editTarget) return this.commitDataEdit();
      let toks;
      if (this.phase === 'edit' && this.toks.length) toks = this.toks;
      else if (this.phase === 'result' && this.last) toks = this.last.toks;
      else return;
      const r = this.run(toks);
      if (!r) return;
      this.ans = r.value;
      this.pushHistory(r);
      this.showResult(r);
      this.hIdx = null;
    }

    pushHistory(r) {
      const entry = { toks: r.toks, value: r.value, hasFrac: r.hasFrac, rat: r.rat ? [String(r.rat.n), String(r.rat.d)] : null };
      this.hist.push(entry);
      if (this.hist.length > 30) this.hist.shift();
    }

    showResult(r) {
      let rat = r.rat;
      if (Array.isArray(rat)) rat = { n: BigInt(rat[0]), d: BigInt(rat[1]) };
      this.last = { toks: r.toks.slice(), value: r.value, rat, hasFrac: r.hasFrac };
      const improper = this.s.fracDisp === 'dc';
      const showFrac = r.hasFrac && rat && E.fracText(rat, improper);
      this.view = { kind: showFrac ? 'frac' : 'dec', eng: 0, improper, rat };
      this.phase = 'result';
      this.toks = r.toks.slice();
      this.cur = this.toks.length;
      this.scroll = 0;
      this.bottom = { value: r.value, fromResult: true, view: this.view };
    }

    percent() {
      if (this.phase !== 'edit' || !this.toks.length) return;
      const toks = this.toks.concat('%');
      const r = this.run(toks);
      if (!r) return;
      this.ans = r.value;
      this.pushHistory(r);
      this.showResult(r);
    }

    // ---- result display conversions ----
    toggleFrac() {
      const v = this.view;
      if (!v || !this.last) return;
      if (v.kind === 'frac') {
        v.kind = 'dec';
        return;
      }
      const rat = this.last.rat || E.approxRat(this.last.value);
      if (rat && E.fracText(rat, v.improper)) {
        v.rat = rat;
        v.kind = 'frac';
      }
    }
    toggleImproper() {
      const v = this.view;
      if (this.phase !== 'result' || !v || v.kind !== 'frac') return;
      if (E.fracText(v.rat, !v.improper)) v.improper = !v.improper;
    }
    toggleDMS() {
      const v = this.view;
      if (!v) return;
      if (E.formatDMS(this.last.value)) v.kind = 'dms';
    }
    dmsBack() {
      const v = this.view;
      if (this.phase === 'result' && v && v.kind === 'dms') v.kind = 'dec';
    }
    eng(dir) {
      if (this.phase !== 'result' || !this.view) return;
      const v = this.view;
      const next = v.kind === 'eng' ? v.eng + dir : dir > 0 ? 0 : -1;
      if (E.formatEng(this.last.value, next)) {
        v.kind = 'eng';
        v.eng = next;
      }
    }

    // ---- memory ----
    valueForMemory() {
      if (this.phase === 'edit' && this.toks.length) {
        const r = this.run(this.toks);
        if (!r) return null;
        this.ans = r.value;
        this.pushHistory(r);
        this.showResult(r);
        return r.value;
      }
      return this.phase === 'result' && this.last ? this.last.value : this.ans;
    }
    memAdd(sign) {
      const v = this.valueForMemory();
      if (v === null) return;
      const m = E.round15(this.vars.M + sign * v);
      if (Math.abs(m) >= 1e100) {
        this.phase = 'error';
        this.err = { type: 'Math', pos: 0, toks: [] };
        return;
      }
      this.vars.M = m;
      if (this.phase !== 'result') this.showResult({ toks: ['Ans'], value: v, rat: null, hasFrac: false });
    }
    store(v) {
      const val = this.valueForMemory();
      if (val === null) return;
      this.vars[v] = val;
      if (this.phase !== 'result') this.showResult({ toks: ['Ans'], value: val, rat: null, hasFrac: false });
      this.phase = 'msg';
      this.msg = { top: 'Ans→' + v, value: val };
    }
    recall(v) {
      this.toks = ['v:' + v];
      this.phase = 'edit';
      this.equals();
    }

    // ---- menus ----
    openMenu(id) {
      if (id === 'mode' && this.phase === 'menu' && this.menu.id === 'mode') {
        this.menu.page = (this.menu.page + 1) % 4;
        return;
      }
      this.prevPhase = this.phase === 'menu' ? this.prevPhase : this.phase;
      this.phase = 'menu';
      this.menu = { id, page: 0 };
    }
    menuKey(k) {
      const pages = menuPages(this.menu.id, this);
      if (k === 'mode' && this.menu.id === 'mode') return this.openMenu('mode');
      if (k === 'right' && this.menu.page < pages.length - 1) {
        this.menu.page++;
        return;
      }
      if (k === 'left' && this.menu.page > 0) {
        this.menu.page--;
        return;
      }
      const n = parseInt(k, 10);
      const items = pages[this.menu.page];
      if (n >= 1 && n <= items.length) {
        const id = this.menu.id;
        this.phase = this.prevPhase === 'result' ? 'result' : 'edit';
        this.menu = null;
        if (this.phase === 'edit' && ['mode', 'clr'].includes(id)) {
          // keep current input
        }
        items[n - 1][1]();
        if (this.phase === 'result' && ['mode', 'reg', 'disp'].includes(id)) this.reRender();
      }
    }
    reRender() {
      if (this.last) this.showResult(this.last);
    }
    prompt(text, what) {
      this.phase = 'prompt';
      this.promptInfo = { text, what };
    }
    promptKey(k) {
      const n = parseInt(k, 10);
      const w = this.promptInfo.what;
      if (Number.isNaN(n)) return;
      if (w === 'norm' && (n < 1 || n > 2)) return;
      this.s.disp = w;
      this.s.dispN = n;
      this.phase = this.prevPhase === 'result' && this.last ? 'result' : 'edit';
      if (this.phase === 'result') this.reRender();
    }
    setMode(mode, regType) {
      const changed = mode !== this.s.mode || (regType && regType !== this.s.regType);
      this.s.mode = mode;
      if (regType) this.s.regType = regType;
      if (changed) this.data = [];
      this.resetInput();
      this.bottom = { value: 0 };
    }
    setAngle(a) {
      this.s.angle = a;
    }
    setSetting(k, v) {
      this.s[k] = v;
    }
    clear(what) {
      if (what === 'mcl') {
        this.vars = emptyVars();
        this.msg = { top: 'Mem Clear', value: 0 };
      } else if (what === 'scl') {
        this.data = [];
        this.msg = { top: 'Stat clear', value: 0 };
      } else if (what === 'mode') {
        const mode = this.s.mode;
        this.s = Object.assign({}, DEFAULT_SETTINGS);
        if (mode !== 'COMP') this.data = [];
        this.msg = { top: 'Mode Clear', value: 0 };
      } else {
        this.s = Object.assign({}, DEFAULT_SETTINGS);
        this.vars = emptyVars();
        this.ans = 0;
        this.data = [];
        this.hist = [];
        this.msg = { top: 'All Clear', value: 0 };
      }
      const msg = this.msg;
      this.resetInput();
      this.msg = msg;
      this.bottom = { value: 0 };
      this.phase = 'msg';
    }

    // ---- statistics data ----
    splitData(toks) {
      const parts = [[]];
      const seps = [];
      for (const t of toks) {
        if (t === ',' || t === ';') {
          seps.push(t);
          parts.push([]);
        } else parts[parts.length - 1].push(t);
      }
      return { parts, seps };
    }
    dataInput() {
      let toks = this.phase === 'edit' && this.toks.length ? this.toks : null;
      if (!toks) {
        if (!this.lastData) return;
        this.data.push(Object.assign({}, this.lastData));
        return this.showCount();
      }
      const reg = this.s.mode === 'REG';
      const { parts, seps } = this.splitData(toks);
      const want = reg ? [',', ';'] : [';'];
      const ok = seps.length <= want.length && seps.every((s, i) => s === want[i]) && (!reg || seps[0] === ',');
      if (!ok) {
        this.phase = 'error';
        this.err = { type: 'Syntax', pos: toks.findIndex((t) => t === ',' || t === ';'), toks: toks.slice() };
        return;
      }
      const vals = [];
      let offset = 0;
      for (const p of parts) {
        const r = this.run(p);
        if (!r) {
          this.err.toks = toks.slice();
          this.err.pos += offset;
          return;
        }
        vals.push(r.value);
        offset += p.length + 1;
      }
      const entry = reg ? { x: vals[0], y: vals[1], f: vals.length > 2 ? vals[2] : 1 } : { x: vals[0], f: vals.length > 1 ? vals[1] : 1 };
      if (entry.f <= 0) {
        this.phase = 'error';
        this.err = { type: 'Math', pos: toks.length, toks: toks.slice() };
        return;
      }
      this.data.push(entry);
      this.lastData = entry;
      this.showCount();
    }
    showCount() {
      this.resetInputKeepData();
      this.phase = 'msg';
      this.msg = { top: 'n=', value: this.data.length };
      this.bottom = { value: this.data.length };
    }
    resetInputKeepData() {
      const lastData = this.lastData;
      this.resetInput();
      this.lastData = lastData;
    }
    dataDelete() {
      if (!this.data.length) return;
      if (this.phase === 'view' && this.dataView) return this.viewDelete();
      this.data.pop();
      this.showCount();
    }
    dataFields() {
      return this.s.mode === 'REG' ? ['x', 'y', 'f'] : ['x', 'f'];
    }
    openDataView(start) {
      if (!this.data.length) return;
      const n = this.data.length * this.dataFields().length;
      this.dataView = { idx: start < 0 ? n - 1 : 0 };
      this.phase = 'view';
      this.toks = [];
      this.cur = 0;
    }
    viewItem() {
      const fields = this.dataFields();
      const i = Math.floor(this.dataView.idx / fields.length);
      const field = fields[this.dataView.idx % fields.length];
      const label = (field === 'f' ? 'Freq' : field) + (i + 1) + '=';
      return { i, field, label, value: this.data[i][field] };
    }
    viewKey(k, sh, al) {
      const n = this.data.length * this.dataFields().length;
      if (!sh && !al && (k === 'up' || k === 'down')) {
        this.dataView.idx = Math.max(0, Math.min(n - 1, this.dataView.idx + (k === 'down' ? 1 : -1)));
        return;
      }
      if (sh && k === 'mplus') return this.viewDelete();
      if (!sh && k === 'eq') return;
      // any input key starts editing the current field
      const it = this.viewItem();
      this.editTarget = { i: it.i, field: it.field, idx: this.dataView.idx, label: it.label };
      this.phase = 'edit';
      this.toks = [];
      this.cur = 0;
      this.normalKey(k, sh, al);
      if (this.phase !== 'edit') this.editTarget = null;
    }
    viewDelete() {
      const it = this.viewItem();
      this.data.splice(it.i, 1);
      if (!this.data.length) {
        this.dataView = null;
        this.phase = 'edit';
        this.bottom = { value: 0 };
        return;
      }
      const n = this.data.length * this.dataFields().length;
      this.dataView.idx = Math.min(it.i * this.dataFields().length, n - 1);
    }
    commitDataEdit() {
      const t = this.editTarget;
      if (!this.toks.length) {
        this.editTarget = null;
        this.phase = 'view';
        return;
      }
      const r = this.run(this.toks);
      if (!r) {
        this.editTarget = null;
        return;
      }
      if (t.field === 'f' && r.value <= 0) {
        this.phase = 'error';
        this.err = { type: 'Math', pos: this.toks.length, toks: this.toks.slice() };
        this.editTarget = null;
        return;
      }
      this.data[t.i][t.field] = r.value;
      this.editTarget = null;
      this.toks = [];
      this.cur = 0;
      this.phase = 'view';
      this.dataView = { idx: t.idx };
    }

    // ---- display description ----
    display() {
      const ind = {
        S: this.shift, A: this.alpha, M: this.vars.M !== 0, STO: this.sto, RCL: this.rcl,
        SD: this.s.mode === 'SD', REG: this.s.mode === 'REG',
        D: this.s.angle === 'D', R: this.s.angle === 'R', G: this.s.angle === 'G',
        FIX: this.s.disp === 'fix', SCI: this.s.disp === 'sci', hyp: this.hyp,
        up: false, down: false, left: false, right: false, INS: false,
      };
      if (this.off) return { off: true, ind: {} };
      const out = { ind, top: { text: '', cursor: null }, bottom: null, comma: this.s.comma };
      const numBottom = (value) => E.toCells(E.formatNumber(value, this.s));

      switch (this.phase) {
        case 'menu': {
          const pages = menuPages(this.menu.id, this);
          const items = pages[this.menu.page];
          const labels = items.map((x) => x[0]);
          out.top = { text: layoutMenu(labels).text };
          out.bottom = menuNumbers(labels);
          ind.left = this.menu.page > 0;
          ind.right = this.menu.page < pages.length - 1;
          return out;
        }
        case 'prompt':
          out.top = { text: this.promptInfo.text };
          out.bottom = { cells: [], exp: null, blank: true };
          return out;
        case 'error':
          out.top = { text: this.err.type + ' ERROR' };
          out.bottom = { cells: [], exp: null, blank: true };
          return out;
        case 'msg':
          out.top = { text: this.msg.top };
          out.bottom = numBottom(this.msg.value);
          return out;
        case 'view': {
          const it = this.viewItem();
          out.top = { text: it.label };
          out.bottom = numBottom(it.value);
          const n = this.data.length * this.dataFields().length;
          ind.up = this.dataView.idx > 0;
          ind.down = this.dataView.idx < n - 1;
          return out;
        }
      }

      // edit / result
      let prefix = '';
      if (this.editTarget) prefix = this.editTarget.label;
      const text = prefix + E.tokenText(this.toks);
      let curChar = prefix.length;
      for (let i = 0; i < this.cur; i++) curChar += T[this.toks[i]].text.length;
      const W = 12;
      if (this.phase === 'edit') {
        if (curChar < this.scroll) this.scroll = curChar;
        if (curChar > this.scroll + W - 1) this.scroll = curChar - W + 1;
        if (this.scroll > 0 && text.length - this.scroll < W - 1) this.scroll = Math.max(0, Math.max(text.length, curChar) - W + 1);
        const style = this.toks.length >= MAX_STEPS - 6 ? 'full' : this.insertMode ? 'insert' : 'under';
        out.top = { text: text.slice(this.scroll, this.scroll + W), cursor: { pos: curChar - this.scroll, style } };
        ind.left = this.scroll > 0;
        ind.right = text.length > this.scroll + W;
        ind.INS = this.insertMode;
      } else {
        out.top = { text: text.slice(0, W) };
        ind.right = text.length > W;
      }
      if (this.s.mode === 'COMP' && this.hist.length && !(this.phase === 'edit' && this.toks.length)) {
        const idx = this.hIdx === null ? (this.phase === 'result' ? this.hist.length - 1 : this.hist.length) : this.hIdx;
        ind.up = idx > 0;
        ind.down = this.hIdx !== null && this.hIdx < this.hist.length - 1;
      }

      const b = this.bottom;
      const v = b && b.view;
      if (!b) out.bottom = numBottom(0);
      else if (v && v.kind === 'frac') {
        const neg = v.rat.n < 0n;
        out.bottom = E.toCells({ neg, mant: E.fracText(v.rat, v.improper), exp: null });
      } else if (v && v.kind === 'dms') out.bottom = E.toCells(E.formatDMS(b.value));
      else if (v && v.kind === 'eng') out.bottom = E.toCells(E.formatEng(b.value, v.eng));
      else out.bottom = numBottom(b.value);
      return out;
    }
  }

  // Spread menu labels evenly across the 12-column top line; fall back to a
  // compact layout when the labels are too long to spread.
  function layoutMenu(labels) {
    const k = labels.length;
    const starts = [];
    let ok = true;
    labels.forEach((l, i) => {
      const center = ((i + 0.5) * 12) / k - 0.5;
      let st = Math.round(center - (l.length - 1) / 2);
      st = Math.max(0, Math.min(12 - l.length, st));
      if (i > 0 && st < starts[i - 1] + labels[i - 1].length + 1) ok = false;
      starts.push(st);
    });
    if (!ok) {
      const total = labels.reduce((a, l) => a + l.length, 0) + (k - 1);
      let pos = Math.max(0, Math.floor((12 - total) / 2));
      starts.length = 0;
      labels.forEach((l) => {
        starts.push(pos);
        pos += l.length + 1;
      });
    }
    let text = '';
    const centers = [];
    labels.forEach((l, i) => {
      text = text.padEnd(starts[i], ' ') + l;
      centers.push(starts[i] + (l.length - 1) / 2);
    });
    return { text: text.slice(0, 12), centers };
  }
  function menuNumbers(labels) {
    const { centers } = layoutMenu(labels);
    const cells = Array.from({ length: 11 }, () => ({ ch: ' ' }));
    centers.forEach((c, i) => {
      // top-line column c sits above 7-segment cell ~ c + 0.3
      const idx = Math.max(1, Math.min(10, Math.round(c + 0.3)));
      cells[idx] = { ch: String(i + 1) };
    });
    return { cells, exp: null };
  }

  const API = { Calc, DEFAULT_SETTINGS, VAR_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CalcCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
