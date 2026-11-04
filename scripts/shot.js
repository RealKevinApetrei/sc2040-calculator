// Dev helper: render the app offscreen, press keys, save a PNG, quit.
// Usage: electron scripts/shot.js <out.png> <width> <height> "<keys>" [--help]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const [out, w = '760', h = '900', keys = '', flag = ''] = process.argv.slice(2);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: +w, height: +h, show: false, useContentSize: true,
    webPreferences: { offscreen: true, partition: 'shot-' + Date.now() },
  });
  win.webContents.on('console-message', (e) => console.log('[page]', e.message));
  await win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));
  const js = `(() => {
    const ks = ${JSON.stringify(keys.split(' ').filter(Boolean))};
    for (const k of ks) {
      const el = document.querySelector('[data-k="' + k + '"]');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    }
    ${flag === '--help' ? "document.getElementById('btn-help').click();" : ''}
    return document.querySelector('.stage').style.getPropertyValue('--z') + ' trail=' + document.getElementById('trail-list').children.length + ' top=' + JSON.stringify(window.__calc && window.__calc.display().top);
  })()`;
  const z = await win.webContents.executeJavaScript(js);
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out, 'zoom', z);
  app.quit();
});
