require('dotenv').config();
const express = require('express');
const router = express.Router();
const ContactModel = require('../models/contacto');
const nodemailer = require('nodemailer');

// Cargar auth middleware si existe (rutas admin)
let authMiddleware;
try {
    authMiddleware = require('../middleware/auth');
} catch (e) {
    authMiddleware = null;
}

/**
 * extraer id y email del usuario autenticado
 */
function resolveUserId(usuario) {
    if (!usuario) return null;
    if (typeof usuario === 'string') return usuario;
    if (usuario._id) return String(usuario._id);
    if (usuario.id) return String(usuario.id);
    if (usuario.payload && (usuario.payload.id || usuario.payload._id)) {
        return String(usuario.payload.id || usuario.payload._id);
    }
    return null;
}

function resolveUserEmail(usuario) {
    if (!usuario) return null;
    if (typeof usuario === 'string') return usuario;
    if (usuario.email && typeof usuario.email === 'string') return usuario.email;
    if (usuario.mail && typeof usuario.mail === 'string') return usuario.mail;
    if (usuario.payload && (usuario.payload.email || usuario.payload.mail)) {
        return usuario.payload.email || usuario.payload.mail;
    }
    return null;
}

/**
 * Crea un transporter de nodemailer usando las variables SMTP.
 * Lanza error si faltan credenciales para evitar comportamiento inesperado.
 */
function createTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpSecure = String(process.env.SMTP_SECURE || 'false') === 'true';

    if (!smtpHost || !smtpUser || !smtpPass) {
        throw new Error('SMTP configuration missing (SMTP_HOST/SMTP_USER/SMTP_PASS)');
    }

    return nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort || 587),
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });
}

/**
 * POST /api/contacto
 * Guarda contacto y envía correo en background.
 */
router.post('/', async (req, res) => {
    try {
        const usuario = req.usuario || null;
        const userId = resolveUserId(usuario);
        const userEmailFromAuth = resolveUserEmail(usuario);

        const { tipo, email: emailFromBody, titulo, mensaje } = req.body || {};

        if (!tipo || !['sugerencia', 'incidencia'].includes(tipo)) {
            return res.status(400).json({ ok: false, message: 'invalid_tipo' });
        }

        const finalEmail = userEmailFromAuth ? String(userEmailFromAuth).trim() : (emailFromBody ? String(emailFromBody).trim() : null);
        if (!finalEmail) return res.status(400).json({ ok: false, message: 'missing_email' });
        if (!titulo || String(titulo).trim().length === 0) return res.status(400).json({ ok: false, message: 'missing_titulo' });
        if (!mensaje || String(mensaje).trim().length === 0) return res.status(400).json({ ok: false, message: 'missing_mensaje' });

        const doc = await ContactModel.create({
            usuarioId: userId || null,
            tipo,
            email: finalEmail,
            titulo: String(titulo).trim(),
            mensaje: String(mensaje).trim(),
            createdAt: new Date(),
            meta: { ip: req.ip, userAgent: req.get('User-Agent') || null }
        });

        // Responder inmediatamente
        res.status(201).json({ ok: true, message: 'received', contactId: doc._id, email: doc.email });

        // Envío en background (no bloquea la respuesta)
        (async () => {
            let transporter;
            try {
                transporter = createTransporter();
            } catch (errTrans) {
                // Guardar intento fallido en BD para auditoría/reintento
                try {
                    await ContactModel.findByIdAndUpdate(doc._id, {
                        $inc: { mailAttempts: 1 },
                        mailError: String(errTrans.message).slice(0, 1000),
                        lastMailErrorAt: new Date()
                    });
                } catch (e) { }
                return;
            }

            try {
                const recipient = process.env.CONTACT_RECIPIENT || process.env.SUPPORT_EMAIL || 'support@tu-dominio.com';
                const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || `no-reply@${process.env.DOMAIN || 'tu-dominio.com'}`;

                const subject = `[${doc.tipo}] ${doc.titulo}`;
                const textBody = [
                    `Tipo: ${doc.tipo}`,
                    `Título: ${doc.titulo}`,
                    `Email remitente: ${doc.email}`,
                    `Mensaje:`,
                    doc.mensaje,
                    '',
                    `ID contacto: ${doc._id}`,
                    `Fecha: ${doc.createdAt}`
                ].join('\n\n');

                const mailOptions = {
                    from: `"Tu App" <${fromAddress}>`,
                    to: recipient,
                    subject,
                    text: textBody,
                    replyTo: doc.email
                };

                const info = await transporter.sendMail(mailOptions);

                // Actualizar documento como notificado
                try {
                    await ContactModel.findByIdAndUpdate(doc._id, { notified: true, notifiedAt: new Date() });
                } catch (updErr) {
                    // no interrumpir el flujo por fallo de actualización
                }
            } catch (err) {
                // Registrar fallo de envío y contador para reintentos
                try {
                    await ContactModel.findByIdAndUpdate(doc._id, {
                        $inc: { mailAttempts: 1 },
                        mailError: String(err.message || err).slice(0, 1000),
                        lastMailErrorAt: new Date()
                    });
                } catch (updErr) { }
            }
        })();

    } catch (err) {
        return res.status(500).json({ ok: false, message: 'internal_server_error' });
    }
});

