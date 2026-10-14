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
  JSON.parse(readFileSync(new URL("../data/google.json", import.meta.url), "utf8"));
} catch (e) {
  console.error("Could not parse JSON:", e.message);
  process.exit(1);
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const dayNum = (s) => Date.parse(s + "T00:00:00Z") / 86400000;

function checkTotals(obj, where) {
  if (!obj || typeof obj !== "object") return fail(`${where}: missing`);
  for (const f of FIELDS) {
    const v = obj[f];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(`${where}.${f} must be a non-negative number (got ${JSON.stringify(v)})`);
    else if (COUNT_FIELDS.includes(f) && !Number.isInteger(v)) fail(`${where}.${f} must be a whole number (got ${v})`);
  }
  if (obj.clicks < obj.linkClicks) fail(`${where}: link clicks (${obj.linkClicks}) exceed all clicks (${obj.clicks})`);
  if (obj.impressions < obj.clicks) fail(`${where}: clicks (${obj.clicks}) exceed impressions (${obj.impressions})`);
}

const AD_FIELDS = ["impressions", "clicks", "linkClicks", "landingPageViews", "leads", "registrations", "spend"];
function sumOf(rows, fields) {
  const t = Object.fromEntries(fields.map((f) => [f, 0]));
  for (const r of rows) for (const f of fields) t[f] += r[f] || 0;
  return t;
}

function compare(expected, actual, where, fields) {
  for (const f of fields) {
    const diff = Math.abs((expected[f] || 0) - (actual[f] || 0));
    const ok = f === "spend" ? diff <= SPEND_TOLERANCE : diff === 0;
    if (!ok) fail(`${where}: ${f} is ${actual[f]} but should be ${expected[f]}`);
  }
}

// Top-level
if (Number.isNaN(Date.parse(d.updatedAt))) fail("updatedAt must be an ISO timestamp");
if (!d.campaign?.id || !isDate(d.campaign?.start)) fail("campaign.id and campaign.start are required");

const periods = d.periods || {};
for (const key of ["last3", "last7", "toDate"]) {
  const p = periods[key];
  if (!p || !isDate(p.since) || !isDate(p.until) || p.since > p.until) {
    fail(`periods.${key}: since/until must be valid dates in order`);
    continue;
  }
  checkTotals(p.totals, `periods.${key}.totals`);
  if (!p.adsets || p.adsets.length === 0) fail(`periods.${key}.adsets is empty`);
  else {
    p.adsets.forEach((s, i) => {
      if (!s.id || !s.label) fail(`periods.${key}.adsets[${i}] needs id and label`);
      checkTotals(s, `periods.${key} adset "${s.label}"`);
    });
    compare(p.totals, sumOf(p.adsets, FIELDS), `periods.${key}: sum of ad sets vs totals`, FIELDS);
  }
}

if (periods.toDate && d.campaign.start !== periods.toDate.since) fail(`periods.toDate.since (${periods.toDate.since}) should equal campaign.start (${d.campaign.start})`);
if (periods.toDate && Date.parse(periods.toDate.until) > Date.parse(d.updatedAt)) fail("periods.toDate.until is after updatedAt");

// Momentum (fixed 7-day comparison, independent of the period selector)
const mom = d.momentum || {};
for (const [k, w] of [["last7", mom.last7], ["prev7", mom.prev7]]) {
  if (!w || !isDate(w.since) || !isDate(w.until) || w.since > w.until) fail(`momentum.${k}: since/until must be valid dates in order`);
}
if (mom.last7 && mom.prev7) {
  if (dayNum(mom.last7.until) - dayNum(mom.last7.since) !== 6) fail("momentum.last7 must cover exactly 7 days");
  if (dayNum(mom.prev7.until) - dayNum(mom.prev7.since) !== 6) fail("momentum.prev7 must cover exactly 7 days");
  if (dayNum(mom.last7.since) - dayNum(mom.prev7.until) !== 1) fail("momentum.prev7 must end the day before momentum.last7 starts");
  checkTotals(mom.last7.totals, "momentum.last7.totals");
  checkTotals(mom.prev7.totals, "momentum.prev7.totals");
}

// Ads (campaign-to-date detail, used for top ads + full table)
const ads = d.ads || [];
const adsetIds = new Set(Object.keys(d.adsetLabels || {}));
if (ads.length === 0) fail("ads is empty");
const adIds = new Set();
ads.forEach((a, i) => {
  if (!a.id || !a.name) fail(`ads[${i}] needs id and name`);
  if (adIds.has(a.id)) fail(`duplicate ad id ${a.id}`);
  adIds.add(a.id);
  if (!adsetIds.has(a.adsetId)) fail(`ad "${a.name}" points at unknown ad set ${a.adsetId}`);
  checkTotals(a, `ad "${a.name}"`);
});

if (errors.length === 0 && periods.toDate) {
  for (const s of periods.toDate.adsets) {
    compare(s, sumOf(ads.filter((a) => a.adsetId === s.id), AD_FIELDS), `Sum of ads in "${s.label}" vs toDate ad set`, AD_FIELDS);
  }
}

if (errors.length) {
  console.error(`report.json failed ${errors.length} check(s):\n- ` + errors.join("\n- "));
  process.exit(1);
}
const t = periods.toDate.totals;
console.log(`report.json OK: ${periods.toDate.since} to ${periods.toDate.until}, ${periods.toDate.adsets.length} ad sets, ${ads.length} ads, ${t.leads} leads, NZ$${t.spend.toFixed(2)} spend.`);
