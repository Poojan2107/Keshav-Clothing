# Keshav Clothing — Shopify → Miracle ERP (v2.1)

Guide-aligned middleware: Shopify orders become Miracle **Sales Bills (`voutyp: SS`)**.  
Also pulls the KC product catalog from Shopify Admin into Miracle Product masters.

## What is covered (no loose ends on our side)

| Flow | Guide | Status |
|------|-------|--------|
| Auth | §5 | Done |
| Customer Account + branch map | §6 | Done (`regtype`+`regappdt`) |
| Product master (SKU≤15, HSN, GST slab) | §7 | Done |
| Sales Bill SS + items + tax expdet | §8.3 | Done |
| Bill-to-bill new ref | §8.3 | Done when balmethod Bill to Bill |
| Shipping as product line | SS items | Done (`SHIP-KC`) |
| Discounts | expdet Discount | Done |
| CGST/SGST vs IGST by state | §8.3 | Done (+ Shopify tax_lines when present) |
| Optional Cash/Bank receipt | §8.6 | Config flag |
| GetAccount / GetProduct / GetVoucher / Opening / Branches | §10–12, §18 | Done |
| Shopify product pull + metafields HSN/GST | — | Done (needs Admin token) |
| Per-SKU overrides | — | `data/product-overrides.json` |
| Idempotent order sync | — | `data/id-map.json` |
| Preflight | — | `npm run preflight` |

## Setup

```powershell
cd d:\kc\integrations\miracle-erp
copy .env.example .env
# fill Miracle + Shopify Admin token
npm install
npm run preflight
npm start
```

### Shopify Admin token (for product pull)

1. Shopify Admin → **Settings → Apps and sales channels → Develop apps**
2. Create app → Admin API → enable **`read_products`**, **`read_orders`**
3. Install → copy Admin API access token into `.env` as `SHOPIFY_ADMIN_TOKEN`
4. Set `SHOPIFY_SHOP=your-store.myshopify.com`

```powershell
npm run sync:products:pull   # catalog only → data/shopify-catalog.json
npm run sync:products        # catalog + upsert Miracle products (needs Miracle auth)
```

Optional product metafields on Shopify:

- `custom.hsn` → HSN  
- `custom.gst_rate` → GST %  

Or edit `data/product-overrides.json` per SKU.

### Webhooks

| Event | URL |
|-------|-----|
| Order creation | `https://YOUR-HOST/webhooks/shopify/orders-create` |
| Order payment (optional) | `https://YOUR-HOST/webhooks/shopify/orders-paid` |

## Commands

| Command | Purpose |
|---------|---------|
| `npm run preflight` | Guide + config + Miracle auth checklist |
| `npm run verify` | HTTP path smoke test |
| `npm run test:auth` | Miracle token |
| `npm run test:order` | Mock order → SS |
| `npm run sync:products` | Pull Shopify → Miracle products |
| `npm start` | Webhook server |

## Live status (2026-10-27)

Miracle recharge cleared. E2E mock Sales Bill **PASS** (`SH-900001`).  

**Deploy:** `RENDER_GO_LIVE.md` + `render.yaml` (Render Starter, separate from Customer Ops).

**Do not** full-sync products into Miracle (`MIRACLE_ALLOW_FULL_PRODUCT_SYNC` gated) — burns credits per SKU.
