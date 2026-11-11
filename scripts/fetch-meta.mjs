// Pulls daily, ad-level Meta figures for the Lodg campaign and writes data/meta-daily.json.
//
// Usage: META_ACCESS_TOKEN=... node scripts/fetch-meta.mjs
//
// The page adds these daily rows up for whatever date range the viewer picks, so this file is
// the only thing the daily refresh needs to change. Before writing, the script checks that the
// daily ad rows add up to Meta's own campaign total for the same window; if they don't, it
// exits non-zero and leaves the existing file alone.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CONFIG = {
  accountId: "845136617574788",
  campaignId: "120251238096060660",
  campaignStart: "2026-09-26",
  timezone: "Pacific/Auckland",
  apiVersion: process.env.META_API_VERSION || "v25.0",
  graphBase: process.env.META_GRAPH_BASE || "https://graph.facebook.com",
  // Friendly ad-set names shown on the page. New ad sets fall back to their Meta name.
  adsetLabels: {
    "120251238096080660": "Video/Reels",
    "120251376213170660": "Static"
  }
};

// First match wins, so nothing is counted twice under two action types.
// Leads are website (pixel) leads only, which is what Ads Manager reports as "Results" for this
// campaign. Meta's broader "lead" count also includes on-Facebook form leads, which Ads Manager
// leaves out of Results.
const ACTION_TYPES = {
  leads: ["offsite_conversion.fb_pixel_lead"],
  registrations: ["complete_registration", "omni_complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
  landingPageViews: ["landing_page_view", "omni_landing_page_view"]
};
const FIELDS = ["impressions", "clicks", "linkClicks", "landingPageViews", "leads", "registrations", "spend"];
const OUT = new URL("../data/meta-daily.json", import.meta.url);
const CHUNK_DAYS = 31;

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN is not set. Add it under the repo's Settings → Secrets and variables → Actions.");
  process.exit(1);
}

// ---------- dates (all in the ad account's NZ timezone) ----------
function todayIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function nzOffsetIso(tz) {
  // e.g. 2026-11-10T09:02:11+13:00
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offMin = Math.round((local - Math.floor(now.getTime() / 1000) * 1000) / 60000);
  const sign = offMin >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offMin) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offMin) % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hh}:${mm}`;
}

// ---------- Graph API ----------
async function graph(url, attempt = 1) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const err = body.error || {};
  // 1/2/4/17/32/613 are Meta's transient and rate-limit codes.
  const transient = res.status >= 500 || [1, 2, 4, 17, 32, 613].includes(err.code);
  if (transient && attempt < 5) {
    const wait = 2000 * 2 ** (attempt - 1);
    console.warn(`Meta returned ${res.status} (${err.message || "no message"}), retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return graph(url, attempt + 1);
  }
  if (err.code === 190) throw new Error(`Meta rejected the access token (${err.message}). Create a new System User token and update the META_ACCESS_TOKEN secret.`);
  throw new Error(`Meta API error ${res.status}: ${err.message || JSON.stringify(body)}`);
}

function insightsUrl(params) {
  const u = new URL(`${CONFIG.graphBase}/${CONFIG.apiVersion}/act_${CONFIG.accountId}/insights`);
  for (const [k, v] of Object.entries({ ...params, access_token: token })) u.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  return u.toString();
}

async function allPages(url) {
  const rows = [];
  while (url) {
    const page = await graph(url);
    rows.push(...(page.data || []));
    url = page.paging?.next || null;
  }
  return rows;
}

function pickAction(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return Math.round(Number(hit.value) || 0);
  }
  return 0;
}

function metricsOf(r) {
  return {
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    linkClicks: Number(r.inline_link_clicks) || 0,
    landingPageViews: pickAction(r.actions, ACTION_TYPES.landingPageViews),
    leads: pickAction(r.actions, ACTION_TYPES.leads),
    registrations: pickAction(r.actions, ACTION_TYPES.registrations),
    spend: Math.round((Number(r.spend) || 0) * 100) / 100
  };
}

