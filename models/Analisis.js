const mongoose = require('mongoose');
const { Schema } = mongoose;

const AnalisisSchema = new Schema({
  usuarioId: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true
  },
  fechaClave: {
    type: String,
    required: true
  },
  resumen: {
    type: Schema.Types.Mixed,
    required: true
  },
  creadoEn: {
    type: Date,
    default: Date.now
  },
  actualizadoEn: {
    type: Date,
    default: Date.now
  }
});

AnalisisSchema.index(
  {
    usuarioId: 1,
    fechaClave: 1
  },
  {
    unique: true
  }
);

module.exports =
  mongoose.models.Analisis ||
  mongoose.model(
    'analisisEmocional',
    AnalisisSchema
  );