const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET no definido');

// SYSTEM_ADMIN
const rawSystemAdmins = process.env.SYSTEM_ADMIN || 'OubaitoriDB_Admin';
const SYSTEM_ADMIN = String(rawSystemAdmins)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isObjectIdString(s) {
  return typeof s === 'string' && mongoose.Types.ObjectId.isValid(s) && String(new mongoose.Types.ObjectId(s)) === s;
}

module.exports = async function authMiddleware(req, res, next) {
  try {
    const auth = (req.headers.authorization || req.headers.Authorization || '').trim();
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'No se pudo validar.' });
    }

    const token = auth.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ ok: false, error: 'No se pudo validar.' });
    }
    // Extraer id
    const rawId = payload.id || payload.sub || payload._id || '';
    const id = rawId ? String(rawId) : '';

    // Si el token es admin se acepta
    if (payload.role === 'admin' || payload.rol === 'admin') {
      req.usuario = {
        _id: id || (SYSTEM_ADMIN.length ? SYSTEM_ADMIN[0] : 'system_admin'),
        role: 'admin',
        email: payload.email || payload.mail || null,
        payload
      };
      return next();
    }

    if (!id) {
      return res.status(401).json({ ok: false, error: 'No se encuentra ID.' });
    }
    // Si id parece un ObjectId válido, consultamos BD
    if (isObjectIdString(id)) {
      try {
        const usuario = await Usuario.findById(id).select('-passwordHash');
        if (!usuario) {
          // Si no existe en BD, comprobar si es un identificador de sistema admin
          if (SYSTEM_ADMIN.includes(id)) {
            req.usuario = { _id: id, role: 'admin', email: payload.email || null, payload };
            return next();
          }
          return res.status(401).json({ ok: false, error: 'Error de autenticación' });
        }

        // Usuario encontrado en BD: normalizar req.usuario y continuar
        req.usuario = usuario;
        return next();
      } catch (dbErr) {
        console.error('authMiddleware - error consultando usuario:', dbErr && dbErr.stack ? dbErr.stack : dbErr);
        return res.status(500).json({ ok: false, error: 'Error de servidor' });
      }
    }
    // Si no cumple ninguna condición, no autenticado
    return res.status(401).json({ ok: false, error: 'Error de autenticación' });
  } catch (err) {
    console.error('Error en authMiddleware:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'Error de autenticación' });
  }
};
