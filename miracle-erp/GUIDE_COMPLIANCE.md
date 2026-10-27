# TPA Guide v1.3 — Compliance (KC v2.1)

| Guide section | Implementation | Status |
|---------------|----------------|--------|
| §3 Base URL / TPA enabled | `MIRACLE_BASE_URL` | PASS |
| §5 Auth headers + urlKey | `miracle_client.authenticate` (token reused in-process) | PASS (live) |
| §2 action A/E, IsError, paths, ufddet U-codes only | client + optional `MIRACLE_UFD_JSON` | PASS |
| §6 Account + regtypedet | `upsertAccount` (no `voutyp` / `ismapallbranch` — KC single-branch) | PASS (live) |
| §7 Product prdnm≤15, HSN, slab, UOM, prdstp | `upsertProduct` on first order; full sync gated | PASS (live) |
| §8.3 SS billdt/billno/acc/flgcd/invtyp/taxtyp/items | `createSalesBill` | PASS (live) |
| §8.3 expdet Central/State or Integrated | `tax.js` (`taxes_included` + tax_lines) | PASS (live) |
| §8.3 b2bdet | only if `MIRACLE_ENABLE_B2B=1` (KC: TPA020 → off) | PASS |
| §8.6 CR/BR receipt | optional `MIRACLE_POST_PAYMENT_RECEIPT` | PASS (config) |
| §10 GetProductOpening | `id` query | PASS |
| §12 GetAccount / GetProduct / GetVoucher | implemented | PASS |
| §18 GetBranchList | `TPA029` treated as single-branch OK | PASS |
| Shopify catalog cache | `sync:products:pull` | PASS |
| Shipping / discounts / idempotency | handler + `data/id-map.json` | PASS (live) |
| Live API | E2E Sales Bill `SH-900001` | PASS (2026-10-27) |

Run: `npm run preflight` · `npm run safe-e2e`
