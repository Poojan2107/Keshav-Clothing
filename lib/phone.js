/**
 * Normalize phone to WhatsApp E.164 digits (no +).
 * Indian 10-digit numbers get 91 prefix.
 */
function normalizePhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  // Strip leading 00 international prefix
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Common India formats
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  }

  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function maskPhone(digits) {
  if (!digits || digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

module.exports = { normalizePhone, maskPhone };
