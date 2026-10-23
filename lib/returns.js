const config = require('../config');
const { normalizePhone } = require('./phone');
const wa = require('./whatsapp');
const { readJson, writeJson } = require('./store');
const axios = require('axios');

const RETURNS_FILE = 'return-requests.json';

async function loadReturns() {
  return readJson(RETURNS_FILE, { requests: [] });
}

async function saveReturns(db) {
  await writeJson(RETURNS_FILE, db);
}

function withinReturnWindow(orderDateIso) {
  if (!orderDateIso) return true;
  const placed = new Date(orderDateIso).getTime();
  if (Number.isNaN(placed)) return true;
  const maxAge = config.returnWindowDays * 24 * 60 * 60 * 1000;
  return Date.now() - placed <= maxAge;
}

async function addShopifyOrderNote(orderId, note) {
  if (!config.shopify.shop || !config.shopify.adminToken || !orderId) {
    return { ok: false, skipped: true, reason: 'Shopify Admin not configured' };
  }
  const base = `https://${config.shopify.shop}/admin/api/${config.shopify.apiVersion}`;
  try {
    // Append note via order update
    const get = await axios.get(`${base}/orders/${orderId}.json`, {
      headers: { 'X-Shopify-Access-Token': config.shopify.adminToken }
    });
    const existing = get.data?.order?.note || '';
    const merged = [existing, note].filter(Boolean).join('\n\n---\n\n');
    await axios.put(
      `${base}/orders/${orderId}.json`,
      { order: { id: orderId, note: merged } },
      { headers: { 'X-Shopify-Access-Token': config.shopify.adminToken, 'Content-Type': 'application/json' } }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.response?.data || err.message };
  }
}

async function createReturnRequest(payload) {
  const {
    orderName,
    orderId,
    orderDate,
    type, // return | exchange
    reason,
    items,
    customerName,
    phone,
    email,
    preferredSize,
    pickupAddress
  } = payload || {};

  if (!orderName && !orderId) {
    return { ok: false, error: 'Order number is required' };
  }
  if (!['return', 'exchange'].includes(String(type || '').toLowerCase())) {
    return { ok: false, error: 'type must be return or exchange' };
  }
  if (!reason || String(reason).trim().length < 3) {
    return { ok: false, error: 'Please provide a reason' };
  }
  if (orderDate && !withinReturnWindow(orderDate)) {
    return {
      ok: false,
      error: `Return / exchange window is ${config.returnWindowDays} days from order date`
    };
  }

  const custPhone = normalizePhone(phone);
  const id = `RR-${Date.now().toString(36).toUpperCase()}`;
  const request = {
    id,
    createdAt: new Date().toISOString(),
    status: 'submitted',
    type: String(type).toLowerCase(),
    orderName: orderName || null,
    orderId: orderId || null,
    orderDate: orderDate || null,
    reason: String(reason).trim(),
    items: items || [],
    customerName: customerName || null,
    phone: custPhone,
    email: email || null,
    preferredSize: preferredSize || null,
    pickupAddress: pickupAddress || null
  };

  const db = await loadReturns();
  db.requests.unshift(request);
  await saveReturns(db);

  const summary = [
    `${config.storeName} ${request.type.toUpperCase()} REQUEST ${id}`,
    `Order: ${request.orderName || request.orderId}`,
    `Customer: ${request.customerName || 'N/A'} | ${request.phone || 'no phone'} | ${request.email || 'no email'}`,
    `Reason: ${request.reason}`,
    request.preferredSize ? `Preferred size (exchange): ${request.preferredSize}` : '',
    request.pickupAddress ? `Pickup: ${request.pickupAddress}` : '',
    request.items?.length ? `Items: ${JSON.stringify(request.items)}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  // Notify store WhatsApp
  let storeNotify = { ok: false, skipped: true };
  if (config.storeWhatsapp && wa.isConfigured()) {
    storeNotify = await wa.sendText(config.storeWhatsapp, summary);
  }

  // Confirm to customer
  let customerNotify = { ok: false, skipped: true };
  if (custPhone && wa.isConfigured()) {
    const msg = `Hi${request.customerName ? ` ${request.customerName}` : ''},\n\nWe received your ${request.type} request ${id} for order ${request.orderName || ''}.\nOur team will contact you on WhatsApp within 24–48 hours.\n\n— ${config.storeName}`;
    customerNotify = await wa.sendText(custPhone, msg);
  }

  const noteResult = await addShopifyOrderNote(
    orderId,
    `[KC ${request.type.toUpperCase()} ${id}]\n${request.reason}\nPhone: ${custPhone || 'n/a'}`
  );

  return {
    ok: true,
    request: { id, status: request.status, type: request.type },
    notifications: { store: storeNotify, customer: customerNotify, shopifyNote: noteResult }
  };
}

module.exports = { createReturnRequest, loadReturns, withinReturnWindow };
