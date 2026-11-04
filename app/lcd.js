/* Canvas renderer for the two-line LCD: indicator row, 12-char dot-matrix
 * line and 10-digit 7-segment line with 2-digit exponent. */
(function (root) {
  'use strict';
  const FONT = root.FONT5x7;

  const W = 300, H = 100; // logical LCD size
  const INK = '#1a1e16';
  const GHOST = 'rgba(26,30,22,0.028)';

  // Indicator row (label, key in display().ind, x)
  const INDICATORS = [
    ['S', 'S', 6], ['A', 'A', 18], ['M', 'M', 30], ['STO', 'STO', 44], ['RCL', 'RCL', 66],
    ['SD', 'SD', 90], ['REG', 'REG', 106], ['FIX', 'FIX', 130], ['SCI', 'SCI', 152],
    ['hyp', 'hyp', 174], ['D', 'D', 197], ['R', 'R', 208], ['G', 'G', 219],
  ];

  const SEGS = {
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
    '6': 'afgedc', '7': 'abcf', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '', '┘': 'cd',
  };

  class LCD {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.blinkOn = true;
      this.state = null;
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.max(1, root.devicePixelRatio || 1);
      // render at the on-screen size (includes CSS transform scale)
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      if (this.state) this.draw(this.state);
    }
    draw(d) {
      this.state = d;
      const c = this.ctx;
      const sx = this.canvas.width / W, sy = this.canvas.height / H;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      c.setTransform(sx, 0, 0, sy, 0, 0);
      if (!d || d.off) return;

      // Pass 1: soft LCD shadow, pass 2: ink
      for (const pass of [0, 1]) {
        c.save();
        if (pass === 0) {
          c.translate(0.7, 0.9);
          c.globalAlpha = 0.13;
        }
        this.drawIndicators(c, d.ind, pass);
        this.drawTop(c, d.top, pass);
        this.drawBottom(c, d.bottom, d.comma, pass);
        c.restore();
      }
    }

    drawIndicators(c, ind, pass) {
      c.font = '600 7.6px "Helvetica Neue", Arial, sans-serif';
      c.textBaseline = 'top';
      c.fillStyle = INK;
      for (const [label, key, x] of INDICATORS) {
        if (ind[key]) c.fillText(label, x, 3);
      }
      const tri = (x, y, dir) => {
        c.beginPath();
        if (dir === 'up') { c.moveTo(x, y + 5); c.lineTo(x + 3.2, y); c.lineTo(x + 6.4, y + 5); }
        if (dir === 'down') { c.moveTo(x, y); c.lineTo(x + 3.2, y + 5); c.lineTo(x + 6.4, y); }
        if (dir === 'left') { c.moveTo(x + 5, y); c.lineTo(x, y + 3.2); c.lineTo(x + 5, y + 6.4); }
        if (dir === 'right') { c.moveTo(x, y); c.lineTo(x + 5, y + 3.2); c.lineTo(x, y + 6.4); }
        c.closePath();
        c.fill();
      };
      if (ind.left) tri(246, 4, 'left');
      if (ind.right) tri(254, 4, 'right');
      if (ind.up) tri(270, 2.5, 'up');
      if (ind.down) tri(279, 2.5, 'down');
      if (ind.INS) {
        c.font = '600 6.4px "Helvetica Neue", Arial, sans-serif';
        c.fillText('INS', 230, 4);
      }
    }

    drawTop(c, top, pass) {
      const p = 3.55; // dot pitch
      const dot = p * 0.86;
      const x0 = 13, y0 = 17;
      const cellW = 6 * p;
      const text = (top && top.text) || '';
      // ghost dots for authenticity
      if (pass === 1) {
        c.fillStyle = GHOST;
        for (let i = 0; i < 12; i++) {
          for (let r = 0; r < 7; r++) for (let col = 0; col < 5; col++) c.fillRect(x0 + i * cellW + col * p, y0 + r * p, dot, dot);
        }
      }
      c.fillStyle = INK;
      const chars = Array.from(text);
      for (let i = 0; i < Math.min(12, chars.length); i++) {
        const g = FONT[chars[i]] || FONT.fallback;
        for (let r = 0; r < 7; r++) {
          for (let col = 0; col < 5; col++) {
            if (g[r][col]) c.fillRect(x0 + i * cellW + col * p, y0 + r * p, dot, dot);
          }
        }
      }
      const cur = top && top.cursor;
      if (cur && this.blinkOn && cur.pos >= 0 && cur.pos < 12) {
        const cx = x0 + cur.pos * cellW;
        if (cur.style === 'full') c.fillRect(cx, y0, 5 * p - (p - dot), 7 * p - (p - dot));
        else if (cur.style === 'insert') c.fillRect(cx - p * 0.75, y0, dot * 0.8, 7 * p);
        else c.fillRect(cx, y0 + 7 * p + 0.6, 5 * p - (p - dot), dot);
      }
    }

    drawBottom(c, b, comma, pass) {
      const x0 = 8, y0 = 50, dw = 17.5, dh = 37, pitch = 21.4;
      // ghost 8s
      if (pass === 1) {
        for (let i = 1; i < 11; i++) this.digit(c, x0 + i * pitch, y0, dw, dh, '8', GHOST);
        this.digit(c, x0 + 11 * pitch + 13, y0, 8.5, 17, '8', GHOST);
        this.digit(c, x0 + 11 * pitch + 24, y0, 8.5, 17, '8', GHOST);
      }
      if (!b || b.blank) return;
      b.cells.forEach((cell, i) => {
        const x = x0 + i * pitch;
        if (i === 0) {
          // sign cell: minus only
          if (cell.ch === '-') this.seg(c, x + 4, y0, dw, dh, 'g', INK);
          return;
        }
        this.digit(c, x, y0, dw, dh, cell.ch, INK);
        if (cell.dp) this.point(c, x + dw + 0.6, y0 + dh - 3.4, comma);
        if (cell.deg) this.degree(c, x + dw + 0.2, y0 + 1);
      });
      if (b.exp) {
        const ex = x0 + 11 * pitch + 2;
        if (b.exp.neg) this.seg(c, ex, y0, 8.5, 17, 'g', INK);
        this.digit(c, ex + 11, y0, 8.5, 17, b.exp.digits[0], INK);
        this.digit(c, ex + 22, y0, 8.5, 17, b.exp.digits[1], INK);
      }
    }

    digit(c, x, y, w, h, ch, color) {
      this.seg(c, x, y, w, h, SEGS[ch] !== undefined ? SEGS[ch] : '', color);
    }

    // Draw italic 7-segment segments.
    seg(c, x, y, w, h, list, color) {
      if (!list) return;
      const t = Math.max(1.4, w * 0.17); // thickness
      const g = t * 0.22; // gap
      const slant = 0.09;
      const hm = h / 2;
      const P = (px, py) => [x + px + (h - py) * slant, y + py];
      const hseg = (yy) => [
        P(g + t * 0.5, yy), P(g + t, yy - t / 2), P(w - g - t, yy - t / 2),
        P(w - g - t * 0.5, yy), P(w - g - t, yy + t / 2), P(g + t, yy + t / 2),
      ];
      const vseg = (xx, ya, yb) => [
        P(xx, ya + g + t * 0.5), P(xx + t / 2, ya + g + t), P(xx + t / 2, yb - g - t),
        P(xx, yb - g - t * 0.5), P(xx - t / 2, yb - g - t), P(xx - t / 2, ya + g + t),
      ];
      const shapes = {
        a: hseg(t / 2), g: hseg(hm), d: hseg(h - t / 2),
        f: vseg(t / 2, 0, hm), b: vseg(w - t / 2, 0, hm),
        e: vseg(t / 2, hm, h), c: vseg(w - t / 2, hm, h),
      };
      c.fillStyle = color;
      for (const s of list) {
        const pts = shapes[s];
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.closePath();
        c.fill();
      }
    }
    point(c, x, y, comma) {
      c.fillStyle = INK;
      c.fillRect(x, y, 3.2, 3.2);
      if (comma) {
        c.beginPath();
        c.moveTo(x + 3.2, y + 3.2);
        c.lineTo(x + 1.2, y + 7);
        c.lineTo(x, y + 7);
        c.lineTo(x + 1.6, y + 3.2);
        c.closePath();
        c.fill();
      }
    }
    degree(c, x, y) {
      c.strokeStyle = INK;
      c.lineWidth = 1.3;
      c.beginPath();
      c.arc(x + 2.6, y + 2.6, 2, 0, Math.PI * 2);
      c.stroke();
    }
  }

  root.LCD = LCD;
})(typeof window !== 'undefined' ? window : globalThis);
