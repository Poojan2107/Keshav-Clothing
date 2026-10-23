# Keshav Clothing — Customer Ops

**Channel split (confirmed with store):**
- **OTP login** → **SMS only** (Axentra Authentication settings — do not enable WhatsApp OTP)
- **Order updates / invoice / shipped / transit / delivered** → **WhatsApp** (Meta Cloud API via this service, or Axentra WhatsApp module)

WhatsApp order updates (Meta Cloud API), optional OTP API (unused if Axentra SMS is primary), and Return/Exchange intake.

## Axentra OTP / Profile outage (live diagnosis 2026-10-21)

OTP "Failed to fetch" / profile load failures come from Axentra, not the theme.

| Check | Result |
|-------|--------|
| Endpoint | `POST https://omc.axentraos.co.in/auth_merchant/otp_signup/` |
| Response | **400** `{"error":"Shop access token not found. Please reinstall the app."}` |

**Fix (Shopify Admin — do this first for OTP/profile):**

1. Apps → **The Customer Command Centre / Axentra**
2. **Uninstall** then **reinstall**, or open the app and reconnect / grant shop access again
3. Confirm OTP send works on `/pages/ax-customer-dashboard`
4. If still broken, contact Axentra support with the error above

Until that token is restored, Axentra login and profile will keep failing on devices.

---

## What this service does

| Feature | Route |
|---------|--------|
| Request OTP (Meta WA) | `POST /api/otp/request` `{ "phone": "9913624703" }` |
| Verify OTP | `POST /api/otp/verify` `{ "phone": "...", "otp": "123456" }` |
| Return / Exchange | `POST /api/returns` |
| Order placed → WA + invoice link | `POST /webhooks/shopify/orders-create` |
| Shipped / in transit / delivered | `POST /webhooks/shopify/fulfillments-create` + `fulfillments-update` |
| Cancelled | `POST /webhooks/shopify/orders-cancelled` |

## Setup

```bash
cd integrations/customer-ops
cp .env.example .env
# fill META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID, SHOPIFY_ADMIN_TOKEN
npm install
npm start
# tunnel for Shopify webhooks:
npm run tunnel
```

### Meta (you said Meta Verified — use this WABA)

1. [Meta Business Suite](https://business.facebook.com) → WhatsApp → API Setup  
2. Copy **Phone number ID** + permanent **Access token** into `.env`  
3. Create & submit these **message templates** (or rename in `.env` to match yours):

| Template name | Body idea |
|---------------|-----------|
| `kc_order_confirmed` | Hi {{1}}, order {{2}} confirmed. Total {{3}}. Invoice: {{4}} |
| `kc_order_shipped` | Hi {{1}}, order {{2}} shipped via {{3}}. Track: {{4}} |
| `kc_order_in_transit` | Hi {{1}}, order {{2}} in transit. Track: {{3}} |
| `kc_order_delivered` | Hi {{1}}, order {{2}} delivered. |
| `kc_order_cancelled` | Hi {{1}}, order {{2}} cancelled. |
| `kc_otp` | Your Keshav Clothing code is {{1}} |

4. Test: `npm run test:wa -- 91XXXXXXXXXX`

### Shopify webhooks (Admin → Settings → Notifications → Webhooks)

Point each to your public HTTPS URL (tunnel / host):

| Event | Path |
|-------|------|
| Order creation | `/webhooks/shopify/orders-create` |
| Fulfillment creation | `/webhooks/shopify/fulfillments-create` |
| Fulfillment update | `/webhooks/shopify/fulfillments-update` |
| Order cancellation | `/webhooks/shopify/orders-cancelled` |

Set `SHOPIFY_WEBHOOK_SECRET` and `SKIP_WEBHOOK_HMAC=0` in production.

### Theme

- Return / Exchange form: page template `page.returns` → section `main-returns`
- Account order cards link to `/pages/returns?order=...`
- Set theme setting / meta `kc_customer_ops_url` to your public API base (see section schema)

## Invoice on WhatsApp

Order-confirmed message includes Shopify order status / account invoice URL.  
For PDF invoices: connect Order Printer / GST app and put the PDF URL into a future `document` send (`wa.sendDocument`).
