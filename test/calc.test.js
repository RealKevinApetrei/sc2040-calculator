const test = require('node:test');
const assert = require('node:assert');
const { Calc } = require('../app/calc.js');

function run(keys, calc = new Calc()) {
  for (const k of keys.split(' ').filter(Boolean)) calc.press(k);
  return calc;
}
function bottom(calc) {
  const d = calc.display();
  if (!d.bottom || d.bottom.blank) return '';
  let s = '';
  for (const c of d.bottom.cells) {
    s += c.ch === ' ' ? '' : c.ch;
    if (c.dp) s += '.';
    if (c.deg) s += '°';
  }
  if (d.bottom.exp) s += ' E' + (d.bottom.exp.neg ? '-' : '') + d.bottom.exp.digits;
  return s;
}
const top = (calc) => calc.display().top.text;

test('basic calculation and Ans continuation', () => {
  const c = run('1 add 2 eq');
  assert.strictEqual(bottom(c), '3.');
  run('mul 4 eq', c);
  assert.strictEqual(top(c), 'Ans×4');
  assert.strictEqual(bottom(c), '12.');
  run('eq', c); // repeat Ans×4
  assert.strictEqual(bottom(c), '48.');
});

test('shift functions and hyp', () => {
  assert.strictEqual(bottom(run('shift sin 0 dot 5 eq')), '30.');
  assert.strictEqual(top(run('hyp sin 0 eq')), 'sinh(0');
  assert.strictEqual(top(run('hyp shift sin 0 eq')), 'sinh⁻¹(0');
  assert.strictEqual(bottom(run('5 shift inv eq')), '120.');
  assert.strictEqual(bottom(run('shift exp eq')), '3.141592654');
});

test('fractions toggle', () => {
  const c = run('1 frac 2 add 1 frac 3 eq');
  assert.strictEqual(bottom(c), '5┘6');
  run('frac', c);
  assert.strictEqual(bottom(c), '0.833333333');
  run('frac', c);
  assert.strictEqual(bottom(c), '5┘6');
  const d = run('0 dot 7 5 eq frac');
  assert.strictEqual(bottom(d), '3┘4');
  const e = run('5 frac 3 eq');
  assert.strictEqual(bottom(e), '1┘2┘3');
  run('shift frac', e);
  assert.strictEqual(bottom(e), '5┘3');
});

test('errors and cursor to error', () => {
  const c = run('1 add eq');
  assert.strictEqual(top(c), 'Syntax ERROR');
  run('left', c);
  assert.strictEqual(c.phase, 'edit');
  assert.strictEqual(c.cur, 2);
  const m = run('1 div 0 eq');
  assert.strictEqual(top(m), 'Math ERROR');
});

test('editing: overwrite, insert, delete', () => {
  const c = run('1 2 3 left left 9');
  assert.strictEqual(top(c), '193');
  run('shift del left 7', c);
  assert.strictEqual(top(c), '1793');
  run('del', c);
  assert.strictEqual(top(c), '193');
});

test('replay history', () => {
  const c = run('1 add 1 eq 2 add 2 eq 3 add 3 eq');
  run('up', c);
  assert.strictEqual(top(c), '2+2');
  assert.strictEqual(bottom(c), '4.');
  run('up', c);
  assert.strictEqual(top(c), '1+1');
  run('down', c);
  assert.strictEqual(top(c), '2+2');
  run('left 0 eq', c); // edit to 2+20
  assert.strictEqual(bottom(c), '22.');
});

test('memory and variables', () => {
  const c = run('5 mplus 3 mplus');
  assert.strictEqual(c.vars.M, 8);
  run('shift mplus', c); // subtract Ans (3)
  assert.strictEqual(c.vars.M, 5);
  run('7 shift rcl neg', c);
  assert.strictEqual(c.vars.A, 7);
  run('ac alpha neg mul 2 eq', c);
  assert.strictEqual(bottom(c), '14.');
  run('rcl neg', c);
  assert.strictEqual(bottom(c), '7.');
  run('shift mode 1', c);
  assert.strictEqual(top(c), 'Mem Clear');
  assert.strictEqual(c.vars.A, 0);
});

