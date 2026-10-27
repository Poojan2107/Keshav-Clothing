const MiracleERPClient = require('./miracle_client');
const IdStore = require('./id_store');
const { resolveProductTax } = require('./product_overrides');
const { lookupCatalog } = require('./catalog');
const config = require('./config');

const miracleClient = new MiracleERPClient();
const idStore = new IdStore();

function accountKeyFromOrder(shopifyOrder) {
  if (shopifyOrder.customer && shopifyOrder.customer.id) return `cust:${shopifyOrder.customer.id}`;
  const email = (shopifyOrder.email || (shopifyOrder.customer && shopifyOrder.customer.email) || '').toLowerCase();
  if (email) return `email:${email}`;
  const phone =
    (shopifyOrder.customer && shopifyOrder.customer.phone) ||
    (shopifyOrder.shipping_address && shopifyOrder.shipping_address.phone) ||
    '';
  if (phone) return `phone:${phone}`;
  return `guest:${shopifyOrder.id || Date.now()}`;
}

function productKeyFromItem(item) {
  if (item.variant_id) return `var:${item.variant_id}`;
  if (item.sku) return `sku:${item.sku}`;
  if (item.product_id) return `prd:${item.product_id}`;
  return `name:${MiracleERPClient.productNameFromShopify(item)}`;
}

function extractUniqueId(apiResult) {
  if (!apiResult) return null;
  const dm = apiResult.DataModel || {};
  return (
    apiResult.UniqueId ||
    apiResult.uniqueId ||
    dm.UniqueId ||
    dm.uniqueId ||
    (typeof dm === 'string' ? dm : null) ||
    null
  );
}

function looksLikeDuplicate(apiResult) {
  if (!apiResult || !apiResult.IsError) return false;
  const msg = `${apiResult.Message || ''} ${JSON.stringify(apiResult.DataModel || {})}`.toLowerCase();
  return /already|exist|duplicate|unique/i.test(msg);
}

async function ensureAccount(shopifyOrder) {
  const key = accountKeyFromOrder(shopifyOrder);
  const cached = idStore.getAccount(key);
  if (cached && cached.uniqueId) {
    console.log(`[Integration] Reusing account ${cached.uniqueId} (${key})`);
    return cached.uniqueId;
  }

  const customer = shopifyOrder.customer || {};
  const address = shopifyOrder.shipping_address || shopifyOrder.billing_address || {};
  const name = MiracleERPClient.customerNameFromShopify(shopifyOrder);

  const accountResult = await miracleClient.upsertAccount({
    name,
    email: customer.email || shopifyOrder.email || '',
    mobile: customer.phone || address.phone || '',
    state: address.province || address.province_code || config.defaultState,
    city: address.city || '',
    pincode: address.zip || '',
    address1: address.address1 || '',
    address2: address.address2 || '',
    gstin: (() => {
      const m = /gstin[:\s]*([0-9A-Z]{15})/i.exec(
        `${customer.note || ''} ${shopifyOrder.note || ''}`
      );
      return m ? m[1].toUpperCase() : undefined;
    })()
  });

  const uniqueId = extractUniqueId(accountResult);
  if (uniqueId) {
    idStore.setAccount(key, uniqueId, { name });
    return uniqueId;
  }
  if (looksLikeDuplicate(accountResult)) {
    throw new Error(
      `Account "${name}" exists in Miracle but UniqueId unknown. Map accounts["${key}"] in data/id-map.json. ${accountResult.Message}`
    );
  }
  throw new Error(`Account upsert failed: ${accountResult && accountResult.Message}`);
}

async function ensureOneProduct(item) {
  const key = productKeyFromItem(item);
  const cached = idStore.getProduct(key);
  if (cached && cached.uniqueId) return cached.uniqueId;

  // also try sku key
  if (item.sku) {
    const bySku = idStore.getProduct(`sku:${item.sku}`);
    if (bySku && bySku.uniqueId) {
      idStore.setProduct(key, bySku.uniqueId, { linkedFrom: `sku:${item.sku}` });
      return bySku.uniqueId;
    }
  }

  const catalogEntry = lookupCatalog(item);
  const tax = resolveProductTax(item, catalogEntry);
  const prdnm = MiracleERPClient.productNameFromShopify(item, tax.prdnm);

  const productResult = await miracleClient.upsertProduct({
    name: prdnm,
    alias: (item.title || item.name || prdnm).slice(0, 15),
    price: parseFloat(item.price),
    gstRate: tax.gst,
    hsnCode: tax.hsn,
    slabName: tax.slab,
    group: tax.group,
    unit: tax.unit
  });

  const uniqueId = extractUniqueId(productResult);
  if (uniqueId) {
    idStore.setProduct(key, uniqueId, { prdnm, sku: item.sku, shopify: item.name });
    if (item.sku) idStore.setProduct(`sku:${item.sku}`, uniqueId, { prdnm });
    return uniqueId;
  }
  if (looksLikeDuplicate(productResult)) {
    throw new Error(
      `Product "${prdnm}" exists in Miracle but UniqueId unknown. Map products["${key}"] in data/id-map.json. ${productResult.Message}`
    );
  }
  throw new Error(`Product upsert failed (${prdnm}): ${productResult && productResult.Message}`);
}

