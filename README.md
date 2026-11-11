# Lodg Meta Ads report

A one-page performance report for Lodg's Sole Trader Signups campaign, published with GitHub Pages at https://leanindigital.github.io/lodg-report/.

## How it fits together

- `index.html`, `styles.css`, `app.js`: the page. No build step.
- `data/meta-daily.json`: one row per ad per day since the campaign started, straight from Meta. Written by the daily refresh; do not hand-edit. The page adds these rows up for whatever date range the viewer picks, so every Meta figure (totals, funnel, ad sets, top ads, the full ad table and the comparison with the previous period) follows the date filter.
- `data/commentary.json`: findings, next steps, takeaways and budget notes. Changed by hand only; the refresh never touches it. It is shown with its review date because it describes the period it was written for.
- `data/google.json`: the Google Ads tab. Still updated by hand.
- `scripts/fetch-meta.mjs`: pulls the daily rows from the Meta Marketing API and checks they add up to Meta's own totals before writing.
- `scripts/validate.mjs`: checks the shape of `meta-daily.json` and that the other data files parse.
- `.github/workflows/refresh.yml`: the daily refresh and publish.

## Date filter

Presets: last 3, 7, 14 and 30 days, this month, last month, campaign to date, plus custom from/to dates. The chosen range is kept in the URL (for example `#from=2026-10-01&to=2026-10-31` or `#range=last7`), so a link to a specific range can be shared or bookmarked.

## Daily refresh

GitHub Actions runs `refresh.yml` at 19:45 and 20:45 UTC: 8:45am and 9:45am NZ daylight time, or 7:45am and 8:45am NZ standard time. Either way, fresh figures are live by 9am NZ. Each run fetches campaign start to yesterday (NZ time), validates, commits `data/` and redeploys Pages. If anything fails, nothing is deployed, the live page keeps the previous figures, and GitHub emails the repo admins. The page shows a "not refreshed" notice if the data is more than 30 hours old.

To refresh on demand, open **Actions → Refresh and publish report → Run workflow**.

### One-time setup

1. **Meta token.** In Meta Business Settings → Users → System users, create (or reuse) a system user and give it the Lodg ad account (act_845136617574788) with at least "View performance". Generate a token for it with the `ads_read` permission and expiry set to **Never**. A system user token is not tied to anyone's personal login, so it doesn't lapse when a password changes or a session expires.
2. **Secret.** In this repo, open Settings → Secrets and variables → Actions → New repository secret, name it `META_ACCESS_TOKEN` and paste the token.
3. **Pages source.** In Settings → Pages, set Source to **GitHub Actions**.
4. Run the workflow once by hand (Actions tab → Run workflow) to backfill the data.

If Meta ever rejects the token, the run fails with a message saying so; generate a new system user token and replace the secret.

## Definitions

- Results: Meta `lead` action count for this Leads campaign. This is not the same as Lodg registrations.
- Registrations: Meta `complete_registration` action.
- Clicks: all clicks. Link clicks: `inline_link_clicks`. Landing-page views: `landing_page_view` action.
- Figures use each ad set's own attribution setting, matching Ads Manager. Conversions are dated to the day the ad was seen or clicked (Meta's default), so the most recent days can still rise as late leads are attributed; each daily run refetches the whole campaign, so those updates are picked up.
