# Tomorrow — Meta WhatsApp go-live (only remaining work)

Everything else for this ticket is done on our side.  
**Blocked only on Meta credentials** (Business admin / WhatsApp API Setup).

## Bring / refresh these values

From Meta Business Suite → WhatsApp → API Setup:

1. `META_WHATSAPP_TOKEN` — **permanent System User token** (temp tokens expire in hours)  
2. `META_PHONE_NUMBER_ID` — Phone number ID (KC: `1012286128632378` once Connected)  
3. Optional: `META_WABA_ID` (KC WABA: `1598472397942314`)

Templates: `TEMPLATES.md` or `npm run templates:create` after a fresh token.  
Host checklist: `GO_LIVE.md`.

Also useful: Shopify Admin token with `read_orders` (+ `write_orders` for return notes).

## Then we run (same day)

```bash
cd integrations/customer-ops
cp .env.example .env
# paste Meta + Shopify values
npm install
npm start
npm run test:wa -- 91XXXXXXXXXX
```

1. Host with public HTTPS (Railway / Render / VPS / Cloudflare tunnel)  
2. Shopify Admin → Settings → Notifications → Webhooks:

| Event | Path |
|-------|------|
| Order creation | `/webhooks/shopify/orders-create` |
| Fulfillment creation | `/webhooks/shopify/fulfillments-create` |
| Fulfillment update | `/webhooks/shopify/fulfillments-update` |
| Order cancellation | `/webhooks/shopify/orders-cancelled` |

3. Approve Meta utility templates (names in `.env.example`):  
   `kc_order_confirmed`, `kc_order_shipped`, `kc_order_in_transit`, `kc_order_delivered`, `kc_order_cancelled`

4. Place a ₹ test order → confirm WhatsApp with invoice link  
5. Mark fulfilled → confirm shipped / transit message  

Full detail: `META_SETUP.md` + `README.md`

## Channel split (do not change)

| Channel | Use |
|---------|-----|
| **SMS** (Axentra) | OTP login only |
| **WhatsApp** (our Meta service) | Order updates + invoice + shipping status |
| Axentra WhatsApp OTP | OFF |
