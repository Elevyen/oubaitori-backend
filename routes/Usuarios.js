const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');
const PendingUser = require('../models/PendingUser');
const authMiddleware = require('../middleware/auth');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = Number(process.env.SALT_ROUNDS || 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const PENDING_MIN = Number(process.env.PENDING_TOKEN_EXPIRES_MIN || 15);

function signPendingToken(payload, expiresInMinutes) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: `${expiresInMinutes}m` });
}

/**
 * Helper: normaliza y obtiene id del usuario desde req.usuario
 */
function getReqUserId(req) {
    const raw = req.usuario || {};
    const candidate = raw.id || raw._id || raw;
    if (!candidate) return null;
    try {
        return String(candidate);
    } catch {
        return null;
    }
}

/**
 * Helper: convierte un documento/objeto usuario a una forma segura para la API
 * Asegura que _id e id sean strings y elimina campos sensibles.
 */
function sanitizeUserForResponse(u) {
    if (!u) return null;
    const copy = { ...(u.toObject ? u.toObject() : u) };
    if (copy._id !== undefined) {
        try {
            copy._id = String(copy._id);
        } catch {
            copy._id = copy._id;
        }
    }
    // mantener compatibilidad: exponer id además de _id
    if (copy.id === undefined && copy._id !== undefined) copy.id = copy._id;
    // eliminar campos sensibles si existen
    if (copy.passwordHash !== undefined) delete copy.passwordHash;
    if (copy.__v !== undefined) delete copy.__v;
    return copy;
}


/* POST /api/usuarios/check-email */
router.post('/check-email', async (req, res) => {
    try {
        const email = (req.body && req.body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'email_requerido' });
        const exists = !!(await Usuario.findOne({ email }).select('_id').lean());
        return res.json({ exists });
    } catch (err) {
        console.error('Error en /api/usuarios/check-email', err);
        return res.status(500).json({ error: 'error_servidor' });
    }
});

/* POST /api/usuarios/create-pending */
router.post('/create-pending', async (req, res) => {
    try {
        const { nombre, email, password, genero, pronombres } = req.body || {};
        if (!nombre || !email || !password) {
            return res.status(400).json({ error: 'nombre_email_password_requeridos' });
        }

        const emailNorm = String(email).toLowerCase().trim();
        const exists = await Usuario.findOne({ email: emailNorm }).select('_id').lean();
        if (exists) return res.status(409).json({ error: 'usuario_ya_existe' });

        const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
        const pendingToken = signPendingToken({ email: emailNorm }, PENDING_MIN);
        const expiresAt = new Date(Date.now() + PENDING_MIN * 60 * 1000);

        await PendingUser.findOneAndUpdate(
            { email: emailNorm },
            { pendingToken, nombre, email: emailNorm, passwordHash, genero: genero || null, pronombres: pronombres || null, expiresAt },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        return res.json({
            pendingToken,
            pendingUser: { nombre, email: emailNorm, genero: genero || null, pronombres: pronombres || null }
        });
    } catch (err) {
        console.error('Error en /api/usuarios/create-pending', err);
        return res.status(500).json({ error: 'error_servidor' });
    }
});

/* POST /api/usuarios/complete-registration */
router.post('/complete-registration', async (req, res) => {
    try {
        const { pendingToken, personaje } = req.body || {};
        if (!pendingToken) return res.status(400).json({ error: 'pendingToken_requerido' });

        let payload;
        try {
            payload = jwt.verify(pendingToken, JWT_SECRET);
        } catch (err) {
            return res.status(400).json({ error: 'token_invalido_o_expirado' });
        }

        const email = String(payload.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'token_sin_email' });

        const pending = await PendingUser.findOne({ email, pendingToken }).exec();
        if (!pending) return res.status(400).json({ error: 'pending_no_encontrado' });

        const already = await Usuario.findOne({ email }).select('_id').lean();
        if (already) {
            await PendingUser.deleteOne({ _id: pending._id }).catch(() => { });
            return res.status(409).json({ error: 'usuario_ya_existe' });
        }

        const nuevo = new Usuario({
            nombre: pending.nombre,
            email: pending.email,
            passwordHash: pending.passwordHash,
            genero: pending.genero,
            pronombres: pending.pronombres,
            personaje: personaje || {},
            gustos: pending.gustos || []
        });

        await nuevo.save();
        await PendingUser.deleteOne({ _id: pending._id }).catch(() => { });

        const userToken = jwt.sign({ id: String(nuevo._id), email: nuevo.email }, JWT_SECRET, { expiresIn: '7d' });

        return res.status(201).json({ id: String(nuevo._id), token: userToken });
    } catch (err) {
        console.error('Error en /api/usuarios/complete-registration', err);
        return res.status(500).json({ error: 'error_servidor' });
    }
});

