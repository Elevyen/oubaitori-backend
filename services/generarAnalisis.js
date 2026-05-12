const analizarNotas = require('../utils/analizarNotas');

function generarAnalisis(registros = []) {
    const contadorEmociones = {};

    let intensidadTotal = 0;
    let totalRegistros = 0;
    let emocionesBuenas = 0;
    let emocionesNeutras = 0;
    let emocionesMalas = 0;
    let nlpPositivo = 0;
    let nlpNegativo = 0;

    registros.forEach((registro) => {
        totalRegistros++;

        const intensidad = Number(registro.intensidad || 0);

        intensidadTotal += intensidad;

        const emociones = Array.isArray(registro.emociones) ? registro.emociones : [];

        emociones.forEach((emocion) => {
            if (!emocion?.id) return;

            const idEmocion = emocion.id;
            const tipoEmocion = emocion.tipo || 'neutra';

            if (!contadorEmociones[idEmocion]) {
                contadorEmociones[idEmocion] = {
                    emocion: idEmocion,
                    tipo: tipoEmocion,
                    cantidad: 0,
                    intensidadTotal: 0
                };
            }

            contadorEmociones[idEmocion].cantidad += 1;
            contadorEmociones[idEmocion].intensidadTotal += intensidad;

            if (tipoEmocion === 'buena') {
                emocionesBuenas++;
            }
            if (tipoEmocion === 'neutra') {
                emocionesNeutras++;
            }
            if (tipoEmocion === 'mala') {
                emocionesMalas++;
            }
        });

        const nota = registro.nota || '';
        const analisisTexto = analizarNotas(nota);

        nlpPositivo += analisisTexto.positivos;
        nlpNegativo += analisisTexto.negativos;
    });

    const emocionesDominantes = Object.values(contadorEmociones)
        .map((emocion) => ({
            emocion: emocion.emocion,
            tipo: emocion.tipo,
            cantidad: emocion.cantidad,
            intensidadMedia: Math.round(
                emocion.intensidadTotal / emocion.cantidad
            )
        }))
        .sort((a, b) => b.cantidad - a.cantidad);

    const totalPositivo = emocionesBuenas + nlpPositivo;
    const totalNegativo = emocionesMalas + nlpNegativo;

    let estadoGeneral = 'neutro';

    if (totalNegativo > totalPositivo) {
        estadoGeneral = 'negativo';
    }
    if (totalPositivo > totalNegativo) {
        estadoGeneral = 'positivo';
    }
    const intensidadMedia = Math.round(
        intensidadTotal / Math.max(totalRegistros, 1)
    );

    const emocionesNegativasIntensas =
        emocionesDominantes.filter(
            (emocion) =>
                emocion.tipo === 'mala' &&
                emocion.intensidadMedia >= 7
        );

    return {
        estadoGeneral,
        intensidadMedia,
        emocionesDominantes,

        resumen: generarResumen(
            estadoGeneral,
            emocionesDominantes
        ),

        alerta: {
            mostrar:
                emocionesNegativasIntensas.length >= 2,

            nivel:
                intensidadMedia >= 8
                    ? 'alto'
                    : intensidadMedia >= 6
                        ? 'medio'
                        : 'bajo',

            mensaje:
                emocionesNegativasIntensas.length >= 2
                    ? 'Se detectaron emociones negativas intensas repetidas.'
                    : null
        },

        metadata: {
            totalRegistros,
            emocionesBuenas,
            emocionesNeutras,
            emocionesMalas,
            nlpPositivo,
            nlpNegativo
        }
    };
}

function generarResumen(
    estadoGeneral,
    emociones
) {
    if (!emociones.length) {
        return 'No hay suficientes datos emocionales.';
    }

    const emocionesPrincipales = emociones
        .slice(0, 3)
        .map((emocion) => emocion.emocion)
        .join(', ');

    if (estadoGeneral === 'positivo') {
        return `Predominan emociones positivas como ${emocionesPrincipales}.`;
    }

    if (estadoGeneral === 'negativo') {
        return `Predominan emociones difíciles como ${emocionesPrincipales}.`;
    }

    return `Se observa un estado emocional mixto con emociones como ${emocionesPrincipales}.`;
}

module.exports = generarAnalisis;