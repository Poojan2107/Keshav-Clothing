require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');

/**
 * Keshav Clothing — Shopify ↔ Miracle Cloud ERP (TPA Guide v1.3)
 */
function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || /^true$/i.test(v);
}

// On Render: mount a persistent disk and set MIRACLE_DATA_DIR=/var/data
const dataDir = process.env.MIRACLE_DATA_DIR
  ? path.resolve(process.env.MIRACLE_DATA_DIR)
  : path.join(__dirname, 'data');

module.exports = {
  port: Number(process.env.PORT || 3001),
  dataDir,

  // --- Miracle TPA ---
  baseUrl: process.env.MIRACLE_BASE_URL || 'https://tpaapi.miracleclouderp.com/',
  urlKey: process.env.MIRACLE_URL_KEY || '',
  clientId: process.env.MIRACLE_CLIENT_ID || '',
  apiKey: process.env.MIRACLE_API_KEY || '',

  // Sales Bill SS (Guide §8.3)
  salesVoucherType: process.env.MIRACLE_VOUCHER_TYPE || 'SS',
  flgcd: process.env.MIRACLE_FLGCD || 'D',
  invtyp: process.env.MIRACLE_INVTYP || 'GST',
  taxtyp: process.env.MIRACLE_TAXTYP || 'T',
  companyState: process.env.MIRACLE_COMPANY_STATE || 'Gujarat',

  // KC garment defaults (override per SKU in data/product-overrides.json)
  defaultGstPercent: Number(process.env.MIRACLE_DEFAULT_GST || 5),
  defaultHsn: process.env.MIRACLE_DEFAULT_HSN || '6109',
  defaultUom: process.env.MIRACLE_DEFAULT_UOM || 'NOS',
  defaultSlab: process.env.MIRACLE_DEFAULT_SLAB || 'GST 5%',
  defaultProductGroup: process.env.MIRACLE_PRODUCT_GROUP || 'Shopify',
  // Y = Sales Bill SS deducts stock (client expects Stock Report to move)
  stockRequired: envBool('MIRACLE_STOCK_REQUIRED', true) ? 'Y' : 'N',
  defaultLocation: process.env.MIRACLE_DEFAULT_LOCATION || '',
  defaultBatch: process.env.MIRACLE_DEFAULT_BATCH || '',

  defaultCustomerGroup: process.env.MIRACLE_CUSTOMER_GROUP || 'Sundry Debtors',
  defaultState: process.env.MIRACLE_DEFAULT_STATE || 'Gujarat',
  // Account balmethod can stay Bill to Bill; voucher b2bdet must stay OFF until company enables B2B (TPA020)
  defaultAccountBalMethod: process.env.MIRACLE_BAL_METHOD || 'Bill to Bill',
  enableB2b: envBool('MIRACLE_ENABLE_B2B', false),
  /** Miracle Bill-to-Bill type code: N|O|A|P|U (N = new reference) — only if ENABLE_B2B=1 */
  b2bType: process.env.MIRACLE_B2B_TYPE || 'N',
  defaultRegistrationDetail: [
    {
      regtype: process.env.MIRACLE_REG_TYPE || 'Unregistered',
      regappdt: process.env.MIRACLE_REG_APP_DT || '2017-07-01'
    }
  ],

  // Shipping as Miracle product line (created once)
  shippingProductName: (process.env.MIRACLE_SHIPPING_PRDNM || 'SHIP-KC').slice(0, 15),
  shippingHsn: process.env.MIRACLE_SHIPPING_HSN || '9965',
  shippingGst: Number(process.env.MIRACLE_SHIPPING_GST || 18),
  shippingSlab: process.env.MIRACLE_SHIPPING_SLAB || 'GST 18%',
  includeShipping: envBool('MIRACLE_INCLUDE_SHIPPING', true),

  // Optional post-bill cash/bank receipt (Guide §8.6) when order is paid
  postPaymentReceipt: envBool('MIRACLE_POST_PAYMENT_RECEIPT', false),
  receiptVoutyp: process.env.MIRACLE_RECEIPT_VOUTYP || 'CR', // CR cash / BR bank
  cashOrBankAccountId: process.env.MIRACLE_CASH_BANK_ACC_ID || '', // oppacc UniqueId

  // Optional ufddet — keys MUST be Miracle U-codes e.g. {"U0000001":"Shopify"}
  ufdJson: process.env.MIRACLE_UFD_JSON || '',

  // --- Shopify Admin (product catalog pull) ---
  shopifyShop: (process.env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  shopifyAdminToken: process.env.SHOPIFY_ADMIN_TOKEN || '',
  // Dev Dashboard apps: Client ID + secret → client_credentials access token
  shopifyApiClientId: process.env.SHOPIFY_API_CLIENT_ID || '',
  shopifyApiClientSecret: process.env.SHOPIFY_API_CLIENT_SECRET || '',
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2024-10',
  // Metafield namespaces/keys for HSN + GST on products
  shopifyHsnNamespace: process.env.SHOPIFY_HSN_NAMESPACE || 'custom',
  shopifyHsnKey: process.env.SHOPIFY_HSN_KEY || 'hsn',
  shopifyGstNamespace: process.env.SHOPIFY_GST_NAMESPACE || 'custom',
  shopifyGstKey: process.env.SHOPIFY_GST_KEY || 'gst_rate',

  // Sync policy
  syncFinancialStatuses: (process.env.SYNC_FINANCIAL_STATUSES || 'paid,authorized,pending,partially_paid')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  skipUnpaid: envBool('SYNC_SKIP_UNPAID', false),

  shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  skipWebhookHmac: envBool('SKIP_WEBHOOK_HMAC', false)
};
