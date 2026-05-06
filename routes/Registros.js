const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const RegistroEmocional = require('../models/RegistroEmocional');
const authMiddleware = require('../middleware/auth');
const crypto = require('crypto');
const { encrypt: encryptNota, decrypt: decryptNota } = require('../utils/encriptarNotas');

const MAX_REGISTROS_POR_DIA = 1;

function generarId() {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) {  }
  return crypto.randomBytes(16).toString('hex');
}

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000));
}

function normalizeEmocion(e) {
  if (!e || typeof e !== 'object') return null;
  const tipo = (e.tipo && ['buena', 'mala', 'neutra'].includes(e.tipo)) ? e.tipo : 'neutra';
  return {
    id: String(e.id || e.key || e._id || generarId()),
    label: String(e.label || e.name || 'Desconocida'),
    emoji: e.emoji || '',
    color: e.color || '',
    textColor: e.textColor || '',
    tipo
  };
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}
function extractPlainNota(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [payload.nota, payload.note, payload.noteText, payload.text];
  for (const c of candidates) {
    if (c !== undefined && c !== null) return c;
  }
  return null;
}

// Helper: normalizar salida del documento para la API
function formatRegistro(doc) {
  if (!doc) return null;

  const obj = (doc && typeof doc.toObject === 'function') ? doc.toObject() : doc;

  // Asegurar que emociones tengan ids como string
  const emociones = Array.isArray(obj.emociones)
    ? obj.emociones.map(e => {
      if (!e || typeof e !== 'object') return e;
      return {
        id: e.id !== undefined ? String(e.id) : (e._id !== undefined ? String(e._id) : ''),
        label: e.label || e.name || '',
        emoji: e.emoji || '',
        color: e.color || '',
        textColor: e.textColor || '',
        tipo: e.tipo || null
      };
    })
    : [];

  // Normalizar campos de id a string para evitar ObjectId en el cliente
  const _id = obj._id !== undefined ? String(obj._id) : undefined;
  const id = obj.id !== undefined ? String(obj.id) : (_id || undefined);
  const userId = obj.userId !== undefined ? String(obj.userId) : (obj.usuarioId !== undefined ? String(obj.usuarioId) : undefined);

  return {
    _id: _id,
    id: id,
    userId: userId,
    fecha: obj.fecha,
    hora: obj.hora,
    emociones: emociones,
    intensidad: obj.intensidad,
    etiquetas: obj.etiquetas,
    notaHash: obj.notaHash,
    nota: obj.nota ?? null,
    meta: obj.meta,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    version: obj.version,
    synced: obj.synced
  };
}

// Util: resolver userId (acepta objeto, string, payload)
function resolveUserId(usuario) {
  if (!usuario) return null;
  if (typeof usuario === 'string') return usuario;
  if (usuario._id) return usuario._id;
  if (usuario.id) return usuario.id;
  // si authMiddleware puso el payload del token
  if (usuario.payload && (usuario.payload.id || usuario.payload._id)) return usuario.payload.id || usuario.payload._id;
  return null;
}

// Util: convertir a ObjectId de (devuelve ObjectId o null)
function toObjectIdIfValid(value) {
  if (value === null || value === undefined) return null;

  // Si ya es un objeto que parece un ObjectId de BSON, devolverlo
  try {
    if (typeof value === 'object') {
      if (value._bsontype === 'ObjectID' || value._bsontype === 'ObjectId') return value;
      if (value.constructor && (value.constructor.name === 'ObjectID' || value.constructor.name === 'ObjectId')) return value;
    }
  } catch (e) {  }

  const asString = String(value);

  // Validar con la utilidad de mongoose
  if (mongoose.isValidObjectId(asString)) {
    // Crear con new para evitar el error "cannot be invoked without 'new'"
    return new mongoose.Types.ObjectId(asString);
  }

  return null;
}

