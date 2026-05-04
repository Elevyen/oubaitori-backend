const crypto = require('crypto');

const KEY_B64 = process.env.NOTA_MASTER_KEY || null;
// NOTA_MASTER_KEY debe ser base64 de 32 bytes (256 bits).
if (!KEY_B64) {
    console.warn('WARNING: NOTA_MASTER_KEY no está definida. Encriptación no funcionará.');
}
const KEY = KEY_B64 ? Buffer.from(KEY_B64, 'base64') : null;

const IV_LEN = 12;
const TAG_LEN = 16;

function encrypt(plainText) {
    if (!KEY) throw new Error('no_master_key');
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const encrypted = Buffer.concat([cipher.update(String(plainText || ''), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(b64) {
    if (!KEY) throw new Error('no_master_key');
    if (!b64) return null;
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.slice(0, IV_LEN);
    const tag = raw.slice(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = raw.slice(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
