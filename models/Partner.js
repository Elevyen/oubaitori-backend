const mongoose = require('mongoose');
const { Schema } = mongoose;

const PartnerSchema = new Schema({
    key: { type: String, required: true, unique: true },
    nombre: { type: String, required: true },
    slug: { type: String, default: '' },
    descripcion: { type: String, default: '' },
    imagen: { type: String, default: '' }, // url o path
    meta: { type: Schema.Types.Mixed, default: {} },
    activo: { type: Boolean, default: true },
    orden: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Partner', PartnerSchema);
