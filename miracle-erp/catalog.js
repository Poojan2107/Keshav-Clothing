const fs = require('fs');
const path = require('path');
const config = require('./config');

const CATALOG_FILE = path.join(config.dataDir, 'shopify-catalog.json');

function loadCatalog() {
  if (!fs.existsSync(CATALOG_FILE)) return { products: [], byVariant: {}, bySku: {}, pulledAt: null };
  try {
    const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    return {
      products: data.products || [],
      byVariant: data.byVariant || {},
      bySku: data.bySku || {},
      pulledAt: data.pulledAt || null
    };
  } catch (_) {
    return { products: [], byVariant: {}, bySku: {}, pulledAt: null };
  }
}

function saveCatalog(products) {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  const byVariant = {};
  const bySku = {};
  for (const p of products) {
    for (const v of p.variants || []) {
      const entry = {
        shopifyProductId: p.shopifyProductId,
        shopifyVariantId: v.shopifyVariantId,
        title: p.title,
        variantTitle: v.title,
        sku: v.sku,
        price: v.price,
        hsn: p.hsn,
        gst: p.gst,
        productType: p.productType,
        handle: p.handle
      };
      byVariant[String(v.shopifyVariantId)] = entry;
      if (v.sku) bySku[String(v.sku).trim()] = entry;
    }
  }
  const payload = {
    pulledAt: new Date().toISOString(),
    count: products.length,
    products,
    byVariant,
    bySku
  };
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function lookupCatalog(item) {
  const cat = loadCatalog();
  if (item.variant_id && cat.byVariant[String(item.variant_id)]) {
    return cat.byVariant[String(item.variant_id)];
  }
  if (item.sku && cat.bySku[String(item.sku).trim()]) {
    return cat.bySku[String(item.sku).trim()];
  }
  return null;
}

module.exports = { loadCatalog, saveCatalog, lookupCatalog, CATALOG_FILE };
