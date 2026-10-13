# Lodg Meta Ads report

A one-page performance report for Lodg's Sole Trader Signups campaign, published with GitHub Pages.

## How it fits together

- `index.html`, `styles.css`, `app.js`: the page. No build step; `app.js` reads the two data files and calculates every derived figure (cost per lead, CTR, deltas, rankings).
- `data/report.json`: raw Meta figures. Replaced each morning by the scheduled refresh. Do not hand-edit.
- `data/commentary.json`: findings, next steps, takeaways and budget notes. Only changed by hand when Logan asks; the refresh never touches it.
- `scripts/validate.mjs`: run before every publish. Checks the shape of `report.json` and that ads add up to ad sets and ad sets add up to the campaign.

## Daily refresh

A scheduled agent runs at 7:00am NZ time. It pulls campaign-to-date (26 Sep 2026 to yesterday), last 7 days and the previous 7 days from Meta, rewrites `data/report.json`, runs `node scripts/validate.mjs`, and only pushes if validation passes. If a run fails, the page keeps showing the previous data and flags it as stale after 36 hours.

## Definitions

- Leads: Meta `lead` action (pixel Lead event). Not reconciled with Lodg's registrations.
- Registrations: Meta `complete_registration` action.
- Clicks: all clicks. Link clicks: `inline_link_clicks`. Landing-page views: `landing_page_view` action.
- Figures use each ad set's own attribution setting, matching Ads Manager.
