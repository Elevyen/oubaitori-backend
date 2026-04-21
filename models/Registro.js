const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Sub-esquema para chip de emoción (id, color y emoji)
 */
const EmocionChipSchema = new Schema({
    id: { type: String, required: true, trim: true },
    emoji: { type: String, default: '' },
    color: { type: String, default: '' }
}, { _id: false });

/**
 * Sub-esquema para usuario (nombre, mail)
 */
const UsuarioSchema = new Schema({
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true }
}, { _id: false });

/**
 * Schema principal de Registro
 */
const RegistroSchema = new Schema({
    usuario: { type: UsuarioSchema, required: true },

    fecha: { type: String, default: '' },

    // Fecha (para buscar rango para análisis últimos días)
    fechaISO: { type: Date, default: () => new Date() },

    // Etiquetas
    etiquetas: { type: [String], default: [] },

    emociones: { type: [EmocionChipSchema], default: [] },

    intensidad: { type: Number, min: 0, max: 10, default: null },

    nota: { type: String, maxlength: 1000, default: '' },

    meta: { type: Schema.Types.Mixed, default: {} },

    createdAt: { type: Date, default: () => new Date() }
});

// Índices para acelerar busqueda por usuario y fecha
RegistroSchema.index({ 'usuario.email': 1, createdAt: 1 });
RegistroSchema.index({ fechaISO: 1 });

module.exports = mongoose.models.Registro || mongoose.model('Registro', RegistroSchema);
