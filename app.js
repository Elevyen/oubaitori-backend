require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { spainDateTime } = require('./utils/date');
const { conexionBD, desconectarBD } = require('./config/mongodb');

const registrosRouter = require('./routes/Registros');
const usuariosRouter = require('./routes/Usuarios');
const internalRouter = require('./routes/internal');
const partnersRouter = require('./routes/partners');
const analisisDiarioRouter = require('./routes/AnalisisDiario');


const contactoRouter = require('./routes/contacto');

const app = express();

const PORT = process.env.PORT || 4000;
const ORIGEN_CORS = process.env.CORS_ORIGIN || '';


app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        console.log('--- WRITE REQUEST ---');
        console.log('time:', spainDateTime().toISOString());
        console.log('method:', req.method, 'url:', req.originalUrl);
        console.log('origin:', req.headers.origin || req.headers.referer || 'n/a');
        console.log('user-agent:', req.headers['user-agent'] || 'n/a');
        console.log('auth present:', !!req.headers.authorization);
        try { console.log('body preview:', JSON.stringify(req.body).slice(0, 1000)); } catch (e) { }
        console.log('---------------------');
    }
    next();
});

// Ruta de prueba para verificar middleware de autenticación
const authMiddleware = require('./middleware/auth');
app.get('/_test_auth', authMiddleware, (req, res) => {
    res.json({
        ok: true,
        usuarioId: req.usuario ? String(req.usuario._id) : null,
        usuario: req.usuario ? { email: req.usuario.email, nombre: req.usuario.nombre } : null
    });
});

// CORS
const allowedOrigins = [
    'http://localhost:5173',
    process.env.FRONTEND_ORIGIN_VERCEL || '',
    process.env.FRONTEND_ORIGIN || '',
    ORIGEN_CORS
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
        return callback(new Error('CORS no permitido por el servidor'));
    },
    credentials: true
}));

// Health check
app.get('/health', (req, res) => {
    const estadoMongo = mongoose.connection.readyState;
    const ok = estadoMongo === 1;
    res.status(ok ? 200 : 503).json({ estado: ok ? 'ok' : 'db-down', estadoMongo });
});

app.get('/', (req, res) => res.send('Backend de Oubaitori funcionando'));

// Rutas
app.use('/api/registros', registrosRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/internal', internalRouter);
app.use('/api/partners', partnersRouter);

// Montar ruta de contacto
app.use('/api/contacto', contactoRouter);

// Montar AnalisisDias protegido por authMiddleware para que req.usuario esté disponible
app.use('/api/AnalisisDiario', authMiddleware, analisisDiarioRouter);

// 404 handler (ruta no encontrada)
app.use((req, res) => {
    res.status(404).json({ ok: false, message: 'not_found' });
});

// Error handler centralizado
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err && err.stack ? err.stack : err);
    if (res.headersSent) return next(err);
    res.status(500).json({ ok: false, message: 'internal_server_error' });
});

// Arranque y apagado controlado
async function iniciar() {
    try {
        await conexionBD();
        console.log('Conectado a MongoDB');

        const servidor = app.listen(PORT, () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });

        const apagar = async (signal) => {
            console.log(`Recibido ${signal}. Cerrando servidor...`);
            servidor.close(async (err) => {
                if (err) {
                    console.error('Error cerrando servidor:', err);
                    process.exit(1);
                }
                try {
                    await desconectarBD();
                    process.exit(0);
                } catch (e) {
                    console.error('Error al desconectar MongoDB:', e);
                    process.exit(1);
                }
            });
        };

        process.on('SIGINT', () => apagar('SIGINT'));
        process.on('SIGTERM', () => apagar('SIGTERM'));
    } catch (err) {
        console.error('Error de arranque:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    iniciar();
}

module.exports = app;
