// Analiza el día actual (hasta 7 registros) y los últimos 7 días.

const AnalisisUtils = require('../utils/AnalisisEmocional') || {};
const analyzeText = AnalisisUtils.analyzeText;
const ANALYZER_VERSION = AnalisisUtils.ANALYZER_VERSION;
const suggestMetadata = typeof AnalisisUtils.suggestMetadata === 'function' ? AnalisisUtils.suggestMetadata : null;

/**
 * Helper: formatea Date a YYYY-MM-DD
 */
function dateKey(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * obtiene rango de fechas (incluye hoy) para los últimos N días
 */
function lastNDates(n) {
    const out = [];
    const today = new Date();
    for (let i = 0; i < n; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        out.push(dateKey(d));
    }
    return out;
}

/**
 * Selecciona hasta `perDayLimit` registros por día, priorizando los más recientes (por fecha/hora).
 * records: array con campos { id, fecha, hora, createdAt, nota, texto, meta, ... }
 */
function pickPerDay(records = [], perDayLimit = 2, days = []) {
    const byDay = {};
    records.forEach(r => {
        const key = dateKey(r.fecha || r.createdAt || new Date());
        if (days.length && !days.includes(key)) return; // filtrar si se pasó lista de días
        byDay[key] = byDay[key] || [];
        byDay[key].push(r);
    });

    // ordenar cada día por fecha/hora descendente y recortar
    const picked = [];
    Object.keys(byDay).forEach(day => {
        const arr = byDay[day].sort((a, b) => {
            const ta = (() => {
                try {
                    if (a.fecha) return new Date(a.fecha).getTime();
                    if (a.createdAt) return new Date(a.createdAt).getTime();
                    if (a._id && typeof a._id.getTimestamp === 'function') return a._id.getTimestamp().getTime();
                } catch (e) { /* ignore */ }
                return Date.now();
            })();
            const tb = (() => {
                try {
                    if (b.fecha) return new Date(b.fecha).getTime();
                    if (b.createdAt) return new Date(b.createdAt).getTime();
                    if (b._id && typeof b._id.getTimestamp === 'function') return b._id.getTimestamp().getTime();
                } catch (e) { /* ignore */ }
                return Date.now();
            })();
            return tb - ta;
        });
        picked.push(...arr.slice(0, perDayLimit));
    });

    // ordenar globalmente por fecha descendente (opcional)
    return picked.sort((a, b) => {
        const ta = new Date(a.fecha || a.createdAt || Date.now()).getTime();
        const tb = new Date(b.fecha || b.createdAt || Date.now()).getTime();
        return tb - ta;
    });
}

/**
 * analyzeDays
 * Opciones:
 *  - records: array de registros (si se pasa, no se consulta DB)
 *  - RecordModel: modelo Mongoose para recuperar registros si no se pasan
 *  - userId, fromDate, toDate: filtros opcionales para la consulta DB
 *  - persist: boolean (si true, actualiza cada registro con meta.analysis y meta.suggested)
 *  - perDayLimit: máximo por día (default 7)
 *  - daysWindow: número de días a considerar (default 7)
 */
async function analyzeDays(options = {}) {
    const {
        records = null,
        RecordModel = null,
        userId = null,
        persist = false,
        perDayLimit = 2,
        daysWindow = 7
    } = options;

    try {
        // calcular días a analizar
        const days = lastNDates(daysWindow);

        // obtener registros:
        let allRecords = Array.isArray(records) ? records.slice() : [];

        if (!allRecords.length && RecordModel) {
            // preparar rangos
            const from = new Date(days[days.length - 1] + 'T00:00:00');
            const to = new Date(days[0] + 'T23:59:59.999');

            // Intentar consulta : cubrir casos donde `fecha` es string (YYYY-MM-DD) o Date
            const baseQuery = {};
            if (userId) baseQuery.userId = userId;

            // Usar $or para cubrir ambos formatos
            const query = {
                ...baseQuery,
                $or: [
                    { fecha: { $in: days } },
                    { fecha: { $gte: from, $lte: to } }
                ]
            };

            try {
                allRecords = await RecordModel.find(query).sort({ fecha: -1, createdAt: -1 }).lean().exec();
            } catch (errQuery) {
                // Si la consulta con $or falla por tipos, intentar consulta por rango simple
                console.warn('AnalisisDias: consulta con $or falló, intentando consulta por rango. Error:', errQuery && errQuery.message);
                try {
                    const fallbackQuery = Object.assign({}, baseQuery, { fecha: { $gte: from, $lte: to } });
                    allRecords = await RecordModel.find(fallbackQuery).sort({ fecha: -1, createdAt: -1 }).lean().exec();
                } catch (err2) {
                    console.error('AnalisisDias: consulta fallback también falló:', err2 && err2.stack ? err2.stack : err2);
                    allRecords = [];
                }
            }
        }

        // seleccionar hasta perDayLimit por día (max total perDayLimit * daysWindow)
        const picked = pickPerDay(allRecords, perDayLimit, days).slice(0, perDayLimit * daysWindow);

        // separar día actual (hoy) hasta perDayLimit y resto (últimos días)
        const todayKey = dateKey(new Date());
        const todayRecords = picked.filter(r => dateKey(r.fecha || r.createdAt || new Date()) === todayKey).slice(0, perDayLimit);
        const remaining = picked.filter(r => dateKey(r.fecha || r.createdAt || new Date()) !== todayKey).slice(0, perDayLimit * (daysWindow - 1));
        const toAnalyze = [...todayRecords, ...remaining].slice(0, perDayLimit * daysWindow);

        // analizar cada registro y persistir
        const perRecord = [];
        const agg = { total: 0, byEmotion: {}, intensitySum: 0, lowConfidence: [], highIntensity: [] };

        for (const rec of toAnalyze) {
            try {
                const text = rec.nota || rec.texto || '';
                let analysis;
                if (rec.meta && rec.meta.analysis && rec.meta.analysis.version === ANALYZER_VERSION) {
                    analysis = rec.meta.analysis;
                } else if (typeof analyzeText === 'function') {
                    analysis = await Promise.resolve(analyzeText(text));
                } else {
                    analysis = {};
                }

                let suggestion = {};
                try {
                    if (suggestMetadata) {
                        suggestion = await Promise.resolve(suggestMetadata(text, analysis));
                    } else {
                        suggestion = {};
                    }
                } catch (errSuggest) {
                    console.warn('suggestMetadata fallo para registro', rec.id || rec._id, errSuggest && errSuggest.message ? errSuggest.message : errSuggest);
                    suggestion = {};
                }

                if (persist && RecordModel && rec._id) {
                    try {
                        await RecordModel.updateOne(
                            { _id: rec._id },
                            {
                                $set: {
                                    'meta.analysis': analysis,
                                    'meta.suggested': suggestion,
                                    'meta.analysisAt': new Date()
                                }
                            }
                        ).exec();
                    } catch (err) {
                        // no bloquear el proceso por fallo de persistencia
                        console.error('Persistencia AnalisisDias error:', err && err.stack ? err.stack : err);
                    }
                }

                // construir salida por registro
                perRecord.push({
                    id: rec.id || (rec._id ? String(rec._id) : null),
                    date: dateKey(rec.fecha || rec.createdAt || new Date()),
                    analysis,
                    suggested: suggestion
                });

                // actualizar agregados
                agg.total += 1;
                agg.intensitySum += (analysis && (analysis.intensity_pred || 0)) || 0;
                if ((analysis && (analysis.confidence || 0)) < 0.4) agg.lowConfidence.push(rec.id || (rec._id ? String(rec._id) : null));
                if ((analysis && (analysis.intensity_pred || 0)) >= 7) agg.highIntensity.push(rec.id || (rec._id ? String(rec._id) : null));
                (analysis && analysis.top_emotions || []).forEach(t => { agg.byEmotion[t.emotion] = (agg.byEmotion[t.emotion] || 0) + 1; });
            } catch (errRec) {
                console.warn('AnalisisDias: fallo analizando registro', rec && (rec.id || rec._id), errRec && errRec.stack ? errRec.stack : errRec);
            }
        }

        const avgIntensity = agg.total ? +(agg.intensitySum / agg.total).toFixed(2) : 0;
        const coverage = agg.total ? +(((agg.total - agg.lowConfidence.length) / agg.total) * 100).toFixed(1) : 0;

        const summary = {
            period: `last_${daysWindow}_days_including_today`,
            totalRecords: agg.total,
            avgIntensity,
            coveragePercent: coverage,
            emotionCounts: agg.byEmotion,
            lowConfidenceIds: agg.lowConfidence,
            highIntensityIds: agg.highIntensity,
            daysConsidered: days
        };

        return { perRecord, summary };
    } catch (err) {
        console.error('analyzeDays error global:', err && err.stack ? err.stack : err);
        throw err;
    }
}

module.exports = { analyzeDays };
