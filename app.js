(function () {
  "use strict";

  var TZ = "Pacific/Auckland";
  var STALE_AFTER_HOURS = 36;

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
  var metaData, commentaryData, currentPeriod;

  function renderHero(d) {
    var td = d.periods.toDate;
    var days = daysInclusive(td.since, td.until);
    $("hero-sub").textContent = "Sole Trader Signups campaign · " + dateShort(td.since) + " to " + dateLong(td.until) + " (" + days + " days)";
    $("updated").textContent = "Data last updated: " + timestamp(d.updatedAt);

    var ageHours = (Date.now() - Date.parse(d.updatedAt)) / 3600000;
    if (ageHours > STALE_AFTER_HOURS) {
      var n = $("stale");
      n.hidden = false;
      n.textContent = "Heads up: these figures have not refreshed since " + timestamp(d.updatedAt) + ". Use the “Request update” button above to ask Lean In Digital to refresh it.";
    }
  }

  function renderPeriodToggle() {
    var btns = document.querySelectorAll("#period-toggle .period-btn");
    btns.forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.period === currentPeriod);
      b.addEventListener("click", function () {
        currentPeriod = b.dataset.period;
        renderMetaPeriod();
      });
    });
  }

  function renderResults(period) {
    var t = period.totals, x = derive(t);
    $("results-title").textContent = period.label;
    $("results-sub").textContent = dateLong(period.since) + " to " + dateLong(period.until) + ", " + metaData.campaign.name;

    var kpis = [
      { v: int(t.leads), l: 'Results in Meta Ads Manager ("Lead" event)', primary: true },
      { v: money(x.cpl), l: "Cost per Meta-reported lead", primary: true },
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

  function renderMetaFunnel(period) {
    var t = period.totals;
    var ctr = ratio(t.linkClicks, t.impressions);
    var lpvRate = ratio(t.landingPageViews, t.linkClicks);
    var leadRate = ratio(t.leads, t.landingPageViews);
    var ctrPct = ctr == null ? null : ctr * 100;
    var lpvPct = lpvRate == null ? null : lpvRate * 100;
    var leadPct = leadRate == null ? null : leadRate * 100;

    var stages = [
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
    ];
    renderFunnel("meta-funnel", stages);
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
    return '<span class="' + cls + '">' + arrow + " " + nf0.format(Math.abs(change)) + "% vs previous 7 days</span>";
  }

  function renderMomentum(d) {
    var a = d.momentum.last7.totals, b = d.momentum.prev7.totals, xa = derive(a), xb = derive(b);
    $("momentum-sub").textContent = dateShort(d.momentum.last7.since) + " to " + dateShort(d.momentum.last7.until) + ", compared with " + dateShort(d.momentum.prev7.since) + " to " + dateShort(d.momentum.prev7.until) + ".";
    var cards = [
      { l: "Spend", now: a.spend, prev: b.spend, fmt: money, better: null },
      { l: 'Meta Results ("Lead" event)', now: a.leads, prev: b.leads, fmt: int, better: true },
      { l: "Cost per lead", now: xa.cpl, prev: xb.cpl, fmt: money, better: false },
      { l: "Link clicks", now: a.linkClicks, prev: b.linkClicks, fmt: int, better: true }
    ];
    $("compare").innerHTML = cards.map(function (c) {
      return '<div class="delta-card"><div class="delta-card__label">' + esc(c.l) + '</div><div class="delta-card__value">' + esc(c.fmt(c.now)) +
        '</div><div class="delta-card__prev">Previous 7 days: ' + esc(c.fmt(c.prev)) + "</div>" + deltaBadge(c.now, c.prev, c.better) + "</div>";
    }).join("");
  }

  function renderAdsets(period, commentary) {
    var sets = period.adsets.slice();
    var totalLeads = sets.reduce(function (s, a) { return s + a.leads; }, 0);
    var spends = sets.map(function (a) { return a.spend; });
    var nearEqual = Math.max.apply(null, spends) <= Math.min.apply(null, spends) * 1.25;
    $("adsets-sub").textContent = sets.length + " ad sets" + (nearEqual ? " on near-equal spend." : ".");

    var leadId = sets.slice().sort(function (a, b) { return b.leads - a.leads || (ratio(a.spend, a.leads) || 1e9) - (ratio(b.spend, b.leads) || 1e9); })[0].id;

    $("adsets").innerHTML = sets.map(function (s) {
      var x = derive(s);
      return '<article class="adset' + (s.id === leadId ? " adset--lead" : "") + '">' +
        '<div class="adset__eyebrow">Ad set</div><h3>' + esc(s.label) + "</h3>" +
        '<div class="adset__main">' +
          '<div><div class="v">' + int(s.leads) + '</div><div class="l">Meta Results ("Lead" event)</div></div>' +
          '<div><div class="v">' + money(x.cpl) + '</div><div class="l">Cost per lead</div></div>' +
          '<div><div class="v">' + money(s.spend) + '</div><div class="l">Spend</div></div>' +
        "</div>" +
        '<div class="adset__minor">' +
          '<div><div class="v">' + int(s.impressions) + '</div><div class="l">Impressions</div></div>' +
          '<div><div class="v">' + int(s.clicks) + '</div><div class="l">Clicks</div></div>' +
          '<div><div class="v">' + pct(x.ctr) + '</div><div class="l">CTR</div></div>' +
          '<div><div class="v">' + int(s.linkClicks) + '</div><div class="l">Link clicks</div></div>' +
        "</div></article>";
    }).join("");

    if (totalLeads > 0 && sets.length === 2) {
      var w = (sets[0].leads / totalLeads) * 100;
      $("share").innerHTML = '<div class="share__labels"><span>Share of the ' + int(totalLeads) + " Meta-reported leads</span><span>" +
        sets.map(function (s) { return esc(s.label) + " " + int(s.leads); }).join(" · ") + "</span></div>" +
        '<div class="share__bar" role="img" aria-label="Lead share by ad set"><span style="width:' + w.toFixed(2) + '%"></span><span style="width:' + (100 - w).toFixed(2) + '%"></span></div>';
    } else {
      $("share").innerHTML = "";
    }

    if (commentary.adsetTakeaway) {
      $("adset-takeaway").innerHTML = "<strong>Key takeaway:</strong> " + esc(commentary.adsetTakeaway);
    }
  }

  var AD_SCREENSHOTS = {
    "120251375340930660": "assets/ad-refunding-users.png",
    "120251375340970660": "assets/ad-wife.png",
    "120251376356230660": "assets/ad-47gst.png"
  };

  function renderAds(d, commentary) {
    var labels = d.adsetLabels;

    var top = d.ads.filter(function (a) { return a.leads > 0; }).sort(function (a, b) {
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
    }).join("") : '<p class="section__sub">No ads have reported leads yet in this period.</p>';

    if (commentary.creativeNote) $("creative-note").textContent = commentary.creativeNote;

    var rows = d.ads.slice().sort(function (a, b) { return b.spend - a.spend; });
    $("ads-table").querySelector("tbody").innerHTML = rows.map(function (a) {
      var x = derive(a);
      return "<tr><td>" + esc(shortAdName(a.name)) + '</td><td class="muted">' + esc(labels[a.adsetId] || "") + "</td>" +
        '<td class="num">' + money(a.spend) + '</td><td class="num">' + int(a.impressions) + '</td><td class="num">' + pct(x.ctr) +
        '</td><td class="num">' + int(a.linkClicks) + '</td><td class="num">' + int(a.leads) + '</td><td class="num">' + (a.leads ? money(x.cpl) : '<span class="muted">–</span>') + "</td></tr>";
    }).join("");
  }

  function renderCommentary(c) {
    if (c.reviewedOn) $("reviewed").textContent = "Commentary last reviewed " + dateLong(c.reviewedOn) + (c.reviewedBy ? " by " + c.reviewedBy : "") + ". The figures above update daily.";
    function items(list) {
      return (list || []).map(function (s) { return "<li><div><h4>" + esc(s.title) + "</h4><p>" + esc(s.body) + "</p></div></li>"; }).join("");
    }
    $("findings").innerHTML = items(c.findings);
    $("next-steps").innerHTML = items(c.nextSteps);
    if (c.budget && c.budget.length) {
      $("budget").innerHTML = '<p class="budget__title">Budget headroom</p>' + c.budget.map(function (b) {
        return '<div class="budget__item"><div class="v">' + esc(b.value) + '</div><div class="l">' + esc(b.label) + "</div></div>";
      }).join("");
    } else {
      $("budget").hidden = true;
    }
    if (c.contactEmail) {
      $("contact").innerHTML = 'Questions? Email <a href="mailto:' + esc(c.contactEmail) + '">' + esc(c.contactEmail) + "</a>";
    }
  }

  function renderMetaPeriod() {
    var period = metaData.periods[currentPeriod];
    document.querySelectorAll("#period-toggle .period-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.period === currentPeriod);
    });
    renderResults(period);
    renderMetaFunnel(period);
    renderAdsets(period, commentaryData);
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

  Promise.all([load("data/report.json"), load("data/commentary.json"), load("data/google.json")]).then(function (res) {
    metaData = res[0]; commentaryData = res[1];
    var googleData = res[2];
    currentPeriod = metaData.defaultPeriod || "last7";

    renderHero(metaData);
    renderPeriodToggle();
    renderMetaPeriod();
    renderMomentum(metaData);
    renderAds(metaData, commentaryData);
    renderCommentary(commentaryData);

    renderGoogle(googleData);
  }).catch(function (err) {
    $("hero-sub").textContent = "The latest figures could not be loaded. Please refresh in a minute.";
    console.error(err);
  });
})();
