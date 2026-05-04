const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AnalisisModel = require('../models/Analisis');
const RegistroEmocional = require('../models/RegistroEmocional');
const { analyzeDays } = require('../services/AnalisisDias');
const authMiddleware = require('../middleware/auth');

// detectar error de duplicado por índice único
function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000));
}

// Util: resolver userId (acepta objeto, string, payload)
function resolveUserId(usuario) {
  if (!usuario) return null;
  if (typeof usuario === 'string') return usuario;
  if (usuario._id) return usuario._id;
  if (usuario.id) return usuario.id;
  if (usuario.payload && (usuario.payload.id || usuario.payload._id)) return usuario.payload.id || usuario.payload._id;
  return null;
}

// Reconstruir perRecord a partir de registros en la BD (por ids)
async function rebuildPerRecordFromIds(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const idsClean = ids.map(String).filter(Boolean);
  if (idsClean.length === 0) return [];
  const registrosBD = await RegistroEmocional.find({ _id: { $in: idsClean } }).lean().exec();
  return (registrosBD || []).map(raw => {
    const emociones = Array.isArray(raw.emociones)
      ? raw.emociones
      : Array.isArray(raw.emotions)
      ? raw.emotions
      : Array.isArray(raw.etiquetas)
      ? raw.etiquetas
      : [];
    const intensidadRaw = raw.intensidad ?? raw.intensity ?? (typeof raw.int === 'number' ? raw.int : null);
    const intensidad = intensidadRaw === null ? null : Number(intensidadRaw);
    return {
      id: String(raw._id),
      fecha: raw.fecha ?? (raw.createdAt ? raw.createdAt.toISOString().slice(0,10) : null),
      emociones,
      intensidad,
      nota: raw.nota ?? raw.note ?? null,
      raw
    };
  }).filter(p => p && p.id && p.fecha);
}

