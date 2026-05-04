require('dotenv').config();
const nodemailer = require('nodemailer');
const dns = require('dns');

function logEnv() {
  console.log('Working directory:', process.cwd());
  console.log('SMTP_HOST=', process.env.SMTP_HOST || 'undefined');
  console.log('SMTP_PORT=', process.env.SMTP_PORT || 'undefined');
  console.log('SMTP_USER=', process.env.SMTP_USER ? 'ok' : 'MISSING');
  console.log('CONTACT_RECIPIENT=', process.env.CONTACT_RECIPIENT || 'undefined');
}

function createTransporter(options = {}) {
  const base = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    // timeout
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    ...options
  };

  return nodemailer.createTransport(base);
}

async function tryVerify(transporter) {
  try {
    await transporter.verify();
    console.log('SMTP verify OK (host=%s port=%s secure=%s)', transporter.options.host, transporter.options.port, transporter.options.secure);
    return true;
  } catch (err) {
    console.error('verify() error:', err && err.message ? err.message : err);
    return false;
  }
}

async function trySend(transporter) {
  try {
    const info = await transporter.sendMail({
      from: `"TFG" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: process.env.CONTACT_RECIPIENT,
      subject: 'Prueba nodemailer TFG',
      text: 'Mensaje de prueba usando App Password',
      replyTo: process.env.SMTP_USER
    });
    console.log('Enviado:', info.messageId);
    if (nodemailer.getTestMessageUrl) {
      const preview = nodemailer.getTestMessageUrl(info);
      if (preview) console.log('Preview URL:', preview);
    }
    return true;
  } catch (err) {
    console.error('sendMail error:', err && err.message ? err.message : err);
    return false;
  }
}

async function resolveIPv4(hostname) {
  return new Promise((resolve) => {
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) return resolve(null);
      resolve(address);
    });
  });
}

(async () => {
  logEnv();

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('Faltan credenciales SMTP en .env: SMTP_USER o SMTP_PASS');
    process.exitCode = 2;
    return;
  }

  // intento con las variables actuales
  console.log('\nIntentando conexión SMTP con las variables actuales...');
  let transporter = createTransporter();
  let ok = await tryVerify(transporter);

  // Si verify falla y host es smtp.gmail.com, forzamos IPv4 y reintentamos
  if (!ok) {
    console.log('\nReintentando forzando resolución IPv4...');
    const ipv4 = await resolveIPv4(transporter.options.host);
    if (ipv4) {
      console.log('IPv4 encontrada para', transporter.options.host, ipv4);
      transporter = createTransporter({
        // lookup que fuerza IPv4
        lookup: (hostname, options, callback) => dns.lookup(hostname, { family: 4 }, callback)
      });
      ok = await tryVerify(transporter);
    } else {
      console.log('No se pudo resolver IPv4 para', transporter.options.host);
    }
  }

  // Si sigue fallando y estamos en puerto 587, probamos puerto 465 (SSL)
  if (!ok && String(process.env.SMTP_PORT || '587') === '587') {
    console.log('\nIntentando fallback a puerto 465 (SSL)...');
    transporter = createTransporter({ port: 465, secure: true });
    ok = await tryVerify(transporter);
  }

  if (!ok) {
    console.error('\nNo se pudo verificar la conexión SMTP. Posibles causas:');
    console.error('- Variables .env incorrectas o no cargadas');
    console.error('- Red local / ISP / firewall bloqueando salida al puerto SMTP');
    console.error('- Credenciales (SMTP_USER / SMTP_PASS) incorrectas');
    console.error('- Cuenta Google bloqueando el intento (revisar actividad de seguridad)');
    console.error('\nPruebas recomendadas:');
    console.error('1) Ejecuta desde la carpeta del backend: node scripts/sendmail-check.js');
    console.error('2) Comprueba conectividad: Test-NetConnection -ComputerName smtp.gmail.com -Port 587 (PowerShell)');
    console.error('3) Prueba desde otra red (hotspot móvil) para descartar bloqueo de la red actual');
    console.error('4) Si usas Google App Password, asegúrate de que 2FA está activo y la contraseña es la correcta');
    process.exitCode = 3;
    return;
  }

  // Si verify OK, intentamos enviar
  console.log('\nVerificación OK. Intentando enviar correo de prueba...');
  const sent = await trySend(transporter);

  if (!sent) {
    console.error('\nEl envío falló tras verificar. Revisa logs anteriores para el error concreto.');
    process.exitCode = 4;
    return;
  }

  console.log('\nPrueba completada con éxito.');
  process.exitCode = 0;
})();
