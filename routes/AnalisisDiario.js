const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const Analisis = require('../models/Analisis');
const RegistroEmocional = require('../models/RegistroEmocional');
const generarAnalisis = require('../services/generarAnalisis');
const { formatDate } = require('../utils/date');

router.post('/', async (req, res) => {
  try {
    const usuarioId = req.usuario._id || req.usuario.id;
    const registros = await RegistroEmocional.find({ userId: usuarioId }).sort({ createdAt: -1 }).limit(7).lean();

    if (!registros.length) {
      return res.status(404).json({
        ok: false,
        message: 'no_registros'
      });
    }
    const resumen = generarAnalisis(registros);

    const fechaClave = req.body.fecha || formatDate(new Date());

    const analisis = await Analisis.findOneAndUpdate({ usuarioId, fechaClave },
      { resumen, actualizadoEn: new Date() },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, analisis });

  } catch (error) {
    console.error('ERROR ANALISIS:', error);

    return res.status(500).json({ ok: false, message: 'error_generando_analisis' });
  }
}
);
router.get('/historial', async (req, res) => {
  try {

    const usuarioId =
      req.usuario._id || req.usuario.id;

    const analisis =
      await Analisis.find({ usuarioId })
        .sort({ actualizadoEn: -1 })
        .limit(7)
        .lean();

    return res.json({
      ok: true,
      analisis
    });

  } catch (error) {

    console.error(
      'ERROR HISTORIAL ANALISIS:',
      error
    );

    return res.status(500).json({
      ok: false
    });
  }
});
router.get('/:fecha', async (req, res) => {
  try {
    const analisis = await Analisis.findOne({ usuarioId: req.usuario._id || req.usuario.id, fechaClave: req.params.fecha });
    console.log("REQ.USUARIO:", req.usuario);
    if (!analisis) {
      return res.status(404).json({ ok: false, message: 'analisis_no_encontrado' });
    }

    return res.json({ ok: true, analisis });

  } catch (error) {
    console.error('ERROR GET ANALISIS:', error);
    return res.status(500).json({ ok: false });
  }
}
);

module.exports = router;