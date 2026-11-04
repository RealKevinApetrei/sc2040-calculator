/*
 * SC2040 calculator engine: tokens, parser, evaluator, exact fractions,
 * number formatting and statistics. Pure logic, no DOM. Works in the
 * browser (window.Engine) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  // ---- Special single-character glyphs used by the dot-matrix font ----
  const G = {
    XBAR: '', YBAR: '', XHAT: '', YHAT: '',
    SMALLE: '', DEGU: '', RADU: '', GRAU: '',
    NEG: '',
  };

  // ---- Token table -------------------------------------------------------
  // kind: digit | exp | op | neg | lp | rp | comma | semi | func | pow | post |
  //       perm | frac | dms | val | pct
  const T = {};
  function def(id, text, kind, extra) {
    T[id] = Object.assign({ id, text, kind }, extra || {});
  }
  '0123456789'.split('').forEach((d) => def(d, d, 'digit'));
  def('.', '.', 'digit');
  def('EXP', G.SMALLE, 'exp');
  def('+', '+', 'op');
  def('-', '-', 'op');
  def('×', '×', 'op');
  def('÷', '÷', 'op');
  def('NEG', G.NEG, 'neg');
  def('(', '(', 'lp');
  def(')', ')', 'rp');
  def(',', ',', 'comma');
  def(';', ';', 'semi');
  [
    ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('],
    ['asin', 'sin⁻¹('], ['acos', 'cos⁻¹('], ['atan', 'tan⁻¹('],
    ['sinh', 'sinh('], ['cosh', 'cosh('], ['tanh', 'tanh('],
    ['asinh', 'sinh⁻¹('], ['acosh', 'cosh⁻¹('], ['atanh', 'tanh⁻¹('],
    ['log', 'log('], ['ln', 'ln('], ['pow10', '10^('], ['expe', 'e^('],
    ['sqrt', '√('], ['cbrt', '³√('], ['Pol', 'Pol('], ['Rec', 'Rec('],
    ['Rnd', 'Rnd('],
  ].forEach(([f, text]) => def(f + '(', text, 'func', { f }));
  def('^(', '^(', 'pow', { f: 'pow' });
  def('xrt(', 'x√(', 'pow', { f: 'xrt' });
  def('sq', '²', 'post', { f: 'sq' });
  def('cube', '³', 'post', { f: 'cube' });
  def('inv', '⁻¹', 'post', { f: 'inv' });
  def('fact', '!', 'post', { f: 'fact' });
  def('degU', G.DEGU, 'post', { f: 'degU' });
  def('radU', G.RADU, 'post', { f: 'radU' });
  def('graU', G.GRAU, 'post', { f: 'graU' });
  def('xhat', G.XHAT, 'post', { f: 'xhat' });
  def('yhat', G.YHAT, 'post', { f: 'yhat' });
  def('xhat1', G.XHAT + '1', 'post', { f: 'xhat1' });
  def('xhat2', G.XHAT + '2', 'post', { f: 'xhat2' });
  def('nPr', 'P', 'perm', { f: 'nPr' });
  def('nCr', 'C', 'perm', { f: 'nCr' });
  def('┘', '┘', 'frac');
  def('°', '°', 'dms');
  def('%', '%', 'pct');
  def('π', 'π', 'val');
  def('Ran#', 'Ran#', 'val');
  def('Ans', 'Ans', 'val');
  const VARS = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M'];
  VARS.forEach((v) => def('v:' + v, v, 'val', { v }));
  [
    ['sumx2', 'Σx²'], ['sumx', 'Σx'], ['n', 'n'],
    ['mean', G.XBAR], ['sdn', 'xσn'], ['sdn1', 'xσn-1'],
    ['ymean', G.YBAR], ['ysdn', 'yσn'], ['ysdn1', 'yσn-1'],
    ['sumy2', 'Σy²'], ['sumy', 'Σy'], ['sumxy', 'Σxy'],
    ['sumx3', 'Σx³'], ['sumx2y', 'Σx²y'], ['sumx4', 'Σx⁴'],
    ['rA', 'A'], ['rB', 'B'], ['rC', 'C'], ['rr', 'r'],
  ].forEach(([id, text]) => def('s:' + id, text, 'val', { stat: id }));

  class CalcError extends Error {
    constructor(type, pos) {
      super(type + ' ERROR');
      this.type = type; // Syntax | Math | Stack | Arg
      this.pos = pos;
    }
  }

  const MAX_DEPTH = 24;

  // ---- Parser -------------------------------------------------------------
  // Casio-style priority (high to low): postfix (x², x⁻¹, x!, °'", DRG) >
  // ^ x√ > a b/c > (-) and prefix functions > implicit multiplication >
  // nPr nCr > × ÷ > + -
  function parse(toks) {
    let i = 0;
    let depth = 0;
    const id = () => toks[i];
    const kind = () => (i < toks.length ? T[toks[i]].kind : null);
    const fail = (p) => {
      throw new CalcError('Syntax', p === undefined ? i : p);
    };
    const open = () => {
      depth++;
      if (depth > MAX_DEPTH) throw new CalcError('Stack', i);
    };
    const close = () => {
      depth--;
      if (id() === ')') i++;
      else if (i < toks.length) fail();
    };
    const startsNumber = () => kind() === 'digit' || kind() === 'exp';
    const startsImplicit = () => ['func', 'lp', 'val'].includes(kind());

    function expr() {
      let l = term();
      while (id() === '+' || id() === '-') {
        const op = id(), p = i;
        i++;
        l = { t: 'bin', op, l, r: term(), p };
      }
      return l;
    }
    function term() {
      let l = perm();
      while (id() === '×' || id() === '÷') {
        const op = id(), p = i;
        i++;
        l = { t: 'bin', op, l, r: perm(), p };
      }
      return l;
    }
    function perm() {
      let l = implicit();
      while (kind() === 'perm') {
        const f = T[id()].f, p = i;
        i++;
        l = { t: 'perm', f, l, r: implicit(), p };
      }
      return l;
    }
    function implicit() {
      let l = unit();
      while (startsImplicit()) {
        const p = i;
        l = { t: 'bin', op: '×', l, r: unit(), p };
      }
      return l;
    }
    function unit() {
      if (kind() === 'neg') {
        const p = i;
        i++;
        return { t: 'neg', a: unit(), p };
      }
      return frac();
    }
    function frac() {
      const a = pow();
      if (kind() !== 'frac') return a;
      const p = i;
      i++;
      const b = pow();
      if (kind() === 'frac') {
        i++;
        const c = pow();
        if (kind() === 'frac') fail();
        return { t: 'frac', w: a, n: b, d: c, p };
      }
      return { t: 'frac', w: null, n: a, d: b, p };
    }
    function pow() {
      let l = post(primary());
      while (kind() === 'pow') {
        const f = T[id()].f, p = i;
        i++;
        open();
        const r = expr();
        close();
        l = post({ t: 'pow', f, l, r, p });
      }
      return l;
    }
    function post(node) {
      for (;;) {
        const k = kind();
        if (k === 'post') {
          node = { t: 'post', f: T[id()].f, a: node, p: i };
          i++;
        } else if (k === 'dms') {
          const p = i;
          i++;
          const parts = [node];
          if (startsNumber()) {
            parts.push(number());
            if (kind() === 'dms') {
              i++;
              if (startsNumber()) {
                parts.push(number());
                if (kind() === 'dms') i++;
              }
            }
          }
          node = { t: 'dms', parts, p };
        } else return node;
      }
    }
    function number() {
      const p = i;
      let s = '';
      let dots = 0;
      while (kind() === 'digit') {
        if (id() === '.') dots++;
        s += id();
        i++;
      }
      if (dots > 1) fail(p);
      if (s === '.') fail(p);
      let dec = dots > 0;
      if (kind() === 'exp') {
        dec = true;
        i++;
        if (s === '') s = '1';
        let sign = '';
        if (id() === '-' || id() === 'NEG') {
          sign = '-';
          i++;
        }
        let e = '';
        while (kind() === 'digit' && id() !== '.') {
          e += id();
          i++;
        }
        if (e === '' || e.length > 3) fail();
        s += 'e' + sign + e;
      }
      return { t: 'num', s, dec, p };
    }
    function primary() {
      const k = kind();
      const p = i;
      if (k === 'digit' || k === 'exp') return number();
      if (k === 'lp') {
        i++;
        open();
        const a = expr();
        close();
        return { t: 'paren', a, p };
      }
      if (k === 'func') {
        const f = T[id()].f;
        i++;
        open();
        const a = expr();
        if (f === 'Pol' || f === 'Rec') {
          if (id() !== ',') fail();
          i++;
          const b = expr();
          close();
          return { t: 'polrec', f, a, b, p };
        }
        close();
        return { t: 'fn', f, a, p };
      }
      if (k === 'val') {
        i++;
        return { t: 'val', id: toks[p], p };
      }
      fail();
    }

    if (toks.length === 0) fail(0);
    const tree = expr();
    if (i < toks.length) fail();
    return tree;
  }

  function hasNode(node, pred) {
    if (!node || typeof node !== 'object') return false;
    if (pred(node)) return true;
    for (const k of ['a', 'b', 'l', 'r', 'w', 'n', 'd']) {
      if (node[k] && hasNode(node[k], pred)) return true;
    }
    if (node.parts) return node.parts.some((x) => hasNode(x, pred));
    return false;
  }

  // ---- Numeric helpers ---------------------------------------------------
  const round15 = (x) => (x === 0 ? 0 : Number(x.toPrecision(15)));

  function check(x, p) {
    if (typeof x !== 'number' || !isFinite(x) || Number.isNaN(x) || Math.abs(x) >= 1e100) {
      throw new CalcError('Math', p);
    }
    return x;
  }

  function isInt(x) {
    return Number.isInteger(round15(x));
  }

  function toRad(x, angle) {
    if (angle === 'R') return x;
    if (angle === 'G') return (x * Math.PI) / 200;
    return (x * Math.PI) / 180;
  }
  function fromRad(x, angle) {
    if (angle === 'R') return x;
    if (angle === 'G') return (x * 200) / Math.PI;
    return (x * 180) / Math.PI;
  }

  function trig(f, x, angle, p) {
    if (Math.abs(x) >= (angle === 'R' ? 1e10 * Math.PI / 180 : angle === 'G' ? 1e10 / 0.9 : 1e10)) {
      throw new CalcError('Math', p);
    }
    if (angle !== 'R') {
      // Exact values at multiples of 90 degrees (e.g. sin 180 = 0, tan 90 = error)
      const deg = angle === 'D' ? x : x * 0.9;
      const r = ((round15(deg) % 360) + 360) % 360;
      if (r % 90 === 0) {
        const q = r / 90; // 0,1,2,3
        if (f === 'sin') return [0, 1, 0, -1][q];
        if (f === 'cos') return [1, 0, -1, 0][q];
        if (q % 2 === 1) throw new CalcError('Math', p);
        return 0;
      }
    }
    const rad = toRad(x, angle);
    let v;
    if (f === 'sin') v = Math.sin(rad);
    else if (f === 'cos') v = Math.cos(rad);
    else {
      if (Math.abs(Math.cos(rad)) < 1e-15) throw new CalcError('Math', p);
      v = Math.tan(rad);
    }
    if (Math.abs(v) < 1e-13 && Math.abs(x) > 1e-6) v = 0;
    return v;
  }

  function factorial(n, p) {
    if (!isInt(n) || n < 0 || n > 69) throw new CalcError('Math', p);
    let r = 1;
    for (let k = 2; k <= Math.round(n); k++) r *= k;
    return r;
  }

  function nPr(n, r, p) {
    if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n || n >= 1e10) throw new CalcError('Math', p);
    n = Math.round(n);
    r = Math.round(r);
    let v = 1;
    for (let k = 0; k < r; k++) {
      v *= n - k;
      if (v >= 1e100) throw new CalcError('Math', p);
    }
    return v;
  }
  function nCr(n, r, p) {
    if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n || n >= 1e10) throw new CalcError('Math', p);
    n = Math.round(n);
    r = Math.round(r);
    if (r > n - r) r = n - r;
    let v = 1;
    for (let k = 1; k <= r; k++) {
      v = (v * (n - r + k)) / k;
      if (v >= 1e100) throw new CalcError('Math', p);
    }
    return Math.round(v) === round15(v) ? Math.round(v) : v;
  }

  function power(a, b, p) {
    if (a === 0) {
      if (b <= 0) throw new CalcError('Math', p);
      return 0;
    }
    if (a < 0 && !isInt(b)) {
      // allow odd roots: (-8)^(1/3) = -2
      const inv = 1 / b;
      if (isInt(inv) && Math.abs(Math.round(inv)) % 2 === 1) return -Math.pow(-a, b);
      throw new CalcError('Math', p);
    }
    if (isInt(b)) b = Math.round(b);
    return Math.pow(a, b);
  }

  function xroot(x, y, p) {
    // x√y
    if (x === 0) throw new CalcError('Math', p);
    if (y < 0) {
      if (isInt(x) && Math.abs(Math.round(x)) % 2 === 1) return -Math.pow(-y, 1 / x);
      throw new CalcError('Math', p);
    }
    return Math.pow(y, 1 / x);
  }

  // Round a value to the current display setting (used by Rnd()).
  function roundToDisplay(x, s) {
    if (x === 0) return 0;
    if (s.disp === 'fix') return Number(x.toFixed(s.dispN));
    if (s.disp === 'sci') return Number(x.toExponential((s.dispN === 0 ? 10 : s.dispN) - 1));
    return Number(x.toPrecision(10));
  }

  // ---- Evaluator ---------------------------------------------------------
  function evalNode(node, ctx) {
    const ev = (n) => evalNode(n, ctx);
    const p = node.p;
    switch (node.t) {
      case 'num':
        return check(parseFloat(node.s), p);
      case 'paren':
        return ev(node.a);
      case 'neg':
        return -ev(node.a);
      case 'val': {
        const tk = T[node.id];
        if (node.id === 'π') return Math.PI;
        if (node.id === 'Ans') return ctx.ans;
        if (node.id === 'Ran#') return Math.floor(ctx.rand() * 1000) / 1000;
        if (tk.v) return ctx.vars[tk.v] || 0;
        if (tk.stat) return check(ctx.stat(tk.stat, p), p);
        throw new CalcError('Syntax', p);
      }
      case 'bin': {
        const a = ev(node.l);
        const b = ev(node.r);
        let v;
        if (node.op === '+') v = a + b;
        else if (node.op === '-') v = a - b;
        else if (node.op === '×') v = a * b;
        else {
          if (b === 0) throw new CalcError('Math', p);
          v = a / b;
        }
        return check(v, p);
      }
      case 'perm': {
        const a = ev(node.l), b = ev(node.r);
        return check(node.f === 'nPr' ? nPr(a, b, p) : nCr(a, b, p), p);
      }
      case 'frac': {
        const w = node.w ? ev(node.w) : 0;
        const n = ev(node.n);
        const d = ev(node.d);
        if (d === 0) throw new CalcError('Math', p);
        const sign = w < 0 ? -1 : 1;
        return check(w + (sign * n) / d, p);
      }
      case 'pow': {
        const a = ev(node.l), b = ev(node.r);
        return check(node.f === 'pow' ? power(a, b, p) : xroot(a, b, p), p);
      }
      case 'dms': {
        const vals = node.parts.map(ev);
        const sign = vals[0] < 0 ? -1 : 1;
        const v = vals[0] + sign * ((vals[1] || 0) / 60 + (vals[2] || 0) / 3600);
        return check(v, p);
      }
      case 'post': {
        const a = ev(node.a);
        switch (node.f) {
          case 'sq': return check(a * a, p);
          case 'cube': return check(a * a * a, p);
          case 'inv':
            if (a === 0) throw new CalcError('Math', p);
            return check(1 / a, p);
          case 'fact': return check(factorial(a, p), p);
          case 'degU': return check(fromRad((a * Math.PI) / 180, ctx.angle), p);
          case 'radU': return check(fromRad(a, ctx.angle), p);
          case 'graU': return check(fromRad((a * Math.PI) / 200, ctx.angle), p);
          default: return check(ctx.estimate(node.f, a, p), p);
        }
      }
      case 'polrec': {
        const a = ev(node.a), b = ev(node.b);
        let r1, r2;
        if (node.f === 'Pol') {
          if (a === 0 && b === 0) throw new CalcError('Math', p);
          r1 = Math.hypot(a, b);
          r2 = fromRad(Math.atan2(b, a), ctx.angle);
        } else {
          r1 = a * trig('cos', b, ctx.angle, p);
          r2 = a * trig('sin', b, ctx.angle, p);
        }
        ctx.side.E = round15(check(r1, p));
        ctx.side.F = round15(check(r2, p));
        return ctx.side.E;
      }
      case 'fn': {
        const x = ev(node.a);
        const f = node.f;
        const A = ctx.angle;
        switch (f) {
          case 'sin': case 'cos': case 'tan':
            return check(trig(f, x, A, p), p);
          case 'asin': case 'acos':
            if (Math.abs(x) > 1) throw new CalcError('Math', p);
            return check(fromRad(f === 'asin' ? Math.asin(x) : Math.acos(x), A), p);
          case 'atan': return check(fromRad(Math.atan(x), A), p);
          case 'sinh': return check(Math.sinh(x), p);
          case 'cosh': return check(Math.cosh(x), p);
          case 'tanh': return check(Math.tanh(x), p);
          case 'asinh': return check(Math.asinh(x), p);
          case 'acosh':
            if (x < 1) throw new CalcError('Math', p);
            return check(Math.acosh(x), p);
          case 'atanh':
            if (Math.abs(x) >= 1) throw new CalcError('Math', p);
            return check(Math.atanh(x), p);
          case 'log':
            if (x <= 0) throw new CalcError('Math', p);
            return check(Math.log10(x), p);
          case 'ln':
            if (x <= 0) throw new CalcError('Math', p);
            return check(Math.log(x), p);
          case 'pow10': return check(isInt(x) ? Number('1e' + Math.round(x)) : Math.pow(10, x), p);
          case 'expe': return check(Math.exp(x), p);
          case 'sqrt':
            if (x < 0) throw new CalcError('Math', p);
            return check(Math.sqrt(x), p);
          case 'cbrt': return check(Math.cbrt(x), p);
          case 'Rnd': return check(roundToDisplay(x, ctx.settings), p);
        }
      }
    }
    throw new CalcError('Syntax', p);
  }

  // ---- Exact rationals (BigInt) for fraction results ---------------------
  const LIMIT = 10n ** 40n;
  const babs = (x) => (x < 0n ? -x : x);
  function bgcd(a, b) {
    a = babs(a);
    b = babs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  }
  function rat(n, d) {
    if (d === 0n) return null;
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = bgcd(n, d) || 1n;
    n /= g;
    d /= g;
    if (babs(n) > LIMIT || d > LIMIT) return null;
    return { n, d };
  }
  function ratFromLiteral(s) {
    const m = /^(\d*)(?:\.(\d*))?(?:e(-?\d+))?$/.exec(s);
    if (!m) return null;
    const intp = m[1] || '0';
    const fracp = m[2] || '';
    let e = m[3] ? parseInt(m[3], 10) : 0;
    let n = BigInt(intp + fracp);
    e -= fracp.length;
    if (Math.abs(e) > 30) return null;
    return e >= 0 ? rat(n * 10n ** BigInt(e), 1n) : rat(n, 10n ** BigInt(-e));
  }
  function ratEval(node) {
    const R = ratEval;
    const both = (a, b, f) => (a && b ? f(a, b) : null);
    switch (node.t) {
      case 'num': return ratFromLiteral(node.s);
      case 'paren': return R(node.a);
      case 'neg': {
        const a = R(node.a);
        return a && rat(-a.n, a.d);
      }
      case 'bin': {
        const a = R(node.l), b = R(node.r);
        return both(a, b, (a, b) => {
          if (node.op === '+') return rat(a.n * b.d + b.n * a.d, a.d * b.d);
          if (node.op === '-') return rat(a.n * b.d - b.n * a.d, a.d * b.d);
          if (node.op === '×') return rat(a.n * b.n, a.d * b.d);
          return b.n === 0n ? null : rat(a.n * b.d, a.d * b.n);
        });
      }
      case 'frac': {
        const n = R(node.n), d = R(node.d);
        const w = node.w ? R(node.w) : rat(0n, 1n);
        if (!n || !d || !w || d.n === 0n) return null;
        const f = rat(n.n * d.d, n.d * d.n);
        if (!f) return null;
        const sf = w.n < 0n ? rat(-f.n, f.d) : f;
        return rat(w.n * sf.d + sf.n * w.d, w.d * sf.d);
      }
      case 'post': {
        const a = R(node.a);
        if (!a) return null;
        if (node.f === 'sq') return rat(a.n * a.n, a.d * a.d);
        if (node.f === 'cube') return rat(a.n ** 3n, a.d ** 3n);
        if (node.f === 'inv') return a.n === 0n ? null : rat(a.d, a.n);
        return null;
      }
      case 'pow': {
        if (node.f !== 'pow') return null;
        const a = R(node.l), b = R(node.r);
        if (!a || !b || b.d !== 1n || babs(b.n) > 60n) return null;
        if (b.n >= 0n) return rat(a.n ** b.n, a.d ** b.n);
        if (a.n === 0n) return null;
        return rat(a.d ** -b.n, a.n ** -b.n);
      }
      default:
        return null;
    }
  }

  // Best rational approximation for decimal -> fraction conversion.
  function approxRat(v) {
    if (!isFinite(v)) return null;
    const neg = v < 0;
    let x = Math.abs(v);
    let h0 = 0, h1 = 1, k0 = 1, k1 = 0;
    let y = x;
    for (let iter = 0; iter < 40; iter++) {
      const a = Math.floor(y);
      const h2 = a * h1 + h0, k2 = a * k1 + k0;
      if (k2 > 1e10 || h2 > 1e15) break;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(h1 / k1 - x) <= 1e-12 * Math.max(1, x)) {
        return rat(BigInt(neg ? -h1 : h1), BigInt(k1));
      }
      const f = y - a;
      if (f < 1e-15) break;
      y = 1 / f;
    }
    return null;
  }

  // Fraction text (without sign) for 7-seg display, or null if it does not fit
  // in 10 cells or is a whole number.
  function fracText(r, improper) {
    if (!r || r.d === 1n) return null;
    const n = babs(r.n);
    const s = improper || n < r.d ? n + '┘' + r.d : n / r.d + '┘' + (n % r.d) + '┘' + r.d;
    return s.length <= 10 ? s : null;
  }

  // ---- Number formatting -------------------------------------------------
  const digitCount = (s) => s.replace(/[^0-9]/g, '').length;

  function sciFormat(a, sig, trim) {
    let [m, e] = a.toExponential(sig - 1).split('e');
    e = parseInt(e, 10);
    if (trim && m.includes('.')) m = m.replace(/0+$/, '');
    if (!m.includes('.')) m += '.';
    return { mant: m, exp: e };
  }

  function plainFormat(a, maxDigits) {
    const intDigits = a >= 1 ? Math.floor(Math.log10(a)) + 1 : 1;
    let dec = Math.max(0, maxDigits - intDigits);
    let s = a.toFixed(dec);
    while (digitCount(s) > maxDigits && dec > 0) s = a.toFixed(--dec);
    if (digitCount(s) > maxDigits) return null;
    if (s.includes('.')) s = s.replace(/0+$/, '');
    if (!s.includes('.')) s += '.';
    return s;
  }

  // Returns { neg, mant, exp } where mant is a digit string with '.', and exp
  // is an integer exponent or null.
  function formatNumber(v, s) {
    v = round15(v);
    const neg = v < 0;
    const a = Math.abs(v);
    if (s.disp === 'sci') {
      const r = a === 0 ? { mant: (0).toFixed((s.dispN || 10) - 1), exp: 0 } : sciFormat(a, s.dispN === 0 ? 10 : s.dispN, false);
      if (!r.mant.includes('.')) r.mant += '.';
      return { neg, ...r };
    }
    if (a === 0) return { neg: false, mant: s.disp === 'fix' ? (0).toFixed(s.dispN) + (s.dispN === 0 ? '.' : '') : '0.', exp: null };
    if (s.disp === 'fix') {
      if (a < 1e10) {
        let dec = s.dispN;
        let str = a.toFixed(dec);
        while (digitCount(str) > 10 && dec > 0) str = a.toFixed(--dec);
        if (digitCount(str) <= 10) {
          if (!str.includes('.')) str += '.';
          return { neg: neg && Number(str) !== 0, mant: str, exp: null };
        }
      }
      return { neg, ...sciFormat(a, 10, true) };
    }
    const lo = s.dispN === 2 ? 1e-9 : 1e-2;
    if (a >= 1e10 || a < lo) return { neg, ...sciFormat(a, 10, true) };
    const str = plainFormat(a, 10);
    if (str === null) return { neg, ...sciFormat(a, 10, true) };
    return { neg, mant: str, exp: null };
  }

  function formatEng(v, level) {
    v = round15(v);
    const neg = v < 0;
    const a = Math.abs(v);
    if (a === 0) return { neg: false, mant: '0.', exp: 0 };
    const e = Math.floor(Math.log10(a) + 1e-12);
    let e3 = Math.floor(e / 3) * 3 - 3 * level;
    const m = round15(a / Math.pow(10, e3));
    const str = plainFormat(m, 10);
    if (str === null || m < 1e-9) return null;
    if (Math.abs(e3) > 99) return null;
    return { neg, mant: str, exp: e3 };
  }

  function formatDMS(v) {
    v = round15(v);
    const neg = v < 0;
    let a = Math.abs(v);
    if (a >= 1e7) return null;
    let d = Math.floor(a);
    let mFloat = (a - d) * 60;
    let m = Math.floor(round15(mFloat));
    let sec = round15((mFloat - m) * 60);
    const used = String(d).length + String(m).length;
    const secInt = String(Math.floor(sec)).length;
    let dec = Math.max(0, 10 - used - secInt);
    let secStr = sec.toFixed(dec);
    if (parseFloat(secStr) >= 60) {
      secStr = (0).toFixed(dec);
      m += 1;
      if (m >= 60) {
        m = 0;
        d += 1;
      }
    }
    if (secStr.includes('.')) secStr = secStr.replace(/0+$/, '').replace(/\.$/, '');
    return { neg, mant: d + '°' + m + '°' + secStr + '°', exp: null };
  }

  // Lay out a formatted value into the 7-segment row: 1 sign cell + 10 cells.
  function toCells(f) {
    const cells = [];
    for (const ch of f.mant) {
      if (ch === '.' && cells.length) cells[cells.length - 1].dp = true;
      else if (ch === '.') cells.push({ ch: '0', dp: true });
      else if (ch === '°' && cells.length) cells[cells.length - 1].deg = true;
      else cells.push({ ch });
    }
    while (cells.length < 10) cells.unshift({ ch: ' ' });
    cells.unshift({ ch: f.neg ? '-' : ' ' });
    let exp = null;
    if (f.exp !== null && f.exp !== undefined) {
      const e = Math.abs(f.exp);
      exp = { neg: f.exp < 0, digits: (e < 10 ? '0' : '') + e };
    }
    return { cells: cells.slice(-11), exp };
  }

  // ---- Statistics --------------------------------------------------------
  function statSums(data) {
    const s = { n: 0, sx: 0, sx2: 0, sx3: 0, sx4: 0, sy: 0, sy2: 0, sxy: 0, sx2y: 0 };
    for (const d of data) {
      const f = d.f;
      const x = d.x, y = d.y || 0;
      s.n += f;
      s.sx += f * x;
      s.sx2 += f * x * x;
      s.sx3 += f * x * x * x;
      s.sx4 += f * x * x * x * x;
      s.sy += f * y;
      s.sy2 += f * y * y;
      s.sxy += f * x * y;
      s.sx2y += f * x * x * y;
    }
    return s;
  }

  function sdPair(data, key, mean, n, p) {
    let ss = 0;
    for (const d of data) ss += d.f * Math.pow(d[key] - mean, 2);
    return { sn: Math.sqrt(ss / n), sn1: n > 1 ? Math.sqrt(ss / (n - 1)) : null };
  }

  function regression(data, type, p) {
    const n0 = data.reduce((a, d) => a + d.f, 0);
    if (n0 === 0) throw new CalcError('Math', p);
    if (type === 'Quad') {
      const s = statSums(data);
      const M = [
        [s.n, s.sx, s.sx2],
        [s.sx, s.sx2, s.sx3],
        [s.sx2, s.sx3, s.sx4],
      ];
      const V = [s.sy, s.sxy, s.sx2y];
      const det3 = (m) =>
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det3(M);
      if (Math.abs(D) < 1e-300) throw new CalcError('Math', p);
      const col = (c) => M.map((row, r) => row.map((v, k) => (k === c ? V[r] : v)));
      return { A: det3(col(0)) / D, B: det3(col(1)) / D, C: det3(col(2)) / D, r: null };
    }
    const tx = (x) => {
      if (type === 'Log' || type === 'Pwr') {
        if (x <= 0) throw new CalcError('Math', p);
        return Math.log(x);
      }
      if (type === 'Inv') {
        if (x === 0) throw new CalcError('Math', p);
        return 1 / x;
      }
      return x;
    };
    const ty = (y) => {
      if (type === 'Exp' || type === 'Pwr') {
        if (y <= 0) throw new CalcError('Math', p);
        return Math.log(y);
      }
      return y;
    };
    let n = 0, sx = 0, sy = 0;
    const pts = data.map((d) => ({ X: tx(d.x), Y: ty(d.y), f: d.f }));
    for (const q of pts) {
      n += q.f;
      sx += q.f * q.X;
      sy += q.f * q.Y;
    }
    const mx = sx / n, my = sy / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of pts) {
      sxx += q.f * (q.X - mx) * (q.X - mx);
      syy += q.f * (q.Y - my) * (q.Y - my);
      sxy += q.f * (q.X - mx) * (q.Y - my);
    }
    if (sxx === 0) throw new CalcError('Math', p);
    const B = sxy / sxx;
    let A = my - B * mx;
    if (type === 'Exp' || type === 'Pwr') A = Math.exp(A);
    const r = syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
    return { A, B, C: 0, r };
  }

  function statValue(id, data, mode, regType, p) {
    if (!data.length) throw new CalcError('Math', p);
    const s = statSums(data);
    const n = s.n;
    switch (id) {
      case 'n': return n;
      case 'sumx': return s.sx;
      case 'sumx2': return s.sx2;
      case 'sumx3': return s.sx3;
      case 'sumx4': return s.sx4;
      case 'sumy': return s.sy;
      case 'sumy2': return s.sy2;
      case 'sumxy': return s.sxy;
      case 'sumx2y': return s.sx2y;
    }
    if (n === 0) throw new CalcError('Math', p);
    if (id === 'mean') return s.sx / n;
    if (id === 'ymean') return s.sy / n;
    if (id === 'sdn' || id === 'sdn1') {
      const r = sdPair(data, 'x', s.sx / n, n, p);
      const v = id === 'sdn' ? r.sn : r.sn1;
      if (v === null) throw new CalcError('Math', p);
      return v;
    }
    if (id === 'ysdn' || id === 'ysdn1') {
      const r = sdPair(data, 'y', s.sy / n, n, p);
      const v = id === 'ysdn' ? r.sn : r.sn1;
      if (v === null) throw new CalcError('Math', p);
      return v;
    }
    if (mode !== 'REG') throw new CalcError('Math', p);
    const reg = regression(data, regType, p);
    if (id === 'rA') return reg.A;
    if (id === 'rB') return reg.B;
    if (id === 'rC') return reg.C;
    if (id === 'rr') {
      if (reg.r === null) throw new CalcError('Math', p);
      return reg.r;
    }
    throw new CalcError('Math', p);
  }

  function estimate(f, v, data, regType, p) {
    const { A, B, C } = regression(data, regType, p);
    const T2 = regType;
    if (f === 'yhat') {
      switch (T2) {
        case 'Lin': return A + B * v;
        case 'Log':
          if (v <= 0) throw new CalcError('Math', p);
          return A + B * Math.log(v);
        case 'Exp': return A * Math.exp(B * v);
        case 'Pwr':
          if (v <= 0) throw new CalcError('Math', p);
          return A * Math.pow(v, B);
        case 'Inv':
          if (v === 0) throw new CalcError('Math', p);
          return A + B / v;
        case 'Quad': return A + B * v + C * v * v;
      }
    }
    if (T2 === 'Quad') {
      if (f === 'xhat') throw new CalcError('Math', p);
      if (C === 0) throw new CalcError('Math', p);
      const disc = B * B - 4 * C * (A - v);
      if (disc < 0) throw new CalcError('Math', p);
      const sq = Math.sqrt(disc);
      return f === 'xhat1' ? (-B + sq) / (2 * C) : (-B - sq) / (2 * C);
    }
    if (f !== 'xhat') throw new CalcError('Math', p);
    if (B === 0) throw new CalcError('Math', p);
    switch (T2) {
      case 'Lin': return (v - A) / B;
      case 'Log': return Math.exp((v - A) / B);
      case 'Exp':
        if (v / A <= 0) throw new CalcError('Math', p);
        return Math.log(v / A) / B;
      case 'Pwr':
        if (v / A <= 0) throw new CalcError('Math', p);
        return Math.pow(v / A, 1 / B);
      case 'Inv':
        if (v === A) throw new CalcError('Math', p);
        return B / (v - A);
    }
    throw new CalcError('Math', p);
  }

  // ---- Public evaluate ---------------------------------------------------
  // ctx: { angle, vars, ans, rand, settings, data, mode, regType }
  // Returns { value, rat, hasFrac, side }
  function evaluate(toks, ctx) {
    let pct = false;
    if (toks[toks.length - 1] === '%') {
      pct = true;
      toks = toks.slice(0, -1);
    }
    if (toks.includes('%')) throw new CalcError('Syntax', toks.indexOf('%'));
    if (toks.includes(';')) throw new CalcError('Syntax', toks.indexOf(';'));
    const tree = parse(toks);
    const full = Object.assign({}, ctx, {
      side: {},
      stat: (id, p) => statValue(id, ctx.data || [], ctx.mode, ctx.regType, p),
      estimate: (f, v, p) => {
        if (ctx.mode !== 'REG' || !(ctx.data || []).length) throw new CalcError('Math', p);
        return estimate(f, v, ctx.data, ctx.regType, p);
      },
    });
    let value;
    if (pct) {
      const end = toks.length;
      if (tree.t === 'bin') {
        const a = evalNode(tree.l, full), b = evalNode(tree.r, full);
        if (tree.op === '×') value = (a * b) / 100;
        else if (tree.op === '÷') {
          if (b === 0) throw new CalcError('Math', end);
          value = (a / b) * 100;
        } else if (tree.op === '+') value = a + (a * b) / 100;
        else value = a - (a * b) / 100;
      } else value = evalNode(tree, full) / 100;
      check(value, end);
    } else {
      value = evalNode(tree, full);
    }
    value = round15(value);
    if (Object.is(value, -0)) value = 0;
    const hasFrac = hasNode(tree, (n) => n.t === 'frac');
    const hasDec = hasNode(tree, (n) => n.t === 'num' && n.dec);
    let r = null;
    if (!pct && hasFrac && !hasDec) r = ratEval(tree);
    return { value, rat: r, hasFrac: hasFrac && !hasDec && !!r, side: full.side };
  }

  // Evaluate a plain numeric expression (used for stat data entry parts).
  function evaluateNumber(toks, ctx) {
    return evaluate(toks, ctx).value;
  }

  const Engine = {
    G, T, VARS, CalcError, parse, evaluate, evaluateNumber,
    formatNumber, formatEng, formatDMS, toCells, fracText, approxRat,
    statValue, regression, round15, roundToDisplay,
    tokenText: (toks) => toks.map((t) => T[t].text).join(''),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
