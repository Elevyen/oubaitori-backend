const mongoose = require('mongoose');

async function conexionBD() {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI no definida');

    const opciones = {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000
    };

    await mongoose.connect(uri, opciones);
}

module.exports = { conexionBD };
