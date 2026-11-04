const test = require('node:test');
const assert = require('node:assert');
const E = require('../app/engine.js');

const ctx = (o = {}) => Object.assign({
  angle: 'D', vars: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0 }, ans: 0,
  rand: () => 0.5, settings: { disp: 'norm', dispN: 1 }, data: [], mode: 'COMP', regType: 'Lin',
}, o);
const ev = (toks, o) => E.evaluate(toks, ctx(o)).value;
const err = (toks, o) => {
  try { E.evaluate(toks, ctx(o)); } catch (e) { return e.type + '@' + e.pos; }
  return 'no error';
};
const fmt = (v, s = { disp: 'norm', dispN: 1 }) => {
  const f = E.formatNumber(v, s);
  return (f.neg ? '-' : '') + f.mant + (f.exp !== null ? ' E' + f.exp : '');
};

test('basic arithmetic and precedence', () => {
  assert.strictEqual(ev(['1', '+', '2', '×', '3']), 7);
  assert.strictEqual(ev(['0', '.', '1', '+', '0', '.', '2']), 0.3);
  assert.strictEqual(ev(['NEG', '2', 'sq']), -4);
  assert.strictEqual(ev(['2', '^(', '3', ')', 'sq']), 64);
  assert.strictEqual(ev(['6', '÷', '2', '(', '1', '+', '2', ')']), 1); // implicit × binds tighter
  assert.strictEqual(ev(['2', 'π']), E.round15(2 * Math.PI));
  assert.strictEqual(ev(['(', '2', '+', '3']), 5); // auto close
  assert.strictEqual(ev(['1', 'EXP', 'NEG', '3']), 0.001);
});

test('trig in degrees, radians, grads', () => {
  assert.strictEqual(ev(['sin(', '3', '0']), 0.5);
  assert.strictEqual(ev(['sin(', '1', '8', '0']), 0);
  assert.strictEqual(ev(['cos(', '9', '0']), 0);
  assert.strictEqual(err(['tan(', '9', '0']), 'Math@0');
  assert.strictEqual(ev(['asin(', '0', '.', '5']), 30);
  assert.strictEqual(ev(['sin(', 'π', ')'], { angle: 'R' }), 0);
  assert.strictEqual(ev(['cos(', '1', '0', '0'], { angle: 'G' }), 0);
  assert.strictEqual(ev(['π', 'radU'], { angle: 'D' }), 180);
  assert.strictEqual(ev(['2', 'sin(', '3', '0', ')']), 1);
});

test('functions and errors', () => {
  assert.strictEqual(ev(['5', 'fact']), 120);
  assert.strictEqual(ev(['5', 'nCr', '2']), 10);
  assert.strictEqual(ev(['5', 'nPr', '2']), 20);
  assert.strictEqual(ev(['3', 'xrt(', '8']), 2);
  assert.strictEqual(ev(['3', 'xrt(', 'NEG', '8']), -2);
  assert.strictEqual(ev(['cbrt(', 'NEG', '2', '7']), -3);
  assert.strictEqual(ev(['log(', '1', '0', '0', '0']), 3);
  assert.strictEqual(ev(['ln(', 'expe(', '2']), 2);
  assert.strictEqual(err(['1', '÷', '0']), 'Math@1');
  assert.strictEqual(err(['1', '+']), 'Syntax@2');
  assert.strictEqual(err(['1', ')']), 'Syntax@1');
  assert.strictEqual(err(['sqrt(', 'NEG', '1']), 'Math@0');
  assert.strictEqual(err(['7', '0', 'fact']), 'Math@2');
});

test('percent', () => {
  assert.strictEqual(ev(['1', '5', '0', '0', '×', '1', '2', '%']), 180);
  assert.strictEqual(ev(['6', '6', '0', '÷', '8', '8', '0', '%']), 75);
  assert.strictEqual(ev(['2', '0', '0', '+', '1', '0', '%']), 220);
});

