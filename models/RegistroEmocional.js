const mongoose = require('mongoose');

const EmocionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  emoji: { type: String, default: '' },
  color: { type: String, default: '' },
  textColor: { type: String, default: '' },
  tipo: { type: String, enum: ['buena', 'mala', 'neutra'], default: 'neutra' }
}, { _id: false });

const RegistroEmocionalSchema = new mongoose.Schema({
  // id que puede venir del cliente o del servidor
  id: { type: String, required: true },

  // Conservamos userId como ObjectId por compatibilidad añadimos usuarioId (string)
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', index: true, required: false },
  usuarioId: { type: String, required: false, index: true },

  fecha: {
    type: String,
    required: true,
    index: true,
    validate: {
      validator: v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')),
      message: props => `${props.value} no es una fecha válida (esperado YYYY-MM-DD)`
    }
  },
  hora: { type: Date, default: Date.now },
  emociones: { type: [EmocionSchema], default: [] },
  intensidad: { type: Number, min: 0, max: 10, default: 0 },
  etiquetas: { type: [String], default: [] },
  notaEncrypted: { type: String, default: null },
  notaHash: { type: String, maxlength: 128, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  version: { type: Number, default: 1 },
  synced: { type: Boolean, default: true }
}, {
  collection: 'registros_emocionales',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

/**
 * Índices
 *
 * - Índice compuesto único por usuario (string) + fecha para evitar duplicados
 *   en los flujos que usan usuarioId como string.
 * - Mantenemos también un índice por userId (ObjectId) para consultas que usen referencias.
 * - Índice único por id (cliente/servidor) para evitar duplicados por identificador.
 *
 * Usamos `sparse: true` en el índice compuesto para no bloquear documentos
 * que no tengan el campo `usuarioId` (compatibilidad con datos antiguos).
 */
RegistroEmocionalSchema.index({ usuarioId: 1, fecha: 1 }, { unique: true, background: true });
//RegistroEmocionalSchema.index({ usuarioId: 1, fecha: 1 }, { unique: true, sparse: true });
//RegistroEmocionalSchema.index({ userId: 1, fecha: 1 }, { sparse: true });
//RegistroEmocionalSchema.index({ id: 1 }, { unique: true, sparse: true });

// Normalizaciones antes de guardar
RegistroEmocionalSchema.pre('save', async function () {
  // Si existe userId (ObjectId) y no existe usuarioId (string), sincronizar ambos
  try {
    if (this.userId && !this.usuarioId) {
      // Guardar como string para compatibilidad con clientes que comparan strings
      this.usuarioId = String(this.userId);
    } else if (this.usuarioId && !this.userId) {
      // No intentamos convertir string a ObjectId automáticamente porque puede fallar;
      // dejamos userId vacío y usamos usuarioId para las comprobaciones de propiedad.
    }

    // normalizar etiquetas: trim, lowercase, únicas
    if (Array.isArray(this.etiquetas)) {
      this.etiquetas = Array.from(
        new Set(
          this.etiquetas
            .map(t => String(t || '').trim().toLowerCase())
            .filter(Boolean)
        )
      );
    }

    // asegurar emociones válidas (ya validadas por sub-schema)
    if (!Array.isArray(this.emociones)) this.emociones = [];

    // asegurar que id existe y es string
    if (this.id && typeof this.id !== 'string') {
      this.id = String(this.id);
    }

    // asegurar fecha en formato string
    if (this.fecha && this.fecha instanceof Date) {
      const d = this.fecha;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      this.fecha = `${yyyy}-${mm}-${dd}`;
    }
  } catch (err) {
    // No bloquear el save por errores menores de normalización; dejar que el flujo principal
    // maneje errores de validación si los hubiera.
    console.warn('RegistroEmocional pre-save normalization warning:', err && err.message ? err.message : err);
  }
});

module.exports = mongoose.model('RegistroEmocional', RegistroEmocionalSchema);