const COMMON = {
  fields: "ad_id,ad_name,adset_id,adset_name,campaign_name,impressions,clicks,inline_link_clicks,actions,spend",
  filtering: [{ field: "campaign.id", operator: "EQUAL", value: CONFIG.campaignId }],
  // Match Ads Manager: each ad set's own attribution setting.
  use_unified_attribution_setting: "true",
  limit: "500"
};

// ---------- main ----------
const until = addDays(todayIn(CONFIG.timezone), -1);
const since = CONFIG.campaignStart;
if (until < since) {
  console.error(`Nothing to fetch yet: campaign starts ${since}.`);
  process.exit(1);
}

const raw = [];
for (let start = since; start <= until; start = addDays(start, CHUNK_DAYS)) {
  const end = addDays(start, CHUNK_DAYS - 1) < until ? addDays(start, CHUNK_DAYS - 1) : until;
  console.log(`Fetching ${start} to ${end}…`);
  raw.push(...(await allPages(insightsUrl({ ...COMMON, level: "ad", time_increment: "1", time_range: { since: start, until: end } }))));
}

// Meta's own whole-window totals (per ad set, so attribution matches the daily rows), to cross-check.
const totalRows = await allPages(insightsUrl({ ...COMMON, fields: "adset_id,campaign_name,impressions,clicks,inline_link_clicks,actions,spend", level: "adset", time_range: { since, until } }));
const metaTotal = Object.fromEntries(FIELDS.map((f) => [f, 0]));
for (const r of totalRows) { const m = metricsOf(r); for (const f of FIELDS) metaTotal[f] += m[f]; }

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const adsets = {};
const ads = {};
const rows = [];
const sum = Object.fromEntries(FIELDS.map((f) => [f, 0]));
let campaignName = previous?.campaign?.name || totalRows[0]?.campaign_name || "";

for (const r of raw) {
  const m = metricsOf(r);
  if (FIELDS.every((f) => !m[f])) continue; // skip empty days to keep the file small
  campaignName = r.campaign_name || campaignName;
  adsets[r.adset_id] = CONFIG.adsetLabels[r.adset_id] || previous?.adsets?.[r.adset_id] || r.adset_name;
  ads[r.ad_id] = { name: r.ad_name, adsetId: r.adset_id };
  rows.push([r.date_start, r.ad_id, ...FIELDS.map((f) => m[f])]);
  for (const f of FIELDS) sum[f] += m[f];
}
rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

// ---------- cross-check ----------
const problems = [];
for (const f of FIELDS) {
  const diff = Math.abs(sum[f] - metaTotal[f]);
  // Spend can drift by a few cents from rounding each day.
  const allowed = f === "spend" ? Math.max(0.5, metaTotal.spend * 0.001) : 0;
  if (diff > allowed) problems.push(`${f}: daily ad rows add up to ${sum[f]} but Meta's campaign total is ${metaTotal[f]}`);
}
if (rows.length === 0) problems.push("Meta returned no rows for this campaign.");
if (previous && sum.spend + 1 < (previous.totals?.spend || 0)) problems.push(`Campaign spend went down (was ${previous.totals.spend}, now ${sum.spend.toFixed(2)}); refusing to overwrite.`);

if (problems.length) {
  console.error("Not publishing. The figures failed these checks:\n- " + problems.join("\n- "));
  process.exit(1);
}

const out = {
  updatedAt: nzOffsetIso(CONFIG.timezone),
  source: `Meta Ads (act_${CONFIG.accountId})`,
  currency: "NZD",
  timezone: CONFIG.timezone,
  campaign: { id: CONFIG.campaignId, name: campaignName, start: CONFIG.campaignStart },
  since,
  through: until,
  fields: FIELDS,
  totals: Object.fromEntries(FIELDS.map((f) => [f, f === "spend" ? Math.round(sum[f] * 100) / 100 : sum[f]])),
  adsets,
  ads,
  rows
};

writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`Wrote ${rows.length} daily rows, ${since} to ${until}: ${sum.leads} leads, NZ$${sum.spend.toFixed(2)} spend, ${Object.keys(ads).length} ads.`);
