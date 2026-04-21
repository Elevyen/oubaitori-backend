const express = require('express');
const router = express.Router();
const RegistroModel = require('../models/Registro');

/**
 * POST /api/registros
 * etiquetas, string separado por comas
 * emociones, array de clave valor
 * intensidad
 * nota, texto (máx 1000)
 */
router.post('/', async (req, res) => {
    const cuerpo = req.body || {};

    // Usuario por mail y nombre
    const usuarioPayload = cuerpo.usuario || cuerpo.user || null;
    const nombreUsuario = usuarioPayload?.nombre || usuarioPayload?.name || null;
    const emailUsuario = usuarioPayload?.email ? String(usuarioPayload.email).toLowerCase() : null;

    if (!nombreUsuario || !emailUsuario) {
        return res.status(400).json({ error: 'Para guardar un registro es necesario un usuario.' });
    }

    // Fecha con formato DD-MM-YYYY
    let fechaRegistro = cuerpo.date || null;
    if (!fechaRegistro) {
        const hoy = new Date();
        const dd = String(hoy.getDate()).padStart(2, '0');
        const mm = String(hoy.getMonth() + 1).padStart(2, '0');
        const yyyy = hoy.getFullYear();
        fechaRegistro = `${dd}-${mm}-${yyyy}`;
    }

    // String separado por comas y guardamos en array
    const stringEtiquetas = typeof cuerpo.etiquetas === 'string' ? cuerpo.etiquetas : '';
    const etiquetasArray = stringEtiquetas === '' ? [] : stringEtiquetas.split(',').map(t => t.trim()).filter(Boolean);

    // Intensidad
    const intensidad = cuerpo.intensidad != null ? Number(cuerpo.intensidad) : null;

    // Nota: texto de hasta 1000 caracteres
    const nota = typeof cuerpo.nota === 'string' ? String(cuerpo.nota).slice(0, 1000) : '';

    // Chips de emociones: conservar solo id o label, emoji y color
    const selectedEmotions = Array.isArray(cuerpo.selectedEmotions) ? cuerpo.selectedEmotions : [];
    const emociones = (selectedEmotions || []).map(item => {
        const identificador = item?.id ? String(item.id) : (item?.label ? String(item.label) : '');
        return {
            id: identificador,
            emoji: item?.emoji ? String(item.emoji) : '',
            color: item?.color ? String(item.color) : ''
        };
    }).filter(chip => chip.id);

    try {
        // Límite diario por usuario
        const ahora = new Date();
        const inicioDia = new Date(ahora); inicioDia.setHours(0, 0, 0, 0);
        const finDia = new Date(ahora); finDia.setHours(23, 59, 59, 999);

        const contadorHoy = await RegistroModel.countDocuments({
            'usuario.email': emailUsuario,
            createdAt: { $gte: inicioDia, $lte: finDia }
        });

        const LIMITE_DIARIO = Number(process.env.LIMITE_REGISTROS_DIARIOS || 2);
        if (contadorHoy >= LIMITE_DIARIO) {
            return res.status(429).json({ error: 'limite_diario_alcanzado', limit: LIMITE_DIARIO });
        }

        // Registro final
        const registroFinal = {
            usuario: { nombre: nombreUsuario, email: emailUsuario },
            fecha: fechaRegistro,
            etiquetas: etiquetasArray,      // array de strings
            emociones,      // array de chips { id, emoji, color }
            intensidad,     // número
            nota,           // texto
            meta: Object.assign({}, cuerpo.meta || {}),
            createdAt: new Date()
        };

        const doc = new RegistroModel(registroFinal);
        await doc.save();

        return res.status(201).json({ ok: true, id: doc._id });
    } catch (err) {
        console.error('Error guardando registro:', err);
        return res.status(500).json({ error: 'Error guardando registro' });
    }
});

module.exports = router;