test('fractions', () => {
  const r = E.evaluate(['1', '┘', '2', '+', '1', '┘', '3'], ctx());
  assert.ok(r.hasFrac);
  assert.strictEqual(E.fracText(r.rat, false), '5┘6');
  const r2 = E.evaluate(['2', '┘', '1', '┘', '2', '+', '1', '┘', '3'], ctx());
  assert.strictEqual(E.fracText(r2.rat, false), '2┘5┘6');
  assert.strictEqual(E.fracText(r2.rat, true), '17┘6');
  const r3 = E.evaluate(['1', '┘', '3', '+', '0', '.', '5'], ctx());
  assert.ok(!r3.hasFrac);
  assert.strictEqual(E.fracText(E.approxRat(0.75), false), '3┘4');
  assert.strictEqual(E.fracText(E.approxRat(1 / 3), false), '1┘3');
});

test('DMS', () => {
  assert.strictEqual(ev(['2', '°', '3', '0', '°']), 2.5);
  assert.strictEqual(ev(['2', '°', '3', '0', '°', '3', '6', '°']), 2.51);
  assert.strictEqual(E.formatDMS(2.51).mant, '2°30°36°');
});

test('Pol/Rec', () => {
  const r = E.evaluate(['Pol(', '1', ',', '1'], ctx());
  assert.strictEqual(r.value, E.round15(Math.SQRT2));
  assert.strictEqual(r.side.F, 45);
  const r2 = E.evaluate(['Rec(', '2', ',', '6', '0'], ctx());
  assert.strictEqual(r2.side.E, 1);
});

test('formatting', () => {
  assert.strictEqual(fmt(0), '0.');
  assert.strictEqual(fmt(1 / 3), '0.333333333');
  assert.strictEqual(fmt(2 / 3), '0.666666667');
  assert.strictEqual(fmt(123456789012), '1.23456789 E11');
  assert.strictEqual(fmt(0.001), '1. E-3');
  assert.strictEqual(fmt(0.001, { disp: 'norm', dispN: 2 }), '0.001');
  assert.strictEqual(fmt(-12.5), '-12.5');
  assert.strictEqual(fmt(9999999999.9), '1. E10');
  assert.strictEqual(fmt(1 / 3, { disp: 'fix', dispN: 2 }), '0.33');
  assert.strictEqual(fmt(5, { disp: 'fix', dispN: 0 }), '5.');
  assert.strictEqual(fmt(1234, { disp: 'sci', dispN: 3 }), '1.23 E3');
  const e = E.formatEng(1234, 0);
  assert.strictEqual(e.mant + ' ' + e.exp, '1.234 3');
  const e2 = E.formatEng(1234, -1);
  assert.strictEqual(e2.mant + ' ' + e2.exp, '0.001234 6');
});

test('statistics SD and REG', () => {
  const data = [{ x: 1, f: 1 }, { x: 2, f: 1 }, { x: 3, f: 2 }];
  const o = { data, mode: 'SD' };
  assert.strictEqual(ev(['s:n'], o), 4);
  assert.strictEqual(ev(['s:mean'], o), 2.25);
  assert.strictEqual(ev(['s:sdn'], o), E.round15(Math.sqrt(((1.25 ** 2) + (0.25 ** 2) + 2 * (0.75 ** 2)) / 4)));
  const reg = [{ x: 1, y: 3, f: 1 }, { x: 2, y: 5, f: 1 }, { x: 3, y: 7, f: 1 }];
  const r = { data: reg, mode: 'REG', regType: 'Lin' };
  assert.strictEqual(ev(['s:rA'], r), 1);
  assert.strictEqual(ev(['s:rB'], r), 2);
  assert.strictEqual(ev(['s:rr'], r), 1);
  assert.strictEqual(ev(['1', '0', 'yhat'], r), 21);
  assert.strictEqual(ev(['2', '1', 'xhat'], r), 10);
  const q = [{ x: 0, y: 1, f: 1 }, { x: 1, y: 2, f: 1 }, { x: 2, y: 5, f: 1 }, { x: 3, y: 10, f: 1 }];
  const qo = { data: q, mode: 'REG', regType: 'Quad' };
  assert.strictEqual(ev(['s:rA'], qo), 1);
  assert.strictEqual(ev(['s:rB'], qo), 0);
  assert.strictEqual(ev(['s:rC'], qo), 1);
  assert.strictEqual(ev(['5', 'xhat1'], qo), 2);
});
