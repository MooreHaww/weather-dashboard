// Renders src/renderer/public/logo.svg into build/icon.ico (16–256 px) and build/icon.png.
// Run with: npm run icon   (uses Electron's Chromium to rasterize the SVG)

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'src/renderer/public/logo.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const MASTER = 512;

/** ICO container whose entries are PNG images (supported since Windows Vista). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

/** Rasterize the SVG once, offscreen, with a transparent background. */
async function renderMaster() {
  const win = new BrowserWindow({
    width: MASTER,
    height: MASTER,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const sized = svg.replace('<svg ', `<svg width="${MASTER}" height="${MASTER}" `);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${sized}</body></html>`;
  const frame = new Promise((resolve) => {
    win.webContents.on('paint', (_e, _dirty, image) => {
      if (!image.isEmpty() && image.getSize().width >= MASTER) resolve(image);
    });
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const image = await frame;
  win.destroy();
  return image.resize({ width: MASTER, height: MASTER, quality: 'best' });
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  const master = await renderMaster();
  const pngs = SIZES.map((size) => ({ size, data: master.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(root, 'build/icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(root, 'build/icon.png'), master.toPNG());
  console.log(`Wrote build/icon.ico (${SIZES.join(', ')} px) and build/icon.png`);
  app.quit();
});
