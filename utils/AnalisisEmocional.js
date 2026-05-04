// Analizador léxico simple en español, emojis, reglas de negación/intensificadores
// Versión: analisis-v1.1 (lexicón adaptado al array de emociones y sugerencias de metadata)
// Exporta: analyzeText(text, options), defaultLexicon, emojiMap, ANALYZER_VERSION, suggestMetadata

const ANALYZER_VERSION = 'analisis-v1.1';

const defaultLexicon = {
    alegria: ['alegr', 'feliz', 'content', 'gozo', 'sonr', 'alegría', 'alegre'],
    amor: ['amor', 'amar', 'querer', 'afecto', 'enamor'],
    gratitud: ['gratitud', 'gracias', 'agradec', 'reconocim'],
    esperanza: ['esperanz', 'esperanza', 'confi', 'optimis'],
    serenidad: ['seren', 'serenidad', 'paz', 'equilibrio'],
    calma: ['calm', 'tranquil', 'relaj'],
    tranquilidad: ['tranquil', 'calma', 'reposo'],
    entusiasmo: ['entusias', 'pasión', 'pasion', 'entusiasm'],
    euforia: ['euforia', 'eufor', 'júbilo', 'jubilo'],
    plenitud: ['plenitud', 'complet', 'satisfech'],
    dicha: ['dicha', 'felicidad profunda', 'felicidad'],
    regocijo: ['regocij', 'regocijo', 'celebr'],
    deleite: ['deleite', 'placer', 'encant'],
    satisfaccion: ['satisfacc', 'satisfacción', 'agrado'],
    orgullo: ['orgull', 'orgullo', 'satisfech personal'],
    motivacion: ['motiv', 'motivación', 'impulso', 'ganas'],
    admiracion: ['admir', 'admiración', 'vener'],
    ternura: ['ternur', 'ternura', 'cariñ'],
    empatia: ['empat', 'empatía', 'sentir por', 'ponerse en'],
    compasion: ['compas', 'compasión', 'piedad', 'pena por'],
    curiosidad: ['curios', 'curiosidad', 'investig', 'pregunt'],
    interes: ['interes', 'interés', 'atraer', 'llamar la atención'],
    fascinacion: ['fascin', 'fascinación', 'hipnotiz'],
    anticipacion: ['anticip', 'anticipación', 'esperar', 'ansia positiva'],
    expectativa: ['expectativ', 'expectativa', 'prever'],
    sorpresa: ['sorpr', 'sorpresa', 'inesperad'],
    asombro: ['asombr', 'asombro', 'maravill'],
    desconcierto: ['desconciert', 'desorient', 'perplej'],
    estupefaccion: ['estupef', 'estupefacción', 'boquiabiert'],
    incredulidad: ['incredul', 'incredulidad', 'no creer'],
    tristeza: ['trist', 'tristeza', 'infelic', 'aflig'],
    pena: ['pena', 'apen', 'dolor moral'],
    melancolia: ['melancol', 'melancolía', 'nostalg'],
    nostalgia: ['nostalg', 'añor', 'añoranza'],
    duelo: ['duelo', 'luto', 'perdida'],
    desolacion: ['desol', 'desolación', 'vacío', 'vacio'],
    desamparo: ['desampar', 'desamparo', 'sin protección'],
    abatimiento: ['abatim', 'abatimiento', 'sin fuerzas'],
    ira: ['ira', 'ira intensa', 'enfado violento'],
    enfado: ['enfad', 'enfado', 'molest', 'irrit'],
    irritacion: ['irrit', 'irritación', 'molestia leve'],
    frustracion: ['frustr', 'frustración', 'impotencia'],
    indignacion: ['indign', 'indignación', 'injusticia'],
    rencor: ['rencor', 'resentim', 'resentimiento'],
    hostilidad: ['hostil', 'hostilidad', 'enemistad'],
    furia: ['furia', 'rabia', 'ira extrema'],
    fastidio: ['fastidi', 'fastidio', 'molestia'],
    aversion: ['aversion', 'aversión', 'repugn', 'repuls'],
    repulsion: ['repuls', 'repulsión', 'vomit'],
    asco: ['asco', 'asco físico', 'repugnancia'],
    envidia: ['envid', 'envidia', 'desear lo ajeno'],
    celos: ['cel', 'celos', 'recelo'],
    traicion: ['traicion', 'traición', 'traicionar'],
    desprecio: ['despreci', 'desprecio', 'menospreci'],
    miedo: ['mied', 'miedo', 'alarma', 'peligro'],
    temor: ['temor', 'temor leve', 'preocupación'],
    ansiedad: ['ansied', 'ansiedad', 'preocup', 'nervios'],
    angustia: ['angusti', 'angustia', 'opresión'],
    panico: ['panico', 'pánico', 'paraliz', 'terror intenso'],
    inseguridad: ['insegur', 'inseguridad', 'duda sobre'],
    vulnerabilidad: ['vulnerab', 'vulnerabilidad', 'expuesto'],
    desconfianza: ['desconfi', 'desconfianza', 'sospech'],
    verguenza: ['vergüenz', 'vergüenza', 'vergonz'],
    humillacion: ['humill', 'humillación', 'humillado'],
    pavor: ['pavor', 'pavor intenso', 'miedo extremo'],
    confusion: ['confus', 'confusión', 'desorden mental'],
    apatia: ['apat', 'apatía', 'indiferenc', 'sin energía'],
    aburrimiento: ['aburr', 'aburrimiento', 'desinteres'],
    tedio: ['tedio', 'tedio', 'monoton'],
    remordimiento: ['remord', 'remordimiento', 'arrepent'],
    culpa: ['culp', 'culpa', 'responsabil'],
    soledad: ['soled', 'soledad', 'aislam'],
    resiliencia: ['resilien', 'resiliencia', 'recuper'],
    bienestar: ['bienestar', 'bienestar físico', 'bienestar emocional'],
    cansancio: ['cansanc', 'cansancio', 'agot', 'agotamiento'],
    fatiga: ['fatig', 'fatiga', 'agotamiento extremo'],
    vigor: ['vigor', 'vitalidad', 'energ', 'vigoroso'],
    tension: ['tens', 'tensión', 'rigidez muscular'],
    agitación: ['agitat', 'agitación', 'inquietud física'],
    parálisis: ['paral', 'parálisis', 'incapacidad de actuar'],
    escalofrio: ['escalofri', 'escalofrío', 'escalofrio'],
    palpitaciones: ['palpit', 'palpitaciones', 'latido acelerado'],
    sofoco: ['sofoc', 'sofoco', 'rubor', 'calor súbito'],
    pesadez: ['pesad', 'pesadez', 'cuerpo pesa'],
    opresion: ['opres', 'opresión', 'nudo en el pecho'],
    nausea: ['náuse', 'nause', 'náusea', 'mareo', 'ganas de vomitar'],
    debilidad: ['debil', 'debilidad', 'fragil'],
    desvelo: ['desvel', 'desvelo', 'insomnio'],
    relajacion: ['relaj', 'relajación', 'descanso'],
    ligereza: ['liger', 'ligereza', 'alivio físico'],
    hormigueo: ['hormigue', 'hormigueo', 'cosquilleo'],
    saciacion: ['saciac', 'saciación', 'saciado']
};

