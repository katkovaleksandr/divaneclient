const express = require('express');
const {
    readDb,
    findUserByUsername,
    findUserById,
    findUserByEmail,
    createUser,
    updateUser
} = require('./db');
const {
    signToken,
    verifyToken,
    hashPassword,
    comparePassword
} = require('./auth');
const {
    createKeysBatch,
    listAllAdminKeys,
    deleteKeyByValue,
    findKeyByValue,
    markKeyUsed
} = require('./keys');
const { verifyTurnstile } = require('./turnstile');
const {
    PAYMENT_METHODS,
    createOrder,
    getOrder,
    publicOrder
} = require('./payments');
const {
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
} = require('./promocodes');

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'dev,robert153')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

const SUBSCRIPTION_PRODUCTS = [
    { time: 30, price: 400, type: 'month' },
    { time: 90, price: 600, type: 'quarter' },
    { time: 999, price: 800, type: 'lifetime' }
];

const ADDITIONAL_PRODUCTS = [
    { price: 250, type: 'hwid_reset', display: 'HWID Reset' },
    { price: 3333, type: 'zbt', display: 'ЗБТ' }
];

function decodePassword(encoded) {
    try {
        const decoded = Buffer.from(String(encoded), 'base64').toString('utf8');
        return decoded || String(encoded);
    } catch {
        return String(encoded);
    }
}

function formatRegDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

function formatSubTill(user) {
    const out = user.subscription?.outDate;
    if (!out) return 'No subscription';
    const d = new Date(out);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        return 'No subscription';
    }
    return formatRegDate(out);
}

function hasActiveSubscription(user) {
    const out = user.subscription?.outDate;
    if (!out) return false;
    return new Date(out).getTime() > Date.now();
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

function parseSubTillInput(value) {
    if (!value || value === 'No subscription') {
        return { outDate: null, entDate: null };
    }
    const parts = String(value).split('.');
    if (parts.length === 3) {
        const [dd, mm, yyyy] = parts;
        const d = new Date(`${yyyy}-${mm}-${dd}T23:59:59.000Z`);
        if (!Number.isNaN(d.getTime())) {
            return { outDate: d.toISOString(), entDate: new Date().toISOString() };
        }
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return { outDate: parsed.toISOString(), entDate: new Date().toISOString() };
    }
    return null;
}

function normalizeRole(role) {
    const r = String(role || '').toUpperCase();
    if (r === 'DEFAULT' || r === 'USER') return 'USER';
    if (r === 'YOUTUBE' || r === 'YOUTUBER') return 'MEDIA';
    if (r === 'MODERATOR') return 'MODER';
    if (r === 'ADMINISTRATOR') return 'ADMIN';
    const allowed = ['USER', 'BETA', 'MEDIA', 'MODER', 'ADMIN', 'OWNER', 'BANNED'];
    return allowed.includes(r) ? r : 'USER';
}

function toFrontendRole(role) {
    const r = normalizeRole(role);
    if (r === 'USER') return 'DEFAULT';
    if (r === 'MEDIA') return 'YOUTUBE';
    return r;
}

function isAdmin(user) {
    if (!user) return false;
    if (['ADMIN', 'OWNER'].includes(user.role)) return true;
    return ADMIN_USERNAMES.includes(user.username.toLowerCase());
}

function getToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    return String(req.query.token || req.body?.token || '').trim();
}

function getRequestField(req, name) {
    const value = req.query?.[name] ?? req.body?.[name];
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim();
}

function userFromToken(req) {
    const token = getToken(req);
    if (!token) return null;
    try {
        const payload = verifyToken(token);
        let user = findUserById(payload.sub);
        if (!user && payload.username) {
            user = findUserByUsername(payload.username);
        }
        return user;
    } catch {
        return null;
    }
}

function requireAuth(req, res) {
    const user = userFromToken(req);
    if (!user) {
        res.status(401).json('Unauthorized');
        return null;
    }
    if (user.role === 'BANNED') {
        res.status(403).json('Account is banned');
        return null;
    }
    return user;
}

