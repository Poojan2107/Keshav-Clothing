const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * MRP / hangtag Article No ↔ Shopify SKU
 * File: data/article-map.json
 * { "KC-SIG-HYB-CSTM-RD-L": "411003", ... }
 *
 * Also accepts data/article-map.csv: sku,article
 */
function articleMapPath() {
  return path.join(config.dataDir, 'article-map.json');
}

function loadArticleMap() {
  const file = articleMapPath();
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) {
      const sku = String(k || '').trim();
      const article = String(v || '').trim();
      if (sku && article) out[sku] = article;
    }
    return out;
  } catch (err) {
    console.warn('[ArticleMap] Failed to parse article-map.json:', err.message);
    return {};
  }
}

/**
 * Resolve hangtag Article No for a Shopify line item.
 * Priority: override.prdnm/article → line barcode → catalog barcode → article-map[sku]
 */
function resolveArticleNo(item, catalogEntry, taxOverride) {
  const fromOverride =
    (taxOverride && (taxOverride.article || taxOverride.prdnm)) || null;
  if (fromOverride && /^\d{4,15}$/.test(String(fromOverride).trim())) {
    return String(fromOverride).trim();
  }
  if (fromOverride && taxOverride && taxOverride.article) {
    return String(taxOverride.article).trim().slice(0, 15);
  }

  const lineBarcode = String(item.barcode || item.Barcode || '').trim();
  if (lineBarcode) return lineBarcode.slice(0, 15);

  const catBarcode = catalogEntry && String(catalogEntry.barcode || '').trim();
  if (catBarcode) return catBarcode.slice(0, 15);

  const sku = item.sku && String(item.sku).trim();
  if (sku) {
    const map = loadArticleMap();
    if (map[sku]) return String(map[sku]).trim().slice(0, 15);
  }

  if (fromOverride) return String(fromOverride).trim().slice(0, 15);
  return null;
}

module.exports = { loadArticleMap, resolveArticleNo, articleMapPath };
