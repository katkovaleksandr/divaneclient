const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const PROMOCODES_PATH = path.join(DATA_DIR, 'promocodes.json');

function ensurePromocodes() {
    const dir = path.dirname(PROMOCODES_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(PROMOCODES_PATH)) {
        fs.writeFileSync(PROMOCODES_PATH, JSON.stringify({ promocodes: {} }, null, 2), 'utf8');
    }
}

function readPromocodesDb() {
    ensurePromocodes();
    try {
        const data = JSON.parse(fs.readFileSync(PROMOCODES_PATH, 'utf8'));
        if (!data.promocodes || typeof data.promocodes !== 'object') {
            return { promocodes: {} };
        }
        return data;
    } catch {
        return { promocodes: {} };
    }
}

function writePromocodesDb(data) {
    ensurePromocodes();
    fs.writeFileSync(PROMOCODES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function parseDiscount(value) {
    const discount = Math.abs(parseInt(value, 10));
    if (!discount || discount <= 0 || discount > 100) {
        return null;
    }
    return discount;
}

function parseMaxUsages(value) {
    const maxUsages = parseInt(value, 10);
    if (!maxUsages || maxUsages <= 0) {
        return null;
    }
    return maxUsages;
}

function toPublicPromocode(record) {
    return {
        name: record.name,
        discount: record.discount,
        maxActivations: record.maxActivations,
        activations: record.activations || 0
    };
}

function getAllPromocodesMap() {
    const db = readPromocodesDb();
    const out = {};
    Object.values(db.promocodes).forEach((record) => {
        out[record.name] = toPublicPromocode(record);
    });
    return out;
}

function getPromocode(code) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    const db = readPromocodesDb();
    return db.promocodes[normalized] || null;
}

function createPromocode({ name, discount, maxUsages, createdBy }) {
    const code = normalizeCode(name);
    if (!code || code.length < 2) {
        throw new Error('INVALID_NAME');
    }

    const bet = parseDiscount(discount);
    const max = parseMaxUsages(maxUsages);
    if (!bet) throw new Error('INVALID_DISCOUNT');
    if (!max) throw new Error('INVALID_MAX_USAGES');

    const db = readPromocodesDb();
    if (db.promocodes[code]) {
        return { duplicate: true };
    }

    db.promocodes[code] = {
        name: code,
        discount: bet,
        maxActivations: max,
        activations: 0,
        createdAt: new Date().toISOString(),
        createdBy: createdBy || 'admin',
        statistics: {
            payments: [],
            totalAmount: 0
        }
    };
    writePromocodesDb(db);
    return { ok: true, promocode: toPublicPromocode(db.promocodes[code]) };
}

function patchPromocode({ name, discount, maxUsages }) {
    const code = normalizeCode(name);
    const bet = parseDiscount(discount);
    const max = parseMaxUsages(maxUsages);
    if (!code) throw new Error('INVALID_NAME');
    if (!bet) throw new Error('INVALID_DISCOUNT');
    if (!max) throw new Error('INVALID_MAX_USAGES');

    const db = readPromocodesDb();
    const record = db.promocodes[code];
    if (!record) {
        return { missing: true };
    }

    record.discount = bet;
    record.maxActivations = max;
    writePromocodesDb(db);
    return { ok: true, promocode: toPublicPromocode(record) };
}

function deletePromocode(name) {
    const code = normalizeCode(name);
    const db = readPromocodesDb();
    if (!db.promocodes[code]) {
        return { missing: true };
    }
    delete db.promocodes[code];
    writePromocodesDb(db);
    return { ok: true };
}

function resetPromocodeUsages(name) {
    const code = normalizeCode(name);
    const db = readPromocodesDb();
    const record = db.promocodes[code];
    if (!record) {
        return { missing: true };
    }
    record.activations = 0;
    writePromocodesDb(db);
    return { ok: true };
}

function clearPromocodeStatistics(name) {
    const code = normalizeCode(name);
    const db = readPromocodesDb();
    const record = db.promocodes[code];
    if (!record) {
        return { missing: true };
    }
    record.statistics = { payments: [], totalAmount: 0 };
    writePromocodesDb(db);
    return { ok: true };
}

function getPromocodeStatistics(name) {
    const record = getPromocode(name);
    if (!record) {
        return null;
    }
    return {
        payments: Array.isArray(record.statistics?.payments) ? record.statistics.payments : [],
        totalAmount: Number(record.statistics?.totalAmount || 0)
    };
}

function applyPromocode(code) {
    const record = getPromocode(code);
    if (!record) {
        return { notFound: true };
    }
    if (record.activations >= record.maxActivations) {
        return { exhausted: true };
    }
    return { discount: record.discount };
}

module.exports = {
    getAllPromocodesMap,
    getPromocode,
    createPromocode,
    patchPromocode,
    deletePromocode,
    resetPromocodeUsages,
    clearPromocodeStatistics,
    getPromocodeStatistics,
    applyPromocode,
    toPublicPromocode
};