/* POST /api/usuarios/login */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email_password_requeridos' });

        const emailNorm = String(email).toLowerCase().trim();

        const usuario = await Usuario.findOne({ email: emailNorm }).select('+passwordHash nombre email').exec();
        if (!usuario) return res.status(401).json({ error: 'credenciales_invalidas' });

        let hash = usuario.passwordHash;
        if (!hash) {
            const raw = await Usuario.collection.findOne({ email: emailNorm });
            hash = raw && raw.passwordHash ? raw.passwordHash : null;
        }

        if (!hash) return res.status(401).json({ error: 'credenciales_invalidas' });

        const match = await bcrypt.compare(String(password), hash);
        if (!match) return res.status(401).json({ error: 'credenciales_invalidas' });

        const token = jwt.sign({ id: String(usuario._id), email: usuario.email }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ id: String(usuario._id), nombre: usuario.nombre || '', email: usuario.email, token });
    } catch (err) {
        console.error('Error en /api/usuarios/login', err);
        return res.status(500).json({ error: 'error_servidor' });
    }
});

/* GET /api/usuarios
   Lista usuarios (incluye genero y pronombres) */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const usuarios = await Usuario.find()
            .select('nombre email genero pronombres personaje createdAt gustos')
            .limit(limit)
            .lean();

        const sanitized = (usuarios || []).map(sanitizeUserForResponse);
        return res.status(200).json({ ok: true, count: sanitized.length, usuarios: sanitized });
    } catch (err) {
        console.error('GET /api/usuarios error', err);
        return res.status(500).json({ error: 'error_listando_usuarios' });
    }
});

/* GET /api/usuarios/usuario
   Devuelve el usuario autenticado */
router.get('/usuario', authMiddleware, async (req, res) => {
    try {
        const id = getReqUserId(req);
        if (!id) return res.status(401).json({ error: 'no_autorizado' });

        if (!mongoose.Types.ObjectId.isValid(id)) {
            console.error('GET /usuario - id_invalido:', id);
            return res.status(401).json({ error: 'no_autorizado' });
        }

        const usuario = await Usuario.findById(id)
            .select('nombre email genero pronombres personaje gustos')
            .lean();

        if (!usuario) return res.status(404).json({ error: 'usuario_no_encontrado' });

        const sanitized = sanitizeUserForResponse(usuario);
        return res.status(200).json({ ok: true, usuario: sanitized });
    } catch (err) {
        console.error('Error GET /api/usuarios/usuario', err);
        return res.status(500).json({ error: 'error_obteniendo_usuario' });
    }
});

/* PUT /api/usuarios/usuario
   Actualiza perfil del usuario autenticado (nombre, email, personaje, gustos, genero, pronombres) */
router.put('/usuario', authMiddleware, async (req, res) => {
    console.log('PUT /api/usuarios/usuario - headers.Authorization:', req.headers.authorization);
    console.log('PUT /api/usuarios/usuario - req.usuario:', req.usuario);
    console.log('PUT /api/usuarios/usuario - resolved id:', getReqUserId(req));
    console.log('PUT /api/usuarios/usuario - body:', JSON.stringify(req.body));
    try {
        const id = getReqUserId(req);
        if (!id) return res.status(401).json({ error: 'no_autorizado' });
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(401).json({ error: 'no_autorizado' });

        const body = req.body || {};
        const update = {};

        if (typeof body.nombre === 'string') update.nombre = String(body.nombre).trim();
        if (typeof body.email === 'string') update.email = String(body.email).toLowerCase().trim();
        if (typeof body.genero === 'string') update.genero = body.genero;
        if (typeof body.pronombres === 'string') update.pronombres = body.pronombres;
        if (body.personaje && typeof body.personaje === 'object') {
            update.personaje = {
                id: body.personaje.id ? String(body.personaje.id) : '',
                nombre: body.personaje.nombre ? String(body.personaje.nombre) : '',
                meta: body.personaje.meta || {}
            };
        }
        if (Array.isArray(body.gustos)) {
            update.gustos = Array.from(new Set(body.gustos.map(g => String(g).trim()).filter(Boolean)));
        }

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ error: 'sin_campos_para_actualizar' });
        }

        // Si se intenta cambiar email, comprobar
        if (update.email) {
            const other = await Usuario.findOne({ email: update.email, _id: { $ne: id } }).select('_id').lean();
            if (other) return res.status(409).json({ error: 'email_ya_en_uso' });
        }

        const updated = await Usuario.findByIdAndUpdate(id, { $set: update }, { new: true, select: 'nombre email genero pronombres personaje gustos' }).lean();
        if (!updated) return res.status(404).json({ error: 'usuario_no_encontrado' });

        const sanitized = sanitizeUserForResponse(updated);
        return res.status(200).json({ ok: true, usuario: sanitized });
    } catch (err) {
        console.error('PUT /api/usuarios/usuario error', err);
        return res.status(500).json({ error: 'error_actualizando_perfil' });
    }
});

