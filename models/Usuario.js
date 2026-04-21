const mongoose = require('mongoose');
const { Schema } = mongoose;
const bcrypt = require('bcrypt');

const PersonajeSchema = new Schema({
    id: { type: String, default: '' },
    nombre: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, default: {} }
}, { _id: false });

const UsuarioSchema = new Schema({
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    genero: { type: String, default: null },
    pronombres: { type: String, default: null },
    personaje: { type: PersonajeSchema, default: {} },
    meta: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: () => new Date() },
    lastLogin: { type: Date, default: null }
});

// Hacemos que el mail sea único
UsuarioSchema.index({ email: 1 }, { unique: true });

// Comparar contraseña
UsuarioSchema.methods.comparePassword = async function (plain) {
    return bcrypt.compare(plain, this.passwordHash);
};

// Crear usuario con hash de contraseña
UsuarioSchema.statics.createWithPassword = async function ({ nombre, email, password, genero = null, pronombres = null, meta = {} }, saltRounds = 10) {
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const u = new this({
        nombre: String(nombre).trim(),
        email: String(email).toLowerCase().trim(),
        passwordHash,
        genero,
        pronombres,
        meta
    });
    return u.save();
};

module.exports = mongoose.models.Usuario || mongoose.model('Usuario', UsuarioSchema);
