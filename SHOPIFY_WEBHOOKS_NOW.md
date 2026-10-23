# Shopify webhooks — wire now (tunnel live)

**Public host (keep PC awake; tunnel + `npm start` must stay running):**  
`https://attitudes-exploration-tvs-former.trycloudflare.com`

> Quick tunnel URL changes if you restart cloudflared. For always-on, deploy Render (`render.yaml`) and replace HOST below.

## Add in Shopify Admin

**Settings → Notifications → Webhooks** (or custom app webhooks). Format: **JSON**.

| Event | Callback URL |
|-------|----------------|
| Order creation | `https://attitudes-exploration-tvs-former.trycloudflare.com/webhooks/shopify/orders-create` |
| Fulfillment creation | `https://attitudes-exploration-tvs-former.trycloudflare.com/webhooks/shopify/fulfillments-create` |
| Fulfillment update | `https://attitudes-exploration-tvs-former.trycloudflare.com/webhooks/shopify/fulfillments-update` |
| Order cancellation | `https://attitudes-exploration-tvs-former.trycloudflare.com/webhooks/shopify/orders-cancelled` |

After creating, copy the **signing secret** into `.env`:

```
SHOPIFY_WEBHOOK_SECRET=whsec_...
SKIP_WEBHOOK_HMAC=0
```

Until the secret is set, local/tunnel tests use `SKIP_WEBHOOK_HMAC=1` (already on).

## Smoke test without Shopify

```bash
cd integrations/customer-ops
node scripts/simulate_order_webhook.js 91XXXXXXXXXX
```

## Live test

Place a small / KCZERO order with a real WhatsApp phone on the address. Customer should get **kc_order_confirmed** from `+91 93284 15350`.
