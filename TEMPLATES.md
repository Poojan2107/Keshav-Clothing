# WhatsApp Utility templates — Keshav Clothing

Submit in **WhatsApp Manager → Message templates** (or `npm run templates:create`).

Category for all: **Utility** · Language: **English (`en`)**

| Name | Body |
|------|------|
| `kc_order_confirmed` | Hi {{1}}, your Keshav Clothing order {{2}} is confirmed. Total {{3}}. Invoice/order: {{4}} |
| `kc_order_shipped` | Hi {{1}}, order {{2}} has been shipped via {{3}}. Track: {{4}} |
| `kc_order_in_transit` | Hi {{1}}, order {{2}} is in transit. Track: {{3}} |
| `kc_order_delivered` | Hi {{1}}, order {{2}} has been delivered. Thank you for shopping Keshav Clothing! |
| `kc_order_cancelled` | Hi {{1}}, order {{2}} has been cancelled. Reply if you need help. |

### Example values (for Meta sample fields)

| # | Example |
|---|---------|
| {{1}} | Rahul |
| {{2}} | #1005 |
| {{3}} | ₹1,999 / Shiprocket / tracking URL (depends on template) |
| {{4}} | https://keshavclothing.com/account/orders |

Wait until status = **Approved** before production order sends.
