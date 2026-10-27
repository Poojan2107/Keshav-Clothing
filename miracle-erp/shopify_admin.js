const axios = require('axios');
const config = require('./config');

/**
 * Shopify Admin REST client for Keshav Clothing.
 * Auth options:
 *  1) SHOPIFY_ADMIN_TOKEN (legacy shpat_…)
 *  2) SHOPIFY_API_CLIENT_ID + SHOPIFY_API_CLIENT_SECRET (Dev Dashboard → client_credentials)
 */
class ShopifyAdminClient {
  constructor() {
    this.shop = config.shopifyShop;
    this.staticToken = config.shopifyAdminToken;
    this.clientId = config.shopifyApiClientId;
    this.clientSecret = config.shopifyApiClientSecret;
    this.apiVersion = config.shopifyApiVersion;
    this._accessToken = null;
    this._tokenExpiresAt = 0;
  }

  get configured() {
    return Boolean(
      this.shop && (this.staticToken || (this.clientId && this.clientSecret))
    );
  }

  base() {
    if (!this.shop) {
      throw new Error('Set SHOPIFY_SHOP (e.g. keshav-clothing-2.myshopify.com) in .env');
    }
    return `https://${this.shop}/admin/api/${this.apiVersion}`;
  }

  /**
   * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
   */
  async getAccessToken({ allowStatic = true } = {}) {
    if (this._accessToken && Date.now() < this._tokenExpiresAt - 60_000) {
      return this._accessToken;
    }

    // Prefer client_credentials when configured — static shpat tokens often expire
    if (this.clientId && this.clientSecret) {
      const url = `https://${this.shop}/admin/oauth/access_token`;
      const res = await axios.post(
        url,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        },
        {
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true
        }
      );

      if (res.status < 400 && res.data && res.data.access_token) {
        this._accessToken = res.data.access_token;
        const expiresIn = Number(res.data.expires_in || 86399);
        this._tokenExpiresAt = Date.now() + expiresIn * 1000;
        console.log(
          `[Shopify] Access token acquired (scopes: ${res.data.scope || 'n/a'}, expires_in: ${expiresIn}s)`
        );
        return this._accessToken;
      }

      console.warn(
        `[Shopify] client_credentials failed (HTTP ${res.status}); falling back if static token set`
      );
    }

    if (allowStatic && this.staticToken) return this.staticToken;

    throw new Error(
      'Shopify Admin not configured. Set SHOPIFY_API_CLIENT_ID + SHOPIFY_API_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN)'
    );
  }

  async request(method, path, params) {
    if (!this.configured) {
      throw new Error(
        'Shopify Admin not configured. Set SHOPIFY_SHOP + Client ID/Secret (or SHOPIFY_ADMIN_TOKEN) in .env'
      );
    }

    const token = await this.getAccessToken();
    const url = `${this.base()}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await axios({
      method,
      url,
      params,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });

    if (res.status === 401 && !this.staticToken) {
      // refresh once
      this._accessToken = null;
      this._tokenExpiresAt = 0;
      const token2 = await this.getAccessToken();
      const res2 = await axios({
        method,
        url,
        params,
        headers: {
          'X-Shopify-Access-Token': token2,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      });
      if (res2.status === 401 || res2.status === 403) {
        throw new Error(
          `Shopify Admin auth failed (HTTP ${res2.status}). Re-install app / check scopes read_products, read_orders.`
        );
      }
      if (res2.status >= 400) {
        throw new Error(
          `Shopify Admin ${method} ${path} → HTTP ${res2.status}: ${JSON.stringify(res2.data).slice(0, 300)}`
        );
      }
      return res2;
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Shopify Admin auth failed (HTTP ${res.status}). Check credentials / scopes read_products, read_orders.`
      );
    }
    if (res.status >= 400) {
      throw new Error(
        `Shopify Admin ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`
      );
    }
    return res;
  }

  async fetchAllProducts() {
    const products = [];
    let pageInfo = null;
    let guard = 0;

    while (guard < 200) {
      guard += 1;
      const res = await this.request(
        'GET',
        pageInfo ? `/products.json?limit=50&page_info=${pageInfo}` : '/products.json',
        pageInfo ? undefined : { limit: 50 }
      );

      const batch = res.data.products || [];
      for (const p of batch) {
        const meta = await this.fetchProductMetafields(p.id);
        products.push(this.normalizeProduct(p, meta));
      }

      const link = res.headers.link || res.headers.Link || '';
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      if (!next) break;
      const u = new URL(next[1]);
      pageInfo = u.searchParams.get('page_info');
      if (!pageInfo) break;
    }

    return products;
  }

  async fetchProductMetafields(productId) {
    try {
      const res = await this.request('GET', `/products/${productId}/metafields.json`);
      return res.data.metafields || [];
    } catch (err) {
      console.warn(`[Shopify] metafields for ${productId}:`, err.message);
      return [];
    }
  }

  metaValue(metafields, namespace, key) {
    const m = (metafields || []).find((f) => f.namespace === namespace && f.key === key);
    return m ? String(m.value) : null;
  }

  normalizeProduct(product, metafields) {
    const hsn =
      this.metaValue(metafields, config.shopifyHsnNamespace, config.shopifyHsnKey) ||
      this.metaValue(metafields, 'global', 'hsn') ||
      null;
    const gstRaw =
      this.metaValue(metafields, config.shopifyGstNamespace, config.shopifyGstKey) ||
      this.metaValue(metafields, 'global', 'gst_rate') ||
      null;
    const gst = gstRaw != null && gstRaw !== '' ? Number(gstRaw) : null;

    return {
      shopifyProductId: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      productType: product.product_type || '',
      vendor: product.vendor || '',
      tags: product.tags || '',
      hsn,
      gst,
      variants: (product.variants || []).map((v) => ({
        shopifyVariantId: v.id,
        sku: (v.sku || '').trim(),
        title: v.title,
        price: v.price,
        barcode: v.barcode || '',
        inventoryQuantity: v.inventory_quantity
      }))
    };
  }

  async fetchOrder(orderId) {
    const res = await this.request('GET', `/orders/${orderId}.json`);
    return res.data.order;
  }

  async ping() {
    await this.getAccessToken();
    const res = await this.request('GET', '/products.json', { limit: 1 });
    return {
      ok: true,
      productSample: (res.data.products || [])[0]?.title || null,
      countHint: (res.data.products || []).length
    };
  }
}

module.exports = ShopifyAdminClient;
