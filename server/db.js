const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const DB_PATH = path.join(DATA_DIR, 'users.json');
const SEED_PATH = path.join(__dirname, 'seed', 'users.json');
const BACKUP_PATH = path.join(DATA_DIR, 'users.backup.json');

let usersCache = null;
let pgPool = null;
let usePostgres = false;
let dbReady = false;
let dbInitPromise = null;

function ensureDb() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2), 'utf8');
    }
}

function readFileDb() {
    ensureDb();
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch {
        return { users: [] };
    }
}

function writeFileDb(data) {
    ensureDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    try {
        fs.writeFileSync(BACKUP_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('[db] Failed to write backup:', error.message);
    }
}

function restoreSeedIfEmpty() {
    const db = readFileDb();
    if (Array.isArray(db.users) && db.users.length > 0) {
        return db;
    }

    if (!fs.existsSync(SEED_PATH)) {
        console.warn('[db] users.json is empty and seed file is missing:', SEED_PATH);
        return db;
    }

    try {
        const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
        if (!Array.isArray(seed.users) || seed.users.length === 0) {
            return db;
        }
        writeFileDb(seed);
        console.log(`[db] Restored ${seed.users.length} users from seed`);
        return seed;
    } catch (error) {
        console.error('[db] Failed to restore seed users:', error.message);
        return db;
    }
}

function rowToUser(row) {
    if (!row) return null;
    const subscription = typeof row.subscription === 'string'
        ? JSON.parse(row.subscription)
        : (row.subscription || { outDate: null, entDate: null });
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role,
        regDate: row.reg_date instanceof Date ? row.reg_date.toISOString() : row.reg_date,
        hwid: row.hwid || '',
        ramAmount: row.ram_amount || 4096,
        subscription
    };
}

function userToRow(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        password_hash: user.passwordHash,
        role: user.role || 'USER',
        reg_date: user.regDate || new Date().toISOString(),
        hwid: user.hwid || '',
        ram_amount: user.ramAmount || 4096,
        subscription: JSON.stringify(user.subscription || { outDate: null, entDate: null })
    };
}

async function initPostgresSchema() {
    await pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'USER',
            reg_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            hwid TEXT DEFAULT '',
            ram_amount INTEGER DEFAULT 4096,
            subscription JSONB NOT NULL DEFAULT '{"outDate":null,"entDate":null}'::jsonb
        );
    `);
    await pgPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
        ON users (LOWER(username));
    `);
    await pgPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
        ON users (LOWER(email));
    `);
}

async function loadUsersFromPostgres() {
    const result = await pgPool.query('SELECT * FROM users ORDER BY reg_date ASC');
    return result.rows.map(rowToUser);
}

async function upsertUserPostgres(user) {
    const row = userToRow(user);
    await pgPool.query(
        `INSERT INTO users (id, username, email, password_hash, role, reg_date, hwid, ram_amount, subscription)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            email = EXCLUDED.email,
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            reg_date = EXCLUDED.reg_date,
            hwid = EXCLUDED.hwid,
            ram_amount = EXCLUDED.ram_amount,
            subscription = EXCLUDED.subscription`,
        [
            row.id,
            row.username,
            row.email,
            row.password_hash,
            row.role,
            row.reg_date,
            row.hwid,
            row.ram_amount,
            row.subscription
        ]
    );
}

async function persistAllToPostgres(users) {
    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM users');
        for (const user of users) {
            const row = userToRow(user);
            await client.query(
                `INSERT INTO users (id, username, email, password_hash, role, reg_date, hwid, ram_amount, subscription)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
                [
                    row.id,
                    row.username,
                    row.email,
                    row.password_hash,
                    row.role,
                    row.reg_date,
                    row.hwid,
                    row.ram_amount,
                    row.subscription
                ]
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function initDb() {
    if (dbReady) {
        return;
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
        try {
            const { Pool } = require('pg');
            pgPool = new Pool({
                connectionString: databaseUrl,
                ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
                    ? false
                    : { rejectUnauthorized: false }
            });
            await pgPool.query('SELECT 1');
            await initPostgresSchema();
            usePostgres = true;
            console.log('[db] Connected to PostgreSQL');

            let users = await loadUsersFromPostgres();
            if (!users.length) {
                const fileDb = restoreSeedIfEmpty();
                users = fileDb.users || [];
                if (users.length) {
                    await persistAllToPostgres(users);
                    console.log(`[db] Migrated ${users.length} users from file/seed to PostgreSQL`);
                }
            } else {
                writeFileDb({ users });
                console.log(`[db] Loaded ${users.length} users from PostgreSQL`);
            }
            usersCache = users;
        } catch (error) {
            console.error('[db] PostgreSQL connection failed, falling back to file storage:', error.message);
            if (pgPool) {
                try {
                    await pgPool.end();
                } catch {
                    // ignore
                }
                pgPool = null;
            }
            usePostgres = false;
            const fileDb = restoreSeedIfEmpty();
            usersCache = fileDb.users || [];
        }
    } else {
        const fileDb = restoreSeedIfEmpty();
        usersCache = fileDb.users || [];
        console.log(`[db] Using file storage (${usersCache.length} users)`);
    }

    dbReady = true;
}

function ensureReady() {
    if (!dbReady) {
        throw new Error('Database is not initialized yet. Call initDb() before handling requests.');
    }
}

function readDb() {
    ensureReady();
    return { users: [...usersCache] };
}

function writeDb(data) {
    ensureReady();
    usersCache = Array.isArray(data.users) ? data.users : [];
    writeFileDb({ users: usersCache });
    if (usePostgres && pgPool) {
        persistAllToPostgres(usersCache).catch((error) => {
            console.error('[db] Failed to persist to PostgreSQL:', error.message);
        });
    }
}

function findUserByUsername(username) {
    const norm = String(username || '').trim().toLowerCase();
    return usersCache.find((u) => u.username.toLowerCase() === norm) || null;
}

function findUserByEmail(email) {
    const norm = String(email || '').trim().toLowerCase();
    return usersCache.find((u) => u.email.toLowerCase() === norm) || null;
}

function findUserById(id) {
    return usersCache.find((u) => u.id === id) || null;
}

function createUser({ username, email, passwordHash, role = 'USER' }) {
    const { v4: uuidv4 } = require('uuid');
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
    const db = readDb();
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

function getDbInitPromise() {
    if (!dbInitPromise) {
        dbInitPromise = initDb();
    }
    return dbInitPromise;
}

module.exports = {
    DATA_DIR,
    DB_PATH,
    initDb: getDbInitPromise,
    readDb,
    writeDb,
    restoreSeedIfEmpty,
    findUserByUsername,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    publicUser,
    isUsingPostgres: () => usePostgres
};
