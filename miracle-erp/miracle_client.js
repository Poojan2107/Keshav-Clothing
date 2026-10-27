const axios = require('axios');
const https = require('https');
const config = require('./config');
const {
  normalizeState,
  buildTaxFromRate,
  buildTaxFromInclusive,
  taxFromShopifyLine,
  discountExpdet
} = require('./tax');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Miracle Cloud ERP TPA Client — Guide v1.3 aligned for Keshav Clothing.
 */
class MiracleERPClient {
  constructor(cfg = {}) {
    this.baseUrl = cfg.baseUrl || config.baseUrl;
    this.urlKey = cfg.urlKey || config.urlKey;
    this.clientId = cfg.clientId || config.clientId;
    this.apiKey = cfg.apiKey || config.apiKey;
    this.authToken = null;
    this.tokenExpiresAt = 0;
  }

  async authenticate(force = false) {
    if (!this.urlKey || !this.clientId || !this.apiKey) {
      throw new Error('Missing Miracle credentials (MIRACLE_URL_KEY / CLIENT_ID / API_KEY).');
    }
    // Reuse in-memory token — every Authenticate call burns TPA credits
    if (!force && this.authToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.authToken;
    }
    const url = `${this.baseUrl}CLAuth/Authenticate?urlKey=${encodeURIComponent(this.urlKey)}`;
    const response = await axios.post(url, null, {
      headers: { clientId: this.clientId, apiKey: this.apiKey },
      httpsAgent,
      validateStatus: () => true
    });
    const data = response.data;
    if (data && !data.IsError && data.DataModel && data.DataModel.token) {
      this.authToken = data.DataModel.token;
      this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
      console.log('[Miracle ERP] Authenticated successfully.');
      return this.authToken;
    }
    const msg = (data && data.Message) || `Authentication failed (HTTP ${response.status})`;
    const code = data && data.ErrorCode ? ` [${data.ErrorCode}]` : '';
    const err = new Error(`${msg}${code}`);
    err.miracle = data;
    throw err;
  }

  async getValidToken() {
    return this.authenticate(false);
  }

