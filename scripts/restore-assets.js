const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const night = path.join(assetsDir, 'night-3-Ba3J82nB.jpg');
const bg = path.join(assetsDir, 'background.png');
const bg2 = path.join(assetsDir, 'background2.png');
const frame = path.join(assetsDir, 'Frame 244.png');

const jpgTargets = [
    'morning-1-48ZFs6MN.jpg', 'morning-2-BYaiLuvq.jpg', 'morning-3-Djoe_UWf.jpg', 'morning-4-BFeRX6yn.jpg',
    'night-2-M87CilwX.jpg', 'night-4-B707M2WH.jpg',
    'day-1-B-j-4icY.jpg', 'day-2-DCTqzDZf.jpg', 'day-3-DcdsBr8e.jpg', 'day-4-mV0FtEqT.jpg'
];

const pngFromBg = [
    'morning-CcRdvl8L.png', 'morning-DCqPT9jh.png',
    'day-DKvZdU74.png', 'day-vnDxU6R_.png'
];

const pngFromBg2 = [
    'night-1z0pI4rK.png', 'night-C5VCxznl.png'
];

const pngFromFrame = [
    'macbook-morning-DXO3pEjE.png', 'macbook-day-CbRyii9T.png', 'macbook-night-D2FVOiw2.png'
];

function isJpeg(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        return buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    } catch {
        return false;
    }
}

function isPng(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        return buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    } catch {
        return false;
    }
}

function copyIfNeeded(source, targetName) {
    const target = path.join(assetsDir, targetName);
    if (!fs.existsSync(source)) {
        console.warn(`[restore-assets] Missing source: ${source}`);
        return;
    }
    const ext = path.extname(targetName).toLowerCase();
    const valid = ext === '.jpg' ? isJpeg(target) : isPng(target);
    if (!valid) {
        fs.copyFileSync(source, target);
        console.log(`[restore-assets] restored ${targetName}`);
    }
}

if (!fs.existsSync(assetsDir)) {
    console.error('[restore-assets] assets directory not found:', assetsDir);
    process.exit(1);
}

for (const name of jpgTargets) {
    copyIfNeeded(night, name);
}
for (const name of pngFromBg) {
    copyIfNeeded(bg, name);
}
for (const name of pngFromBg2) {
    copyIfNeeded(bg2, name);
}
for (const name of pngFromFrame) {
    copyIfNeeded(frame, name);
}

console.log('[restore-assets] Done.');
