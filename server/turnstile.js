const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function isTurnstileRequired() {
    return process.env.TURNSTILE_REQUIRED === 'true';
}

async function verifyTurnstile(token, remoteIp) {
    if (!isTurnstileRequired()) {
        return true;
    }

    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) {
        return true;
    }

    const response = String(token || '').trim();
    if (!response || response === 'ok') {
        return false;
    }

    try {
        const body = new URLSearchParams();
        body.append('secret', secret);
        body.append('response', response);
        if (remoteIp) {
            body.append('remoteip', remoteIp);
        }

        const result = await fetch(VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });

        const data = await result.json();
        return data.success === true;
    } catch (error) {
        console.error('[turnstile]', error);
        return false;
    }
}

module.exports = { verifyTurnstile, isTurnstileRequired };