async function ensureShippingProduct() {
  const key = `sku:${config.shippingProductName}`;
  const cached = idStore.getProduct(key);
  if (cached && cached.uniqueId) return cached.uniqueId;

  const res = await miracleClient.upsertProduct({
    name: config.shippingProductName,
    alias: 'Shipping Charges',
    price: 0,
    gstRate: config.shippingGst,
    hsnCode: config.shippingHsn,
    slabName: config.shippingSlab,
    group: 'Services',
    unit: config.defaultUom,
    stockRequired: 'N'
  });
  const uniqueId = extractUniqueId(res);
  if (uniqueId) {
    idStore.setProduct(key, uniqueId, { prdnm: config.shippingProductName, kind: 'shipping' });
    return uniqueId;
  }
  if (looksLikeDuplicate(res)) {
    throw new Error(
      `Shipping product ${config.shippingProductName} exists — map products["${key}"] in id-map.json`
    );
  }
  throw new Error(`Shipping product create failed: ${res && res.Message}`);
}

async function ensureProducts(shopifyOrder) {
  const lines = [];
  for (const item of shopifyOrder.line_items || []) {
    if (item.gift_card) continue;
    const prd = await ensureOneProduct(item);
    const catalogEntry = lookupCatalog(item);
    const tax = resolveProductTax(item, catalogEntry);
    lines.push({
      prd,
      qty: Number(item.quantity),
      rate: parseFloat(item.price),
      gst: tax.gst,
      shopifyLine: item
    });
  }

  if (config.includeShipping) {
    const shippingTotal = parseFloat(shopifyOrder.total_shipping_price_set?.shop_money?.amount
      || shopifyOrder.shipping_lines?.reduce((s, l) => s + parseFloat(l.price || 0), 0)
      || 0);
    if (shippingTotal > 0) {
      const shipPrd = await ensureShippingProduct();
      const shipLine = {
        price: String(shippingTotal),
        quantity: 1,
        tax_lines: (shopifyOrder.shipping_lines || []).flatMap((l) => l.tax_lines || []),
        _gst: config.shippingGst
      };
      lines.push({
        prd: shipPrd,
        qty: 1,
        rate: shippingTotal,
        gst: config.shippingGst,
        shopifyLine: shipLine
      });
    }
  }

  return lines;
}

function shouldSyncOrder(shopifyOrder) {
  const status = String(shopifyOrder.financial_status || 'pending').toLowerCase();
  if (config.skipUnpaid && !['paid', 'authorized', 'partially_paid'].includes(status)) {
    return { ok: false, reason: `Skipped financial_status=${status}` };
  }
  if (config.syncFinancialStatuses.length && !config.syncFinancialStatuses.includes(status)) {
    return { ok: false, reason: `financial_status ${status} not in allow-list` };
  }
  return { ok: true };
}

/**
 * Shopify orders/create (or paid) → Miracle Account + Products + Sales Bill SS
 */
async function handleShopifyOrderCreated(shopifyOrder) {
  if (!shopifyOrder || !shopifyOrder.id) {
    return { success: false, error: 'Invalid Shopify order payload (missing id)' };
  }

  const orderRef = shopifyOrder.order_number || shopifyOrder.name || shopifyOrder.id;
  console.log(`[Integration] Processing Shopify Order #${orderRef}`);

  const prior = idStore.getOrder(shopifyOrder.id);
  if (prior && prior.voucherUniqueId) {
    return { success: true, duplicate: true, voucherId: prior.voucherUniqueId };
  }

  const gate = shouldSyncOrder(shopifyOrder);
  if (!gate.ok) {
    console.log(`[Integration] ${gate.reason}`);
    return { success: false, skipped: true, error: gate.reason };
  }

  try {
    const accountId = await ensureAccount(shopifyOrder);
    const lines = await ensureProducts(shopifyOrder);
    if (!lines.length) return { success: false, error: 'Order has no syncable line items' };

    const voucherResult = await miracleClient.createSalesBill(shopifyOrder, accountId, lines);

    if (!voucherResult || voucherResult.IsError) {
      return {
        success: false,
        error: (voucherResult && voucherResult.Message) || 'Unknown voucher error',
        errorCode: voucherResult && voucherResult.ErrorCode,
        detail: voucherResult && voucherResult.DataModel
      };
    }

    const voucherId = extractUniqueId(voucherResult);
    const result = {
      success: true,
      voucherId,
      accountId,
      billno: `SH-${String(orderRef).replace(/^#/, '')}`
    };

    // Optional Guide §8.6 receipt for paid orders
    if (
      config.postPaymentReceipt &&
      config.cashOrBankAccountId &&
      ['paid', 'partially_paid'].includes(String(shopifyOrder.financial_status || '').toLowerCase())
    ) {
      try {
        const payRes = await miracleClient.createPaymentReceipt(
          accountId,
          parseFloat(shopifyOrder.total_price),
          shopifyOrder
        );
        result.paymentReceiptId = extractUniqueId(payRes);
        result.paymentReceiptOk = payRes && !payRes.IsError;
        if (payRes && payRes.IsError) result.paymentReceiptError = payRes.Message;
      } catch (err) {
        result.paymentReceiptOk = false;
        result.paymentReceiptError = err.message;
      }
    }

    idStore.setOrder(shopifyOrder.id, voucherId, {
      orderRef,
      billno: result.billno,
      paymentReceiptId: result.paymentReceiptId || null
    });

    console.log(`[Integration] Sales Bill ${voucherId} for Order #${orderRef}`);
    return result;
  } catch (err) {
    console.error('[Integration Exception]:', err.message);
    throw err;
  }
}

async function syncStockFromMiracleToShopify(productUniqueId) {
  return await miracleClient.getProductStock(productUniqueId);
}

module.exports = {
  handleShopifyOrderCreated,
  syncStockFromMiracleToShopify,
  ensureAccount,
  ensureProducts,
  miracleClient,
  idStore
};
