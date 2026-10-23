require('dotenv').config();

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return v === '1' || /^true$/i.test(v);
}

function list(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT || 3002),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  corsOrigins: list(process.env.CORS_ORIGINS),

  meta: {
    token: process.env.META_WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    wabaId: process.env.META_WABA_ID || '',
    graphVersion: process.env.META_GRAPH_VERSION || 'v21.0',
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || 'kc_wa_verify_change_me',
    appSecret: process.env.META_APP_SECRET || ''
  },

  templates: {
    orderConfirmed: process.env.WA_TEMPLATE_ORDER_CONFIRMED || 'kc_order_confirmed',
    orderShipped: process.env.WA_TEMPLATE_ORDER_SHIPPED || 'kc_order_shipped',
    orderInTransit: process.env.WA_TEMPLATE_ORDER_IN_TRANSIT || 'kc_order_in_transit',
    orderDelivered: process.env.WA_TEMPLATE_ORDER_DELIVERED || 'kc_order_delivered',
    orderCancelled: process.env.WA_TEMPLATE_ORDER_CANCELLED || 'kc_order_cancelled',
    otp: process.env.WA_TEMPLATE_OTP || 'kc_otp',
    language: process.env.WA_TEMPLATE_LANGUAGE || 'en'
  },

  allowPlaintextFallback: bool(process.env.WA_ALLOW_PLAINTEXT_FALLBACK, true),

  storeWhatsapp: String(process.env.STORE_WHATSAPP_NUMBER || '919974033803').replace(/\D/g, ''),
  storeName: process.env.STORE_NAME || 'Keshav Clothing',
  storeInvoiceBaseUrl: (process.env.STORE_INVOICE_BASE_URL || 'https://keshavclothing.com/account/orders').replace(
    /\/$/,
    ''
  ),

  shopify: {
    shop: process.env.SHOPIFY_SHOP || '',
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-10',
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
    skipWebhookHmac: bool(process.env.SKIP_WEBHOOK_HMAC, true)
  },

  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS || 300),
  otpLength: Number(process.env.OTP_LENGTH || 6),
  returnWindowDays: Number(process.env.RETURN_WINDOW_DAYS || 15),

  inbox: {
    enabled: bool(process.env.INBOX_ENABLED, true),
    password: process.env.INBOX_PASSWORD || '',
    tokenSecret: process.env.INBOX_TOKEN_SECRET || process.env.INBOX_PASSWORD || 'kc-inbox-dev'
  }
};
