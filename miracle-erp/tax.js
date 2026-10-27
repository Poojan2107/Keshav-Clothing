const config = require('./config');

const STATE_MAP = {
  GJ: 'Gujarat',
  MH: 'Maharashtra',
  DL: 'Delhi',
  KA: 'Karnataka',
  TN: 'Tamil Nadu',
  RJ: 'Rajasthan',
  UP: 'Uttar Pradesh',
  WB: 'West Bengal',
  HR: 'Haryana',
  PB: 'Punjab',
  MP: 'Madhya Pradesh',
  AP: 'Andhra Pradesh',
  TS: 'Telangana',
  KL: 'Kerala',
  OR: 'Odisha',
  BR: 'Bihar',
  JH: 'Jharkhand',
  CT: 'Chhattisgarh',
  AS: 'Assam',
  GA: 'Goa',
  HP: 'Himachal Pradesh',
  UK: 'Uttarakhand',
  JK: 'Jammu and Kashmir'
};

function normalizeState(state) {
  if (!state) return config.defaultState;
  const s = String(state).trim();
  if (STATE_MAP[s.toUpperCase()]) return STATE_MAP[s.toUpperCase()];
  return s;
}

function isSameState(customerState) {
  return normalizeState(customerState).toLowerCase() === config.companyState.toLowerCase();
}

/**
 * Build Miracle item expdet from a GST % on a taxable (exclusive) amount.
 * Guide §8.3: Central Tax + State/UT Tax (intra) or Integrated Tax (inter).
 */
function buildTaxFromRate(taxableAmt, gstPercent, customerState) {
  const rate = Number(gstPercent) || config.defaultGstPercent;
  const amt = Number(taxableAmt) || 0;
  const half = Number(((amt * rate) / 200).toFixed(2));
  const full = Number(((amt * rate) / 100).toFixed(2));

  if (isSameState(customerState)) {
    return {
      invtyp: 'GST',
      gstPercent: rate,
      taxableAmt: amt,
      expdet: [
        { expnm: 'Central Tax', expper: rate / 2, expamt: half },
        { expnm: 'State/UT Tax', expper: rate / 2, expamt: half }
      ],
      taxTotal: Number((half * 2).toFixed(2))
    };
  }
  return {
    invtyp: 'IGST',
    gstPercent: rate,
    taxableAmt: amt,
    expdet: [{ expnm: 'Integrated Tax', expper: rate, expamt: full }],
    taxTotal: full
  };
}

/**
 * Back-calculate taxable + tax from a tax-inclusive gross line amount.
 * Used when Shopify order.taxes_included === true and tax_lines are absent.
 */
function buildTaxFromInclusive(grossAmt, gstPercent, customerState) {
  const rate = Number(gstPercent) || config.defaultGstPercent;
  const gross = Number(grossAmt) || 0;
  const taxable = Number((gross / (1 + rate / 100)).toFixed(2));
  const tax = buildTaxFromRate(taxable, rate, customerState);
  // Keep tax components summing to gross - taxable (rounding-safe)
  const taxTotal = Number((gross - taxable).toFixed(2));
  if (tax.invtyp === 'GST' && tax.expdet.length === 2) {
    const half = Number((taxTotal / 2).toFixed(2));
    const other = Number((taxTotal - half).toFixed(2));
    tax.expdet[0].expamt = half;
    tax.expdet[1].expamt = other;
  } else if (tax.expdet[0]) {
    tax.expdet[0].expamt = taxTotal;
  }
  tax.taxTotal = taxTotal;
  tax.taxableAmt = taxable;
  return tax;
}

/**
 * Prefer Shopify tax_lines when present (most accurate for KC store tax settings).
 */
function taxFromShopifyLine(lineItem, customerState) {
  const taxable = Number(lineItem.price) * Number(lineItem.quantity || 1);
  const lines = lineItem.tax_lines || [];
  if (!lines.length) {
    return buildTaxFromRate(taxable, lineItem._gst || config.defaultGstPercent, customerState);
  }

  const expdet = [];
  let taxTotal = 0;
  let rateSum = 0;

  for (const tl of lines) {
    const title = String(tl.title || tl.name || 'Tax');
    const price = Number(tl.price || 0);
    const rate = Number(tl.rate || 0) * (Number(tl.rate) <= 1 ? 100 : 1);
    taxTotal += price;
    rateSum += rate;

    let expnm = title;
    if (/igst|integrated/i.test(title)) expnm = 'Integrated Tax';
    else if (/cgst|central/i.test(title)) expnm = 'Central Tax';
    else if (/sgst|state|ut/i.test(title)) expnm = 'State/UT Tax';

    expdet.push({
      expnm: expnm.slice(0, 20),
      expper: Number(rate.toFixed(2)),
      expamt: Number(price.toFixed(2))
    });
  }

  const invtyp = !isSameState(customerState) || /integrated|igst/i.test(expdet.map((e) => e.expnm).join(' '))
    ? 'IGST'
    : 'GST';

  return {
    invtyp,
    gstPercent: rateSum || config.defaultGstPercent,
    expdet,
    taxTotal: Number(taxTotal.toFixed(2))
  };
}

/** Discount as voucher-level expdet (Guide lists Discount in expdet examples). */
function discountExpdet(amount) {
  const n = Math.abs(Number(amount) || 0);
  if (!n) return null;
  return { expnm: 'Discount', expper: 0, expamt: -Number(n.toFixed(2)) };
}

module.exports = {
  normalizeState,
  isSameState,
  buildTaxFromRate,
  buildTaxFromInclusive,
  taxFromShopifyLine,
  discountExpdet
};
