const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

const {
    findUserByUsername,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    publicUser,
    readDb
} = require('./db');
const {
    signToken,
    hashPassword,
    comparePassword,
    authMiddleware,
    adminMiddleware
} = require('./auth');
const {
    createKeysBatch,
    listKeysExport,
    deleteKeyByValue,
    findKeyByValue,
    markKeyUsed
} = require('./keys');
const { createCompatRouter } = require('./compat');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_ROOT = path.join(__dirname, '..');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function attachUser(req, res, next) {
    const user = findUserById(req.userId);
    if (!user) {
        return res.status(401).json({ message: 'User not found' });
    }
    req.user = user;
    next();
}

function profilePayload(user) {
    const pub = publicUser(user);
    return {
        ...pub,
        subscription: {
            outDate: pub.subscription?.outDate || null,
            entDate: pub.subscription?.entDate || null
        }
    };
}

function hasActiveSubscription(user) {
    const outDate = user.subscription?.outDate;
    if (!outDate) return false;
    return new Date(outDate).getTime() > Date.now();
}

function subscriptionPatchForDays(user, days) {
    const count = parseInt(days, 10);
    if (!count || count <= 0) return {};

    const sub = user.subscription || { outDate: null, entDate: null };
    const now = Date.now();
    let base = now;
    if (sub.outDate) {
        const existing = new Date(sub.outDate).getTime();
        if (!Number.isNaN(existing) && existing > now) {
            base = existing;
        }
    }

    return {
        subscription: {
            entDate: sub.entDate || new Date(now).toISOString(),
            outDate: new Date(base + count * 86400000).toISOString()
        }
    };
}

function adminExportUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        regDate: user.regDate,
        hasSubscription: hasActiveSubscription(user)
    };
}

function normalizeRole(role) {
    const r = String(role || '').toUpperCase();
    if (r === 'ADMINISTRATOR') return 'ADMIN';
    if (r === 'MODERATOR') return 'MODER';
    const allowed = ['USER', 'BETA', 'MEDIA', 'MODER', 'ADMIN', 'OWNER', 'BANNED'];
    return allowed.includes(r) ? r : 'USER';
}

