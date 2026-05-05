const mongoose = require('mongoose');

async function conexionBD() {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI no definida');
    const opciones = {
        serverSelectionTimeoutMS: 5000,
    };
    await mongoose.connect(uri, opciones);
}
mongoose.connection.on('connected', () => {
    console.log('MongoDB conectado (mongoose.connection.readyState =', mongoose.connection.readyState, ')');
});
mongoose.connection.on('error', (err) => {
    console.error('Error en conexión MongoDB:', err);
});
mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB desconectado');
});
async function desconectarBD() {
    try {
        await mongoose.disconnect();
        console.log('Desconectado de MongoDB');
    } catch (e) {
        console.error('Error al desconectar MongoDB:', e);
    }
}
module.exports = { conexionBD, desconectarBD };
