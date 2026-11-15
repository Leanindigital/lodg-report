(function () {
  "use strict";

  var TZ = "Pacific/Auckland";
  var STALE_AFTER_HOURS = 30;

  // ---------- formatting ----------
  var nf0 = new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function money(v) { return v == null ? "–" : "NZ$" + nf2.format(v); }
  function moneyShort(v) { return v == null ? "–" : "NZ$" + nf0.format(v); }
  function int(v) { return nf0.format(v || 0); }
  function pct(v) { return v == null ? "–" : nf2.format(v) + "%"; }
  function ratio(a, b) { return b > 0 ? a / b : null; }

  function dateLong(iso) {
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  function dateShort(iso) {
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });
  }
  function daysInclusive(since, until) {
    var a = Date.parse(since + "T00:00:00Z"), b = Date.parse(until + "T00:00:00Z");
    return Math.round((b - a) / 86400000) + 1;
  }
  function timestamp(iso) {
    return new Date(iso).toLocaleString("en-NZ", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ, timeZoneName: "short" });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(id) { return document.getElementById(id); }

  // Turn "Ad #6 - Refunding Users" into "Refunding Users"
  function shortAdName(name) {
    var m = /^Ad\s*#\s*\d+\s*-\s*(.+)$/i.exec(name);
    return (m ? m[1] : name).replace(/\.(png|jpe?g|mp4|mov)$/i, "").replace(/^["“”']|["“”']$/g, "");
  }

  function derive(t) {
    return {
      cpl: ratio(t.spend, t.leads),
      ctr: t.impressions ? (t.clicks / t.impressions) * 100 : null,
      linkCtr: t.impressions ? (t.linkClicks / t.impressions) * 100 : null
    };
  }

  // ---------- funnel ----------
  // stages: [{ label, value, rateLabel, rate, status: 'great'|'good'|'watch'|'poor'|null, note }]
  var STATUS_LABELS = { great: "Great - Above average", good: "Good - On track", watch: "Ok - Watch", poor: "Low - Take action" };
  function renderFunnel(containerId, stages) {
    var max = Math.max.apply(null, stages.map(function (s) { return s.value || 0; })) || 1;
    var html = stages.map(function (s, i) {
      var width = Math.max(6, (s.value / max) * 100);
      var statusCls = s.status ? " funnel__bar--" + s.status : "";
      var rateCls = s.status ? " funnel__rate--" + s.status : "";
      var statusLabel = STATUS_LABELS[s.status] || "";
      return '<div class="funnel__row">' +
          '<div class="funnel__meta">' +
            '<div class="funnel__step">' + String(i + 1).padStart(2, "0") + "</div>" +
            '<div><div class="funnel__label">' + esc(s.label) + '</div><div class="funnel__value">' + int(s.value) + "</div></div>" +
          "</div>" +
          '<div class="funnel__bar-col">' +
            '<div class="funnel__bar-wrap"><div class="funnel__bar' + statusCls + '" style="width:' + width.toFixed(1) + '%"></div></div>' +
            (i > 0 ? '<div class="funnel__rate' + rateCls + '">' + esc(s.rateLabel) + (statusLabel ? ' <span class="funnel__status funnel__status--' + s.status + '">' + statusLabel + "</span>" : "") + "</div>" : "") +
            (s.note ? '<div class="funnel__note">' + esc(s.note) + "</div>" : "") +
          "</div>" +
        "</div>";
    }).join("");
    $(containerId).innerHTML = '<div class="funnel-diagram">' + html + "</div>";
  }

  function rateStatus(rate, great, good, watch) {
    // rate in %, great/good/watch are lower bounds, descending
    if (rate == null) return null;
    if (rate >= great) return "great";
    if (rate >= good) return "good";
    if (rate >= watch) return "watch";
    return "poor";
  }

  // ---------- META TAB ----------
  // data/meta-daily.json holds one row per ad per day. Every figure on the Meta tab is
  // added up from those rows for the date range the viewer picks.
  var meta, commentaryData, range;
  var FIELDS = ["impressions", "clicks", "linkClicks", "landingPageViews", "leads", "registrations", "spend"];

  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function maxDate(a, b) { return a > b ? a : b; }
  function minDate(a, b) { return a < b ? a : b; }
  function zero() { var t = {}; FIELDS.forEach(function (f) { t[f] = 0; }); return t; }
  function addInto(t, vals) { for (var i = 0; i < FIELDS.length; i++) t[FIELDS[i]] += vals[i]; }
  function roundSpend(t) { t.spend = Math.round(t.spend * 100) / 100; return t; }

  function aggregate(from, to) {
    var totals = zero(), bySet = {}, byAd = {};
    Object.keys(meta.adsets).forEach(function (id) { bySet[id] = zero(); });
    meta.rows.forEach(function (r) {
      if (r[0] < from || r[0] > to) return;
      var vals = r.slice(2), ad = meta.ads[r[1]];
      addInto(totals, vals);
      if (ad) {
        addInto(bySet[ad.adsetId] || (bySet[ad.adsetId] = zero()), vals);
        addInto(byAd[r[1]] || (byAd[r[1]] = zero()), vals);
      }
    });
    roundSpend(totals);
    var adsets = Object.keys(bySet).map(function (id) {
      var s = roundSpend(bySet[id]); s.id = id; s.label = meta.adsets[id] || id; return s;
    });
    var ads = Object.keys(byAd).map(function (id) {
      var a = roundSpend(byAd[id]); a.id = id; a.name = meta.ads[id].name; a.adsetId = meta.ads[id].adsetId; return a;
    });
    return { from: from, to: to, totals: totals, adsets: adsets, ads: ads };
  }

  // ----- date range -----
  var PRESETS = [
    { id: "last3", label: "Last 3 days" },
    { id: "last7", label: "Last 7 days" },
    { id: "last14", label: "Last 14 days" },
    { id: "last30", label: "Last 30 days" },
    { id: "thisMonth", label: "This month" },
    { id: "lastMonth", label: "Last month" },
    { id: "toDate", label: "Campaign to date" }
  ];

  function presetRange(id) {
    var end = meta.through, start = meta.since;
    var lastN = /^last(\d+)$/.exec(id);
    if (lastN) return { from: maxDate(start, addDays(end, 1 - Number(lastN[1]))), to: end };
    if (id === "thisMonth") return { from: maxDate(start, end.slice(0, 8) + "01"), to: end };
    if (id === "lastMonth") {
      var firstThis = end.slice(0, 8) + "01", lastPrev = addDays(firstThis, -1);
      if (lastPrev < start) return null;
      return { from: maxDate(start, lastPrev.slice(0, 8) + "01"), to: lastPrev };
    }
    return { from: start, to: end }; // toDate
  }

  function rangeLabel(r) {
    var p = PRESETS.filter(function (x) { return x.id === r.preset; })[0];
    return p ? p.label : "Custom range";
  }
  function rangeDates(r) {
    return r.from === r.to ? dateLong(r.from) : dateShort(r.from) + " to " + dateLong(r.to);
  }

  function readHash() {
    var h = {};
    location.hash.replace(/^#/, "").split("&").forEach(function (kv) {
      var p = kv.split("="); if (p[0]) h[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    var iso = /^\d{4}-\d{2}-\d{2}$/;
    if (iso.test(h.from || "") && iso.test(h.to || "")) {
      var from = maxDate(meta.since, minDate(h.from, h.to)), to = minDate(meta.through, maxDate(h.from, h.to));
      if (from <= to) return { preset: "custom", from: from, to: to };
    }
    if (h.range && presetRange(h.range)) { var pr = presetRange(h.range); return { preset: h.range, from: pr.from, to: pr.to }; }
    return null;
  }
  function writeHash() {
    var h = range.preset === "custom" ? "from=" + range.from + "&to=" + range.to : "range=" + range.preset;
    if (location.hash.replace(/^#/, "") !== h) history.replaceState(null, "", "#" + h);
  }

  function setRange(r) {
    range = r;
    writeHash();
    renderRangeControls();
    renderMetaRange();
  }

  function setupRangeControls() {
    var wrap = $("range-presets");
    wrap.innerHTML = PRESETS.filter(function (p) { return presetRange(p.id); }).map(function (p) {
      return '<button type="button" class="period-btn" data-preset="' + p.id + '">' + esc(p.label) + "</button>";
    }).join("") + '<button type="button" class="period-btn" data-preset="custom">Custom dates</button>';

    wrap.addEventListener("click", function (e) {
      var b = e.target.closest("[data-preset]");
      if (!b) return;
      var id = b.dataset.preset;
      if (id === "custom") {
        $("range-custom").hidden = false;
        $("range-from").focus();
        return;
      }
      var pr = presetRange(id);
      $("range-custom").hidden = true;
      setRange({ preset: id, from: pr.from, to: pr.to });
    });

    [$("range-from"), $("range-to")].forEach(function (el) {
      el.min = meta.since; el.max = meta.through;
    });
    $("range-custom").addEventListener("submit", function (e) {
      e.preventDefault();
      var a = $("range-from").value, b = $("range-to").value;
      if (!a || !b) { $("range-error").textContent = "Pick both a start and an end date."; return; }
      var from = maxDate(meta.since, minDate(a, b)), to = minDate(meta.through, maxDate(a, b));
      if (from > to) { $("range-error").textContent = "Pick dates between " + dateLong(meta.since) + " and " + dateLong(meta.through) + "."; return; }
      $("range-error").textContent = "";
      setRange({ preset: "custom", from: from, to: to });
    });
    $("range-note").textContent = "Data available " + dateLong(meta.since) + " to " + dateLong(meta.through) + ".";
  }

  function renderRangeControls() {
    document.querySelectorAll("#range-presets .period-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.preset === range.preset);
      b.setAttribute("aria-pressed", b.dataset.preset === range.preset ? "true" : "false");
    });
    $("range-from").value = range.from;
    $("range-to").value = range.to;
    if (range.preset === "custom") $("range-custom").hidden = false;
  }

  // ----- sections -----
  function renderHero() {
    var days = daysInclusive(meta.since, meta.through);
    $("hero-sub").textContent = "Sole Trader Signups campaign · " + dateShort(meta.since) + " to " + dateLong(meta.through) + " (" + days + " days)";
    $("updated").textContent = "Data last updated: " + timestamp(meta.updatedAt);

    var ageHours = (Date.now() - Date.parse(meta.updatedAt)) / 3600000;
    if (ageHours > STALE_AFTER_HOURS) {
      var n = $("stale");
      n.hidden = false;
      n.textContent = "Heads up: these figures have not refreshed since " + timestamp(meta.updatedAt) + ". Use the “Request update” button above to let Lean In Digital know.";
    }
  }

  function renderResults(p) {
    var t = p.totals, x = derive(t);
    $("results-title").textContent = rangeLabel(range);
    $("results-sub").textContent = rangeDates(p) + " (" + daysInclusive(p.from, p.to) + (p.from === p.to ? " day" : " days") + "), " + meta.campaign.name;

    var kpis = [
      { v: int(t.leads), l: "Results", primary: true },
      { v: money(x.cpl), l: "Cost per result", primary: true },
      { v: moneyShort(t.spend), l: "Spend" }
    ];
    $("kpis").innerHTML = kpis.map(function (k) {
      return '<div class="kpi' + (k.primary ? " kpi--primary" : "") + '"><div class="kpi__label">' + esc(k.l) + '</div><div class="kpi__value">' + esc(k.v) + "</div></div>";
    }).join("");

    var stats = [
      [int(t.impressions), "Impressions"],
      [int(t.clicks), "Clicks (all)"],
      [pct(x.ctr), "CTR (all)"],
      [int(t.linkClicks), "Link clicks"],
      [pct(x.linkCtr), "Link CTR"],
      [int(t.landingPageViews), "Landing-page views"]
    ];
    $("stats").innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="stat__value">' + esc(s[0]) + '</div><div class="stat__label">' + esc(s[1]) + "</div></div>";
    }).join("");
  }

  function renderMetaFunnel(p) {
    var t = p.totals;
    var ctr = ratio(t.linkClicks, t.impressions);
    var lpvRate = ratio(t.landingPageViews, t.linkClicks);
    var leadRate = ratio(t.leads, t.landingPageViews);
    var ctrPct = ctr == null ? null : ctr * 100;
    var lpvPct = lpvRate == null ? null : lpvRate * 100;
    var leadPct = leadRate == null ? null : leadRate * 100;

    renderFunnel("meta-funnel", [
      { label: "Impressions", value: t.impressions },
      {
        label: "Link clicks", value: t.linkClicks,
        rateLabel: pct(ctrPct) + " click-through",
        status: rateStatus(ctrPct, 3, 2, 1),
        note: ctrPct != null && ctrPct < 1 ? "Low click-through — the ad or audience may need attention before spend." : null
      },
      {
        label: "Landing page views", value: t.landingPageViews,
        rateLabel: pct(lpvPct) + " of clicks loaded the page",
        status: rateStatus(lpvPct, 85, 70, 40),
        note: lpvPct != null && lpvPct < 70 ? "A chunk of clicks aren't reaching the landing page — worth checking load speed or link setup." : null
      },
      {
        label: "Leads", value: t.leads,
        rateLabel: pct(leadPct) + " of landing page views became a lead",
        status: rateStatus(leadPct, 5, 3, 1),
        note: leadPct != null && leadPct < 1 ? "Page is getting seen but not converting — look at the landing page itself, not the ad." : null
      }
    ]);
  }

  function deltaBadge(now, prev, higherIsBetter) {
    if (now == null || prev == null || prev === 0) return '<span class="delta">No comparison</span>';
    var change = ((now - prev) / prev) * 100;
    var cls = "delta";
    if (higherIsBetter !== null && Math.abs(change) >= 0.5) {
      var good = higherIsBetter ? change > 0 : change < 0;
      cls += good ? " delta--good" : " delta--bad";
    }
    var arrow = change > 0 ? "▲" : change < 0 ? "▼" : "";
    return '<span class="' + cls + '">' + arrow + " " + nf0.format(Math.abs(change)) + "% vs previous period</span>";
  }

  // Compares the selected range with the same number of days immediately before it.
  function renderMomentum(p) {
    var len = daysInclusive(p.from, p.to);
    var prevTo = addDays(p.from, -1), prevFrom = addDays(p.from, -len);
    $("momentum-title").textContent = "Compared with the previous " + len + (len === 1 ? " day" : " days");
    if (prevFrom < meta.since) {
      $("momentum-sub").textContent = rangeDates(p) + ". There isn't a full " + len + "-day period before this one in the campaign, so there's nothing to compare against. Pick a later or shorter range to see a comparison.";
      $("compare").innerHTML = "";
      return;
    }
    var q = aggregate(prevFrom, prevTo);
    var a = p.totals, b = q.totals, xa = derive(a), xb = derive(b);
    $("momentum-sub").textContent = rangeDates(p) + ", compared with " + rangeDates(q) + ".";
    var cards = [
      { l: "Spend", now: a.spend, prev: b.spend, fmt: money, better: null },
      { l: "Results", now: a.leads, prev: b.leads, fmt: int, better: true },
      { l: "Cost per lead", now: xa.cpl, prev: xb.cpl, fmt: money, better: false },
      { l: "Link clicks", now: a.linkClicks, prev: b.linkClicks, fmt: int, better: true }
    ];
    $("compare").innerHTML = cards.map(function (c) {
      return '<div class="delta-card"><div class="delta-card__label">' + esc(c.l) + '</div><div class="delta-card__value">' + esc(c.fmt(c.now)) +
        '</div><div class="delta-card__prev">Previous period: ' + esc(c.fmt(c.prev)) + "</div>" + deltaBadge(c.now, c.prev, c.better) + "</div>";
    }).join("");
  }

  function renderAdsets(p) {
    var sets = p.adsets.filter(function (s) { return s.impressions || s.spend; });
    $("adsets-sub").textContent = rangeDates(p) + ".";
    if (!sets.length) {
      $("adsets").innerHTML = '<p class="section__sub">No ad-set delivery in this range.</p>';
      $("share").innerHTML = "";
      return;
    }
    var totalLeads = sets.reduce(function (s, a) { return s + a.leads; }, 0);
    var leadId = totalLeads ? sets.slice().sort(function (a, b) { return b.leads - a.leads || (ratio(a.spend, a.leads) || 1e9) - (ratio(b.spend, b.leads) || 1e9); })[0].id : null;

    $("adsets").innerHTML = sets.map(function (s) {
      var x = derive(s);
      return '<article class="adset' + (s.id === leadId ? " adset--lead" : "") + '">' +
        '<div class="adset__eyebrow">Ad set</div><h3>' + esc(s.label) + "</h3>" +
        '<div class="adset__main">' +
          '<div><div class="v">' + int(s.leads) + '</div><div class="l">Results</div></div>' +
          '<div><div class="v">' + money(x.cpl) + '</div><div class="l">Cost per lead</div></div>' +
          '<div><div class="v">' + money(s.spend) + '</div><div class="l">Spend</div></div>' +
        "</div>" +
        '<div class="adset__minor">' +
          '<div><div class="v">' + int(s.impressions) + '</div><div class="l">Impressions</div></div>' +
          '<div><div class="v">' + int(s.clicks) + '</div><div class="l">Clicks</div></div>' +
          '<div><div class="v">' + pct(x.ctr) + '</div><div class="l">CTR</div></div>' +
          '<div><div class="v">' + int(s.registrations) + '</div><div class="l">Registrations</div></div>' +
        "</div></article>";
    }).join("");

    if (totalLeads > 0 && sets.length === 2) {
      var w = (sets[0].leads / totalLeads) * 100;
      $("share").innerHTML = '<div class="share__labels"><span>Share of the ' + int(totalLeads) + " Results</span><span>" +
        sets.map(function (s) { return esc(s.label) + " " + int(s.leads); }).join(" · ") + "</span></div>" +
        '<div class="share__bar" role="img" aria-label="Lead share by ad set"><span style="width:' + w.toFixed(2) + '%"></span><span style="width:' + (100 - w).toFixed(2) + '%"></span></div>';
    } else {
      $("share").innerHTML = "";
    }
  }

  var AD_SCREENSHOTS = {
    "120251375340930660": "assets/ad-refunding-users.png",
    "120251989123830660": "assets/ad-refunding-repost.png",
    "120251973415040660": "assets/ad-ird-letter.png",
    "120251375340970660": "assets/ad-wife.png",
    "120251376356230660": "assets/ad-47gst.png"
  };

  function renderAds(p) {
    var labels = meta.adsets;
    $("ads-period").textContent = rangeDates(p);
    $("ads-sub").textContent = "Ranked by Meta-reported leads, then cost per lead, for " + rangeDates(p) + ".";
    $("all-title").textContent = "All ads, " + rangeLabel(range).toLowerCase();
    $("all-ads-sub").textContent = rangeDates(p) + ". Ads with no delivery in this range are hidden.";

    var top = p.ads.filter(function (a) { return a.leads > 0; }).sort(function (a, b) {
      return b.leads - a.leads || a.spend / a.leads - b.spend / b.leads;
    }).slice(0, 3);

    $("top-ads").innerHTML = top.length ? top.map(function (a, i) {
      var x = derive(a);
      var shot = AD_SCREENSHOTS[a.id];
      return '<article class="ad-card">' +
        (shot ? '<img class="ad-card__shot" src="' + esc(shot) + '" alt="' + esc(shortAdName(a.name)) + ' ad creative">' : "") +
        '<div class="ad-card__rank">' + String(i + 1).padStart(2, "0") + " · " + esc(labels[a.adsetId] || "") + "</div>" +
        "<h3>" + esc(shortAdName(a.name)) + "</h3>" +
        '<div class="ad-card__cpl">' + money(x.cpl) + " <small>per lead</small></div>" +
        '<div class="ad-card__grid">' +
          '<div><div class="v">' + int(a.leads) + '</div><div class="l">Leads</div></div>' +
          '<div><div class="v">' + moneyShort(a.spend) + '</div><div class="l">Spent</div></div>' +
          '<div><div class="v">' + int(a.impressions) + '</div><div class="l">Impressions</div></div>' +
          '<div><div class="v">' + int(a.clicks) + '</div><div class="l">Clicks</div></div>' +
          '<div><div class="v">' + pct(x.ctr) + '</div><div class="l">CTR</div></div>' +
          '<div><div class="v">' + int(a.linkClicks) + '</div><div class="l">Link clicks</div></div>' +
        "</div></article>";
    }).join("") : '<p class="section__sub">No ads reported leads in this date range.</p>';

    var rows = p.ads.filter(function (a) { return a.impressions || a.spend; }).sort(function (a, b) { return b.spend - a.spend; });
    $("ads-table").querySelector("tbody").innerHTML = rows.length ? rows.map(function (a) {
      var x = derive(a);
      return "<tr><td>" + esc(shortAdName(a.name)) + '</td><td class="muted">' + esc(labels[a.adsetId] || "") + "</td>" +
        '<td class="num">' + money(a.spend) + '</td><td class="num">' + int(a.impressions) + '</td><td class="num">' + pct(x.ctr) +
        '</td><td class="num">' + int(a.linkClicks) + '</td><td class="num">' + int(a.leads) + '</td><td class="num">' + (a.leads ? money(x.cpl) : '<span class="muted">–</span>') + "</td></tr>";
    }).join("") : '<tr><td colspan="8" class="muted">No ad delivery in this range.</td></tr>';
  }

  // Hand-written notes from data/commentary.json. These describe the period they were written
  // for, so they are labelled with their review date rather than following the date filter.
  function renderCommentary(c) {
    var reviewed = c.reviewedOn ? "Lean In Digital note, " + dateLong(c.reviewedOn) + ": " : "Lean In Digital note: ";
    if (c.adsetTakeaway) $("adset-takeaway").innerHTML = "<strong>" + esc(reviewed) + "</strong>" + esc(c.adsetTakeaway);
    if (c.creativeNote) $("creative-note").innerHTML = "<strong>" + esc(reviewed) + "</strong>" + esc(c.creativeNote);
    if (c.reviewedOn) $("reviewed").textContent = "Written by Lean In Digital on " + dateLong(c.reviewedOn) + (c.reviewedBy ? " by " + c.reviewedBy : "") + ". The figures above update daily; this commentary is updated when we review the account.";
    function items(list) {
      return (list || []).map(function (s) { return "<li><div><h4>" + esc(s.title) + "</h4><p>" + esc(s.body) + "</p></div></li>"; }).join("");
    }
    $("findings").innerHTML = items(c.findings);
    $("next-steps").innerHTML = items(c.nextSteps);
    if (c.budget && c.budget.length) {
      $("budget").innerHTML = '<p class="budget__title">Budget plan</p>' + c.budget.map(function (b) {
        return '<div class="budget__item"><div class="v">' + esc(b.value) + '</div><div class="l">' + esc(b.label) + "</div></div>";
      }).join("");
    } else {
      $("budget").hidden = true;
    }
    if (c.contactEmail) {
      $("contact").innerHTML = 'Questions? Email <a href="mailto:' + esc(c.contactEmail) + '">' + esc(c.contactEmail) + "</a>";
    }
  }

  function renderMetaRange() {
    var p = aggregate(range.from, range.to);
    renderResults(p);
    renderMetaFunnel(p);
    renderMomentum(p);
    renderAdsets(p);
    renderAds(p);
  }

  function initMeta(d, c) {
    meta = d; commentaryData = c;
    renderHero();
    setupRangeControls();
    var initial = readHash();
    if (!initial) { var pr = presetRange("last7"); initial = { preset: "last7", from: pr.from, to: pr.to }; }
    renderCommentary(commentaryData);
    setRange(initial);
    window.addEventListener("hashchange", function () {
      var r = readHash();
      if (r && (r.from !== range.from || r.to !== range.to || r.preset !== range.preset)) setRange(r);
    });
  }

  // ---------- GOOGLE TAB ----------
  function renderGoogle(g) {
    $("g-campaign-pill").textContent = g.campaign.name;
    $("g-results-sub").textContent = g.window.label + " (" + dateLong(g.window.since) + " to " + dateLong(g.window.until) + ").";
    $("g-updated").textContent = "Data last updated: " + timestamp(g.updatedAt);
    $("g-funnel-sub").textContent = "Impressions → clicks → conversions, " + g.window.label.toLowerCase() + ".";
    var t = g.totals;
    var ctr = ratio(t.clicks, t.impressions);
    var cpc = ratio(t.cost, t.clicks);
    var kpis = [
      { v: int(t.impressions), l: "Impressions" },
      { v: int(t.clicks), l: "Clicks", primary: true },
      { v: pct(ctr == null ? null : ctr * 100), l: "CTR" },
      { v: moneyShort(t.cost), l: "Cost", primary: true },
      { v: money(cpc), l: "Cost per click" },
      { v: int(t.conversions), l: "Conversions" }
    ];
    $("g-kpis").innerHTML = kpis.map(function (k) {
      return '<div class="kpi' + (k.primary ? " kpi--primary" : "") + '"><div class="kpi__label">' + esc(k.l) + '</div><div class="kpi__value">' + esc(k.v) + "</div></div>";
    }).join("");

    if (g.newCampaignNote) {
      $("g-new-note").hidden = false;
      $("g-new-note").textContent = g.newCampaignNote;
    }
    if (g.trackingNote) {
      $("g-tracking-note").hidden = false;
      $("g-tracking-note").textContent = g.trackingNote;
    }

    var ctrPct = ctr == null ? null : ctr * 100;
    var convRate = ratio(t.conversions, t.clicks);
    var convPct = convRate == null ? null : convRate * 100;
    renderFunnel("google-funnel", [
      { label: "Impressions", value: t.impressions },
      {
        label: "Clicks", value: t.clicks,
        rateLabel: pct(ctrPct) + " click-through",
        status: rateStatus(ctrPct, 6, 4, 2)
      },
      {
        label: "Conversions", value: t.conversions,
        rateLabel: pct(convPct) + " of clicks converted",
        status: null,
        note: "Conversion tracking needs fixing (see note above) — treat this stage as directional, not final."
      }
    ]);

    $("g-themes-sub").textContent = g.themesNote || "";
    $("g-themes").innerHTML = g.searchThemes.map(function (th) {
      return '<article class="theme-card"><h3>' + esc(th.theme) + "</h3>" +
        '<div class="theme-card__stats"><span>' + int(th.clicks) + " clicks</span><span>" + money(th.cost) + "</span><span>" + int(th.conversions) + " conv</span></div>" +
        '<p class="theme-card__terms">' + th.terms.map(esc).join(" · ") + "</p></article>";
    }).join("");

    $("g-keywords-sub").textContent = g.keywordsNote || "";
    $("g-keywords-table").querySelector("tbody").innerHTML = g.topKeywords.map(function (k) {
      return "<tr><td>" + esc(k.text) + '</td><td class="muted">' + esc(k.matchType) + '</td><td class="num">' + int(k.impressions) +
        '</td><td class="num">' + int(k.clicks) + '</td><td class="num">' + pct(k.ctr) + '</td><td class="num">' + money(k.cost) +
        '</td><td class="num">' + int(k.conversions) + "</td></tr>";
    }).join("");
  }

  // ---------- platform tabs ----------
  function setupPlatformTabs() {
    var tabs = document.querySelectorAll(".platform-tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.toggle("is-active", t === tab); t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
        var platform = tab.dataset.platform;
        $("panel-meta").hidden = platform !== "meta";
        $("panel-google").hidden = platform !== "google";
      });
    });
  }

  function load(path) {
    return fetch(path + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " returned " + r.status);
      return r.json();
    });
  }

  setupPlatformTabs();

  Promise.all([load("data/meta-daily.json"), load("data/commentary.json"), load("data/google.json")]).then(function (res) {
    initMeta(res[0], res[1]);
    renderGoogle(res[2]);
  }).catch(function (err) {
    $("hero-sub").textContent = "The latest figures could not be loaded. Please refresh in a minute.";
    console.error(err);
  });
})();