function requireAdmin(req, res) {
    const user = requireAuth(req, res);
    if (!user) return null;
    if (!isAdmin(user)) {
        res.status(403).json('Forbidden');
        return null;
    }
    return user;
}

function sessionPayload(user, token) {
    return {
        authStatus: true,
        id: String(uidForUser(user)),
        username: user.username,
        email: user.email,
        isEmailVerified: false,
        role: isAdmin(user) ? 'ADMIN' : user.role,
        banned: user.role === 'BANNED',
        token,
        hwid: user.hwid || '',
        subtill: formatSubTill(user),
        regdate: formatRegDate(user.regDate)
    };
}

function uidForUser(user) {
    const db = readDb();
    const idx = db.users.findIndex((u) => u.id === user.id);
    return idx >= 0 ? idx + 1 : 1;
}

function userByUid(uid) {
    const db = readDb();
    const index = parseInt(uid, 10) - 1;
    if (index < 0 || index >= db.users.length) return null;
    return db.users[index];
}

function adminUserRow(user) {
    return {
        uid: uidForUser(user),
        user: user.username,
        email: user.email,
        subtill: formatSubTill(user),
        group: toFrontendRole(user.role)
    };
}

function adminUsersMap() {
    const db = readDb();
    const out = {};
    db.users.forEach((user, idx) => {
        out[idx + 1] = {
            uid: idx + 1,
            user: user.username,
            email: user.email,
            subtill: formatSubTill(user),
            group: toFrontendRole(user.role)
        };
    });
    return out;
}

