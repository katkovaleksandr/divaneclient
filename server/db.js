const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'users.json');

function ensureDb() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2), 'utf8');
    }
}

function readDb() {
    ensureDb();
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(data) {
    ensureDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function findUserByUsername(username) {
    const db = readDb();
    const norm = String(username || '').trim().toLowerCase();
    return db.users.find((u) => u.username.toLowerCase() === norm) || null;
}

function findUserByEmail(email) {
    const db = readDb();
    const norm = String(email || '').trim().toLowerCase();
    return db.users.find((u) => u.email.toLowerCase() === norm) || null;
}

function findUserById(id) {
    const db = readDb();
    return db.users.find((u) => u.id === id) || null;
}

function createUser({ username, email, passwordHash, role = 'USER' }) {
    const db = readDb();
    const user = {
        id: uuidv4(),
        username: String(username).trim(),
        email: String(email).trim().toLowerCase(),
        passwordHash,
        role,
        regDate: new Date().toISOString(),
        hwid: '',
        ramAmount: 4096,
        subscription: {
            outDate: null,
            entDate: null
        }
    };
    db.users.push(user);
    writeDb(db);
    return user;
}

function updateUser(id, patch) {
    const db = readDb();
    const idx = db.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    db.users[idx] = { ...db.users[idx], ...patch };
    writeDb(db);
    return db.users[idx];
}

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        regDate: user.regDate,
        hwid: user.hwid || '',
        ramAmount: user.ramAmount || 4096,
        subscription: user.subscription || { outDate: null, entDate: null },
        outDate: user.subscription?.outDate || null,
        entDate: user.subscription?.entDate || null
    };
}

module.exports = {
    readDb,
    writeDb,
    findUserByUsername,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    publicUser
};
