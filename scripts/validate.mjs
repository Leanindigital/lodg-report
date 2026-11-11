// Checks data/meta-daily.json (and that the other data files parse) before publishing.
// Usage: node scripts/validate.mjs   (exits 1 and lists problems if anything is off)
import { readFileSync } from "node:fs";

const FIELDS = ["impressions", "clicks", "linkClicks", "landingPageViews", "leads", "registrations", "spend"];
const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const read = (p) => JSON.parse(readFileSync(new URL("../data/" + p, import.meta.url), "utf8"));

let d;
try {
  d = read("meta-daily.json");
  read("commentary.json");
  read("google.json");
} catch (e) {
  console.error("Could not parse JSON:", e.message);
  process.exit(1);
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

if (Number.isNaN(Date.parse(d.updatedAt))) fail("updatedAt must be an ISO timestamp");
if (!d.campaign?.id || !isDate(d.campaign?.start)) fail("campaign.id and campaign.start are required");
if (!isDate(d.since) || !isDate(d.through) || d.since > d.through) fail("since/through must be valid dates in order");
if (d.since !== d.campaign?.start) fail(`since (${d.since}) should equal campaign.start (${d.campaign?.start})`);
if (JSON.stringify(d.fields) !== JSON.stringify(FIELDS)) fail(`fields must be ${JSON.stringify(FIELDS)}`);
if (!Array.isArray(d.rows) || d.rows.length === 0) fail("rows is empty");

const sum = Object.fromEntries(FIELDS.map((f) => [f, 0]));
const seen = new Set();
(d.rows || []).forEach((r, i) => {
  const [date, adId, ...vals] = r;
  if (!isDate(date) || date < d.since || date > d.through) fail(`rows[${i}]: date ${date} is outside ${d.since}–${d.through}`);
  const ad = d.ads?.[adId];
  if (!ad) fail(`rows[${i}]: unknown ad ${adId}`);
  else if (!d.adsets?.[ad.adsetId]) fail(`ad ${adId} points at unknown ad set ${ad.adsetId}`);
  const key = date + "|" + adId;
  if (seen.has(key)) fail(`rows[${i}]: duplicate row for ${key}`);
  seen.add(key);
  if (vals.length !== FIELDS.length) return fail(`rows[${i}]: expected ${FIELDS.length} values, got ${vals.length}`);
  vals.forEach((v, j) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(`rows[${i}].${FIELDS[j]} must be a non-negative number`);
    else if (FIELDS[j] !== "spend" && !Number.isInteger(v)) fail(`rows[${i}].${FIELDS[j]} must be a whole number`);
    sum[FIELDS[j]] += v;
  });
  // Meta counts "clicks (all)" and link clicks separately, so on small days link clicks can
  // exceed all clicks (or clicks exceed impressions). That's Meta's data, not a broken file,
  // so note it without blocking the refresh.
  const [imp, clicks, link] = vals;
  if (clicks > imp) warnings.push(`rows[${i}]: clicks (${clicks}) exceed impressions (${imp})`);
  if (link > clicks) warnings.push(`rows[${i}]: link clicks (${link}) exceed all clicks (${clicks})`);
});

if (warnings.length) console.log(`Note: ${warnings.length} row(s) where Meta's click counts don't nest (expected on small days):\n- ` + warnings.slice(0, 10).join("\n- "));

for (const f of FIELDS) {
  const diff = Math.abs(sum[f] - (d.totals?.[f] ?? NaN));
  if (!(diff <= (f === "spend" ? 0.05 : 0))) fail(`totals.${f} is ${d.totals?.[f]} but rows add up to ${sum[f]}`);
}

if (errors.length) {
  console.error(`meta-daily.json failed ${errors.length} check(s):\n- ` + errors.slice(0, 40).join("\n- "));
  process.exit(1);
}
console.log(`meta-daily.json OK: ${d.since} to ${d.through}, ${Object.keys(d.adsets).length} ad sets, ${Object.keys(d.ads).length} ads, ${d.rows.length} rows, ${sum.leads} leads, NZ$${sum.spend.toFixed(2)} spend.`);
