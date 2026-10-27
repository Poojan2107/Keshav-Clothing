# Miracle ERP — Handoff (Keshav Clothing)

**Updated:** 2026-10-27  
**Middleware:** `d:\kc\integrations\miracle-erp` (v2.1)  
**API:** `https://tpaapi.miracleclouderp.com/`

---

## Status (verified live)

| Check | Result |
|-------|--------|
| Miracle `CLAuth/Authenticate` | **PASS** (R0007 cleared after TPA recharge) |
| Account create | **PASS** (`ca574f9e9f`) |
| Product create | **PASS** (`KC-E2E-TEE-01`) |
| Sales Bill SS | **PASS** voucher `10272026652366761150` / bill `SH-900001` |
| Idempotent replay | **PASS** (no second voucher) |
| Single-branch company | **OK** (`TPA029` — expected) |
| Bill-to-Bill on voucher | **OFF** (`TPA020` — company has B2B setup disabled; `MIRACLE_ENABLE_B2B=0`) |

---

## Credit-safe rules (mandatory)

1. **Do not** run full `npm run sync:products` unless `MIRACLE_ALLOW_FULL_PRODUCT_SYNC=1` — it upserts every SKU and burns credits. Products create on **first order**.
2. **Do not** poll `/health?pingMiracle=1` or `/preflight` in a loop — each auth/branch call costs credits.
3. Default `/health` does **not** call Miracle.
4. Re-running `npm run test:order` / `npm run safe-e2e` is **idempotent** for the fixed E2E order (`9000000001`).
5. Sevensoft: use API carefully — prefer one real paid test order after webhook is live, not repeated mocks.

---

## Company-specific API facts (learned)

| Issue | Fix in code |
|-------|-------------|
| Account rejects `voutyp` | Removed from Account payload |
| Account rejects `ismapallbranch` (TPA029) | Removed |
| `b2btype` must be `N\|O\|A\|P\|U` | Config `MIRACLE_B2B_TYPE=N` |
| Bill-to-Bill setup disabled (TPA020) | `MIRACLE_ENABLE_B2B=0` — no `b2bdet` on vouchers |
| Shopify prices often tax-inclusive | Uses `taxes_included` + inclusive tax split |

---

## Go-live checklist (Render — prepared)

Full steps: **`RENDER_GO_LIVE.md`** + **`render.yaml`**

1. Deploy `kc-miracle-erp` on Render (Starter, disk `/var/data`) — separate from Customer Ops.
2. Paste Miracle + Shopify webhook secrets in Render Environment.
3. Shopify webhook → Miracle host `/webhooks/shopify/orders-create` (not Customer Ops).
4. One real paid test order → confirm Sales Bill `SH-<order_number>` in Miracle.

---

## Commands

| Command | Credits | Purpose |
|---------|---------|---------|
| `npm run preflight` | ~1–2 | Config + auth |
| `npm run test:auth` | ~1 | Auth only |
| `npm run test:order` | 0 if already mapped | Idempotent E2E mock |
| `npm run safe-e2e` | minimal | Local + auth + idempotent checks |
| `npm run sync:products:pull` | 0 Miracle | Shopify catalog cache only |
| `npm start` | 0 until webhooks | Webhook server |

---

## Contact note

Integration path is working end-to-end against Miracle.  
**Do not batch-create products.** Wire Shopify webhook → one real order confirmation.