  async post(endpointPath, payload) {
    const token = await this.getValidToken();
    const url = `${this.baseUrl}${endpointPath.replace(/^\//, '')}`;
    try {
      const response = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        httpsAgent,
        validateStatus: () => true
      });
      const data = response.data;
      if (data && data.IsError) {
        console.warn(`[Miracle ERP Error ${data.ErrorCode}]: ${data.Message}`);
        if (data.DataModel) console.warn('[Miracle ERP Error Detail]:', JSON.stringify(data.DataModel));
      }
      return data;
    } catch (err) {
      if (err.response && err.response.status === 401) {
        this.authToken = null;
        return this.post(endpointPath, payload);
      }
      throw err;
    }
  }

  async get(endpointPath, params = {}) {
    const token = await this.getValidToken();
    const url = `${this.baseUrl}${endpointPath.replace(/^\//, '')}`;
    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params,
        httpsAgent,
        validateStatus: () => true
      });
      return response.data;
    } catch (err) {
      if (err.response && err.response.status === 401) {
        this.authToken = null;
        return this.get(endpointPath, params);
      }
      throw err;
    }
  }

  static productNameFromShopify(item, overridePrdnm) {
    if (overridePrdnm) return String(overridePrdnm).slice(0, 15);
    const sku = (item.sku || '').trim();
    if (sku) return sku.slice(0, 15);
    const raw = (item.name || item.title || 'ITEM').replace(/\s+/g, ' ').trim();
    return raw.slice(0, 15) || 'ITEM';
  }

  static customerNameFromShopify(order) {
    if (order.customer) {
      const n = `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim();
      if (n) return n.slice(0, 60);
    }
    const addr = order.shipping_address || order.billing_address;
    if (addr) {
      const n = `${addr.first_name || ''} ${addr.last_name || ''}`.trim();
      if (n) return n.slice(0, 60);
    }
    return 'Shopify Retail Customer';
  }

  async upsertAccount(accountData) {
    const isEdit = Boolean(accountData.uniqueId);
    const payload = {
      action: isEdit ? 'E' : 'A',
      accnm: accountData.name,
      accgrpnm: accountData.groupName || config.defaultCustomerGroup,
      balmethod: accountData.balMethod || config.defaultAccountBalMethod,
      addr: {
        statenm: normalizeState(accountData.state || config.defaultState),
        citynm: (accountData.city || '').slice(0, 25),
        pincode: (accountData.pincode || '').slice(0, 6),
        addr1: (accountData.address1 || '').slice(0, 50),
        addr2: (accountData.address2 || '').slice(0, 50),
        mob1: (accountData.mobile || '').slice(0, 20),
        email: (accountData.email || '').slice(0, 50)
      },
      // Single-branch companies reject ismapallbranch / voutyp on Account (TPA029 / 410)
    };
    if (!isEdit) {
      payload.regtypedet = accountData.registrationDetail || config.defaultRegistrationDetail;
    }
    if (accountData.gstin) payload.gstin = String(accountData.gstin).slice(0, 15);
    if (accountData.pan) payload.panno = String(accountData.pan).slice(0, 10);
    if (isEdit) payload.uniqueId = accountData.uniqueId;
    return await this.post('TPA/M2/V1/Account', payload);
  }

  async upsertProduct(productData) {
    const prdnm = String(productData.name || 'ITEM').slice(0, 15);
    const gst = Number(productData.gstRate || config.defaultGstPercent);
    const hsn = String(productData.hsnCode || config.defaultHsn).replace(/\s/g, '').slice(0, 8);
    const isEdit = Boolean(productData.uniqueId);

    if (isEdit) {
      return await this.post('TPA/M2/V1/Product', {
        action: 'E',
        uniqueId: productData.uniqueId,
        prdnm,
        ...(productData.alias ? { prdalinm: String(productData.alias).slice(0, 15) } : {}),
        salrate: Number(productData.price || 0)
      });
    }

    return await this.post('TPA/M2/V1/Product', {
      action: 'A',
      prdnm,
      ...(productData.alias ? { prdalinm: String(productData.alias).slice(0, 15) } : {}),
      grpnm: String(productData.group || config.defaultProductGroup).slice(0, 25),
      slabnm: productData.slabName || config.defaultSlab,
      commnm: hsn.slice(0, 8),
      uomnm: productData.unit || config.defaultUom,
      hsncode: String(productData.hsnCode || config.defaultHsn).replace(/\s/g, '').slice(0, 16),
      gstper: gst,
      salrate: Number(productData.price || 0),
      prdstp: {
        isstkreq: productData.stockRequired || config.stockRequired,
        isbatchstk: 'N',
        islocstk: config.defaultLocation ? 'Y' : 'N',
        ispricelist: 'N'
      }
    });
  }

  /**
   * Build + post Sales Bill SS from prepared lines.
   * lines: [{ prd, qty, rate, gst?, shopifyLine? }]
   */
  async createSalesBill(shopifyOrder, accountUniqueId, lines, options = {}) {
    const address = shopifyOrder.shipping_address || shopifyOrder.billing_address || {};
    const customerState = address.province || address.province_code || config.defaultState;
    const billno = String(shopifyOrder.order_number || shopifyOrder.name || Date.now())
      .replace(/^#/, '')
      .slice(0, 32);
    const billdt = new Date(shopifyOrder.created_at || Date.now()).toISOString().split('T')[0];

    const items = [];
    let goodsTotal = 0;
    let taxTotal = 0;
    let invtyp = config.invtyp;
    const taxesIncluded = Boolean(shopifyOrder.taxes_included);

    lines.forEach((line, idx) => {
      const qty = Number(line.qty);
      const grossRate = Number(line.rate);
      const grossAmt = Number((qty * grossRate).toFixed(2));
      const gst = line.gst || config.defaultGstPercent;

      let tax;
      let taxableAmt = grossAmt;
      let rate = grossRate;

      if (line.shopifyLine && line.shopifyLine.tax_lines && line.shopifyLine.tax_lines.length) {
        line.shopifyLine._gst = gst;
        tax = taxFromShopifyLine(line.shopifyLine, customerState);
        if (taxesIncluded) {
          taxableAmt = Number((grossAmt - tax.taxTotal).toFixed(2));
          rate = qty ? Number((taxableAmt / qty).toFixed(4)) : taxableAmt;
        } else {
          taxableAmt = grossAmt;
        }
      } else if (taxesIncluded) {
        tax = buildTaxFromInclusive(grossAmt, gst, customerState);
        taxableAmt = tax.taxableAmt;
        rate = qty ? Number((taxableAmt / qty).toFixed(4)) : taxableAmt;
      } else {
        tax = buildTaxFromRate(grossAmt, gst, customerState);
        taxableAmt = grossAmt;
      }

      invtyp = tax.invtyp;
      goodsTotal += taxableAmt;
      taxTotal += tax.taxTotal;

      const item = {
        prd: line.prd,
        seqno: idx + 1,
        qty1: qty,
        rate,
        amt: taxableAmt,
        expdet: tax.expdet
      };
      if (config.defaultBatch) item.batchnm = config.defaultBatch;
      if (config.defaultLocation) item.locnm = config.defaultLocation;
      items.push(item);
    });

    let billamt = Number((goodsTotal + taxTotal).toFixed(2));
    const voucherExpdet = [];

    const discount = Math.abs(parseFloat(shopifyOrder.total_discounts || 0));
    if (discount > 0) {
      const d = discountExpdet(discount);
      if (d) {
        voucherExpdet.push(d);
        billamt = Number((billamt - discount).toFixed(2));
      }
    }

    // Prefer Shopify payable total when within ₹1 (rounding) — avoids inclusive/exclusive drift
    const shopifyTotal = parseFloat(
      shopifyOrder.current_total_price || shopifyOrder.total_price || NaN
    );
    if (!Number.isNaN(shopifyTotal) && shopifyTotal >= 0) {
      const diff = Math.abs(billamt - shopifyTotal);
      if (diff <= 1) {
        billamt = shopifyTotal;
      } else {
        console.warn(
          `[Miracle ERP] billamt ${billamt} vs Shopify total ${shopifyTotal} (diff ${diff}) — keeping computed billamt`
        );
      }
    }

    const payload = {
      action: 'A',
      voutyp: config.salesVoucherType || 'SS',
      billdt,
      billno: `SH-${billno}`.slice(0, 35),
      acc: accountUniqueId,
      billamt: Math.max(billamt, 0),
      flgcd: options.flgcd || config.flgcd || 'D',
      invtyp: invtyp || config.invtyp,
      taxtyp: config.taxtyp || 'T',
      narr: `Shopify ${shopifyOrder.name || shopifyOrder.order_number} / id:${shopifyOrder.id || ''} / ${shopifyOrder.financial_status || ''} / ${shopifyOrder.gateway || (shopifyOrder.payment_gateway_names || []).join(',') || 'Online'}`.slice(0, 2500),
      items
    };

    if (voucherExpdet.length) payload.expdet = voucherExpdet;

    if (config.ufdJson) {
      try {
        payload.ufddet = JSON.parse(config.ufdJson);
      } catch (_) {
        console.warn('[Miracle ERP] MIRACLE_UFD_JSON invalid; skipped');
      }
    }

    // Bill-to-bill only when company has B2B enabled (else TPA020)
    // b2btype codes: N|O|A|P|U
    if (config.enableB2b) {
      payload.b2bdet = {
        [accountUniqueId]: {
          b2btype: config.b2bType || 'N',
          b2badj: [
            {
              reftyp: 'N',
              b2bamt: payload.billamt,
              prtdet: payload.billno,
              b2bcrdays: 0,
              b2bcrdb: 'D'
            }
          ]
        }
      };
    }

    return await this.post('TPA/M2/V1/Voucher', payload);
  }

  /** Guide §8.6 — Cash/Bank Receipt against customer after prepaid order */
  async createPaymentReceipt(accountUniqueId, amount, shopifyOrder) {
    if (!config.cashOrBankAccountId) {
      throw new Error('MIRACLE_CASH_BANK_ACC_ID required for payment receipt');
    }
    const voudt = new Date(shopifyOrder.created_at || Date.now()).toISOString().split('T')[0];
    const payload = {
      action: 'A',
      voutyp: config.receiptVoutyp || 'CR',
      voudt,
      acc: accountUniqueId,
      oppacc: config.cashOrBankAccountId,
      amount: Number(amount),
      taxtyp: 'O',
      narr: `Shopify payment ${shopifyOrder.name || shopifyOrder.id}`.slice(0, 2500)
    };
    if (config.receiptVoutyp === 'BR') {
      payload.cheqdt = voudt;
    }
    return await this.post('TPA/M2/V1/Voucher', payload);
  }

  async getAccount(uniqueId) {
    return await this.get('TPA/M2/V1/GetAccount', { id: uniqueId });
  }

  async getProduct(uniqueId) {
    return await this.get('TPA/M2/V1/GetProduct', { id: uniqueId });
  }

  async getVoucher(uniqueId) {
    return await this.get('TPA/M2/V1/GetVoucher', { id: uniqueId });
  }

  async getProductStock(uniqueId) {
    return await this.get('TPA/M2/V1/GetProductOpening', { id: uniqueId });
  }

  async getBranchList() {
    return await this.get('TPA/M2/V1/GetBranchList');
  }

  async pingAuth() {
    try {
      await this.getValidToken();
      return { ok: true, message: 'Authenticated', cached: Boolean(this.authToken) };
    } catch (err) {
      return {
        ok: false,
        message: err.message,
        errorCode: err.miracle && err.miracle.ErrorCode
      };
    }
  }
}

module.exports = MiracleERPClient;
