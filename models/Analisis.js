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
    fechaClave: {
      type: String,
      required: true,
      validate: {
        validator: v => /^\d{2}-\d{2}-\d{4}$/.test(String(v || '')),
        message: props =>
          `${props.value} no es una fecha válida (DD-MM-YYYY)`
      }
    },
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