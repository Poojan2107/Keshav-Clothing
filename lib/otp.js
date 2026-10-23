const crypto = require('crypto');
const { readJson, writeJson } = require('./store');
const { normalizePhone } = require('./phone');
const config = require('../config');
const wa = require('./whatsapp');

const OTP_FILE = 'otp-sessions.json';

async function load() {
  return readJson(OTP_FILE, { sessions: {} });
}

async function save(db) {
  await writeJson(OTP_FILE, db);
}

function generateCode(length = config.otpLength) {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function requestOtp(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: 'Invalid phone number' };
  }

  const code = generateCode();
  const db = await load();
  db.sessions[phone] = {
    hash: hashCode(code),
    expiresAt: Date.now() + config.otpTtlSeconds * 1000,
    attempts: 0,
    createdAt: Date.now()
  };
  await save(db);

  const plaintext = `${config.storeName} verification code: ${code}\nValid for ${Math.round(config.otpTtlSeconds / 60)} minutes. Do not share this code.`;
  const sent = await wa.sendTemplateOrText(phone, config.templates.otp, [code], plaintext);

  if (!sent.ok) {
    return {
      ok: false,
      error: 'Failed to send OTP via WhatsApp',
      detail: sent.error,
      phone
    };
  }

  return {
    ok: true,
    phone,
    expiresIn: config.otpTtlSeconds,
    mode: sent.mode
  };
}

async function verifyOtp(rawPhone, code) {
  const phone = normalizePhone(rawPhone);
  if (!phone || !code) {
    return { ok: false, error: 'Phone and OTP are required' };
  }

  const db = await load();
  const session = db.sessions[phone];
  if (!session) {
    return { ok: false, error: 'No OTP requested for this number' };
  }

  if (Date.now() > session.expiresAt) {
    delete db.sessions[phone];
    await save(db);
    return { ok: false, error: 'OTP expired. Please request a new code.' };
  }

  session.attempts = (session.attempts || 0) + 1;
  if (session.attempts > 5) {
    delete db.sessions[phone];
    await save(db);
    return { ok: false, error: 'Too many attempts. Request a new OTP.' };
  }

  if (hashCode(String(code).trim()) !== session.hash) {
    await save(db);
    return { ok: false, error: 'Incorrect OTP' };
  }

  delete db.sessions[phone];
  await save(db);

  const token = crypto.randomBytes(24).toString('hex');
  const tokens = await readJson('auth-tokens.json', { tokens: {} });
  tokens.tokens[token] = {
    phone,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
  await writeJson('auth-tokens.json', tokens);

  return { ok: true, phone, token };
}

async function validateToken(token) {
  if (!token) return null;
  const tokens = await readJson('auth-tokens.json', { tokens: {} });
  const row = tokens.tokens[token];
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    delete tokens.tokens[token];
    await writeJson('auth-tokens.json', tokens);
    return null;
  }
  return row;
}

module.exports = { requestOtp, verifyOtp, validateToken };
