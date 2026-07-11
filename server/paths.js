const fs = require('fs');
const path = require('path');

let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

if (process.env.DATA_DIR) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (error) {
        console.warn('[paths] Failed to use DATA_DIR, falling back to local data:', error.message);
        DATA_DIR = path.join(__dirname, 'data');
    }
}

module.exports = {
    DATA_DIR
};