/**
 * POST /api/AnalisisDiario
 * Body: { registros: [...], persist: true|false }
 * Requiere authMiddleware (req.usuario disponible)
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const usuario = req.usuario;
    const userIdResolved = resolveUserId(usuario);
    if (!userIdResolved) {
      return res.status(401).json({ ok: false, message: 'no_autorizado' });
    }

    const { registros = null, records = null, persist = false } = req.body || {};

    // Normalizar: preferir array enviado por cliente; si no, recuperar desde BD
    let registrosAAnalizar = null;
    if (Array.isArray(registros) && registros.length > 0) registrosAAnalizar = registros;
    else if (Array.isArray(records) && records.length > 0) registrosAAnalizar = records;

    if (!registrosAAnalizar) {
      try {
        // Obtener últimos 7 registros del usuario (ordenados por createdAt desc)
        const registrosBD = await RegistroEmocional.find({ usuarioId: userIdResolved })
          .sort({ createdAt: -1 })
          .limit(7)
          .lean()
          .exec();

        registrosAAnalizar = (registrosBD || []).map(raw => {
          const emociones = Array.isArray(raw.emociones)
            ? raw.emociones
            : Array.isArray(raw.emotions)
            ? raw.emotions
            : Array.isArray(raw.etiquetas)
            ? raw.etiquetas
            : [];

          const intensidadRaw = raw.intensidad ?? raw.intensity ?? (typeof raw.int === 'number' ? raw.int : null);
          const intensidad = intensidadRaw === null ? null : Number(intensidadRaw);

          const nota = raw.nota ?? raw.note ?? null;
          const fecha = raw.fecha ?? (raw.createdAt ? raw.createdAt.toISOString().slice(0,10) : null);
          const id = String(raw._id ?? raw.id ?? '');

          return {
            _id: raw._id,
            id,
            fecha,
            emociones,
            intensidad,
            nota,
            _raw: raw
          };
        });
      } catch (errFetch) {
        console.error('AnalisisDiario: error fetching registros for user:', errFetch);
        return res.status(500).json({ ok: false, message: 'error_fetching_registros', detail: String(errFetch) });
      }
    } else {
      // Si el cliente envía registros, normalizarlos también para garantizar consistencia
      registrosAAnalizar = registrosAAnalizar.map(raw => {
        const r = raw || {};
        const emociones = Array.isArray(r.emociones)
          ? r.emociones
          : Array.isArray(r.emotions)
          ? r.emotions
          : Array.isArray(r.etiquetas)
          ? r.etiquetas
          : [];

        const intensidadRaw = r.intensidad ?? r.intensity ?? (typeof r.int === 'number' ? r.int : null);
        const intensidad = intensidadRaw === null ? null : Number(intensidadRaw);

        const nota = r.nota ?? r.note ?? null;
        const fecha = r.fecha ?? r.date ?? (r.createdAt ? (new Date(r.createdAt)).toISOString().slice(0,10) : null);
        const id = String(r.id ?? r._id ?? '');

        return {
          _id: r._id ?? r.id ?? null,
          id,
          fecha,
          emociones,
          intensidad,
          nota,
          _raw: r
        };
      });
    }

    // Validación final: si no hay registros, devolver 400
    if (!Array.isArray(registrosAAnalizar) || registrosAAnalizar.length === 0) {
      return res.status(400).json({ ok: false, message: 'no_records_provided' });
    }

    // Ejecutar servicio de análisis con manejo de errores
    let analysisResult;
    try {
      analysisResult = await analyzeDays({
        records: registrosAAnalizar,
        RecordModel: RegistroEmocional,
        userId: String(userIdResolved),
        persist: persist === true,
        perDayLimit: 7,
        daysWindow: 7
      });
    } catch (errAnalyze) {
      console.error('analyzeDays error:', errAnalyze && errAnalyze.stack ? errAnalyze.stack : errAnalyze);

      // Fallback específico si falta suggestMetadata (ya manejado antes)
      if (errAnalyze && /suggestMetadata/.test(String(errAnalyze.message || ''))) {
        console.warn('suggestMetadata no definida en AnalisisDias.js — usando fallback de análisis ligero');
        const perRecord = registrosAAnalizar.map((r) => {
          const emociones = Array.isArray(r.emociones) ? r.emociones : (Array.isArray(r.emotions) ? r.emotions : []);
          const intensidad = Number(r.intensidad ?? r.intensity ?? 0) || 0;
          return {
            id: r.id || r._id || null,
            fecha: r.fecha || r.date || null,
            summary: { emocionesCount: emociones.length, intensidad },
            analysis: { version: 'fallback-1', notes: 'fallback analysis due to missing suggestMetadata' }
          };
        });
        const summary = {
          totalRecords: perRecord.length,
          avgIntensity: perRecord.reduce((s, p) => s + (p.summary.intensidad || 0), 0) / Math.max(1, perRecord.length),
          fallback: true
        };
        analysisResult = { perRecord, summary };
      } else {
        throw errAnalyze;
      }
    }

    // Si se solicita persistir, crear o actualizar documento Analisis (upsert)
    if (persist === true) {
      try {
        const fechaClave = (registrosAAnalizar[0] && (registrosAAnalizar[0].fecha || registrosAAnalizar[0].date)) || new Date().toLocaleDateString('sv-SE');
        const registrosProcesados = (registrosAAnalizar.map(r => r._id || r.id).filter(Boolean));
        const resumenAnalisis = analysisResult.summary || {};
        const meta = { analyzerVersion: (analysisResult?.perRecord?.[0]?.analysis?.version || null) };
        const hash = String(Date.now()) + '-' + String(Math.random()).slice(2, 8);

        // construir perRecord a partir de analysisResult.perRecord o registrosAAnalizar (priorizar resultado del análisis)
        const sourcePerRecord = Array.isArray(analysisResult?.perRecord) && analysisResult.perRecord.length
          ? analysisResult.perRecord
          : Array.isArray(registrosAAnalizar) ? registrosAAnalizar : [];

        const perRecordToSave = sourcePerRecord.map(item => {
          const raw = item._raw || item.raw || item;
          const id = String(item.id ?? item._id ?? raw?._id ?? raw?.id ?? '');
          const fecha = item.fecha ?? raw?.fecha ?? (raw?.createdAt ? raw.createdAt.toISOString().slice(0,10) : null);
          const emociones = Array.isArray(item.emociones) ? item.emociones : (Array.isArray(raw?.emociones) ? raw.emociones : (Array.isArray(raw?.emotions) ? raw.emotions : []));
          const intensidadRaw = item.intensidad ?? item.intensity ?? raw?.intensidad ?? raw?.intensity ?? (typeof raw?.int === 'number' ? raw.int : null);
          const intensidad = intensidadRaw === null ? null : Number(intensidadRaw);
          const nota = item.nota ?? raw?.nota ?? raw?.note ?? null;
          return { id, fecha, emociones, intensidad, nota, raw };
        }).filter(p => p && p.id && p.fecha);

        const filter = { usuarioId: userIdResolved, fechaClave, tipo: 'diario' };
        const update = {
          $set: {
            resumenAnalisis,
            registrosProcesados,
            meta,
            perRecord: perRecordToSave,
            updatedAt: new Date()
          },
          $setOnInsert: {
            usuarioId: userIdResolved,
            fechaClave,
            tipo: 'diario',
            CamposSensibles: [],
            hashAnalisis: hash,
            createdAt: new Date()
          }
        };
        const opts = { upsert: true, new: true, rawResult: true, setDefaultsOnInsert: true };

        const raw = await AnalisisModel.findOneAndUpdate(filter, update, opts).lean().exec();
        const created = !(raw && raw.lastErrorObject && raw.lastErrorObject.updatedExisting);
        const analisisDoc = raw && raw.value ? raw.value : null;

        if (created) {
          return res.status(201).json({
            ok: true,
            result: { perRecord: analysisResult.perRecord, summary: analysisResult.summary },
            analisisId: analisisDoc?._id,
            created: true
          });
        } else {
          return res.status(200).json({
            ok: true,
            result: { perRecord: analysisResult.perRecord, summary: analysisResult.summary },
            analisisId: analisisDoc?._id,
            updated: true
          });
        }
      } catch (err) {
        console.error('AnalisisDiario persist error (upsert):', err && err.stack ? err.stack : err);
        if (isDuplicateKeyError(err)) {
          try {
            const fechaClave = (registrosAAnalizar[0] && (registrosAAnalizar[0].fecha || registrosAAnalizar[0].date)) || new Date().toLocaleDateString('sv-SE');
            const existing = await AnalisisModel.findOne({ usuarioId: userIdResolved, fechaClave, tipo: 'diario' }).lean().exec();
            if (existing) {
              // si perRecord falta o está incompleto, reconstruir desde registrosProcesados
              const existingHasPerRecord = Array.isArray(existing.perRecord) && existing.perRecord.length > 0;
              const needsFix = !existingHasPerRecord || existing.perRecord.some(p => p?.intensidad === undefined || p?.nota === undefined);
              if (needsFix && Array.isArray(existing.registrosProcesados) && existing.registrosProcesados.length) {
                existing.perRecord = await rebuildPerRecordFromIds(existing.registrosProcesados);
              }
              return res.status(200).json({ ok: true, message: 'analisis_existente', analisis: existing });
            }
          } catch (e) {
            console.error('AnalisisDiario persist fallback read error:', e);
          }
          return res.status(409).json({ ok: false, message: 'analisis_duplicado' });
        }
        return res.status(500).json({ ok: false, message: 'error_guardando_analisis', detail: err.message });
      }
    }

    // Si no persistir, devolver resultado en memoria
    return res.status(200).json({ ok: true, result: { perRecord: analysisResult.perRecord, summary: analysisResult.summary } });
  } catch (err) {
    console.error('POST /api/AnalisisDiario handler error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message || String(err) });
  }
});

/**
 * GET /api/AnalisisDiario
 * Query params:
 *   - fecha=YYYY-MM-DD   -> devuelve análisis para la fecha (usuario autenticado)
 *   - userId=...         -> opcional, admin/servicio puede pasar userId (se requiere auth)
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const fecha = String(req.query.fecha || '').trim();
    const queryUserId = String(req.query.userId || '').trim();

    let userIdToUse = queryUserId;
    if (!userIdToUse) {
      const usuario = req.usuario;
      const resolved = resolveUserId(usuario);
      if (resolved) userIdToUse = String(resolved);
    }

    if (!userIdToUse || !fecha) {
      return res.status(400).json({ ok: false, message: 'missing_params' });
    }

    const found = await AnalisisModel.findOne({ usuarioId: userIdToUse, fechaClave: fecha, tipo: 'diario' }).lean().exec();
    if (!found) {
      return res.status(404).json({ ok: false, message: 'not_found' });
    }

    // si perRecord falta o está incompleto, intentar reconstruir desde registrosProcesados
    const existingHasPerRecord = Array.isArray(found.perRecord) && found.perRecord.length > 0;
    const needsFix = !existingHasPerRecord || found.perRecord.some(p => p?.intensidad === undefined || p?.nota === undefined);
    if (needsFix && Array.isArray(found.registrosProcesados) && found.registrosProcesados.length) {
      found.perRecord = await rebuildPerRecordFromIds(found.registrosProcesados);
    }

    return res.status(200).json({ ok: true, analisis: found });
  } catch (err) {
    console.error('GET /api/AnalisisDiario error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message });
  }
});

/**
 * GET /api/AnalisisDiario/status?userId=...&fecha=YYYY-MM-DD
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const queryUserId = String(req.query.userId || '').trim();
    const fecha = String(req.query.fecha || '').trim();

    let userIdToUse = queryUserId;
    if (!userIdToUse) {
      const usuario = req.usuario;
      const resolved = resolveUserId(usuario);
      if (resolved) userIdToUse = String(resolved);
    }

    if (!userIdToUse || !fecha) {
      return res.status(400).json({ ok: false, message: 'missing_params' });
    }

    const found = await AnalisisModel.findOne({ usuarioId: userIdToUse, fechaClave: fecha, tipo: 'diario' }).lean().exec();
    return res.status(200).json({ ok: true, exists: Boolean(found) });
  } catch (err) {
    console.error('GET /api/AnalisisDiario/status error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message });
  }
});

/**
 * GET /api/AnalisisDiario/user/:userId
 */
