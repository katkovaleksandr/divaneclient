const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const sourceLandscape = path.join(assetsDir, 'night-3-Ba3J82nB.jpg');

function isRealImage(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        if (buf.length < 12) return false;
        if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
        if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
            && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

function copyIfBroken(targetName) {
    const target = path.join(assetsDir, targetName);
    if (isRealImage(target)) {
        return;
    }
    if (!fs.existsSync(sourceLandscape)) {
        console.warn(`[restore-assets] Missing source landscape: ${sourceLandscape}`);
        return;
    }
    fs.copyFileSync(sourceLandscape, target);
    console.log(`[restore-assets] fixed ${targetName}`);
}

if (!fs.existsSync(assetsDir)) {
    console.error('[restore-assets] assets directory not found:', assetsDir);
    process.exit(1);
}

const landscapeTargets = [
    'morning-1-48ZFs6MN.jpg', 'morning-2-BYaiLuvq.jpg', 'morning-3-Djoe_UWf.jpg', 'morning-4-BFeRX6yn.jpg',
    'night-2-M87CilwX.jpg', 'night-4-B707M2WH.jpg',
    'day-1-B-j-4icY.jpg', 'day-2-DCTqzDZf.jpg', 'day-3-DcdsBr8e.jpg', 'day-4-mV0FtEqT.jpg',
    'morning-CcRdvl8L.png', 'morning-DCqPT9jh.png',
    'day-DKvZdU74.png', 'day-vnDxU6R_.png',
    'night-1z0pI4rK.png', 'night-C5VCxznl.png'
];

for (const name of landscapeTargets) {
    copyIfBroken(name);
}

console.log('[restore-assets] Done. Macbook assets are left untouched.');
