# Keshav Clothing — Meta WhatsApp order updates (ours, not Axentra)

**Decision:** Axentra WhatsApp is not available.  
**OTP** = Axentra SMS only.  
**Order updates** = our Meta Cloud API service (`customer-ops`).

---

## What you send me (required)

From [Meta Business Suite](https://business.facebook.com) → **WhatsApp Accounts** → your number → **API Setup** (or Developers → App → WhatsApp → API Setup):

1. **Phone number ID** → `META_PHONE_NUMBER_ID`
2. **Permanent access token** (System User token preferred) → `META_WHATSAPP_TOKEN`
3. Optional but useful: **WhatsApp Business Account ID** → `META_WABA_ID`

Paste them here in chat (or put in `integrations/customer-ops/.env` yourself).  
Do **not** paste into GitHub / public places.

Also from Shopify Admin → Apps → Develop apps (or existing admin token):

4. **Admin API access token** with at least `read_orders`, `write_orders` → `SHOPIFY_ADMIN_TOKEN`

---

## Templates to create in Meta (Utility category)

| Name | Body |
|------|------|
| `kc_order_confirmed` | Hi {{1}}, your Keshav Clothing order {{2}} is confirmed. Total {{3}}. Invoice/order: {{4}} |
| `kc_order_shipped` | Hi {{1}}, order {{2}} has been shipped via {{3}}. Track: {{4}} |
| `kc_order_in_transit` | Hi {{1}}, order {{2}} is in transit. Track: {{3}} |
| `kc_order_delivered` | Hi {{1}}, order {{2}} has been delivered. Thank you for shopping Keshav Clothing! |
| `kc_order_cancelled` | Hi {{1}}, order {{2}} has been cancelled. Reply if you need help. |

Submit → wait until status = **Approved**.

Until approved, the service can try plaintext fallback only inside an open 24h chat window (not reliable for new orders).

---

## After credentials land

```bash
cd integrations/customer-ops
cp .env.example .env
# fill META_* + SHOPIFY_ADMIN_TOKEN
npm install
npm start
npm run test:wa -- 91YOURNUMBER
```

Host with public HTTPS (Railway / Render / VPS / `npm run tunnel`), then in Shopify:

**Settings → Notifications → Webhooks**

| Event | URL |
|-------|-----|
| Order creation | `https://YOUR_HOST/webhooks/shopify/orders-create` |
| Fulfillment creation | `https://YOUR_HOST/webhooks/shopify/fulfillments-create` |
| Fulfillment update | `https://YOUR_HOST/webhooks/shopify/fulfillments-update` |
| Order cancellation | `https://YOUR_HOST/webhooks/shopify/orders-cancelled` |

---

## Axentra (unchanged)

- OTP delivery = **SMS ON**, WhatsApp OTP = **OFF**
- Redirect = `/pages/ax-customer-dashboard`