// GET /api/registros?month=YYYY-MM
// Devuelve registros del usuario autenticado para el mes indicado
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const usuario = req.usuario;
    const userIdRaw = resolveUserId(usuario);
    if (!userIdRaw) return res.status(401).json({ ok: false, error: 'no_autorizado' });
    const month = String(req.query.month || '').trim();
    const filter = {};
    const userIdObj = toObjectIdIfValid(userIdRaw);
    if (userIdObj) {
      filter.userId = userIdObj;
    } else {
      filter.userId = String(userIdRaw);
    }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      // buscar por fecha que empiece por YYYY-MM
      filter.fecha = { $regex: `^${month}` };
    }
    const docs = await RegistroEmocional.find(filter).sort({ fecha: -1, createdAt: -1 }).lean().exec();

    // Intentar desencriptar notaEncrypted para cada doc solo si el requester es owner
    try {
      const resolvedUserId = resolveUserId(req.usuario);
      const authId = resolvedUserId ? String(resolvedUserId) : null;

      if (authId && Array.isArray(docs)) {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          // recolectar candidatos a owner y normalizarlos a string (evita problemas con ObjectId)
          const ownerCandidates = [
            doc && doc.usuarioId,
            doc && doc.userId,
            doc && doc.usuario,
            doc && doc.user
          ].filter(Boolean).map(v => {
            try { return String(v); } catch { return '' + v; }
          }).filter(Boolean);

          const isOwner = ownerCandidates.length > 0 && authId && ownerCandidates.includes(authId);
          if (isOwner) {
            if (doc.notaEncrypted) {
              try {
                doc.nota = decryptNota(doc.notaEncrypted);
              } catch (e) {
                console.warn('decryptNota failed for list item id', doc._id || doc.id, e && e.message ? e.message : e);
                doc.nota = null;
              }
            } else {
              doc.nota = null;
            }
            // No exponer ciphertext al cliente
            delete doc.notaEncrypted;
          } else {
            // Ocultar campos sensibles para no-owners
            delete doc.nota;
            delete doc.notaEncrypted;
            delete doc.notaHash;
          }
        }
      }
    } catch (e) {
      console.warn('Warning while decrypting notas for list:', e && e.message ? e.message : e);
    }

    return res.json({ ok: true, registros: docs.map(d => formatRegistro(d)) });
  } catch (err) {
    console.error('GET /api/registros error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'error_servidor', message: err.message });
  }
});

