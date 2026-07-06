const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const KEYS_PATH = path.join(__dirname, 'data', 'keys.json');

function ensureKeys() {
    const dir = path.dirname(KEYS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(KEYS_PATH)) {
        fs.writeFileSync(KEYS_PATH, JSON.stringify({ regular: [], hwid: [], beta: [] }, null, 2), 'utf8');
    }
}

function readKeysDb() {
    ensureKeys();
    const data = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
    if (!Array.isArray(data.regular)) data.regular = [];
    if (!Array.isArray(data.hwid)) data.hwid = [];
    if (!Array.isArray(data.beta)) data.beta = [];
    return data;
}

function writeKeysDb(data) {
    ensureKeys();
    fs.writeFileSync(KEYS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function generateKeyValue() {
    const a = Math.random().toString(36).slice(2, 6).toUpperCase();
    const b = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `DIVANE-${a}-${b}`;
}

function exportKeyRow(key) {
    return {
        id: key.id || '',
        value: key.value || '',
        days: key.days ?? null,
        used: key.used ? 1 : 0,
        entDate: key.entDate || new Date().toISOString(),
        activationId: key.used ? (key.activationId || 0) : 0
    };
}

function exportAdminKeyRow(key) {
    const days = key.days;
    let display = 'Custom';
    if (key.type === 'hwid') display = 'HWID Reset';
    else if (key.type === 'beta') display = 'Beta';
    else if (days >= 999) display = 'Lifetime';
    else if (days) display = `${days} Days`;

    return {
        key: key.value,
        display,
        generatedBy: key.generatedBy || 'admin'
    };
}

function createKeysBatch(type, quantity, days, generatedBy = 'admin') {
    const qty = Math.max(1, Math.min(100, parseInt(quantity, 10) || 1));
    const dayCount = Math.max(0, parseInt(days, 10) || 0);
    const db = readKeysDb();
    const bucket = type === 'hwid' ? 'hwid' : type === 'beta' ? 'beta' : 'regular';
    const created = [];

    for (let i = 0; i < qty; i++) {
        const row = {
            id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            value: generateKeyValue(),
            days: bucket === 'hwid' ? null : dayCount,
            type: bucket === 'regular' ? 'subscription' : bucket,
            used: false,
            entDate: new Date().toISOString(),
            activationId: 0,
            generatedBy
        };
        db[bucket].push(row);
        created.push(exportKeyRow(row));
    }

    writeKeysDb(db);
    return created;
}

function listKeysExport(type) {
    const db = readKeysDb();
    const list = db[type] || [];
    return list.filter((k) => k && typeof k === 'object').map(exportKeyRow);
}

function listAllAdminKeys() {
    const db = readKeysDb();
    const all = [...db.regular, ...db.hwid, ...db.beta];
    return all.map(exportAdminKeyRow);
}

function deleteKeyByValue(keyValue) {
    const db = readKeysDb();
    for (const bucket of ['regular', 'hwid', 'beta']) {
        const next = [];
        let found = false;
        for (const key of db[bucket]) {
            if (key.value === keyValue) {
                found = true;
                continue;
            }
            next.push(key);
        }
        if (found) {
            db[bucket] = next;
            writeKeysDb(db);
            return true;
        }
    }
    return false;
}

function findKeyByValue(value) {
    const db = readKeysDb();
    for (const bucket of ['regular', 'hwid', 'beta']) {
        const found = db[bucket].find((k) => k.value === value);
        if (found) return { key: found, bucket };
    }
    return null;
}

function markKeyUsed(bucket, keyId, userId) {
    const db = readKeysDb();
    const idx = db[bucket].findIndex((k) => k.id === keyId);
    if (idx === -1) return false;
    db[bucket][idx].used = true;
    db[bucket][idx].activationId = userId;
    writeKeysDb(db);
    return true;
}

module.exports = {
    readKeysDb,
    writeKeysDb,
    createKeysBatch,
    listKeysExport,
    listAllAdminKeys,
    deleteKeyByValue,
    findKeyByValue,
    markKeyUsed,
    exportKeyRow,
    exportAdminKeyRow,
    generateKeyValue
};
