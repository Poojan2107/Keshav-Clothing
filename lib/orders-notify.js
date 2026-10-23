const config = require('../config');
const { normalizePhone } = require('./phone');
const wa = require('./whatsapp');
const inbox = require('./inbox');
const { readJson, writeJson } = require('./store');

const LOG_FILE = 'wa-send-log.json';

function phoneFromOrder(order) {
  const candidates = [
    order?.shipping_address?.phone,
    order?.billing_address?.phone,
    order?.customer?.phone,
    order?.phone
  ];
  for (const c of candidates) {
    const n = normalizePhone(c);
    if (n) return n;
  }
  return null;
}

function customerName(order) {
  const first =
    order?.customer?.first_name ||
    order?.shipping_address?.first_name ||
    order?.billing_address?.first_name ||
    '';
  const last =
    order?.customer?.last_name ||
    order?.shipping_address?.last_name ||
    order?.billing_address?.last_name ||
    '';
  const name = `${first} ${last}`.trim();
  return name || 'Customer';
}

function orderNumber(order) {
  return order?.name || (order?.order_number ? `#${order.order_number}` : String(order?.id || ''));
}

function orderTotal(order) {
  const amount = order?.total_price || order?.current_total_price || '0';
  const currency = order?.currency || 'INR';
  if (currency === 'INR') return `₹${amount}`;
  return `${currency} ${amount}`;
}

function invoiceUrl(order) {
  const token = order?.token;
  if (token) return `${config.storeInvoiceBaseUrl}/${order.id}?token=${token}`;
  if (order?.order_status_url) return order.order_status_url;
  return `${config.storeInvoiceBaseUrl}`;
}

function trackingInfo(orderOrFulfillment) {
  const f =
    orderOrFulfillment?.tracking_number != null
      ? orderOrFulfillment
      : (orderOrFulfillment?.fulfillments || []).find((x) => x.tracking_number) ||
        (orderOrFulfillment?.fulfillments || [])[0] ||
        {};
  return {
    company: f.tracking_company || 'Carrier',
    number: f.tracking_number || '',
    url: f.tracking_url || (f.tracking_urls && f.tracking_urls[0]) || ''
  };
}

function alreadySent(key) {
  const log = readJson(LOG_FILE, { sent: {} });
  return Boolean(log.sent[key]);
}

function markSent(key, meta) {
  const log = readJson(LOG_FILE, { sent: {} });
  log.sent[key] = { at: new Date().toISOString(), ...meta };
  writeJson(LOG_FILE, log);
}

async function notify(event, order, extra = {}) {
  const phone = phoneFromOrder(order);
  if (!phone) {
    return { ok: false, skipped: true, reason: 'No customer phone on order' };
  }

  const name = customerName(order);
  const num = orderNumber(order);
  const id = order.id || order.admin_graphql_api_id || num;
  const dedupeKey = `${event}:${id}:${extra.fulfillmentId || ''}`;
  if (alreadySent(dedupeKey)) {
    return { ok: true, duplicate: true, key: dedupeKey };
  }

  let result;
  let plaintext;

  switch (event) {
    case 'order_confirmed': {
      const total = orderTotal(order);
      const inv = invoiceUrl(order);
      plaintext = `Hi ${name},\n\nThank you for shopping at ${config.storeName}!\nOrder ${num} confirmed. Total: ${total}.\n\nView invoice / order: ${inv}\n\nWe will update you here when it ships.`;
      result = await wa.sendTemplateOrText(
        phone,
        config.templates.orderConfirmed,
        [name, num, total, inv],
        plaintext
      );
      break;
    }
    case 'order_shipped': {
      const t = trackingInfo(extra.fulfillment || order);
      const track = t.url || t.number || 'N/A';
      plaintext = `Hi ${name},\n\nYour ${config.storeName} order ${num} has been shipped via ${t.company}.\nTrack: ${track}`;
      result = await wa.sendTemplateOrText(
        phone,
        config.templates.orderShipped,
        [name, num, t.company, track],
        plaintext
      );
      break;
    }
    case 'order_in_transit': {
      const t = trackingInfo(extra.fulfillment || order);
      const track = t.url || t.number || 'N/A';
      plaintext = `Hi ${name},\n\nYour ${config.storeName} order ${num} is in transit.\nTrack: ${track}`;
      result = await wa.sendTemplateOrText(
        phone,
        config.templates.orderInTransit,
        [name, num, track],
        plaintext
      );
      break;
    }
    case 'order_delivered': {
      plaintext = `Hi ${name},\n\nYour ${config.storeName} order ${num} has been delivered. Enjoy your drop!\nNeed a return or exchange? Reply here or visit your account.`;
      result = await wa.sendTemplateOrText(
        phone,
        config.templates.orderDelivered,
        [name, num],
        plaintext
      );
      break;
    }
    case 'order_cancelled': {
      plaintext = `Hi ${name},\n\nYour ${config.storeName} order ${num} has been cancelled. If this was unexpected, reply to this message.`;
      result = await wa.sendTemplateOrText(
        phone,
        config.templates.orderCancelled,
        [name, num],
        plaintext
      );
      break;
    }
    default:
      return { ok: false, error: `Unknown event ${event}` };
  }

  if (result.ok) {
    markSent(dedupeKey, { event, phone, mode: result.mode });
    try {
      inbox.recordOutbound(phone, {
        type: 'text',
        text: plaintext,
        id: result.data?.messages?.[0]?.id,
        by: 'orders-bot'
      });
    } catch (_) {
      /* inbox store optional */
    }
  }

  return { ...result, phone, event, key: dedupeKey };
}

module.exports = {
  phoneFromOrder,
  notify,
  invoiceUrl
};