// GET /api/registros/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ ok: false, message: 'missing_id' });

    // debug request
    console.debug('GET /api/registros/:id - incoming rawId:', rawId, 'user:', req.usuario && (req.usuario._id || req.usuario.id));

    // construir filtros
    const filters = [];
    if (mongoose.isValidObjectId(rawId)) {
      try { filters.push({ _id: new mongoose.Types.ObjectId(rawId) }); } catch (e) { /* ignore */ }
    }
    filters.push({ id: rawId }, { uuid: rawId }, { externalId: rawId });

    console.debug('GET /api/registros/:id - filters to try:', JSON.stringify(filters));

    // búsqueda principal
    let found = await RegistroEmocional.findOne({ $or: filters }).lean().exec();
    console.debug('GET /api/registros/:id - primary findOne result exists:', !!found);

    // fallback: si no encontrado y rawId parece ObjectId, buscar por la cadena en campos textuales
    if (!found && mongoose.isValidObjectId(rawId)) {
      const rawStr = String(rawId);
      console.debug('GET /api/registros/:id - fallback search by string fields for:', rawStr);
      found = await RegistroEmocional.findOne({
        $or: [{ id: rawStr }, { usuarioId: rawStr }, { userId: rawStr }]
      }).lean().exec();
      console.debug('GET /api/registros/:id - fallback findOne result exists:', !!found);
    }

    if (!found) {
      console.debug('GET /api/registros/:id - not found after all attempts for id:', rawId);
      return res.status(404).json({ ok: false, message: 'not_found' });
    }

    // ownership candidates normalizados
    const resolvedUserId = resolveUserId(req.usuario);
    const authId = resolvedUserId ? String(resolvedUserId) : null;
    const ownerCandidatesRaw = [
      found.usuarioId, found.userId, found.user, found.usuario, found.usuario_id, found.usuarioID
    ];
    const ownerCandidates = ownerCandidatesRaw.filter(Boolean).map(v => {
      try { return String(v); } catch { return '' + v; }
    }).filter(Boolean);

    console.debug('ownership check -> authId:', authId, 'ownerCandidates:', ownerCandidates);

    if (authId && ownerCandidates.length > 0 && !ownerCandidates.includes(authId)) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }
    if (authId && ownerCandidates.length === 0) {
      console.warn('ownership check -> no owner field found for id:', rawId);
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    // desencriptar nota para owner y eliminar ciphertext antes de devolver
    const isOwner = authId && ownerCandidates.length > 0 && ownerCandidates.includes(authId);
    if (isOwner) {
      if (!Object.prototype.hasOwnProperty.call(found, 'notaEncrypted')) found.notaEncrypted = null;
      if (!Object.prototype.hasOwnProperty.call(found, 'notaHash')) found.notaHash = null;
      try {
        found.nota = found.notaEncrypted ? decryptNota(found.notaEncrypted) : null;
      } catch (e) {
        console.warn('decryptNota failed for id:', rawId, e && e.message ? e.message : e);
        found.nota = null;
      }
      delete found.notaEncrypted;
    } else {
      delete found.nota;
      delete found.notaEncrypted;
      delete found.notaHash;
    }

    return res.status(200).json({ ok: true, registro: found });
  } catch (err) {
    console.error('GET /api/registros/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detail: err.message || String(err) });
  }
});

