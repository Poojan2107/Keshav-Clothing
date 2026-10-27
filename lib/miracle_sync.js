/**
 * Optional Miracle ERP bridge — same free Render service as WhatsApp.
 * Enable with MIRACLE_SYNC_ENABLED=1 and Miracle env vars on Customer Ops.
 */
const path = require('path');

let handler = null;
let loadError = null;

function miracleRoot() {
  // GitHub/Render: customer-ops repo root has ./miracle-erp
  // Local monorepo: integrations/miracle-erp sits next to customer-ops
  const candidates = [
    path.join(__dirname, '..', 'miracle-erp'),
    path.join(__dirname, '..', '..', 'miracle-erp')
  ];
  const fs = require('fs');
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'shopify_webhook_handler.js'))) return p;
  }
  return candidates[0];
}

function loadMiracle() {
  if (process.env.MIRACLE_SYNC_ENABLED !== '1' && process.env.MIRACLE_SYNC_ENABLED !== 'true') {
    return null;
  }
  if (handler) return handler;
  if (loadError) return null;
  try {
    // Ensure Miracle data dir points at shared Turso-backed path when set
    if (!process.env.MIRACLE_DATA_DIR && process.env.DATA_DIR) {
      process.env.MIRACLE_DATA_DIR = process.env.DATA_DIR;
    }
    const root = miracleRoot();
    handler = require(path.join(root, 'shopify_webhook_handler'));
    const { ensureDataDir } = require(path.join(root, 'ensure_data'));
    ensureDataDir();
    if (handler.idStore && typeof handler.idStore.hydrateFromRemote === 'function') {
      handler.idStore.hydrateFromRemote().catch((err) => {
        console.warn('[Miracle] remote id-map hydrate:', err.message);
      });
    }
    console.log('[Miracle] Sync enabled — Sales Bills on order webhooks (', root, ')');
    return handler;
  } catch (err) {
    loadError = err;
    console.error('[Miracle] Failed to load miracle-erp:', err.message);
    console.error('[Miracle] Expected ./miracle-erp next to this app (see FREE_DEPLOY.md)');
    return null;
  }
}

async function syncOrderToMiracle(shopifyOrder) {
  const m = loadMiracle();
  if (!m) return { skipped: true, reason: 'miracle_disabled_or_unavailable' };
  try {
    const result = await m.handleShopifyOrderCreated(shopifyOrder);
    return result;
  } catch (err) {
    console.error('[Miracle] order sync failed:', err.message);
    return { success: false, error: err.message };
  }
}

function isEnabled() {
  return process.env.MIRACLE_SYNC_ENABLED === '1' || process.env.MIRACLE_SYNC_ENABLED === 'true';
}

module.exports = { loadMiracle, syncOrderToMiracle, isEnabled, miracleRoot };
