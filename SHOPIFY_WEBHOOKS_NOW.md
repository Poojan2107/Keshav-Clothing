# Shopify → WhatsApp auto updates (live)

**Host:** `https://inbox.keshavclothing.com`

These webhooks send WhatsApp templates automatically from **+91 93284 15350**:

| When (Shopify / Shiprocket) | WhatsApp template |
|-----------------------------|-------------------|
| Order created | `kc_order_confirmed` (name, order #, total, invoice link) |
| Fulfillment created (Shiprocket ships) | `kc_order_shipped` (courier + tracking URL) |
| Fulfillment update → in transit / OFD | `kc_order_in_transit` |
| Fulfillment update → delivered | `kc_order_delivered` |
| Order cancelled | `kc_order_cancelled` |

Shiprocket does **not** need a separate WhatsApp connection. Connect Shiprocket → Shopify so tracking lands on the Shopify fulfillment; our webhooks do the rest.

## Shopify Admin — add webhooks

**Settings → Notifications → Webhooks** (JSON format):

| Event | Callback URL |
|-------|----------------|
| Order creation | `https://inbox.keshavclothing.com/webhooks/shopify/orders-create` |
| Fulfillment creation | `https://inbox.keshavclothing.com/webhooks/shopify/fulfillments-create` |
| Fulfillment update | `https://inbox.keshavclothing.com/webhooks/shopify/fulfillments-update` |
| Order cancellation | `https://inbox.keshavclothing.com/webhooks/shopify/orders-cancelled` |

Copy the webhook **signing secret** into Render Environment:

```
SHOPIFY_WEBHOOK_SECRET=whsec_...
SKIP_WEBHOOK_HMAC=0
```

(If HMAC is still skipped in Render, set `SKIP_WEBHOOK_HMAC=0` after the secret is saved.)

## Shiprocket checklist

1. Shiprocket channel = your Shopify store (orders sync).  
2. When you ship in Shiprocket, Shopify fulfillment gets **tracking number + tracking URL**.  
3. That triggers **Fulfillment creation / update** → WhatsApp shipped / in-transit / delivered.

## Phone requirement

WhatsApp goes to the **phone on the Shopify order** (shipping address preferred). Orders without a valid mobile will be skipped.

## Test

1. Place a small order with your WhatsApp number on the address.  
2. You should get **order confirmed**.  
3. Create fulfillment / ship via Shiprocket with tracking.  
4. You should get **shipped** (then in-transit / delivered as status updates).

Or simulate confirmed only:

```bash
cd integrations/customer-ops
node scripts/simulate_order_webhook.js 91XXXXXXXXXX
```