function randomPassword(length = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

app.use('/api', createCompatRouter());

app.post('/api/auth/register', async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (username.length < 3) {
            return res.status(400).json({ message: 'Логин минимум 3 символа' });
        }
        if (password.length < 4) {
            return res.status(400).json({ message: 'Пароль минимум 4 символа' });
        }
        if (!email.includes('@')) {
            return res.status(400).json({ message: 'Некорректный email' });
        }
        if (findUserByUsername(username)) {
            return res.status(409).json({ message: 'Логин уже занят' });
        }
        if (findUserByEmail(email)) {
            return res.status(409).json({ message: 'Email уже используется' });
        }

        const passwordHash = await hashPassword(password);
        const user = createUser({ username, email, passwordHash, role: 'USER' });
        const token = signToken(user.id);

        return res.json({
            token,
            message: 'Registered',
            user: profilePayload(user)
        });
    } catch (error) {
        console.error('[register]', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        const password = String(req.body.password || '');
        const user = findUserByUsername(username);

        if (!user || !(await comparePassword(password, user.passwordHash))) {
            return res.status(401).json({ message: 'Неверный логин или пароль' });
        }

        const token = signToken(user.id);
        return res.json({
            token,
            message: 'OK',
            user: profilePayload(user)
        });
    } catch (error) {
        console.error('[login]', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/auth/forgot-password', (_req, res) => {
    res.json({ message: 'If account exists, reset link sent' });
});

app.post('/api/auth/reset-password', (_req, res) => {
    res.json({ message: 'Password updated' });
});

app.get('/api/user/profile', authMiddleware, attachUser, (req, res) => {
    res.json(profilePayload(req.user));
});

app.get('/api/user/getHwid', authMiddleware, attachUser, (req, res) => {
    res.json({ hwid: req.user.hwid || '' });
});

app.post('/api/user/sub', authMiddleware, attachUser, (req, res) => {
    res.json({
        outDate: req.user.subscription?.outDate || null,
        entDate: req.user.subscription?.entDate || null,
        active: hasActiveSubscription(req.user)
    });
});

app.get('/api/user/discount', authMiddleware, attachUser, (_req, res) => {
    res.json({ discount: 0, valid: false });
});

app.post('/api/user/eventGetter', authMiddleware, attachUser, (_req, res) => {
    res.json([]);
});

app.post('/api/settings/ram', authMiddleware, attachUser, (req, res) => {
    const ramAmount = Math.max(2048, Math.min(32768, parseInt(req.body.ramAmount, 10) || 4096));
    updateUser(req.user.id, { ramAmount });
    res.json({ ramAmount });
});

app.get('/api/payment/createPlatega', authMiddleware, (_req, res) => {
    res.status(501).json({ message: 'Payments not configured' });
});

app.post('/api/media/getPromoInfoForMedia', authMiddleware, (_req, res) => {
    res.json({ promo: null });
});

app.post('/api/admin/give/check-admin-panel', authMiddleware, attachUser, (req, res) => {
    const isAdmin = ['ADMIN', 'OWNER'].includes(req.user.role)
        || req.user.username.toLowerCase() === 'dev';
    res.json({ admin: isAdmin });
});

app.post('/api/admin/give/user', authMiddleware, attachUser, adminMiddleware, (_req, res) => {
    const db = readDb();
    res.json(db.users.map(adminExportUser));
});

app.post('/api/admin/give/keys', authMiddleware, attachUser, adminMiddleware, (_req, res) => {
    res.json(listKeysExport('regular'));
});

app.post('/api/admin/give/hwidKeysGet', authMiddleware, attachUser, adminMiddleware, (_req, res) => {
    res.json(listKeysExport('hwid'));
});

app.post('/api/admin/give/promocode', authMiddleware, attachUser, adminMiddleware, (_req, res) => {
    res.json([]);
});

app.put('/api/admin/read/user', authMiddleware, attachUser, adminMiddleware, async (req, res) => {
    try {
        const username = String(req.body.username || req.query.username || '').trim();
        const email = String(req.body.email || req.query.email || '').trim();
        const role = req.body.role || req.query.role || '';
        const subs = parseInt(req.body.subs || req.query.subs, 10) || 0;
        const passwordReset = req.body.passwordReset === 'true' || req.query.passwordReset === 'true';
        const hwidReset = req.body.hwidReset === 'true' || req.query.hwidReset === 'true';

        if (!username) {
            return res.status(400).json({ message: 'Username required' });
        }

        const user = findUserByUsername(username);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const patch = {};
        if (email) patch.email = email.toLowerCase();
        if (role) patch.role = normalizeRole(role);
        if (subs > 0) Object.assign(patch, subscriptionPatchForDays(user, subs));
        if (hwidReset) patch.hwid = '';
        if (passwordReset) {
            const plain = randomPassword(10);
            patch.passwordHash = await hashPassword(plain);
            updateUser(user.id, patch);
            return res.send(`Updated. New password: ${plain}`);
        }

        updateUser(user.id, patch);
        return res.json({ message: 'Updated', user: adminExportUser(findUserById(user.id)) });
    } catch (error) {
        console.error('[admin update user]', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/admin/create/keys', authMiddleware, attachUser, adminMiddleware, (req, res) => {
    const days = parseInt(req.body.days || req.query.days, 10) || 0;
    const quantity = parseInt(req.body.quantity || req.query.quantity, 10) || 1;
    const type = String(req.body.type || req.query.type || 'regular');
    const bucket = type === 'hwid' ? 'hwid' : 'regular';
    const created = createKeysBatch(bucket, quantity, days, req.user.username);
    res.json({ keys: created, message: 'Created' });
});

app.post('/api/admin/read/deleteKeys', authMiddleware, attachUser, adminMiddleware, (req, res) => {
    const id = String(req.body.id || req.query.id || '');
    const value = String(req.body.value || req.query.value || '');
    if (value ? deleteKeyByValue(value) : false) {
        return res.json({ message: 'Deleted' });
    }
    return res.status(404).json({ message: 'Key not found' });
});

app.post('/api/launcher/bind-hwid', authMiddleware, attachUser, (req, res) => {
    const hwid = String(req.body.hwid || '').trim().toUpperCase();
    if (!hwid) {
        return res.status(400).json({ message: 'HWID required' });
    }
    updateUser(req.user.id, { hwid });
    res.json({ hwid, bound: true });
});

app.get('/api/launcher/session', authMiddleware, attachUser, (req, res) => {
    res.json({
        token: req.token,
        user: profilePayload(req.user),
        active: hasActiveSubscription(req.user)
    });
});

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'divaneclient.fun' });
});

app.use(express.static(SITE_ROOT, { index: 'index.html' }));

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(SITE_ROOT, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Divane site running at http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api`);
});
