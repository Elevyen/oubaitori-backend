const palabrasPositivas = ['feliz', 'bien', 'genial', 'contento', 'contenta', 'tranquilo', 'tranquila', 'motivado', 'motivada', 'gracias', 'calma', 'esperanza', 'amor'];
const palabrasNegativas = ['mal', 'triste', 'ansiedad', 'vacío', 'solo', 'sola', 'miedo', 'cansado', 'cansada', 'llorar', 'frustrado', 'frustrada', 'agobiado', 'agobiada', 'fatal', 'horrible', 'odio', 'angustia'];

function analizarNotas(texto = '') {
    const textoNormalizado = String(texto).toLowerCase().trim();

    let positivos = 0;
    let negativos = 0;

    palabrasPositivas.forEach((palabra) => {
        if (textoNormalizado.includes(palabra)) {
            positivos++;
        }
    });

    palabrasNegativas.forEach((palabra) => {
        if (textoNormalizado.includes(palabra)) {
            negativos++;
        }
    });

    let polaridad = 'neutral';

    if (positivos > negativos) {
        polaridad = 'positiva';
    }

    if (negativos > positivos) {
        polaridad = 'negativa';
    }

    return {
        positivos,
        negativos,
        polaridad
    };
}

module.exports = analizarNotas;