# Keshav Clothing — customer-ops go-live checklist

WhatsApp order updates via Meta Cloud API. OTP stays on Axentra SMS.

## Prerequisites

- [x] KC WhatsApp `+91 93284 15350` migrated → **Cloud API · Registered**
- [x] Permanent / long-lived `META_WHATSAPP_TOKEN` (System User preferred; temp tokens expire ~24h)
- [x] `META_PHONE_NUMBER_ID` = `1382070738327178`
- [x] `META_WABA_ID` / Messaging account = `2655808998186290`
- [ ] Utility templates **Approved** (`kc_order_confirmed` done; others In review)
- [ ] Shopify Admin token with `read_orders` (+ `write_orders` optional) — optional for webhook-only path
- [ ] Public HTTPS host for this service

## Host (pick one)

### A) Railway / Render / Fly (recommended)

1. Create new Node service from `integrations/customer-ops`
2. Set start command: `npm start`
3. Port: use `PORT` env (default `3002`)
4. Paste all vars from `.env.example` (never commit `.env`)
5. Set `PUBLIC_BASE_URL=https://your-app.up.railway.app` (or your domain)
6. Set `SKIP_WEBHOOK_HMAC=0` and `SHOPIFY_WEBHOOK_SECRET=<from Shopify>` once webhooks exist

### B) Quick tunnel (dev only)

```bash
cd integrations/customer-ops
npm start
npm run tunnel
```

Copy the `https://….trycloudflare.com` URL into `PUBLIC_BASE_URL` and Shopify webhooks.

## Shopify webhooks

Admin → Settings → Notifications → Webhooks (or Apps → custom app):

| Event | URL |
|-------|-----|
| Order creation | `https://HOST/webhooks/shopify/orders-create` |
| Fulfillment creation | `https://HOST/webhooks/shopify/fulfillments-create` |
| Fulfillment update | `https://HOST/webhooks/shopify/fulfillments-update` |
| Order cancellation | `https://HOST/webhooks/shopify/orders-cancelled` |

Format: JSON. Copy signing secret → `SHOPIFY_WEBHOOK_SECRET`.

## Meta webhooks (optional — delivery status)

In Developers → WhatsApp → Configuration:

- Callback URL: `https://HOST/webhooks/meta` (if implemented) or skip until needed
- Verify token: same as `META_WEBHOOK_VERIFY_TOKEN` in `.env`

Outbound order messages do **not** require Meta inbound webhooks.

## Smoke tests

```bash
npm run test:wa -- 91XXXXXXXXXX
npm run templates:create   # submit if not yet created
```

Then place a `KCZERO` / ₹0 test order → confirm WhatsApp on customer phone.

## Switch from test → KC number

| Env | Test | Production (live) |
|-----|------|------------|
| `META_PHONE_NUMBER_ID` | `1304508476089992` | `1382070738327178` |
| `META_WABA_ID` | `39734293056184080` | `2655808998186290` |
| Sender shown to customer | +1 555… | +91 93284 15350 |

## Channel split (do not change)

| Channel | Use |
|---------|-----|
| Axentra SMS | OTP only |
| Meta WhatsApp | Order updates |
| Axentra WhatsApp OTP | OFF |
