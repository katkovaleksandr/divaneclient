const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');

const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');

const PAYMENT_METHODS = [
    { enumName: 'SBP', displayName: 'СБП' },
    { enumName: 'CARD_MIR', displayName: 'Карта' },
    { enumName: 'FUNPAY', displayName: 'FunPay' }
];

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readSiteConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function paymentPhone() {
    return process.env.PAYMENT_PHONE || '+79103441485';
}

function paymentCard() {
    return process.env.PAYMENT_CARD || '2202206241727739';
}

function funpayUrl() {
    return process.env.FUNPAY_URL
        || readSiteConfig().funpayLink
        || 'https://funpay.com/users/14018761/';
}

function discordLink() {
    return process.env.DISCORD_SUPPORT || 'https://discord.gg/PaCYp5XbP4';
}

function ensureOrders() {
    const dir = path.dirname(ORDERS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(ORDERS_PATH)) {
        fs.writeFileSync(ORDERS_PATH, JSON.stringify({ orders: [] }, null, 2), 'utf8');
    }
}

function readOrders() {
    ensureOrders();
    return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
}

function writeOrders(data) {
    ensureOrders();
    fs.writeFileSync(ORDERS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function findProduct(productId, subscriptionProducts, additionalProducts) {
    const sub = subscriptionProducts.find((p) => p.type === productId);
    if (sub) {
        return {
            id: sub.type,
            price: sub.price,
            label: sub.time < 999 ? `${sub.time} Days` : 'Lifetime'
        };
    }
    const add = additionalProducts.find((p) => p.type === productId);
    if (add) {
        return {
            id: add.type,
            price: add.price,
            label: add.display
        };
    }
    return null;
}

function createOrder({ user, productId, paymentType, email, subscriptionProducts, additionalProducts }) {
    const product = findProduct(productId, subscriptionProducts, additionalProducts);
    if (!product) {
        throw new Error('PRODUCT_NOT_FOUND');
    }

    const method = PAYMENT_METHODS.find((m) => m.enumName === paymentType);
    if (!method) {
        throw new Error('PAYMENT_METHOD_NOT_FOUND');
    }

    const order = {
        id: crypto.randomBytes(6).toString('hex'),
        userId: user.id,
        username: user.username,
        email: email || user.email || '',
        productId: product.id,
        productLabel: product.label,
        amount: product.price,
        paymentType,
        paymentLabel: method.displayName,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    const db = readOrders();
    db.orders.unshift(order);
    writeOrders(db);
    return order;
}

function getOrder(orderId) {
    const db = readOrders();
    return db.orders.find((o) => o.id === orderId) || null;
}

function publicOrder(order) {
    if (!order) return null;
    return {
        id: order.id,
        username: order.username,
        productLabel: order.productLabel,
        amount: order.amount,
        paymentType: order.paymentType,
        paymentLabel: order.paymentLabel,
        status: order.status,
        createdAt: order.createdAt,
        phone: order.paymentType === 'SBP' ? paymentPhone() : null,
        card: order.paymentType === 'CARD_MIR' ? paymentCard() : null,
        funpayUrl: order.paymentType === 'FUNPAY' ? funpayUrl() : null,
        discord: discordLink()
    };
}

module.exports = {
    PAYMENT_METHODS,
    paymentPhone,
    paymentCard,
    funpayUrl,
    discordLink,
    createOrder,
    getOrder,
    publicOrder,
    findProduct
};
