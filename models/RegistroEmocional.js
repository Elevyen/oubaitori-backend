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
  id: { type: String, required: false},
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', index: true, required: true },

  // fecha en formato DD-MM-YYYY
  fecha: {
    type: String,
    required: true,
    index: true,
    validate: {
      validator: v => /^\d{2}-\d{2}-\d{4}$/.test(String(v || '')),
      message: props => `${props.value} no es una fecha válida (esperado DD-MM-YYYY)`
    }
  },
  hora: { type: Date, default: Date.now },
  emociones: { type: [EmocionSchema], default: [] },
  intensidad: { type: Number, min: 0, max: 10, default: 0 },
  etiquetas: { type: [String], default: [] },
  notaEncrypted: { type: String, default: null },

  version: { type: Number, default: 1 }
}, {
  collection: 'registros_emocionales',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

RegistroEmocionalSchema.index({ userId: 1, fecha: 1 }, { background: true });
RegistroEmocionalSchema.index({ id: 1 }, { background: true });

/*
 * Pre-save hook:
 * - Asegurar que id exista (copiar desde _id si falta)
 */
RegistroEmocionalSchema.pre('save', function (next) {
  try {
    // Normaliza etiquetas
    if (Array.isArray(this.etiquetas)) {
      this.etiquetas = Array.from(
        new Set(
          this.etiquetas
            .map(t => String(t || '').trim().toLowerCase())
            .filter(Boolean)
        )
      );
    } else {
      this.etiquetas = [];
    }

    // Asegura que emociones es array y normaliza elementos
    if (!Array.isArray(this.emociones)) this.emociones = [];
    const allowedKeys = ['id', 'label', 'emoji', 'color', 'textColor', 'tipo'];
    this.emociones = this.emociones
      .filter(e => e && (e.id || e.label))
      .map(e => {
        const out = {};
        for (const k of allowedKeys) {
          if (Object.prototype.hasOwnProperty.call(e, k) && e[k] !== undefined && e[k] !== null) {
            out[k] = e[k];
          }
        }
        if (out.id && typeof out.id !== 'string') out.id = String(out.id);
        if (!out.id && out.label) out.id = String(out.label).toLowerCase().replace(/\s+/g, '_');
        if (!out.label && out.id) out.label = String(out.id);
        if (!out.tipo) out.tipo = 'neutra';
        return out;
      });

    // Si fecha viene como Date, convertir a DD-MM-YYYY
    if (this.fecha && this.fecha instanceof Date) {
      const d = this.fecha;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      this.fecha = `${dd}-${mm}-${yyyy}`;
    }

    // Asegurar id principal como string; si no existe, usar _id (si ya generado)
    if (this.id && typeof this.id !== 'string') this.id = String(this.id);
    if ((!this.id || String(this.id).trim() === '') && this._id) {
      this.id = String(this._id);
    }
  } catch (err) {
    console.warn('Registro Emocional pre-save normalization error:', err && err.message ? err.message : err);
  }


  if (typeof next === 'function') return next();
  return;
});

module.exports = mongoose.model('RegistroEmocional', RegistroEmocionalSchema);