const emojiMap = {'😢': 'pena','😭': 'pena','😔': 'tristeza','😞': 'melancolia','😊': 'alegria','😄': 'dicha','😁': 'alegria','🤩': 'extasis','🤗': 'euforia',
    '😃': 'alegria','❤️': 'amor','🙏': 'gratitud','🥰': 'ternura','😌': 'alivio','😨': 'miedo','😰': 'temor','😱': 'panico','🤢': 'aversion','🤮': 'repulsion',
    '😡': 'furia','😠': 'ira','😤': 'enfado','😬': 'fastidio','🤔': 'curiosidad','🔎': 'interes','🎉': 'regocijo','🔥': 'entusiasmo','🌿': 'serenidad','🌟': 'esperanza',
    '🧘': 'calma','🌊': 'tranquilidad','💪': 'orgullo','🚀': 'motivacion','😴': 'cansancio','🪫': 'fatiga','⚡': 'vigor','💢': 'tension','🫀': 'palpitaciones',
    '🌙': 'desvelo','🛀': 'relajacion','✨': 'deleite','🎉': 'regocijo','🏝️': 'soledad','🥀': 'desamparo','🕳️': 'desolacion','😩': 'abatimiento','😬': 'fastidio'
};

const intensifiers = ['muy', 'mucho', 'sumamente', 'extremadamente', 'super', 'totalmente', 'bastante'];
const diminishers = ['poco', 'algo', 'ligeramente', 'un poco', 'poco a poco', 'medianamente'];
const negations = ['no', 'nunca', 'jamás', 'jamas', 'nadie', 'ningún', 'ninguna', 'sin', 'ni'];

