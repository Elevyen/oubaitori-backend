const mongoose = require('mongoose');

const ContactoSchema = new mongoose.Schema({
    usuarioId: { type: String, default: null, index: true },
    email: { type: String, required: true, maxlength: 254 }, // email del remitente
    tipo: { type: String, enum: ['sugerencia', 'incidencia'], required: true },
    titulo: { type: String, required: true, maxlength: 200 },
    mensaje: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: true },
    // Notificación por correo
    notified: { type: Boolean, default: false },
    notifiedAt: { type: Date, default: null },
    // Estado de resolución para administración
    resuelto: { type: Boolean, default: false, index: true },
    resueltoAt: { type: Date, default: null },
    // Contadores y errores de envío
    mailAttempts: { type: Number, default: 0 },
    mailError: { type: String, default: null },
    lastMailErrorAt: { type: Date, default: null },
    meta: {
        ip: { type: String, default: null },
        userAgent: { type: String, default: null }
    }
}, { collection: 'contactoINC_SG' });

module.exports = mongoose.model('Contacto', ContactoSchema);
