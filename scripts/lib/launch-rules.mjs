// Pure launch-gate rules for scripts/check-launch.mjs (unit-tested in
// tests/unit/launch-rules.test.mjs). Each function takes plain source data
// (frontmatter objects, product JSON, parsed config) and returns a list of
// blocker messages; an empty list means that rule passes. No file I/O.

/**
 * Every category and legal entry must be explicitly approved by the client.
 * @param {{ collection: string, id: string, approved: unknown }[]} entries
 */
export function approvalBlockers(entries) {
  return entries
    .filter((e) => e.approved !== true)
    .map(
      (e) =>
        `${e.collection}/${e.id}: approved is ${JSON.stringify(e.approved ?? null)}, must be true`,
    );
}

/**
 * Product size-table rules:
 * - sizesStatus "fixture" or "pending-transcription" never ships;
 * - a shipped table ("verified") needs a verification record with clientApproved
 *   true, an expectedRows count, and exactly that many CSV rows;
 * - sizesStatus "none" (no table) ships only with an explicit, non-empty
 *   launchException string recording the client-approved reason.
 * @param {{ id: string, data: object, csvRows: number | null }[]} products
 *   csvRows: data rows in sizes/<id>.csv, or null when there is no CSV.
 */
export function productBlockers(products) {
  const out = [];
  for (const { id, data: p, csvRows } of products) {
    const at = `products/${id}`;
    const status = p.sizesStatus;
    if (status === "fixture" || status === "pending-transcription") {
      out.push(`${at}: sizesStatus is "${status}"`);
      continue;
    }
    if (status === "none") {
      if (
        typeof p.launchException !== "string" ||
        p.launchException.trim() === ""
      )
        out.push(
          `${at}: sizesStatus is "none" with no launchException (record the client-approved reason for shipping without a size table)`,
        );
      continue;
    }
    if (status !== "verified") {
      out.push(`${at}: unknown sizesStatus "${status}"`);
      continue;
    }
    const v = p.verification;
    if (!v) out.push(`${at}: size table has verification: null`);
    else if (v.clientApproved !== true)
      out.push(`${at}: size table verification.clientApproved is not true`);
    if (!Number.isInteger(p.expectedRows) || p.expectedRows <= 0)
      out.push(`${at}: size table has no expectedRows`);
    else if (csvRows === null) out.push(`${at}: no size CSV`);
    else if (csvRows !== p.expectedRows)
      out.push(
        `${at}: size CSV has ${csvRows} row(s), expectedRows is ${p.expectedRows}`,
      );
  }
  return out;
}

/**
 * The legal pages say analytics is used; a configured provider without a token
 * means the built site sends nothing, so the legal copy would be false.
 * @param {{ analytics?: { provider?: string, token?: string } }} config parsed src/config.yaml
 */
export function analyticsBlockers(config) {
  const a = config?.analytics ?? {};
  if (a.provider && a.provider !== "none" && !(a.token ?? "").trim())
    return [
      `config.yaml: analytics.provider is "${a.provider}" but analytics.token is empty (the privacy and cookies pages say analytics is used; set the token, or set provider to "none" and correct the legal copy)`,
    ];
  return [];
}

/** Every price figure in src/data/pricing.json (grade from-prices and band prices). */
export function pricingFigures(pricing) {
  const figures = (pricing?.grades ?? []).map((g) => g.fromPrice);
  for (const p of Object.values(pricing?.products ?? {}))
    figures.push(...Object.values(p.prices ?? {}));
  return figures;
}

/**
 * Prices must not ship with an unconfirmed basis (what the price includes).
 * @param {{ basis: string, grades: object[], products: object }} pricing
 */
export function pricingBlockers(pricing) {
  const anyPrice = pricingFigures(pricing).some(
    (v) => v !== null && v !== undefined,
  );
  if (anyPrice && /TODO\(client\)/.test(pricing?.basis ?? ""))
    return [
      "data/pricing.json: basis still contains TODO(client) while prices are set",
    ];
  return [];
}

/** All launch blockers, in a stable order. */
export function launchBlockers({ approvals, products, config, pricing }) {
  return [
    ...approvalBlockers(approvals),
    ...productBlockers(products),
    ...analyticsBlockers(config),
    ...pricingBlockers(pricing),
  ];
}
