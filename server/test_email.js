const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

function loadEnv(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq > -1) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        env[key] = val;
      }
    });
  } catch (e) {
    console.error('Failed to read .env:', e.message);
  }
  return env;
}

async function main() {
  const env = loadEnv(path.join(__dirname, '.env'));
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.error('SMTP credentials not found in server/.env');
    process.exit(1);
  }
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });

  try {
    await transporter.verify();
    console.log('SMTP verified');
    const info = await transporter.sendMail({
      from: env.SMTP_USER,
      to: 'hanzalak395@gmail.com',
      subject: 'VELOCE Test Email',
      text: 'This is a test email from VELOCE backend.',
      html: '<p>This is a <strong>test email</strong> from VELOCE backend.</p>'
    });
    console.log('Email sent:', info.messageId);
    process.exit(0);
  } catch (e) {
    console.error('Failed to send:', e.message);
    process.exit(1);
  }
}

main();
