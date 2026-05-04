const mongoose = require('mongoose');

const { Schema } = mongoose;
/**
 * Esquema de Análisis
 * @param UsuarioId identificador del usuario
 * @param fechaClave fecha del análisis
 * @param tipo diario o semanal
 * @param tipo diario o semanal
 */
const AnalisisSchema = new Schema({
  usuarioId: { type: Schema.Types.ObjectId, required: true, index: true },
  fechaClave: { type: String, required: true },
  tipo: { type: String, enum: ['diario', 'semanal'], default: 'diario' },
  registrosProcesados: { type: [Schema.Types.ObjectId], default: [] }, // IDs sin hash
  CamposSensibles: { type: [String], default: [] },
  hashAnalisis: { type: String, required: true },
  resumenAnalisis: { type: Schema.Types.Mixed },
  creadoEn: { type: Date, default: Date.now },
  meta: { type: Schema.Types.Mixed }
});

// Índice único por usuario/fecha/tipo
AnalisisSchema.index({ usuarioId: 1, fechaClave: 1, tipo: 1 }, { unique: true });

/**
 * Transformación global para toObject / toJSON
 * Convierte ObjectId y arrays de ObjectId a strings para evitar que el cliente reciba objetos BSON.
 */
function objectIdToString(val) {
  if (val === undefined || val === null) return val;
  try {
    if (Array.isArray(val)) {
      return val.map((v) => (v && typeof v.toString === 'function' ? String(v.toString()) : v));
    }
    return (val && typeof val.toString === 'function') ? String(val.toString()) : val;
  } catch {
    return val;
  }
}

AnalisisSchema.set('toObject', {
  transform(doc, ret) {
    // convierte _id si existe
    if (ret._id !== undefined) ret._id = objectIdToString(ret._id);
    // convierte usuarioId
    if (ret.usuarioId !== undefined) ret.usuarioId = objectIdToString(ret.usuarioId);
    // convierte registrosProcesados (array de ObjectId)
    if (ret.registrosProcesados !== undefined) ret.registrosProcesados = objectIdToString(ret.registrosProcesados);
    // mantener el resto de campos
    return ret;
  }
});

AnalisisSchema.set('toJSON', {
  transform(doc, ret) {
    // aplica la misma normalización que toObject pero a string (json realmente)
    if (ret._id !== undefined) ret._id = objectIdToString(ret._id);
    if (ret.usuarioId !== undefined) ret.usuarioId = objectIdToString(ret.usuarioId);
    if (ret.registrosProcesados !== undefined) ret.registrosProcesados = objectIdToString(ret.registrosProcesados);
    return ret;
  }
});

module.exports = mongoose.models.Analisis || mongoose.model('analisisEmocional', AnalisisSchema);
