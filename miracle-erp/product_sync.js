const MiracleERPClient = require('./miracle_client');
const ShopifyAdminClient = require('./shopify_admin');
const IdStore = require('./id_store');
const { saveCatalog } = require('./catalog');
const { resolveProductTax } = require('./product_overrides');
const config = require('./config');

function extractUniqueId(apiResult) {
  if (!apiResult) return null;
  return apiResult.UniqueId || apiResult.uniqueId || (apiResult.DataModel && apiResult.DataModel.uniqueId) || null;
}

/**
 * Pull all Shopify products → save catalog → upsert each SKU into Miracle Product master.
 */
async function syncProductsFromShopify({ dryRun = false } = {}) {
  const shopify = new ShopifyAdminClient();
  if (!shopify.configured) {
    throw new Error(
      'Set SHOPIFY_SHOP + SHOPIFY_ADMIN_TOKEN in .env to pull KC products from Shopify.'
    );
  }

  console.log(`[ProductSync] Pulling products from ${config.shopifyShop}...`);
  const products = await shopify.fetchAllProducts();
  const catalog = saveCatalog(products);
  console.log(`[ProductSync] Saved catalog: ${catalog.count} products → data/shopify-catalog.json`);

  if (dryRun) {
    return { catalog, miracle: [], dryRun: true };
  }

  // Full catalog upsert burns 1+ Miracle API call per variant — blocked by default
  if (process.env.MIRACLE_ALLOW_FULL_PRODUCT_SYNC !== '1') {
    throw new Error(
      'Refusing full Miracle product upsert (burns TPA credits per SKU). ' +
        'Products are created on first order instead. ' +
        'To force: set MIRACLE_ALLOW_FULL_PRODUCT_SYNC=1. For catalog only: npm run sync:products:pull'
    );
  }

  const client = new MiracleERPClient();
  const idStore = new IdStore();
  await client.authenticate();

  const results = [];
  for (const p of products) {
    for (const v of p.variants || []) {
      if (!v.sku && !v.shopifyVariantId) continue;
      const fakeItem = {
        sku: v.sku,
        variant_id: v.shopifyVariantId,
        product_id: p.shopifyProductId,
        title: p.title,
        name: `${p.title} - ${v.title}`,
        price: v.price
      };
      const tax = resolveProductTax(fakeItem, { hsn: p.hsn, gst: p.gst });
      const prdnm = MiracleERPClient.productNameFromShopify(fakeItem, tax.prdnm);
      const key = v.sku ? `sku:${v.sku}` : `var:${v.shopifyVariantId}`;

      const cached = idStore.getProduct(key);
      let uniqueId = cached && cached.uniqueId;

      if (uniqueId) {
        const editRes = await client.upsertProduct({
          uniqueId,
          name: prdnm,
          alias: p.title.slice(0, 15),
          price: parseFloat(v.price)
        });
        results.push({ key, prdnm, uniqueId, action: 'E', ok: !editRes.IsError, message: editRes.Message });
        continue;
      }

      const addRes = await client.upsertProduct({
        name: prdnm,
        alias: p.title.slice(0, 15),
        price: parseFloat(v.price),
        gstRate: tax.gst,
        hsnCode: tax.hsn,
        slabName: tax.slab,
        group: tax.group || p.productType || config.defaultProductGroup,
        unit: tax.unit
      });

      uniqueId = extractUniqueId(addRes);
      if (uniqueId) {
        idStore.setProduct(key, uniqueId, {
          prdnm,
          sku: v.sku,
          shopifyVariantId: v.shopifyVariantId,
          shopifyProductId: p.shopifyProductId,
          title: p.title
        });
        // also index by variant
        idStore.setProduct(`var:${v.shopifyVariantId}`, uniqueId, { prdnm, sku: v.sku });
      }

      results.push({
        key,
        prdnm,
        uniqueId,
        action: 'A',
        ok: !addRes.IsError,
        message: addRes.Message,
        errorCode: addRes.ErrorCode
      });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`[ProductSync] Miracle upserts: ${ok}/${results.length} ok`);
  return { catalog, miracle: results, dryRun: false };
}

module.exports = { syncProductsFromShopify };