function randomPassword(length = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

function createCompatRouter() {
    const router = express.Router();

    router.get('/payments/getAll', (_req, res) => {
        res.json(SUBSCRIPTION_PRODUCTS);
    });

    router.get('/payments/additional/getAll', (_req, res) => {
        res.json(ADDITIONAL_PRODUCTS);
    });

    router.get('/payments/getMethods', (_req, res) => {
        res.json(PAYMENT_METHODS);
    });

    router.get('/payments/order/:orderId', (req, res) => {
        const order = getOrder(String(req.params.orderId || '').trim());
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        return res.json(publicOrder(order));
    });

    router.post('/users/auth/default', async (req, res) => {
        try {
            const captcha = req.query.hCaptcha;
            const remoteIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
            if (!(await verifyTurnstile(captcha, remoteIp))) {
                return res.status(400).json('Captcha verification failed');
            }

            const username = String(req.query.username || '').trim();
            const password = decodePassword(req.query.password || '');
            const user = findUserByUsername(username);

            if (!user || !(await comparePassword(password, user.passwordHash))) {
                return res.status(400).json('Wrong password');
            }
            if (user.role === 'BANNED') {
                return res.status(400).json('Account is banned');
            }

            const token = signToken(user.id, user.username);
            return res.json({
                authStatus: true,
                authMessage: 'Login successful!',
                token
            });
        } catch (error) {
            console.error('[compat login]', error);
            return res.status(500).json('Server error');
        }
    });

    router.post('/users/auth/register', async (req, res) => {
        try {
            const captcha = req.query.hCaptcha;
            const remoteIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
            if (!(await verifyTurnstile(captcha, remoteIp))) {
                return res.status(400).json('Captcha verification failed');
            }

            const username = String(req.query.username || '').trim();
            const email = String(req.query.email || '').trim().toLowerCase();
            const password = decodePassword(req.query.password || '');

            if (username.length < 3) {
                return res.status(400).json('Username too short (min 3 chars)');
            }
            if (password.length < 4) {
                return res.status(400).json('Password too short');
            }
            if (findUserByUsername(username)) {
                return res.status(400).json('Username already taken');
            }
            if (email && findUserByEmail(email)) {
                return res.status(400).json('Email already used');
            }

            const passwordHash = await hashPassword(password);
            const user = createUser({
                username,
                email: email || `${username}@divaneclient.fun`,
                passwordHash,
                role: 'USER'
            });
            const token = signToken(user.id, user.username);

            return res.json({
                authStatus: true,
                authMessage: 'Registration successful!',
                token
            });
        } catch (error) {
            console.error('[compat register]', error);
            return res.status(500).json('Server error');
        }
    });

    router.post('/users/auth/session', (req, res) => {
        const user = requireAuth(req, res);
        if (!user) return;
        const token = getToken(req);
        return res.json(sessionPayload(user, token));
    });

    router.get('/users/auth/session', (req, res) => {
        const user = requireAuth(req, res);
        if (!user) return;
        const token = getToken(req);
        return res.json(sessionPayload(user, token));
    });

    router.post('/users/auth/logout', (_req, res) => {
        res.json('Logged out successfully');
    });

    router.post('/users/actions/activateDigitalKey', (req, res) => {
        const user = requireAuth(req, res);
        if (!user) return;

        const keyValue = String(req.query.key || '').trim().toUpperCase();
        if (!keyValue) {
            return res.status(400).json('Key required');
        }

        const found = findKeyByValue(keyValue);
        if (!found || found.key.used) {
            return res.status(400).json('The entered key is invalid or already used');
        }

        if (found.bucket === 'hwid') {
            updateUser(user.id, { hwid: '' });
            markKeyUsed(found.bucket, found.key.id, user.id);
            return res.json('HWID reset successfully');
        }

        const days = found.key.days || 30;
        const patch = subscriptionPatchForDays(user, days >= 999 ? 36500 : days);
        updateUser(user.id, patch);
        markKeyUsed(found.bucket, found.key.id, user.id);
        return res.json(`Subscription activated for ${days >= 999 ? 'lifetime' : days + ' days'}`);
    });

    router.post('/admin/states/isSessionInitialized', (req, res) => {
        const user = requireAdmin(req, res);
        if (!user) return;
        return res.json({ initialized: true });
    });

    router.post('/admin/users/getAll', (req, res) => {
        const user = requireAdmin(req, res);
        if (!user) return;
        return res.json(adminUsersMap());
    });

    router.post('/admin/users/getByIdentifier', (req, res) => {
        const user = requireAdmin(req, res);
        if (!user) return;

        const target = userByUid(req.query.id);
        if (!target) {
            return res.status(404).json('User not found');
        }

        return res.json({
            banned: target.role === 'BANNED',
            email: target.email,
            group: toFrontendRole(target.role),
            hwid: target.hwid || '',
            subtill: formatSubTill(target),
            user: target.username
        });
    });

    router.patch('/admin/users/patch', (req, res) => {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const username = String(req.query.user || req.body?.username || '').trim();
        const target = findUserByUsername(username);
        if (!target) {
            return res.status(404).json('User not found');
        }

        const patch = {};
        if (req.body?.email) patch.email = String(req.body.email).trim().toLowerCase();
        if (req.body?.role) patch.role = normalizeRole(req.body.role);
        if (typeof req.body?.isBanned === 'boolean') {
            patch.role = req.body.isBanned ? 'BANNED' : normalizeRole(req.body.role || target.role);
        }
        if (req.body?.subTill) {
            const sub = parseSubTillInput(req.body.subTill);
            if (sub) patch.subscription = sub;
        }
        if (req.body?.hwid !== undefined) {
            patch.hwid = String(req.body.hwid || '').trim().toUpperCase();
        }

        updateUser(target.id, patch);
        return res.json('User updated successfully');
    });

    router.post('/admin/users/resetHardwareId', (req, res) => {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const username = String(req.query.user || '').trim();
        const target = findUserByUsername(username);
        if (!target) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (!target.hwid) {
            return res.status(400).json({ message: 'This user does not have HWID bound' });
        }
        updateUser(target.id, { hwid: '' });
        return res.json({ message: 'HWID reset successfully' });
    });

    router.post('/admin/multiactions/keys/action/getAll', (req, res) => {
        const user = requireAdmin(req, res);
        if (!user) return;
        return res.json(listAllAdminKeys());
    });

    router.post('/admin/multiactions/keys/action/remove', (req, res) => {
        const user = requireAdmin(req, res);
        if (!user) return;

        const key = String(req.query.key || '').trim();
        if (!key || !deleteKeyByValue(key)) {
            return res.status(404).json('Key not found');
        }
        return res.json('Key deleted');
    });

    router.get('/admin/multiactions/keys/getAdditionalProducts', (req, res) => {
        const user = requireAdmin(req, res);
        if (!user) return;
        return res.json([
            { id: 1, title: 'HWID Reset' },
            { id: 2, title: 'ЗБТ' }
        ]);
    });

    function handleCreateKeys(req, res, type, days) {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const count = parseInt(req.query.count, 10) || 1;
        const created = createKeysBatch(type, count, days, admin.username);
        const text = created.map((k) => k.value).join('\n');
        res.type('text/plain').send(text);
    }

    router.post('/admin/multiactions/keys/subscription', (req, res) => {
        handleCreateKeys(req, res, 'regular', parseInt(req.query.days, 10) || 30);
    });

    router.post('/admin/multiactions/keys/hardwareReset', (req, res) => {
        handleCreateKeys(req, res, 'hwid', 0);
    });

    router.post('/admin/multiactions/keys/beta', (req, res) => {
        handleCreateKeys(req, res, 'beta', 30);
    });

    router.post('/admin/promocodes/getAll', (req, res) => {
        if (!requireAdmin(req, res)) return;
        return res.json(getAllPromocodesMap());
    });

    router.post('/admin/promocodes/create', (req, res) => {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const name = getRequestField(req, 'promocode');
        const discount = req.body?.bet ?? req.query?.bet;
        const maxUsages = req.body?.maxUsages ?? req.query?.maxUsages;

        try {
            const result = createPromocode({
                name,
                discount,
                maxUsages,
                createdBy: admin.username
            });
            if (result.duplicate) {
                return res.status(400).json('Данный промокод уже существует');
            }
            return res.json(`Promocode ${result.promocode.name} created successfully`);
        } catch (error) {
            if (error.message === 'INVALID_NAME') {
                return res.status(400).json('Invalid promocode name');
            }
            if (error.message === 'INVALID_DISCOUNT') {
                return res.status(400).json('Discount must be between 1 and 100');
            }
            if (error.message === 'INVALID_MAX_USAGES') {
                return res.status(400).json('Max activations must be greater than 0');
            }
            console.error('[promocodes/create]', error);
            return res.status(500).json('Failed to create promocode');
        }
    });

    router.post('/admin/promocodes/delete', (req, res) => {
        if (!requireAdmin(req, res)) return;

        const name = String(req.body?.promocode || req.query.promocode || '').trim();
        const result = deletePromocode(name);
        if (result.missing) {
            return res.status(404).json('This promo code was not found');
        }
        return res.json('Promocode deleted successfully');
    });

    router.post('/admin/promocodes/patch', (req, res) => {
        if (!requireAdmin(req, res)) return;

        const name = getRequestField(req, 'promocode');
        const discount = req.body?.bet ?? req.query?.bet;
        const maxUsages = req.body?.maxUsages ?? req.query?.maxUsages;

        try {
            const result = patchPromocode({ name, discount, maxUsages });
            if (result.missing) {
                return res.status(404).json('This promo code was not found');
            }
            return res.json('Promocode updated successfully');
        } catch (error) {
            if (error.message === 'INVALID_DISCOUNT') {
                return res.status(400).json('Discount must be between 1 and 100');
            }
            if (error.message === 'INVALID_MAX_USAGES') {
                return res.status(400).json('Max activations must be greater than 0');
            }
            console.error('[promocodes/patch]', error);
            return res.status(500).json('Failed to update promocode');
        }
    });

    router.post('/admin/promocodes/resetUsages', (req, res) => {
        if (!requireAdmin(req, res)) return;

        const name = String(req.body?.promocode || req.query.promocode || '').trim();
        const result = resetPromocodeUsages(name);
        if (result.missing) {
            return res.status(404).json('This promo code was not found');
        }
        return res.json('Promocode activations reset successfully');
    });

    router.post('/admin/promocodes/statistic/clearPayments', (req, res) => {
        if (!requireAdmin(req, res)) return;

        const name = String(req.body?.promocode || req.query.promocode || '').trim();
        const result = clearPromocodeStatistics(name);
        if (result.missing) {
            return res.status(404).json('This promo code was not found');
        }
        return res.json('Promocode statistics cleared successfully');
    });

    router.post('/admin/promocodes/get', (req, res) => {
        if (!requireAdmin(req, res)) return;

        const name = String(req.query.promocode || req.body?.promocode || '').trim();
        const record = getPromocode(name);
        if (!record) {
            return res.status(404).json('This promo code was not found');
        }
        return res.json(toPublicPromocode(record));
    });

    router.post('/admin/promocodes/statistic/get', (req, res) => {
        if (!requireAdmin(req, res)) return;

        const name = String(req.query.promocode || req.body?.promocode || '').trim();
        const stats = getPromocodeStatistics(name);
        if (!stats) {
            return res.status(404).json('This promo code was not found');
        }
        return res.json(stats);
    });

    router.post('/admin/finances/getBalance', (req, res) => {
        if (!requireAdmin(req, res)) return;
        res.json({ balance: 0 });
    });

    router.post('/admin/finances/getBanks', (_req, res) => {
        res.json({});
    });

    router.post('/admin/finances/getWithdraws', (req, res) => {
        if (!requireAdmin(req, res)) return;
        res.json([]);
    });

    router.post('/admin/autoload/getVersions', (req, res) => {
        if (!requireAdmin(req, res)) return;
        res.json([]);
    });

    router.post('/friends/getAll', (req, res) => {
        if (!requireAuth(req, res)) return;
        res.json([]);
    });

    router.post('/payments/frontend/create', (req, res) => {
        const user = requireAuth(req, res);
        if (!user) return;

        const productId = String(req.query.id || '').trim();
        const paymentType = String(req.query.paymentType || '').trim();
        const email = String(req.query.inputBoxEmail || req.query.email || '').trim();

        try {
            const order = createOrder({
                user,
                productId,
                paymentType,
                email,
                subscriptionProducts: SUBSCRIPTION_PRODUCTS,
                additionalProducts: ADDITIONAL_PRODUCTS
            });
            const paymentUrl = `/payment.html?order=${encodeURIComponent(order.id)}`;
            return res.json(paymentUrl);
        } catch (error) {
            if (error.message === 'PRODUCT_NOT_FOUND') {
                return res.status(400).json('Product not found');
            }
            if (error.message === 'PAYMENT_METHOD_NOT_FOUND') {
                return res.status(400).json('Payment method not found');
            }
            console.error('[payments/create]', error);
            return res.status(500).json('Payment creation failed');
        }
    });

    router.post('/payments/promocodes/apply', (req, res) => {
        const user = requireAuth(req, res);
        if (!user) return;

        const code = String(req.query.code || req.body?.code || '').trim();
        if (!code) {
            return res.status(400).json('PROMO_CODE_NOT_FOUND');
        }

        const result = applyPromocode(code);
        if (result.notFound) {
            return res.status(404).json('PROMO_CODE_NOT_FOUND');
        }
        if (result.exhausted) {
            return res.status(400).json('PROMO_CODE_EXPIRED');
        }
        return res.json(String(result.discount));
    });

    const stubOk = (_req, res) => res.json('OK');
    router.post('/friends/request', stubOk);
    router.post('/friends/remove', stubOk);
    router.post('/friends/accept', stubOk);
    router.post('/email/setup', stubOk);
    router.post('/users/auth/2fa/generate', stubOk);
    router.post('/users/auth/2fa/initializePanelSession', stubOk);
    router.post('/admin/autoload/uploadVersion', stubOk);
    router.post('/admin/finances/createInference', stubOk);
    router.post('/admin/finances/updateInferenceStatus', stubOk);
    router.post('/admin/finances/returnCancelledInference', stubOk);
    router.post('/admin/logs/getAllByCategory', (_req, res) => res.json([]));
    router.postForm = null;

    return router;
}

module.exports = { createCompatRouter, SUBSCRIPTION_PRODUCTS, ADDITIONAL_PRODUCTS };
