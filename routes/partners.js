const express = require('express');
const router = express.Router();
const Partner = require('../models/Partner');
const authMiddleware = require('../middleware/auth');

function requireAdmin(req, res, next) {
    const user = req.usuario || {};

    //token con rol admin
    if (user.role === 'admin') return next();

    //usuario con rol 'admin'
    if (user.roles && Array.isArray(user.roles) && user.roles.includes('admin')) return next();

    //identificadores en env
    const envAdmin =  process.env.SYSTEM_ADMIN || '';
    const SYSTEM_ADMIN = String(envAdmin).split(',').map(s => s.trim()).filter(Boolean);
    if (user._id && SYSTEM_ADMIN.includes(String(user._id))) return next();

    return res.status(403).json({ error: 'no_autorizado_admin' });
}

// GET /api/partners
router.get('/', async (req, res) => {
    try {
        const list = await Partner.find({ activo: true }).sort({ orden: 1, nombre: 1 }).lean();
        return res.json({ ok: true, partners: list });
    } catch (err) {
        console.error('GET /api/partners error', err);
        return res.status(500).json({ error: 'Error mostrando compañeros' });
    }
});
// GET /api/partners/all  -> lista completa (admin)
router.get('/all', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const list = await Partner.find().sort({ orden: 1, nombre: 1 }).lean();
        return res.json({ ok: true, partners: list });
    } catch (err) {
        console.error('GET /api/partners/all error', err);
        return res.status(500).json({ error: 'Error mostrando compañeros' });
    }
});
// PUT /api/partners/:id  -> actualizar (admin)
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        if (!id) return res.status(400).json({ error: 'id_requerido' });

        const body = req.body || {};
        const update = {};
        if (body.key) update.key = String(body.key);
        if (body.nombre) update.nombre = String(body.nombre);
        if (body.slug) update.slug = String(body.slug);
        if (body.descripcion) update.descripcion = String(body.descripcion);
        if (body.imagen) update.imagen = String(body.imagen);
        if (body.meta) update.meta = body.meta;
        if (typeof body.activo === 'boolean') update.activo = body.activo;
        if (body.orden != null) update.orden = Number(body.orden);

        const updated = await Partner.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
        if (!updated) return res.status(404).json({ error: 'partner_no_encontrado' });
        return res.json({ ok: true, partner: updated });
    } catch (err) {
        console.error('PUT /api/partners/:id error', err);
        return res.status(500).json({ error: 'error_actualizando_partner' });
    }
});

// DELETE /api/partners/:id  -> borrar (admin)
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const deleted = await Partner.findByIdAndDelete(id).lean();
        if (!deleted) return res.status(404).json({ error: 'partner_no_encontrado' });
        return res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/partners/:id error', err);
        return res.status(500).json({ error: 'error_borrando_partner' });
    }
});

module.exports = router;
