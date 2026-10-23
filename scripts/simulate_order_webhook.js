/**
 * Local smoke: POST a fake Shopify order-create payload → WhatsApp kc_order_confirmed.
 * Usage: node scripts/simulate_order_webhook.js [phoneDigits]
 * Example: node scripts/simulate_order_webhook.js 919023362134
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const phoneArg = (process.argv[2] || '919023362134').replace(/\D/g, '');
const base = process.env.SIM_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3002}`;

const order = {
  id: Date.now(),
  name: `#TEST-${String(Date.now()).slice(-4)}`,
  order_number: Number(String(Date.now()).slice(-4)),
  total_price: '0.00',
  currency: 'INR',
  token: 'sim-token',
  order_status_url: 'https://keshavclothing.com/account/orders',
  customer: { first_name: 'GoLive', last_name: 'Test', phone: phoneArg },
  shipping_address: {
    first_name: 'GoLive',
    last_name: 'Test',
    phone: phoneArg
  },
  billing_address: { phone: phoneArg }
};

async function main() {
  const url = `${base}/webhooks/shopify/orders-create`;
  console.log('POST', url, '→', phoneArg);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order)
  });
  const text = await res.text();
  console.log('status', res.status);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
