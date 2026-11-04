// Dev helper: renders scripts/icon.html to build/icon.png (1024x1024) and app/icon.png (256x256).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, useContentSize: true, transparent: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  await win.loadFile(path.join(__dirname, 'icon.html'));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const full = img.resize({ width: 1024, height: 1024, quality: 'best' });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), full.toPNG());
  fs.writeFileSync(path.join(__dirname, '..', 'app', 'icon.png'), full.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  console.log('icon written', img.getSize());
  app.quit();
});