router.get('/user/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, message: 'missing_userId' });

    const usuario = req.usuario;
    const resolved = resolveUserId(usuario);
    if (!resolved) return res.status(401).json({ ok: false, message: 'no_autorizado' });
    if (String(resolved) !== String(userId)) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    const limit = Math.min(100, Number(req.query.limit || 20));
    const page = Math.max(0, Number(req.query.page || 0));
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const q = { usuarioId: userId, tipo: 'diario' };
    if (from || to) {
      q.fechaClave = {};
      if (from) q.fechaClave.$gte = from;
      if (to) q.fechaClave.$lte = to;
    }

    const docs = await AnalisisModel.find(q).sort({ fechaClave: -1 }).skip(page * limit).limit(limit).lean().exec();
    const total = await AnalisisModel.countDocuments(q).exec();

    return res.status(200).json({ ok: true, total, page, limit, items: docs });
  } catch (err) {
    console.error('GET /api/AnalisisDiario/user/:userId error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message });
  }
});

/**
 * GET /api/AnalisisDiario/fecha/:fecha
 */
router.get('/fecha/:fecha', authMiddleware, async (req, res) => {
  try {
    const fecha = String(req.params.fecha || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ ok: false, message: 'invalid_fecha' });
    }

    const usuario = req.usuario;
    const resolved = resolveUserId(usuario);
    if (!resolved) return res.status(401).json({ ok: false, message: 'no_autorizado' });

    const found = await AnalisisModel.findOne({ usuarioId: String(resolved), fechaClave: fecha, tipo: 'diario' }).lean().exec();
    if (!found) return res.status(404).json({ ok: false, message: 'not_found' });

    const existingHasPerRecord = Array.isArray(found.perRecord) && found.perRecord.length > 0;
    const needsFix = !existingHasPerRecord || found.perRecord.some(p => p?.intensidad === undefined || p?.nota === undefined);
    if (needsFix && Array.isArray(found.registrosProcesados) && found.registrosProcesados.length) {
      found.perRecord = await rebuildPerRecordFromIds(found.registrosProcesados);
    }

    return res.status(200).json({ ok: true, analisis: found });
  } catch (err) {
    console.error('GET /api/AnalisisDiario/fecha/:fecha error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message });
  }
});

