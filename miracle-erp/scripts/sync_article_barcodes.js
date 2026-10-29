/**
 * Push article-map.json → Shopify variant barcode (MRP Article No)
 *
 *   node scripts/sync_article_barcodes.js
 *   node scripts/sync_article_barcodes.js --dry-run
 */
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', 'miracle-erp', '.env') });

const ShopifyAdminClient = require('../shopify_admin');
const { loadArticleMap } = require('../article_map');
const { ensureDataDir } = require('../ensure_data');

async function main() {
  ensureDataDir();
  const dry = process.argv.includes('--dry-run');
  const map = loadArticleMap();
  const skus = Object.keys(map);
  if (!skus.length) {
    console.log('[BarcodeSync] article-map.json empty — nothing to push');
    return;
  }

  const shopify = new ShopifyAdminClient();
  if (!shopify.configured) throw new Error('Shopify Admin not configured');

  const bySku = {};
  let sinceId = 0;
  for (;;) {
    const res = await shopify.request('GET', '/products.json', {
      limit: 250,
      since_id: sinceId || undefined,
      fields: 'id,title,variants'
    });
    if (res.status >= 400) {
      throw new Error(`products.json HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }
    const products = res.data.products || [];
    if (!products.length) break;
    for (const p of products) {
      for (const v of p.variants || []) {
        const sku = (v.sku || '').trim();
        if (sku) bySku[sku] = v;
      }
      sinceId = Math.max(sinceId, Number(p.id) || 0);
    }
    if (products.length < 250) break;
  }

  let ok = 0;
  let miss = 0;
  const token = await shopify.getAccessToken();

  for (const sku of skus) {
    const article = String(map[sku]).slice(0, 15);
    const variant = bySku[sku];
    if (!variant) {
      console.warn(`[BarcodeSync] SKU not in Shopify: ${sku}`);
      miss += 1;
      continue;
    }
    if (String(variant.barcode || '') === article) {
      console.log(`[BarcodeSync] OK already ${sku} → ${article}`);
      ok += 1;
      continue;
    }
    console.log(
      `[BarcodeSync] ${dry ? 'DRY ' : ''}${sku} barcode ${variant.barcode || '(empty)'} → ${article}`
    );
    if (dry) {
      ok += 1;
      continue;
    }
    const put = await axios.put(
      `${shopify.base()}/variants/${variant.id}.json`,
      { variant: { id: variant.id, barcode: article } },
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      }
    );
    if (put.status >= 400) {
      console.error(`[BarcodeSync] FAIL ${sku}: HTTP ${put.status}`, put.data);
      continue;
    }
    ok += 1;
  }

  console.log(`[BarcodeSync] done ok=${ok} missing=${miss} dry=${dry}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
