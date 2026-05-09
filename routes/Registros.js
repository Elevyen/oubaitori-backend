const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const RegistroEmocional = require('../models/RegistroEmocional');
const authMiddleware = require('../middleware/auth');
const { encrypt: encryptNota, decrypt: decryptNota } = require('../utils/encriptarNotas');

const MAX_REGISTROS_POR_DIA = 1;

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000));
}

function normalizeEmocion(e) {
  if (!e || typeof e !== 'object') return null;

  const id =
    e.id ??
    e.key ??
    e._id ??
    null;

  const label =
    e.label ??
    e.name ??
    null;

  if (!id || !label) {
    return null;
  }

  return {
    id: String(id).trim(),
    label: String(label).trim(),
    emoji: e.emoji ? String(e.emoji) : '',
    color: e.color ? String(e.color) : '',
    textColor: e.textColor ? String(e.textColor) : '',
    tipo: ['buena', 'mala', 'neutra'].includes(e.tipo)
      ? e.tipo
      : 'neutra'
  };
}

function extractPlainNota(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.nota === undefined || payload.nota === null) {
    return null;
  }
  return payload.nota;
}

// normaliza salida del documento para la API
function formatRegistro(doc, opts = {}) {
  if (!doc) return null;

  const obj = (doc && typeof doc.toObject === 'function') ? doc.toObject() : doc;

  // Asegura que emociones tengan ids como string
  const emociones = Array.isArray(obj.emociones)
    ? obj.emociones.map(e => {
      if (!e || typeof e !== 'object') return e;
      return {
        id: e.id !== undefined ? String(e.id) : (e._id !== undefined ? String(e._id) : ''),
        label: e.label || e.name || '',
        emoji: e.emoji || '',
        color: e.color || '',
        textColor: e.textColor || '',
        tipo: e.tipo || 'neutra'
      };
    })
    : [];

  // Normaliza campos de id a string para evitar ObjectId en el cliente
  const _id = obj && obj._id !== undefined ? String(obj._id) : undefined;
  const registroId = obj && obj.id !== undefined ? String(obj.id) : (_id || undefined);

  // Determinar userId a partir del documento; si el caller pasó reqUser, priorizarlo
  const userIdFromDoc = obj && obj.userId !== undefined ? String(obj.userId) : (obj && obj.usuarioId !== undefined ? String(obj.usuarioId) : undefined);
  const reqUser = opts.reqUser || null;
  const userIdForClient = reqUser && (reqUser.id || reqUser._id) ? String(reqUser.id || reqUser._id) : userIdFromDoc;

  return {
    _id: _id,
    id: registroId,
    userId: userIdForClient,
    fecha: obj.fecha,
    hora: obj.hora,
    emociones: emociones,
    intensidad: obj.intensidad,
    etiquetas: obj.etiquetas || [],
    nota: obj.nota !== undefined ? obj.nota : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    version: obj.version
  };
}

// helpers de fecha usando zona Europe/Madrid (España)