/**
 * Tokeniza texto en minúsculas, preservando letras y emojis.
 */
function tokenize(text) {
    if (!text) return [];
    const s = String(text).toLowerCase();
    return s
        .replace(/[^\p{L}\p{N}\s\p{Emoji_Presentation}\p{Emoji}\-]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function containsEmojis(text) {
    if (!text) return [];
    return Object.keys(emojiMap).filter(e => text.includes(e));
}

function scoreFromLexicon(tokens, lexicon) {
    const scores = {};
    Object.keys(lexicon).forEach(k => (scores[k] = 0));
    tokens.forEach((tok, i) => {
        Object.entries(lexicon).forEach(([emotion, words]) => {
            words.forEach(w => {
                if (tok.includes(w)) {
                    let weight = 1;
                    const window = tokens.slice(Math.max(0, i - 3), i + 1).join(' ');
                    if (negations.some(n => window.includes(n + ' ' + tok) || window.includes(n + ' ' + w))) weight *= -1;
                    if (intensifiers.some(x => window.includes(x))) weight *= 1.6;
                    if (diminishers.some(x => window.includes(x))) weight *= 0.6;
                    scores[emotion] += weight;
                }
            });
        });
    });
    return scores;
}

function aggregateEmojiScores(text) {
    const found = containsEmojis(text);
    const scores = {};
    Object.keys(defaultLexicon).forEach(k => (scores[k] = 0));
    found.forEach(e => {
        const emo = emojiMap[e];
        if (emo) scores[emo] = (scores[emo] || 0) + 2;
    });
    return scores;
}

function mergeScores(a, b) {
    const out = {};
    Object.keys(a).forEach(k => (out[k] = (a[k] || 0) + (b[k] || 0)));
    return out;
}

function normalizeScores(rawScores) {
    const vals = Object.values(rawScores);
    const max = Math.max(...vals, 0.0001);
    const normalized = {};
    Object.entries(rawScores).forEach(([k, v]) => {
        normalized[k] = +(v / max).toFixed(3);
    });
    return normalized;
}

function computePolarity(scores) {
    const pos = (scores.alegria || 0) + (scores.ternura || 0) + (scores.amor || 0) + (scores.gratitud || 0) + (scores.euforia || 0);
    const neg =
        (scores.tristeza || 0) +
        (scores.ira || 0) +
        (scores.miedo || 0) +
        (scores.ansiedad || 0) +
        (scores.asco || 0) +
        (scores.culpa || 0);
    const denom = Math.max(pos, neg, 1);
    const polarity = +((pos - neg) / denom).toFixed(3);
    return polarity;
}

function mapIntensity(polarity, rawScores) {
    const maxScore = Math.max(...Object.values(rawScores), 0);
    const base = Math.min(1, Math.abs(maxScore));
    const intensity = Math.round(Math.min(10, Math.max(0, base * 10)));
    return intensity;
}

/**
 * analyzeText
 * @param {string} text - texto a analizar
 * @param {object} options - { lexicon, includeEmojis (bool) }
 * @returns {object} analysis
 */
function analyzeText(text, options = {}) {
    const lexicon = options.lexicon || defaultLexicon;
    const tokens = tokenize(text);
    const lexScores = scoreFromLexicon(tokens, lexicon);
    const emojiScores = options.includeEmojis === false ? {} : aggregateEmojiScores(String(text || ''));
    const raw = mergeScores(lexScores, emojiScores);
    const normalized = normalizeScores(raw);
    const polarity = computePolarity(normalized);
    const intensity_pred = mapIntensity(polarity, raw);
    const confidence = Math.max(...Object.values(normalized), 0);
    const top = Object.entries(normalized)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => ({ emotion: k, score: v }));
    return {
        version: ANALYZER_VERSION,
        emotions_scores: normalized,
        top_emotions: top,
        polarity,
        intensity_pred,
        confidence: +confidence.toFixed(3),
        tokens_count: tokens.length,
        raw_counts: raw
    };
}

module.exports = {
    analyzeText,
    defaultLexicon,
    emojiMap,
    ANALYZER_VERSION
};