// POST /api/registros
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    console.log('POST /api/registros - headers:', req.headers);
    console.log('POST /api/registros - body:', req.body);
    console.log('POST /api/registros - req.usuario:', req.usuario);

    // helper local para extraer texto de nota
    const payload = req.body || {};
    // resolver usuario
    const usuarioRaw = resolveUserId(req.usuario);
    if (!usuarioRaw) return res.status(401).json({ ok: false, error: 'no_autorizado' });

    // validar y convertir userId si el esquema espera ObjectId
    let userIdForSave = toObjectIdIfValid(usuarioRaw);
    if (!userIdForSave) {
      // si no es ObjectId válido, lo guardamos como string (si tu esquema exige ObjectId, cambia esto)
      userIdForSave = String(usuarioRaw);
      console.warn('userId no es ObjectId válido, se guardará como string:', usuarioRaw);
    }

    // validaciones básicas
    if (!payload.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.fecha))) {
      return res.status(400).json({ ok: false, error: 'falta_fecha', message: 'Campo fecha requerido (YYYY-MM-DD).' });
    }

    const intensidad = Number(payload.intensidad ?? payload.intensity ?? 0);
    if (isNaN(intensidad) || intensidad < 0 || intensidad > 10) {
      return res.status(400).json({ ok: false, error: 'intensidad_invalida' });
    }

    if (payload.nota && String(payload.nota).length > 2000) {
      return res.status(400).json({ ok: false, error: 'nota_demasiado_larga' });
    }

    // normalizar emociones con defensas extra
    const emocionesRaw = Array.isArray(payload.emociones) ? payload.emociones : (Array.isArray(payload.emotions) ? payload.emotions : []);
    const emociones = emocionesRaw
      .map(normalizeEmocion)
      .filter(e => e && e.id && e.label); // asegurar campos mínimos

    // generar id si falta
    const id = payload.id ? String(payload.id) : generarId();

    // EXTRA: extraer texto de nota desde variantes (nota, note, noteText, text)
    const plainNota = extractPlainNota(payload);
    const notaText = plainNota !== null ? String(plainNota) : '';

    // calcular notaHash en servidor (usar sha256Hex si existe, si no fallback a crypto)
    let notaHash = '';
    try {
      if (typeof sha256Hex === 'function') {
        notaHash = notaText ? sha256Hex(notaText) : '';
      } else {
        notaHash = notaText ? crypto.createHash('sha256').update(String(notaText || ''), 'utf8').digest('hex') : '';
      }
    } catch (e) {
      // fallback seguro
      try {
        notaHash = notaText ? crypto.createHash('sha256').update(String(notaText || ''), 'utf8').digest('hex') : '';
      } catch (e2) {
        console.warn('No se pudo calcular notaHash:', e2 && e2.message ? e2.message : e2);
        notaHash = '';
      }
    }

    // normalizar hora: si viene string intentar parsear, si no usar now
    let horaVal = null;
    if (payload.hora) {
      const parsed = new Date(payload.hora);
      horaVal = isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      horaVal = new Date();
    }

    // ENCRIPTAR la nota en servidor y preparar notaEncrypted
    let notaEncrypted = null;
    try {
      if (notaText !== '') {
        // encryptNota lanzará si falta NOTA_MASTER_KEY; capturamos y devolvemos error controlado
        notaEncrypted = encryptNota(String(notaText));
      } else {
        notaEncrypted = null;
      }
    } catch (e) {
      console.error('POST /api/registros - encryptNota error:', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: 'encryption_error', message: 'Error en encriptación de la nota', detalle: String(e) });
    }

    const safePayload = {
      id,
      userId: userIdForSave,
      fecha: payload.fecha,
      hora: horaVal,
      emociones,
      intensidad,
      etiquetas: Array.isArray(payload.etiquetas) ? payload.etiquetas : (Array.isArray(payload.tags) ? payload.tags : []),
      notaHash,
      notaEncrypted,            // guardamos la nota encriptada
      nota: null,               // mantener campo legacy vacío por seguridad (texto plano no se guarda)
      meta: payload.meta || {},
      version: payload.version || 1,
      synced: payload.synced !== undefined ? !!payload.synced : true
    };

    // Intentar guardar con manejo explícito de errores de validación y duplicados
    const doc = new RegistroEmocional(safePayload);
    try {
      await doc.save();
      // devolver objeto limpio
      const out = doc.toObject ? doc.toObject() : doc;
      if (out._id) out.id = String(out._id);
      return res.status(201).json({ ok: true, registro: formatRegistro(out) });
    } catch (errSave) {
      console.error('POST /api/registros - save error:', errSave && errSave.stack ? errSave.stack : errSave);

      // Detección de error de clave duplicada (Mongo E11000)
      if (isDuplicateKeyError(errSave) || (errSave && (errSave.code === 11000 || errSave.code === 11001))) {
        // Intentar devolver información útil: si errSave.keyValue existe, incluirla
        console.warn('Duplicate key on create:', errSave.keyValue || errSave.message || errSave);
        return res.status(409).json({
          ok: false,
          error: 'limite_dia_alcanzado',
          message: 'Ya existe un registro para ese día.',
          detalle: errSave.keyValue || errSave.message || null
        });
      }

      if (errSave.name === 'ValidationError') {
        return res.status(400).json({ ok: false, error: 'validation', details: errSave.errors });
      }

      // Otros errores al guardar: propagar al catch externo para logging centralizado
      throw errSave;
    }
  } catch (err) {
    console.error('CRÍTICO POST /api/registros error completo:', err && err.stack ? err.stack : err);
    // Responder con detalle mínimo para el cliente y loguear stack completo en servidor
    return res.status(500).json({
      ok: false,
      error: 'error_servidor',
      message: err.message || 'internal_server_error',
      detalle: err.stack || String(err)
    });
  }
});

