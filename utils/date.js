const TZ = 'Europe/Madrid';

function formatDate(value = new Date()) {
    const date =
        value instanceof Date
            ? value
            : new Date(value);

    const parts = new Intl.DateTimeFormat('es-ES', {
        timeZone: TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).formatToParts(date);

    const dd = parts.find(p => p.type === 'day').value;
    const mm = parts.find(p => p.type === 'month').value;
    const yyyy = parts.find(p => p.type === 'year').value;

    return `${dd}-${mm}-${yyyy}`;
}

// Hoy España
function todayDate() {
    return formatDate();
}

// DD-MM-YYYY a Date
function toDate(value) {
    if (value instanceof Date) {
        return value;
    }

    const [dd, mm, yyyy] = String(value).split('-');

    return new Date(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        12
    );
}

// Comparar fechas
function isSameDate(a, b) {
    return formatDate(a) === formatDate(b);
}

// Fecha futura
function isFutureDate(value) {
    return toDate(value) > toDate(todayDate());
}

// Últimos 7 días
function isWithinLast7Days(value) {
    const diff =
        toDate(todayDate()) - toDate(value);

    const days = Math.floor(
        diff / (1000 * 60 * 60 * 24)
    );

    return days >= 0 && days <= 6;
}

// DD-MM-YYYY a YYYY-MM-DD
function toISODate(value) {
    const [dd, mm, yyyy] = String(value).split('-');

    return `${yyyy}-${mm}-${dd}`;
}

// Hora actual España HH:mm:ss
function spainTime(value = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(value);
}

/*
  IMPORTANTE:
  Mongo/Mongoose necesita un Date,
  no un string formateado.
*/
function spainDateTime(value = new Date()) {
    return new Date(value);
}

/*
  Solo para logs y consola
*/
function spainDateTimeString(value = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(value);
}

// Añadir minutos
function addMinutes(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000);
}

module.exports = {
    formatDate,
    todayDate,
    toDate,
    isSameDate,
    isFutureDate,
    isWithinLast7Days,
    toISODate,
    spainTime,
    spainDateTime,
    spainDateTimeString,
    addMinutes
};