// Convierte "DD-MM-YYYY" a "YYYY-MM-DD" (ISO date string)
function ddmmyyyyToISO(fechaStr) {
  if (!fechaStr || typeof fechaStr !== 'string') return null;
  const m = fechaStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const dd = m[1], mm = m[2], yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`; // "YYYY-MM-DD"
}

// Devuelve la fecha actual en España en formato ISO "YYYY-MM-DD"
function getSpainTodayISO() {
  try {
    const iso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); // "YYYY-MM-DD"
    return String(iso);
  } catch (e) {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

// Convierte "YYYY-MM-DD" a Date (UTC midnight)
function isoToDateUTC(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return null;
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
}

// devuelve true si fechaStr está dentro de los últimos 6 días + hoy (7 días en total) según hora de España
function isWithinLast7Days(fechaStr) {
  const isoTarget = ddmmyyyyToISO(fechaStr);
  if (!isoTarget) return false;

  const todayISO = getSpainTodayISO(); // "YYYY-MM-DD"
  const dateToday = isoToDateUTC(todayISO);
  const dateTarget = isoToDateUTC(isoTarget);
  if (!dateToday || !dateTarget) return false;

  const diffMs = dateToday.getTime() - dateTarget.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= 6;
}

// devuelve true si fechaStr es exactamente hoy en España
function isTodayDDMMYYYY(fechaStr) {
  const isoTarget = ddmmyyyyToISO(fechaStr);
  if (!isoTarget) return false;
  const todayISO = getSpainTodayISO();
  return isoTarget === todayISO;
}

// devuelve hoy en formato DD-MM-YYYY según hora de España
function todayDDMMYYYY() {
  const todayISO = getSpainTodayISO(); // "YYYY-MM-DD"
  const [yyyy, mm, dd] = String(todayISO).split('-');
  return `${dd}-${mm}-${yyyy}`;
}

function sanitizeEtiquetas(raw = []) {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map(t => String(t || '').trim().toLowerCase()).filter(Boolean)));
}

// Resuelve userId (acepta objeto, string, payload)
function resolveUserId(usuario) {
  if (!usuario) return null;
  if (typeof usuario === 'string') return usuario;
  if (usuario._id) return usuario._id;
  if (usuario.id) return usuario.id;
  if (usuario.payload && (usuario.payload.id || usuario.payload._id)) return usuario.payload.id || usuario.payload._id;
  return null;
}

// Util: convertir a ObjectId de (devuelve ObjectId o null)
function toObjectIdIfValid(value) {
  if (value === null || value === undefined) return null;
  try {
    if (typeof value === 'object') {
      if (value._bsontype === 'ObjectID' || value._bsontype === 'ObjectId') return value;
      if (value.constructor && (value.constructor.name === 'ObjectID' || value.constructor.name === 'ObjectId')) return value;
    }
  } catch (e) { }
  const asString = String(value);
  if (mongoose.isValidObjectId(asString)) {
    return new mongoose.Types.ObjectId(asString);
  }
  return null;
}

/* GET /api/registros?month=YYYY-MM
*   Devuelve registros del usuario autenticado para el mes indicado.
*   Nota: el modelo guarda fecha en DD-MM-YYYY,  convertimos con regex ^\\d{2}-MM-YYYY
*/
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const usuario = req.usuario;
    const userIdRaw = resolveUserId(usuario); // Obtén el ID de usuario
    if (!userIdRaw)
      return res.status(401).json({ ok: false, error: 'No autorizado' });

    const month = String(req.query.month || '').trim(); // Esperamos MM-YYYY
    const filter = {};
    const userIdObj = toObjectIdIfValid(userIdRaw);
    if (userIdObj) {
      filter.userId = userIdObj;
    } else {
      filter.userId = String(userIdRaw);
    }

    // Valida el formato MM-YYYY
    if (/^\d{2}-\d{4}$/.test(month)) {
      const [mm, yyyy] = month.split('-');
      // Filtro por fecha en formato DD-MM-YYYY que inicie con el mes y año
      filter.fecha = { $regex: `^\\d{2}-${mm}-${yyyy}` };
    } else if (month !== '') {
      // Error si el mes tiene formato inválido
      return res.status(400).json({
        ok: false,
        error: 'Formato mes invalido',
        message: 'El formato del mes debe ser MM-YYYY (ej: 05-2026).'
      });
    }

    const docs = await RegistroEmocional.find(filter)
      .sort({ fecha: -1, createdAt: -1 }) // Ordena por nueva fecha
      .lean()
      .exec();

    // Desencripta las notas solo si el usuario es dueño de los registros
    try {
      const resolvedUserId = resolveUserId(req.usuario);
      const authId = resolvedUserId ? String(resolvedUserId) : null;

      if (authId && Array.isArray(docs)) {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          const usuariosCandidatos = [
            doc && doc.userId,
            doc && doc.usuarioId,
            doc && doc.user,
            doc && doc.usuario
          ]
            .filter(Boolean)
            .map(v => String(v)); // Convierte a string

          const isOwner =
            usuariosCandidatos.length > 0 &&
            authId &&
            usuariosCandidatos.includes(authId);

          if (isOwner) {
            if (doc.notaEncrypted) {
              try {
                const maybePromise = decryptNota(doc.notaEncrypted);
                doc.nota =
                  maybePromise && typeof maybePromise.then === 'function'
                    ? await maybePromise
                    : maybePromise;
              } catch (e) {
                console.warn(
                  'decryptNota falló para id:',
                  doc._id || doc.id,
                  e.message || e
                );
                doc.nota = null;
              }
            } else {
              doc.nota = null;
            }
            // Protege el campo de notas cifradas
            delete doc.notaEncrypted;
          } else {
            // Elimina campos sensibles para no propietarios
            delete doc.nota;
            delete doc.notaEncrypted;
          }
        }
      }
    } catch (e) {
      console.warn('Advertencia al desencriptar notas:', e.message || e);
    }

    return res.json({ ok: true, registros: docs.map(d => formatRegistro(d, { reqUser: req.usuario })) });
  } catch (err) {
    console.error('GET /api/registros error:', err.stack || err);
    return res
      .status(500)
      .json({ ok: false, error: 'Error servidor', message: err.message });
  }
});
// GET /api/registros/fecha/:fecha  -> devuelve registro del usuario para esa fecha (DD-MM-YYYY)
router.get('/fecha/:fecha', authMiddleware, async (req, res) => {
  try {
    const fecha = String(req.params.fecha || '').trim();
    if (!/^\d{2}-\d{2}-\d{4}$/.test(fecha)) {
      return res.status(400).json({ ok: false, error: 'Fecha invalida' });
    }

    const usuarioRaw = resolveUserId(req.usuario);
    if (!usuarioRaw) return res.status(401).json({ ok: false, error: 'No autorizado' });

    const userIdObj = toObjectIdIfValid(usuarioRaw);
    const filterBase = { fecha };
    if (userIdObj) filterBase.userId = userIdObj;
    else filterBase.userId = String(usuarioRaw);

    const found = await RegistroEmocional.findOne({
      $or: [
        filterBase,
        Object.assign({}, filterBase, { usuarioId: String(usuarioRaw) })
      ]
    }).lean().exec();

    if (!found) return res.status(404).json({ ok: false, message: 'No encontrado' });

    // desencriptar nota solo si owner
    const resolvedUserId = resolveUserId(req.usuario);
    const authId = resolvedUserId ? String(resolvedUserId) : null;
    const usuariosCandidatos = [found.userId, found.usuarioId, found.user, found.usuario].filter(Boolean).map(v => String(v));
    const isOwner = authId && usuariosCandidatos.length > 0 && usuariosCandidatos.includes(authId);

    if (isOwner) {
      if (!Object.prototype.hasOwnProperty.call(found, 'notaEncrypted')) found.notaEncrypted = null;
      try {
        const maybePromise = decryptNota(found.notaEncrypted);
        found.nota = (maybePromise && typeof maybePromise.then === 'function') ? await maybePromise : maybePromise;
      } catch (e) {
        found.nota = null;
      }
      delete found.notaEncrypted;
    } else {
      delete found.nota;
      delete found.notaEncrypted;
    }

    const responseRegistro = formatRegistro(found, { reqUser: req.usuario });
    responseRegistro.isToday = isTodayDDMMYYYY(found.fecha);

    return res.json({ ok: true, registro: responseRegistro });
  } catch (err) {
    console.error('GET /api/registros/fecha/:fecha error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'Error servidor', detail: String(err) });
  }
});
// GET /api/registros/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ ok: false, message: 'ID no encontrado' });

    // construir filtros
    const filters = [];
    if (mongoose.isValidObjectId(rawId)) {
      try { filters.push({ _id: new mongoose.Types.ObjectId(rawId) }); } catch (e) { }
    }
    filters.push({ id: rawId }, { uuid: rawId }, { externalId: rawId });

    // búsqueda principal
    let found = await RegistroEmocional.findOne({ $or: filters }).lean().exec();

    // fallback: si no encontrado y rawId parece ObjectId, buscar por la cadena en campos textuales
    if (!found && mongoose.isValidObjectId(rawId)) {
      const rawStr = String(rawId);
      found = await RegistroEmocional.findOne({
        $or: [{ id: rawStr }, { userId: rawStr }]
      }).lean().exec();
    }

    if (!found) {
      return res.status(404).json({ ok: false, message: 'No encontrado' });
    }

    const resolvedUserId = resolveUserId(req.usuario);
    const authId = resolvedUserId ? String(resolvedUserId) : null;
    const usuariosCandidatosRaw = [
      found.userId, found.usuarioId, found.user, found.usuario
    ];
    const usuariosCandidatos = usuariosCandidatosRaw.filter(Boolean).map(v => {
      try { return String(v); } catch { return '' + v; }
    }).filter(Boolean);

    if (authId && usuariosCandidatos.length > 0 && !usuariosCandidatos.includes(authId)) {
      return res.status(403).json({ ok: false, message: 'Error 403' });
    }
    if (authId && usuariosCandidatos.length === 0) {
      console.warn('ownership check no owner field found for id:', rawId);
      return res.status(403).json({ ok: false, message: 'Error 403' });
    }

    // desencripta nota para owner y eliminar ciphertext antes de devolver
    const isOwner = authId && usuariosCandidatos.length > 0 && usuariosCandidatos.includes(authId);
    if (isOwner) {
      if (!Object.prototype.hasOwnProperty.call(found, 'notaEncrypted')) found.notaEncrypted = null;
      try {
        const maybePromise = decryptNota(found.notaEncrypted);
        found.nota = (maybePromise && typeof maybePromise.then === 'function') ? await maybePromise : maybePromise;
      } catch (e) {
        console.warn('decryptNota failed for id:', rawId, e && e.message ? e.message : e);
        found.nota = null;
      }
      delete found.notaEncrypted;
    } else {
      delete found.nota;
      delete found.notaEncrypted;
    }

    return res.status(200).json({ ok: true, registro: formatRegistro(found, { reqUser: req.usuario }) });
  } catch (err) {
    console.error('GET /api/registros/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'Error servidor', detail: err.message || String(err) });
  }
});

// POST /api/registros
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const usuarioRaw = resolveUserId(req.usuario);
    if (!usuarioRaw) return res.status(401).json({ ok: false, error: 'No autorizado' });

    // valida y convertir userId (modelo espera ObjectId)
    let userIdForSave = toObjectIdIfValid(usuarioRaw);
    if (!userIdForSave) {
      // si no es ObjectId válido, lo guardamos como string
      userIdForSave = String(usuarioRaw);
      console.warn('userId no es ObjectId válido, se guardará como string:', usuarioRaw);
    }

    // validaciones fecha en DD-MM-YYYY (modelo)
    let fechaInput = payload.fecha;
    if (fechaInput instanceof Date) {
      const iso = fechaInput.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); // YYYY-MM-DD
      const [yyyy, mm, dd] = String(iso).split('-');
      fechaInput = `${dd}-${mm}-${yyyy}`;
    }
    if (!fechaInput || !/^\d{2}-\d{2}-\d{4}$/.test(String(fechaInput))) {
      return res.status(400).json({ ok: false, error: 'Fecha requerida', message: 'Campo fecha requerido (DD-MM-YYYY).' });
    }

    // validar que la fecha esté dentro de los 7 días permitidos
    if (!isWithinLast7Days(fechaInput)) {
      return res.status(400).json({ ok: false, error: 'Solo se permiten los últimos 7 días', message: 'Solo se permiten registros del día actual y los 6 días anteriores.' });
    }

    const intensidad = Number(payload.intensidad ?? 0);
    if (isNaN(intensidad) || intensidad < 0 || intensidad > 10) {
      return res.status(400).json({ ok: false, error: 'Intensidad incorrecta' });
    }

    if (payload.nota && String(payload.nota).length > 2000) {
      return res.status(400).json({ ok: false, error: 'Nota muy larga' });
    }

    // normaliza emociones
    const emocionesRaw = Array.isArray(payload.emociones) ? payload.emociones : [];
    const emociones = emocionesRaw
      .map(normalizeEmocion)
      .filter(Boolean);

    // extrae texto de nota desde variantes (nota, note, noteText, text)
    let notaEncrypted = null;
    // Prioriza el valor que llega cifrado, si está
    if (payload.notaEncrypted) {
      notaEncrypted = payload.notaEncrypted;
    } else {
      // Si el frontend no cifra, cifra en backend
      const plainNota = extractPlainNota(payload);
      const notaText = plainNota !== null ? String(plainNota) : '';
      try {
        if (notaText !== '') {
          const maybePromise = encryptNota(String(notaText));
          notaEncrypted = (maybePromise && typeof maybePromise.then === 'function') ? await maybePromise : maybePromise;
        } else {
          notaEncrypted = null;
        }
      } catch (e) {
        console.error('POST /api/registros - encryptNota error:', e && e.message ? e.message : e);
        return res.status(500).json({ ok: false, error: 'Error de encriptado', message: 'Error en encriptación de la nota', detalle: String(e) });
      }
    }
    // Normalizar payload y extraer registroId
    const idFromBody = payload.id ?? payload._id ?? null;
    const idFromParams = req.params && req.params.id ? String(req.params.id).trim() : null;
    const registroId = idFromBody || idFromParams || undefined;

    const safePayload = {
      userId: userIdForSave,
      fecha: fechaInput,
      hora: payload.hora ? new Date(payload.hora) : new Date(),
      emociones,
      intensidad,
      etiquetas: Array.isArray(payload.etiquetas)  ? payload.etiquetas  : [],
      notaEncrypted: notaEncrypted ?? null,
      version: payload.version || 1
    };

    if (typeof registroId !== 'undefined' && registroId !== null && String(registroId).trim() !== '') {
      safePayload.id = String(registroId);
    }

    // compatibilidad con índices antiguos que usen usuarioId
    try {
      safePayload.usuarioId = (userIdForSave && userIdForSave.toString) ? String(userIdForSave) : userIdForSave;
    } catch (e) {
      safePayload.usuarioId = userIdForSave;
    }

    // --- comprobar si ya existe registro para este user+fecha ---
    // --- comprobar si ya existe registro para este user+fecha ---
    const existing = await RegistroEmocional.findOne({
      $or: [
        { userId: userIdForSave },
        { usuarioId: String(userIdForSave) },
        { userId: String(userIdForSave) }
      ],
      fecha: fechaInput
    }).lean().exec();

    if (existing) {
      const existingFecha = existing.fecha || fechaInput;
      const isExistingToday = isTodayDDMMYYYY(existingFecha);

      if (isExistingToday) {
        const updateFields = {
          hora: safePayload.hora,
          emociones: safePayload.emociones,
          intensidad: safePayload.intensidad,
          etiquetas: safePayload.etiquetas,
          notaEncrypted: safePayload.notaEncrypted,
          version: safePayload.version,
          updatedAt: new Date()
        };

        const updated = await RegistroEmocional.findOneAndUpdate(
          { _id: existing._id },
          { $set: updateFields },
          { returnDocument: 'after', new: true, lean: true }
        ).exec();

        if (updated && updated.notaEncrypted) {
          try {
            const maybe = decryptNota(updated.notaEncrypted);
            updated.nota = (maybe && typeof maybe.then === 'function') ? await maybe : maybe;
          } catch (e) {
            updated.nota = null;
          }
        }

        return res.status(200).json({ ok: true, registro: formatRegistro(updated, { reqUser: req.usuario }) });
      }

      // Si existe y no es hoy, devolvemos 409 con info (no editable)
      return res.status(409).json({
        ok: false,
        error: 'Límite día',
        message: 'Ya existe un registro para ese día.',
        detalle: {
          id: existing.id || String(existing._id),
          fecha: existingFecha,
          isToday: !!isExistingToday
        }
      });
    }

    const doc = new RegistroEmocional(safePayload);
    try {
      await doc.save();
      const out = doc.toObject ? doc.toObject() : doc;
      if (out._id) out.id = String(out._id);
      return res.status(201).json({ ok: true, registro: formatRegistro(out, { reqUser: req.usuario }) });

    } catch (errSave) {
      console.error('POST /api/registros - save error:', errSave && errSave.stack ? errSave.stack : errSave);

      // Detección de error de clave duplicada (Mongo E11000) fallback
      if (isDuplicateKeyError(errSave) || (errSave && (errSave.code === 11000 || errSave.code === 11001))) {
        console.warn('Duplicate key on create:', errSave.keyValue || errSave.message || errSave);
        return res.status(409).json({
          ok: false,
          error: 'Límite día',
          message: 'Ya existe un registro para ese día.',
          detalle: errSave.keyValue || errSave.message || null
        });
      }

      if (errSave.name === 'ValidationError') {
        return res.status(400).json({ ok: false, error: 'validation', details: errSave.errors });
      }

      throw errSave;
    }
  } catch (err) {
    console.error('CRÍTICO POST /api/registros error completo:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      ok: false,
      error: 'Error servidor',
      message: err.message || 'Error servidor',
      detalle: err.stack || String(err)
    });
  }
});

// PUT /api/registros/:id actualizar registro (solo si pertenece al usuario)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ ok: false, message: 'No se encuentra ID' });

    const resolvedUserId = resolveUserId(req.usuario);
    if (!resolvedUserId) return res.status(401).json({ ok: false, message: 'No autorizado' });

    // construir filtros para localizar el documento por id
    const filters = [];
    if (mongoose.isValidObjectId(rawId)) {
      try {
        filters.push({ _id: new mongoose.Types.ObjectId(rawId) });
      } catch (e) {
        console.warn('No se pudo convertir rawId a ObjectId, usando filtros por string:', rawId, e && e.message ? e.message : e);
      }
    }
    filters.push({ id: rawId });
    filters.push({ uuid: rawId });
    filters.push({ externalId: rawId });


    const found = await RegistroEmocional.findOne({ $or: filters }).lean().exec();
    if (!found) return res.status(404).json({ ok: false, message: 'No se encontró' });

    // Normalizar candidatos a owner y authId a string
    const authId = resolvedUserId ? String(resolvedUserId) : null;
    const usuariosCandidatosRaw = [
      found.userId,
      found.usuarioId,
      found.user && found.user._id,
      found.usuario && found.usuario._id,
      found.usuarioId && String(found.usuarioId),
      found.userId && String(found.userId)
    ].filter(Boolean);
    const usuariosCandidatos = usuariosCandidatosRaw.map(v => String(v));

    if (authId && usuariosCandidatos.length > 0 && !usuariosCandidatos.includes(authId)) {
      return res.status(403).json({ ok: false, message: 'Error 403' });
    }

    // Solo permitir editar si el registro corresponde al día actual
    if (!isTodayDDMMYYYY(found.fecha)) {
      return res.status(403).json({ ok: false, message: 'Solo se puede editar el registro del día actual.' });
    }

    // Construir objeto de actualización con campos permitidos
    const allowed = ['fecha', 'hora', 'emociones', 'intensidad', 'nota', 'etiquetas', 'version'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        updates[k] = req.body[k];
      }
    }

    if (Array.isArray(updates.emociones)) {
      updates.emociones = updates.emociones
        .map(normalizeEmocion)
        .filter(Boolean);
    }
    updates.updatedAt = new Date();

    // Control para nota cifrada (prioriza una ya cifrada)
    if (req.body.notaEncrypted !== undefined) {
      updates.notaEncrypted = req.body.notaEncrypted;
      updates.nota = null; // nunca guardes el texto plano
    } else if (req.body.nota !== undefined) {
      const plainNota = extractPlainNota(req.body);
      try {
        if (plainNota !== null && plainNota !== undefined && String(plainNota).length > 0) {
          const maybePromise = encryptNota(String(plainNota));
          updates.notaEncrypted = (maybePromise && typeof maybePromise.then === 'function') ? await maybePromise : maybePromise;
          updates.nota = null;
        } else {
          updates.notaEncrypted = null;
          updates.nota = null;
        }
      } catch (e) {
        console.error('encryptNota error on update:', e && e.message ? e.message : e);
        return res.status(500).json({ ok: false, error: 'Error encriptado.', detalle: String(e) });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, message: 'Sin campos actualizados.' });
    }

    // Ejecutar findOneAndUpdate sin upsert; usar returnDocument: 'after'
    const opts = { returnDocument: 'after', lean: true, upsert: false };
    const finalFilter = { $or: filters };
    const updated = await RegistroEmocional.findOneAndUpdate(finalFilter, { $set: updates }, opts).exec();

    if (!updated) {
      const foundAny = await RegistroEmocional.findOne({ $or: filters }).lean().exec();
      if (foundAny) return res.status(403).json({ ok: false, message: 'Error 403' });
      return res.status(404).json({ ok: false, message: 'Error 404' });
    }

    return res.status(200).json({ ok: true, registro: updated });
  } catch (err) {
    console.error('PUT /api/registros/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, message: 'Error servidor', detalle: err.message || String(err) });
  }
});

// POST /api/registros/sincronizar procesar pendientes (items: [])
router.post("/sincronizar", authMiddleware, async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.json({ ok: true, actualizados: [], rechazados: [] });

    const usuarioIdRaw = resolveUserId(req.usuario);
    if (!usuarioIdRaw) return res.status(401).json({ ok: false, error: 'No autorizado' });

    const usuarioIdObj = toObjectIdIfValid(usuarioIdRaw);
    const usuarioIdForFilter = usuarioIdObj ? usuarioIdObj : String(usuarioIdRaw);

    const results = { actualizados: [], rechazados: [] };

    function extractPlainNotaLocal(payload) {
      if (!payload || typeof payload !== 'object') {
        return null;
      }
      if (payload.nota === undefined || payload.nota === null) {
        return null;
      }
      return payload.nota;
    }

    for (const it of items) {
      try {
        // valida fecha: aceptar Date, luego valida DD-MM-YYYY
        const fechaRaw = typeof normalizeFecha === 'function' ? normalizeFecha(it.fecha) : it.fecha;
        let fecha = fechaRaw;
        if (fecha instanceof Date) {
          const iso = fecha.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); // "YYYY-MM-DD"
          const [yyyy, mm, dd] = String(iso).split('-');
          fecha = `${dd}-${mm}-${yyyy}`;
        }
        if (!fecha || !/^\d{2}-\d{2}-\d{4}$/.test(String(fecha))) {
          results.rechazados.push({ item: it, reason: "Fecha invalida" });
          continue;
        }

        const horaVal = it.hora ? new Date(it.hora) : new Date();
        const emociones = Array.isArray(it.emociones) ? it.emociones.map(normalizeEmocion).filter(Boolean) : [];
        const intensidad = typeof it.intensidad !== 'undefined' ? it.intensidad : null;
        const etiquetas = Array.isArray(it.etiquetas) ? it.etiquetas : [];

        // Nota: aceptar notaEncrypted si viene; si viene nota en texto plano, encriptar aquí
        const entradaNotaEncrypted = it.notaEncrypted || null;
        const plainNota = extractPlainNotaLocal(it);
        let guardarNotaEncrypted = null;

        try {
          if (entradaNotaEncrypted) {
            guardarNotaEncrypted = entradaNotaEncrypted;
          } else if (plainNota !== null && plainNota !== undefined) {
            const maybePromise = encryptNota(String(plainNota));
            guardarNotaEncrypted = (maybePromise && typeof maybePromise.then === 'function') ? await maybePromise : maybePromise;
          } else {
            guardarNotaEncrypted = null;
          }
        } catch (encErr) {
          console.error('Error encriptando nota al sincronizar:', encErr && encErr.message ? encErr.message : encErr);
          results.rechazados.push({ item: it, reason: "encryption_error", detail: String(encErr) });
          continue;
        }

        // Upsert por userId+fecha: busca por userId y fecha; si existe actualiza, si no crea
        const filter = { userId: usuarioIdForFilter, fecha };
        const update = {
          $set: {
            hora: horaVal,
            emociones,
            intensidad,
            etiquetas,
            notaEncrypted: guardarNotaEncrypted
          }
        };

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
    return res.status(500).json({ ok: false, error: "Error servidor", detalle: String(err) });
  }
});

module.exports = router;
