require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const { conexionBD, desconectarBD } = require('./config/mongodb');

const aplicacion = express();

const puerto = process.env.PORT || 4000;
const origenCors = process.env.CORS_ORIGIN || '*';

aplicacion.use(express.json({ limit: '200kb' }));
aplicacion.use(cors({ origin: origenCors }));

// Health check para Render que muestra el estado de conexión
aplicacion.get('/health', (req, res) => {
    const estadoMongo = mongoose.connection.readyState;
    const ok = estadoMongo === 1;
    res.status(ok ? 200 : 503).json({ estado: ok ? 'ok' : 'db-down', estadoMongo });
});

aplicacion.get('/', (req, res) => res.send('Backend de Oubaitori funcionando'));

async function iniciar() {
    try {
        await conexionBD();
        console.log('Conectado a MongoDB');

        const servidor = aplicacion.listen(puerto, () => {
            console.log(`Servidor corriendo en http://localhost:${puerto}`);
        });

        const apagar = async (signal) => {
            console.log(`Recibido ${signal}. Apagando servidor.`);
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
    //Para las ejecuciones locales o en Render
    iniciar();
}

//Para las ejecuciones de test unitarios de la última semana
module.exports = aplicacion;