/**
 * GET /api/contacto
 * Listado paginado y filtrable (admin)
 * Query params: page, limit, tipo, resuelto (true/false)
 */
router.get('/', authMiddleware ? authMiddleware : (req, res, next) => next(), async (req, res) => {
    try {
        if (req.usuario && req.usuario.role && req.usuario.role !== 'admin') {
            return res.status(403).json({ ok: false, message: 'forbidden' });
        }
        if (!req.usuario && authMiddleware) {
            return res.status(401).json({ ok: false, message: 'unauthenticated' });
        }

        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(200, Math.max(1, Number(req.query.limit || 25)));
        const skip = (page - 1) * limit;

        const filter = {};
        if (req.query.tipo) filter.tipo = req.query.tipo;
        if (typeof req.query.resuelto !== 'undefined') {
            const val = String(req.query.resuelto).toLowerCase();
            if (val === 'true' || val === 'false') filter.resuelto = (val === 'true');
        }

        const [items, total] = await Promise.all([
            ContactModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            ContactModel.countDocuments(filter)
        ]);

        res.json({ ok: true, page, limit, total, items });
    } catch (err) {
        res.status(500).json({ ok: false, message: 'internal_server_error' });
    }
});

/**
 * PATCH /api/contacto/:id/resuelto
 * Marcar/desmarcar como resuelto (solo admin)
 * Body: { resuelto: true|false }
 */
router.patch('/:id/resuelto', authMiddleware ? authMiddleware : (req, res, next) => next(), async (req, res) => {
    try {
        if (req.usuario && req.usuario.role && req.usuario.role !== 'admin') {
            return res.status(403).json({ ok: false, message: 'forbidden' });
        }
        if (!req.usuario && authMiddleware) {
            return res.status(401).json({ ok: false, message: 'unauthenticated' });
        }

        const id = req.params.id;
        const { resuelto } = req.body;
        if (typeof resuelto === 'undefined') {
            return res.status(400).json({ ok: false, message: 'missing_resuelto' });
        }

        const update = { resuelto: Boolean(resuelto) };
        if (resuelto) {
            update.resueltoAt = new Date();
        } else {
            update.resueltoAt = null;
        }

        const updated = await ContactModel.findByIdAndUpdate(id, update, { new: true });
        if (!updated) return res.status(404).json({ ok: false, message: 'not_found' });

        res.json({ ok: true, message: 'updated', contactId: updated._id, resuelto: updated.resuelto, resueltoAt: updated.resueltoAt });
    } catch (err) {
        res.status(500).json({ ok: false, message: 'internal_server_error' });
    }
});

module.exports = router;
