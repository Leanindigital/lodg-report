// Checks data/report.json before it is published.
// Usage: node scripts/validate.mjs   (exits 1 and lists problems if anything is off)
import { readFileSync } from "node:fs";

const COUNT_FIELDS = ["impressions", "clicks", "linkClicks", "landingPageViews", "leads", "registrations"];
const FIELDS = [...COUNT_FIELDS, "spend"];
const SPEND_TOLERANCE = 0.05;

const errors = [];
const fail = (msg) => errors.push(msg);

let d;
try {
  d = JSON.parse(readFileSync(new URL("../data/report.json", import.meta.url), "utf8"));
  JSON.parse(readFileSync(new URL("../data/commentary.json", import.meta.url), "utf8"));
} catch (e) {
  console.error("Could not parse JSON:", e.message);
  process.exit(1);
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const dayNum = (s) => Date.parse(s + "T00:00:00Z") / 86400000;

function checkMetrics(obj, where) {
  if (!obj || typeof obj !== "object") return fail(`${where}: missing`);
  for (const f of FIELDS) {
    const v = obj[f];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(`${where}.${f} must be a non-negative number (got ${JSON.stringify(v)})`);
    else if (COUNT_FIELDS.includes(f) && !Number.isInteger(v)) fail(`${where}.${f} must be a whole number (got ${v})`);
  }
  if (obj.clicks < obj.linkClicks) fail(`${where}: link clicks (${obj.linkClicks}) exceed all clicks (${obj.clicks})`);
  if (obj.impressions < obj.clicks) fail(`${where}: clicks (${obj.clicks}) exceed impressions (${obj.impressions})`);
}

function sumOf(rows) {
  const t = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const r of rows) for (const f of FIELDS) t[f] += r[f] || 0;
  return t;
}

function compare(expected, actual, where) {
  for (const f of FIELDS) {
    const diff = Math.abs((expected[f] || 0) - (actual[f] || 0));
    const ok = f === "spend" ? diff <= SPEND_TOLERANCE : diff === 0;
    if (!ok) fail(`${where}: ${f} is ${actual[f]} but should be ${expected[f]}`);
  }
}

// Top-level
if (Number.isNaN(Date.parse(d.updatedAt))) fail("updatedAt must be an ISO timestamp");
if (!d.campaign?.id || !isDate(d.campaign?.start)) fail("campaign.id and campaign.start are required");

// Windows
const td = d.toDate || {};
for (const [k, w] of [["toDate", td], ["last7", d.last7], ["prev7", d.prev7]]) {
  if (!w || !isDate(w.since) || !isDate(w.until) || w.since > w.until) fail(`${k}: since/until must be valid dates in order`);
}
if (errors.length === 0) {
  if (td.since !== d.campaign.start) fail(`toDate.since (${td.since}) should equal campaign.start (${d.campaign.start})`);
  if (d.last7.until !== td.until) fail(`last7.until (${d.last7.until}) should equal toDate.until (${td.until})`);
  if (dayNum(d.last7.until) - dayNum(d.last7.since) !== 6) fail("last7 must cover exactly 7 days");
  if (dayNum(d.prev7.until) - dayNum(d.prev7.since) !== 6) fail("prev7 must cover exactly 7 days");
  if (dayNum(d.last7.since) - dayNum(d.prev7.until) !== 1) fail("prev7 must end the day before last7 starts");
  if (Date.parse(td.until) > Date.parse(d.updatedAt)) fail("toDate.until is after updatedAt");
}

// Metrics and reconciliation
checkMetrics(td.campaignTotals, "toDate.campaignTotals");
checkMetrics(d.last7?.totals, "last7.totals");
checkMetrics(d.prev7?.totals, "prev7.totals");

const adsets = td.adsets || [];
const ads = td.ads || [];
if (adsets.length === 0) fail("toDate.adsets is empty");
const adsetIds = new Set();
adsets.forEach((s, i) => {
  if (!s.id || !s.label) fail(`toDate.adsets[${i}] needs id and label`);
  if (adsetIds.has(s.id)) fail(`duplicate ad set id ${s.id}`);
  adsetIds.add(s.id);
  checkMetrics(s, `adset "${s.label}"`);
});
const adIds = new Set();
ads.forEach((a, i) => {
  if (!a.id || !a.name) fail(`toDate.ads[${i}] needs id and name`);
  if (adIds.has(a.id)) fail(`duplicate ad id ${a.id}`);
  adIds.add(a.id);
  if (!adsetIds.has(a.adsetId)) fail(`ad "${a.name}" points at unknown ad set ${a.adsetId}`);
  checkMetrics(a, `ad "${a.name}"`);
});

if (errors.length === 0) {
  compare(td.campaignTotals, sumOf(adsets), "Sum of ad sets vs campaign totals");
  for (const s of adsets) compare(s, sumOf(ads.filter((a) => a.adsetId === s.id)), `Sum of ads in "${s.label}" vs ad set`);
}

if (errors.length) {
  console.error(`report.json failed ${errors.length} check(s):\n- ` + errors.join("\n- "));
  process.exit(1);
}
const t = td.campaignTotals;
console.log(`report.json OK: ${td.since} to ${td.until}, ${adsets.length} ad sets, ${ads.length} ads, ${t.leads} leads, NZ$${t.spend.toFixed(2)} spend.`);