/* POST /api/usuarios/usuario/personaje
   Actualiza personaje del usuario autenticado (parcial) */
router.post('/usuario/personaje', authMiddleware, async (req, res) => {
    try {
        const id = getReqUserId(req);
        if (!id) return res.status(401).json({ error: 'no_autorizado' });
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(401).json({ error: 'no_autorizado' });

        const p = req.body.personaje || {};
        const personaje = {
            id: p?.id ? String(p.id) : '',
            nombre: p?.nombre ? String(p.nombre) : '',
            meta: p?.meta || {}
        };
        if (!personaje.id && !personaje.nombre) return res.status(400).json({ error: 'personaje_invalido' });

        const updated = await Usuario.findByIdAndUpdate(
            id,
            { $set: { personaje } },
            { new: true, select: 'personaje' }
        ).lean();

        if (!updated) return res.status(404).json({ error: 'usuario_no_encontrado' });
        return res.status(200).json({ ok: true, personaje: updated.personaje });
    } catch (err) {
        console.error('Error POST /api/usuarios/usuario/personaje', err);
        return res.status(500).json({ error: 'error_guardando_personaje' });
    }
});

/* POST /api/usuarios/usuario/password
   Cambiar contraseña (requiere currentPassword) */
router.post('/usuario/password', authMiddleware, async (req, res) => {
    try {
        const id = getReqUserId(req);
        if (!id) return res.status(401).json({ error: 'no_autorizado' });
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(401).json({ error: 'no_autorizado' });

        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'passwords_requeridos' });
        if (String(newPassword).length < 8) return res.status(400).json({ error: 'password_demasiado_corto' });

        const usuario = await Usuario.findById(id).select('+passwordHash').exec();
        if (!usuario) return res.status(404).json({ error: 'usuario_no_encontrado' });

        const match = await bcrypt.compare(String(currentPassword), usuario.passwordHash);
        if (!match) return res.status(401).json({ error: 'password_actual_incorrecta' });

        const newHash = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
        usuario.passwordHash = newHash;
        await usuario.save();

        return res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/usuarios/usuario/password error', err);
        return res.status(500).json({ error: 'error_cambiando_password' });
    }
});


/* PUT /api/usuarios/:id
   Actualiza campos permitidos de un usuario (admin / protegido) */
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'id_invalido' });

        const body = req.body || {};
        const update = {};
        if (typeof body.nombre === 'string') update.nombre = body.nombre;
        if (typeof body.email === 'string') update.email = String(body.email).toLowerCase().trim();
        if (typeof body.genero === 'string') update.genero = body.genero;
        if (typeof body.pronombres === 'string') update.pronombres = body.pronombres;
        if (body.personaje && typeof body.personaje === 'object') {
            update.personaje = {
                id: body.personaje.id ? String(body.personaje.id) : '',
                nombre: body.personaje.nombre ? String(body.personaje.nombre) : ''
            };
        }
        if (Array.isArray(body.gustos)) {
            update.gustos = Array.from(new Set(body.gustos.map(g => String(g).trim()).filter(Boolean)));
        }

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ error: 'sin_campos_para_actualizar' });
        }

        // comprobar email único si se cambia
        if (update.email) {
            const other = await Usuario.findOne({ email: update.email, _id: { $ne: id } }).select('_id').lean();
            if (other) return res.status(409).json({ error: 'email_ya_en_uso' });
        }

        const updated = await Usuario.findByIdAndUpdate(
            id,
            { $set: update },
            { new: true, select: 'nombre email genero pronombres personaje gustos' }
        ).lean();

        if (!updated) return res.status(404).json({ error: 'usuario_no_encontrado' });

        const sanitized = sanitizeUserForResponse(updated);
        return res.status(200).json({ ok: true, usuario: sanitized });
    } catch (err) {
        console.error('PUT /api/usuarios/:id error', err);
        return res.status(500).json({ error: 'error_actualizando_usuario' });
    }
});

/* DELETE /api/usuarios/:id
   Elimina un usuario */
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'id_invalido' });
        const deleted = await Usuario.findByIdAndDelete(id).lean();
        if (!deleted) return res.status(404).json({ error: 'usuario_no_encontrado' });
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/usuarios/:id error', err);
        return res.status(500).json({ error: 'error_borrando_usuario' });
    }
});

/* GET /api/usuarios/:id
   Devuelve usuario por id (debe ir al final para no capturar rutas estáticas) */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'id_invalido' });

        const usuario = await Usuario.findById(id)
            .select('nombre email genero pronombres personaje gustos')
            .lean();

        if (!usuario) return res.status(404).json({ error: 'usuario_no_encontrado' });

        const sanitized = sanitizeUserForResponse(usuario);
        return res.status(200).json({ usuario: sanitized });
    } catch (err) {
        console.error('GET /api/usuarios/:id error', err);
        return res.status(500).json({ error: 'error_obteniendo_usuario' });
    }
});

module.exports = router;
