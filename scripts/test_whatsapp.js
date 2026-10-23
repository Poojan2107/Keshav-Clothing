require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const wa = require('../lib/whatsapp');
const { normalizePhone } = require('../lib/phone');

async function main() {
  const phone = normalizePhone(process.argv[2] || process.env.STORE_WHATSAPP_NUMBER);
  if (!wa.isConfigured()) {
    console.error('Set META_WHATSAPP_TOKEN and META_PHONE_NUMBER_ID in .env');
    process.exit(1);
  }
  if (!phone) {
    console.error('Usage: npm run test:wa -- <phoneE164>');
    process.exit(1);
  }
  const result = await wa.sendText(
    phone,
    `Keshav Clothing WhatsApp test OK at ${new Date().toISOString()}`
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