test('modes: rad, fix, sci, eng, DMS', () => {
  const c = run('mode mode 2 shift exp eq');
  assert.ok(c.display().ind.R);
  run('ac sin shift exp div 2 eq', c);
  assert.strictEqual(bottom(c), '1.');
  const f = run('mode mode mode 1 2 1 div 3 eq');
  assert.strictEqual(bottom(f), '0.33');
  assert.ok(f.display().ind.FIX);
  const s = run('mode mode mode 2 3 1 2 3 4 eq');
  assert.strictEqual(bottom(s), '1.23 E03');
  const e = run('1 2 3 4 5 eq eng');
  assert.strictEqual(bottom(e), '12.345 E03');
  run('eng', e);
  assert.strictEqual(bottom(e), '12345. E00');
  run('shift eng shift eng', e);
  assert.strictEqual(bottom(e), '0.012345 E06');
  const d = run('2 dot 5 1 eq dms');
  assert.strictEqual(bottom(d), '2°30°36°');
});

test('SD statistics', () => {
  const c = run('mode 2');
  assert.ok(c.display().ind.SD);
  run('1 0 mplus 2 0 mplus 3 0 shift comma 2 mplus', c);
  assert.strictEqual(top(c), 'n=');
  assert.strictEqual(bottom(c), '3.');
  run('ac shift 2 1 eq', c);
  assert.strictEqual(bottom(c), '22.5');
  run('ac shift 1 3 eq', c);
  assert.strictEqual(bottom(c), '4.');
  run('ac down', c);
  assert.strictEqual(top(c), 'x1=');
  run('down down', c);
  assert.strictEqual(top(c), 'x2=');
  run('2 5 eq', c);
  assert.strictEqual(c.data[1].x, 25);
});

test('REG linear statistics', () => {
  const c = run('mode 3 1');
  assert.ok(c.display().ind.REG);
  run('1 comma 3 mplus 2 comma 5 mplus 3 comma 7 mplus', c);
  run('ac shift 2 right right 2 eq', c);
  assert.strictEqual(bottom(c), '2.');
  run('ac 1 0 shift 2 right right right 2 eq', c);
  assert.strictEqual(bottom(c), '21.');
});

test('percent and DRG', () => {
  assert.strictEqual(bottom(run('1 5 0 0 mul 1 2 shift eq')), '180.');
  assert.strictEqual(bottom(run('shift exp shift ans 2 eq')), '180.');
});

test('Pol stores E and F', () => {
  const c = run('pol 1 comma 1 rp eq');
  assert.strictEqual(c.vars.F, 45);
  run('rcl tan', c);
  assert.strictEqual(bottom(c), '45.');
});

test('power off and on keeps memory', () => {
  const c = run('9 shift rcl neg shift ac');
  assert.ok(c.display().off);
  run('5', c);
  assert.ok(c.display().off);
  run('on', c);
  assert.strictEqual(c.vars.A, 9);
  assert.strictEqual(bottom(c), '0.');
});

test('fraction answers carry stacked parts for the display', () => {
  const c = run('2 frac 1 frac 3 add 1 frac 4 eq');
  assert.deepStrictEqual(c.display().bottom.frac, { neg: false, whole: '2', num: '7', den: '12' });
  run('shift frac', c);
  assert.deepStrictEqual(c.display().bottom.frac, { neg: false, whole: '', num: '31', den: '12' });
  const d = run('neg 1 frac 3 eq');
  assert.deepStrictEqual(d.display().bottom.frac, { neg: true, whole: '', num: '1', den: '3' });
  run('frac', d);
  assert.strictEqual(d.display().bottom.frac, undefined);
});
