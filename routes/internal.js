const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const MONGO_URI = process.env.MONGO_URI || '';

// Extraer contraseña de una URI mongodb://user:pass@...
function extractMongoPassword(uri) {
    if (!uri || typeof uri !== 'string') return null;
    const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^:]+:([^@]+)@/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

function timingSafeEqualStr(a, b) {
    try {
        const A = Buffer.from(String(a));
        const B = Buffer.from(String(b));
        if (A.length !== B.length) return false;
        return crypto.timingSafeEqual(A, B);
    } catch (e) {
        return false;
    }
}

router.post('/check-mongo-pass', (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Missing password' });

    const mongoPass = extractMongoPassword(MONGO_URI);
    if (!mongoPass) return res.status(500).json({ error: 'Server misconfigured' });

    if (!timingSafeEqualStr(password, mongoPass)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ role: 'admin', sub: 'OubaitoriDB_Admin' }, JWT_SECRET, { expiresIn: '2h' });

    return res.json({
        id: 'admin',
        nombre: 'OubaitoriDB_Admin',
        email: 'OubaitoriDB_Admin@local',
        token
    });
});

module.exports = router;