/**
 * GET /api/AnalisisDiario/:id
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, message: 'missing_id' });

    if (/^\d{4}-\d{2}-\d{2}$/.test(id)) {
      const usuario = req.usuario;
      const resolved = resolveUserId(usuario);
      if (!resolved) return res.status(401).json({ ok: false, message: 'no_autorizado' });

      const foundByFecha = await AnalisisModel.findOne({ usuarioId: String(resolved), fechaClave: id, tipo: 'diario' }).lean().exec();
      if (!foundByFecha) return res.status(404).json({ ok: false, message: 'not_found' });

      const existingHasPerRecord = Array.isArray(foundByFecha.perRecord) && foundByFecha.perRecord.length > 0;
      const needsFix = !existingHasPerRecord || foundByFecha.perRecord.some(p => p?.intensidad === undefined || p?.nota === undefined);
      if (needsFix && Array.isArray(foundByFecha.registrosProcesados) && foundByFecha.registrosProcesados.length) {
        foundByFecha.perRecord = await rebuildPerRecordFromIds(foundByFecha.registrosProcesados);
      }

      return res.status(200).json({ ok: true, analisis: foundByFecha });
    }

    let found = null;
    if (mongoose.isValidObjectId(id)) {
      found = await AnalisisModel.findById(id).lean().exec();
    }
    if (!found) {
      const filters = [{ id }, { uuid: id }, { externalId: id }];
      found = await AnalisisModel.findOne({ $or: filters }).lean().exec();
    }

    if (!found) return res.status(404).json({ ok: false, message: 'not_found' });

    const usuario = req.usuario;
    const resolved = resolveUserId(usuario);
    if (resolved && String(found.usuarioId) !== String(resolved)) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    const existingHasPerRecord = Array.isArray(found.perRecord) && found.perRecord.length > 0;
    const needsFix = !existingHasPerRecord || found.perRecord.some(p => p?.intensidad === undefined || p?.nota === undefined);
    if (needsFix && Array.isArray(found.registrosProcesados) && found.registrosProcesados.length) {
      found.perRecord = await rebuildPerRecordFromIds(found.registrosProcesados);
    }

    return res.status(200).json({ ok: true, analisis: found });
  } catch (err) {
    console.error('GET /api/AnalisisDiario/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message });
  }
});

/**
 * PUT /api/AnalisisDiario/:id
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok: false, message: 'missing_id' });

    const usuario = req.usuario;
    const resolved = resolveUserId(usuario);
    if (!resolved) return res.status(401).json({ ok: false, message: 'no_autorizado' });

    const existing = await AnalisisModel.findById(id).exec();
    if (!existing) return res.status(404).json({ ok: false, message: 'not_found' });

    if (String(existing.usuarioId) !== String(resolved)) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    const allowed = ['resumenAnalisis', 'registrosProcesados', 'meta', 'CamposSensibles'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    updates.updatedAt = new Date();

    Object.assign(existing, updates);
    await existing.save();

    return res.status(200).json({ ok: true, analisis: existing });
  } catch (err) {
    console.error('PUT /api/AnalisisDiario/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message });
  }
});

/**
 * DELETE /api/AnalisisDiario/:id
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok: false, message: 'missing_id' });

    const usuario = req.usuario;
    const resolved = resolveUserId(usuario);
    if (!resolved) return res.status(401).json({ ok: false, message: 'no_autorizado' });

    const existing = await AnalisisModel.findById(id).exec();
    if (!existing) return res.status(404).json({ ok: false, message: 'not_found' });

    if (String(existing.usuarioId) !== String(resolved)) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    await AnalisisModel.deleteOne({ _id: id }).exec();
    return res.status(200).json({ ok: true, message: 'deleted' });
  } catch (err) {
    console.error('DELETE /api/AnalisisDiario/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message });
  }
});

module.exports = router;
