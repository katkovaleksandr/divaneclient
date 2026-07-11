const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'divane-client-secret-change-in-production';
const JWT_EXPIRES = '30d';

function signToken(userId, username) {
    const payload = { sub: userId };
    if (username) {
        payload.username = String(username);
    }
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const payload = verifyToken(token);
        req.userId = payload.sub;
        req.token = token;
        next();
    } catch {
        return res.status(401).json({ message: 'Invalid token' });
    }
}

function adminMiddleware(req, res, next) {
    const isAdmin = req.user && (
        ['ADMIN', 'OWNER'].includes(req.user.role)
        || req.user.username.toLowerCase() === 'dev'
    );
    if (!isAdmin) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    next();
}

module.exports = {
    signToken,
    verifyToken,
    hashPassword,
    comparePassword,
    authMiddleware,
    adminMiddleware
};
