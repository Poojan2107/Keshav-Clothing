const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { ensureDataDir } = require('./ensure_data');
const {
  handleShopifyOrderCreated,
  syncStockFromMiracleToShopify,
  miracleClient
} = require('./shopify_webhook_handler');
const { syncProductsFromShopify } = require('./product_sync');
const { loadCatalog } = require('./catalog');
const { runPreflight } = require('./scripts/preflight_lib');

ensureDataDir();

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

function verifyShopifyHmac(req) {
  if (config.skipWebhookHmac) return { ok: true, skipped: true };
  if (!config.shopifyWebhookSecret) {
    return { ok: false, error: 'SHOPIFY_WEBHOOK_SECRET not set (or SKIP_WEBHOOK_HMAC=1)' };
  }
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  if (!hmacHeader) return { ok: false, error: 'Missing X-Shopify-Hmac-Sha256' };
  const digest = crypto
    .createHmac('sha256', config.shopifyWebhookSecret)
    .update(req.rawBody)
    .digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid Shopify HMAC' };
  }
  return { ok: true };
}

app.get('/health', async (req, res) => {
  // Default: do NOT hit Miracle (saves TPA credits). Use ?pingMiracle=1 to force.
  const wantPing = String(req.query.pingMiracle || '') === '1';
  let miracle = { ok: null, message: 'skipped (pass ?pingMiracle=1 to test auth)' };
  if (wantPing) {
    miracle = await miracleClient.pingAuth();
  } else if (miracleClient.authToken && Date.now() < miracleClient.tokenExpiresAt - 60_000) {
    miracle = { ok: true, message: 'token cached in process', cached: true };
  }
  const catalog = loadCatalog();
  res.status(miracle.ok === false ? 503 : 200).json({
    status: miracle.ok === false ? 'degraded' : 'online',
    service: 'Keshav Clothing Shopify ↔ Miracle ERP v2.1',
    timestamp: new Date().toISOString(),
    miracle,
    shopifyAdmin: {
      configured: Boolean(
        config.shopifyShop &&
          (config.shopifyAdminToken ||
            (config.shopifyApiClientId && config.shopifyApiClientSecret))
      ),
      shop: config.shopifyShop || null,
      authMode: config.shopifyAdminToken
        ? 'admin_token'
        : config.shopifyApiClientId
          ? 'client_credentials'
          : null,
      catalogProducts: catalog.count || catalog.products?.length || 0,
      catalogPulledAt: catalog.pulledAt
    },
    config: {
      salesVoucherType: config.salesVoucherType,
      flgcd: config.flgcd,
      invtyp: config.invtyp,
      taxtyp: config.taxtyp,
      companyState: config.companyState,
      includeShipping: config.includeShipping,
      postPaymentReceipt: config.postPaymentReceipt,
      hmacEnabled: !config.skipWebhookHmac && Boolean(config.shopifyWebhookSecret)
    }
  });
});

app.get('/preflight', async (_req, res) => {
  const report = await runPreflight();
  res.status(report.readyForLiveOrders ? 200 : 503).json(report);
});

app.post('/webhooks/shopify/orders-create', async (req, res) => {
  const auth = verifyShopifyHmac(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const result = await handleShopifyOrderCreated(req.body);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Webhook]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/** Also accept orders/paid if they configure that webhook */
app.post('/webhooks/shopify/orders-paid', async (req, res) => {
  const auth = verifyShopifyHmac(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const result = await handleShopifyOrderCreated(req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/sync/products', async (req, res) => {
  try {
    const dryRun = Boolean(req.body && req.body.dryRun);
    const result = await syncProductsFromShopify({ dryRun });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/sync/stock', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Pass { "id": "<Miracle product UniqueId>" }' });
    res.json({ success: true, stock: await syncStockFromMiracleToShopify(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug/miracle-auth', async (_req, res) => {
  const miracle = await miracleClient.pingAuth();
  res.status(miracle.ok ? 200 : 502).json(miracle);
});

app.get('/debug/branches', async (_req, res) => {
  try {
    res.json(await miracleClient.getBranchList());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug/catalog', (_req, res) => {
  res.json(loadCatalog());
});

app.post('/debug/replay-order', async (req, res) => {
  try {
    const result = await handleShopifyOrderCreated(req.body);
    res.status(result.success || result.skipped ? 200 : 422).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[KC Miracle] v2.1 on http://localhost:${config.port}`);
    console.log(`[KC Miracle] dataDir=${config.dataDir}`);
    console.log(`[KC Miracle] GET  /health  /preflight  /debug/catalog`);
    console.log(`[KC Miracle] POST /webhooks/shopify/orders-create`);
    console.log(`[KC Miracle] POST /sync/products  { "dryRun": true|false }`);
    if (process.env.SKIP_WEBHOOK_HMAC === '1' || process.env.SKIP_WEBHOOK_HMAC === 'true') {
      console.warn('[KC Miracle] WARNING: SKIP_WEBHOOK_HMAC=1 — set secret + 0 before production traffic');
    }
  });
}

module.exports = app;