// PUT /api/registros/:id -> actualizar registro (solo si pertenece al usuario)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ ok: false, message: 'missing_id' });

    const resolvedUserId = resolveUserId(req.usuario);
    if (!resolvedUserId) return res.status(401).json({ ok: false, message: 'no_autorizado' });

    // construir filtros para localizar el documento por id
    const filters = [];
    if (mongoose.isValidObjectId(rawId)) filters.push({ _id: rawId });
    filters.push({ id: rawId });
    filters.push({ uuid: rawId });
    filters.push({ externalId: rawId });

    // buscar el documento primero (sin modificar)
    const found = await RegistroEmocional.findOne({ $or: filters }).lean().exec();
    if (!found) return res.status(404).json({ ok: false, message: 'not_found' });

    // Normalizar candidatos a owner y authId a string
    const authId = resolvedUserId ? String(resolvedUserId) : null;
    const ownerCandidatesRaw = [
      found.usuarioId,
      found.userId,
      found.user && found.user._id,
      found.usuario && found.usuario._id,
      found.usuarioId && String(found.usuarioId),
      found.userId && String(found.userId)
    ].filter(Boolean);
    const ownerCandidates = ownerCandidatesRaw.map(v => String(v));

    console.debug('PUT /api/registros/:id ownership check', { rawId, authId, ownerCandidates });

    // Si hay authId y hay candidatos y ninguno coincide -> forbidden
    if (authId && ownerCandidates.length > 0 && !ownerCandidates.includes(authId)) {
      return res.status(403).json({ ok: false, message: 'forbidden' });
    }

    // Construir objeto de actualización con campos permitidos
    const allowed = ['fecha', 'hora', 'emociones', 'intensidad', 'nota', 'etiquetas', 'meta', 'notaHash'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    updates.updatedAt = new Date();

    // Si viene nota en el body, encriptarla y guardar notaEncrypted y notaHash en lugar de texto plano
    if (req.body && (req.body.nota !== undefined || req.body.note !== undefined || req.body.noteText !== undefined || req.body.text !== undefined)) {
      const plainNota = extractPlainNota(req.body);
      try {
        if (plainNota !== null && plainNota !== undefined && String(plainNota).length > 0) {
          updates.notaEncrypted = encryptNota(String(plainNota));
          updates.notaHash = updates.notaHash || sha256Hex(String(plainNota));
          // no guardar texto plano
          updates.nota = null;
        } else {
          // si cliente envía nota vacía, borrar notaEncrypted y notaHash
          updates.notaEncrypted = null;
          updates.notaHash = updates.notaHash || null;
          updates.nota = null;
        }
      } catch (e) {
        console.error('encryptNota error on update:', e && e.message ? e.message : e);
        return res.status(500).json({ ok: false, error: 'encryption_error', detalle: String(e) });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, message: 'no_update_fields' });
    }

    // Ejecutar findOneAndUpdate sin upsert; usar returnDocument: 'after'
    const opts = { returnDocument: 'after', lean: true, upsert: false };
    const finalFilter = { $or: filters }; // ya validamos propiedad arriba
    const updated = await RegistroEmocional.findOneAndUpdate(finalFilter, { $set: updates }, opts).exec();

    if (!updated) {
      // si no se actualizó, comprobar si existe pero pertenece a otro usuario
      const foundAny = await RegistroEmocional.findOne({ $or: filters }).lean().exec();
      if (foundAny) return res.status(403).json({ ok: false, message: 'forbidden' });
      return res.status(404).json({ ok: false, message: 'not_found' });
    }

    return res.status(200).json({ ok: true, registro: updated });
  } catch (err) {
    console.error('PUT /api/registros/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'internal_server_error', detalle: err.message || String(err) });
  }
});

