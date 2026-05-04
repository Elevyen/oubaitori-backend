const mongoose = require('mongoose');

const PendingUserSchema = new mongoose.Schema({
    pendingToken: { type: String, required: true, unique: true },
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    genero: { type: String, default: null },
    pronombres: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
});

module.exports = mongoose.models.PendingUser || mongoose.model('PendingUser', PendingUserSchema);
