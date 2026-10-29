const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Per-SKU / per-variant overrides for KC products.
 * File: data/product-overrides.json
 *
 * {
 *   "KC-TEE-01": { "hsn": "61091000", "gst": 5, "prdnm": "KC-TEE-01", "slab": "GST 5%", "group": "Tshirts" },
 *   "var:123456": { "hsn": "6109", "gst": 12 }
 * }
 */
function loadOverrides() {
  const file = path.join(config.dataDir, 'product-overrides.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('[Overrides] Failed to parse product-overrides.json:', err.message);
    return {};
  }
}

function resolveProductTax(item, catalogEntry) {
  const overrides = loadOverrides();
  const keys = [
    item.sku && String(item.sku).trim(),
    item.variant_id && `var:${item.variant_id}`,
    item.product_id && `prd:${item.product_id}`
  ].filter(Boolean);

  let o = {};
  for (const k of keys) {
    if (overrides[k]) {
      o = { ...o, ...overrides[k] };
    }
  }

  const hsn =
    o.hsn ||
    item.hsn ||
    (catalogEntry && catalogEntry.hsn) ||
    config.defaultHsn;

  const gst =
    o.gst != null
      ? Number(o.gst)
      : item.gst_rate != null
        ? Number(item.gst_rate)
        : catalogEntry && catalogEntry.gst != null
          ? Number(catalogEntry.gst)
          : config.defaultGstPercent;

  return {
    hsn: String(hsn).replace(/\s/g, ''),
    gst: Number(gst),
    slab: o.slab || (gst === 18 ? 'GST 18%' : gst === 12 ? 'GST 12%' : config.defaultSlab),
    group: o.group || config.defaultProductGroup,
    prdnm: o.prdnm || o.article || null,
    article: o.article || null,
    unit: o.unit || config.defaultUom
  };
}

module.exports = { loadOverrides, resolveProductTax };