// POST /api/registros/sincronizar -> procesar pendientes (items: [])
// Procesa solo items que pertenezcan al usuario autenticado (seguridad)
// POST /api/registros/sincronizar
router.post("/sincronizar", authMiddleware, async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.json({ ok: true, actualizados: [], rechazados: [] });

    const usuarioId = String(req.usuario._id);
    const results = { actualizados: [], rechazados: [] };

    // helper local para extraer texto de nota desde variantes
    function extractPlainNotaLocal(payload) {
      if (!payload || typeof payload !== 'object') return null;
      const candidates = [payload.nota, payload.note, payload.noteText, payload.text];
      for (const c of candidates) {
        if (c !== undefined && c !== null) return c;
      }
      return null;
    }

    for (const it of items) {
      try {
        const fecha = normalizeFecha(it.fecha);
        if (!fecha) {
          results.rechazados.push({ item: it, reason: "fecha_invalida" });
          continue;
        }
        // No permitir fechas futuras o fuera de ventana
        if (isFutureDate(fecha) || !isWithinLastNDays(fecha, 6)) {
          results.rechazados.push({ item: it, reason: "fecha_fuera_ventana" });
          continue;
        }

        // Preparar campos a setear en el upsert
        const horaVal = it.hora ? new Date(it.hora) : new Date();
        const emociones = Array.isArray(it.emociones) ? it.emociones : [];
        const intensidad = typeof it.intensidad !== 'undefined' ? it.intensidad : null;
        const etiquetas = Array.isArray(it.etiquetas) ? it.etiquetas : [];

        // Nota: aceptar notaEncrypted si viene; si viene nota en texto plano, encriptar aquí
        const incomingNotaEncrypted = it.notaEncrypted || it.notaEncrypted || null;
        const plainNota = extractPlainNotaLocal(it);
        let notaEncryptedToSave = null;
        let notaHashToSave = it.notaHash || null;

        try {
          if (incomingNotaEncrypted) {
            // Si el cliente ya envía notaEncrypted, la usamos tal cual
            notaEncryptedToSave = incomingNotaEncrypted;
            // si no hay notaHash, no podemos calcularlo sin desencriptar; si viene plainNota, calcular hash desde plainNota
            if (!notaHashToSave && plainNota) {
              notaHashToSave = crypto.createHash('sha256').update(String(plainNota || ''), 'utf8').digest('hex');
            }
          } else if (plainNota !== null && plainNota !== undefined) {
            // Encriptar en servidor y calcular hash
            notaEncryptedToSave = encryptNota(String(plainNota));
            notaHashToSave = notaHashToSave || crypto.createHash('sha256').update(String(plainNota || ''), 'utf8').digest('hex');
          } else {
            // no hay nota ni notaEncrypted
            notaEncryptedToSave = null;
            notaHashToSave = notaHashToSave || null;
          }
        } catch (encErr) {
          // Rechazar este item si falla la encriptación (por ejemplo falta NOTA_MASTER_KEY)
          console.error('Error encriptando nota en sincronizar:', encErr && encErr.message ? encErr.message : encErr);
          results.rechazados.push({ item: it, reason: "encryption_error", detail: String(encErr) });
          continue;
        }

        // Upsert por usuarioId+fecha
        const filter = { usuarioId, fecha };
        const update = {
          $set: {
            hora: horaVal,
            emociones,
            intensidad,
            etiquetas,
            notaHash: notaHashToSave,
            notaEncrypted: notaEncryptedToSave,
            meta: it.meta || {}
          }
        };

        // Mantener setDefaultsOnInsert para valores por defecto en el modelo
        const updated = await RegistroEmocional.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
        results.actualizados.push({ fecha, id: updated._id });
      } catch (e) {
        console.error('Error procesando item en sincronizar:', e && e.stack ? e.stack : e);
        results.rechazados.push({ item: it, reason: String(e) });
      }
    }

    return res.json({ ok: true, ...results });
  } catch (err) {
    console.error("POST /api/registros/sincronizar error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: "server_error", detalle: String(err) });
  }
});


module.exports = router;
