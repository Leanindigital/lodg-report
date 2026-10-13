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
    // iso is YYYY-MM-DD in the ad account timezone; render without shifting days
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

  // ---------- render ----------
  function renderHero(d) {
    var td = d.toDate;
    var days = daysInclusive(td.since, td.until);
    $("hero-sub").textContent = "Sole Trader Signups campaign · " + dateShort(td.since) + " to " + dateLong(td.until) + " (" + days + " days)";
    $("updated").textContent = "Data last updated: " + timestamp(d.updatedAt);

    var ageHours = (Date.now() - Date.parse(d.updatedAt)) / 3600000;
    if (ageHours > STALE_AFTER_HOURS) {
      var n = $("stale");
      n.hidden = false;
      n.textContent = "Heads up: these figures have not refreshed since " + timestamp(d.updatedAt) + ". Lean In Digital has been notified.";
    }
  }

  function renderResults(d) {
    var t = d.toDate.campaignTotals, x = derive(t);
    $("results-sub").textContent = dateLong(d.toDate.since) + " to " + dateLong(d.toDate.until) + ", " + d.campaign.name;

    var kpis = [
      { v: int(t.leads), l: "Meta-reported leads", primary: true },
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
    var a = d.last7.totals, b = d.prev7.totals, xa = derive(a), xb = derive(b);
    $("momentum-sub").textContent = dateShort(d.last7.since) + " to " + dateShort(d.last7.until) + ", compared with " + dateShort(d.prev7.since) + " to " + dateShort(d.prev7.until) + ".";
    var cards = [
      { l: "Spend", now: a.spend, prev: b.spend, fmt: money, better: null },
      { l: "Meta-reported leads", now: a.leads, prev: b.leads, fmt: int, better: true },
      { l: "Cost per lead", now: xa.cpl, prev: xb.cpl, fmt: money, better: false },
      { l: "Link clicks", now: a.linkClicks, prev: b.linkClicks, fmt: int, better: true }
    ];
    $("compare").innerHTML = cards.map(function (c) {
      return '<div class="delta-card"><div class="delta-card__label">' + esc(c.l) + '</div><div class="delta-card__value">' + esc(c.fmt(c.now)) +
        '</div><div class="delta-card__prev">Previous 7 days: ' + esc(c.fmt(c.prev)) + "</div>" + deltaBadge(c.now, c.prev, c.better) + "</div>";
    }).join("");
  }

  function renderAdsets(d, commentary) {
    var sets = d.toDate.adsets.slice();
    var totalLeads = sets.reduce(function (s, a) { return s + a.leads; }, 0);
    var spends = sets.map(function (a) { return a.spend; });
    var nearEqual = Math.max.apply(null, spends) <= Math.min.apply(null, spends) * 1.25;
    $("adsets-sub").textContent = sets.length + " ad sets" + (nearEqual ? " on near-equal spend." : ".");

    // The ad set with the most leads gets the blue card
    var leadId = sets.slice().sort(function (a, b) { return b.leads - a.leads || (ratio(a.spend, a.leads) || 1e9) - (ratio(b.spend, b.leads) || 1e9); })[0].id;

    $("adsets").innerHTML = sets.map(function (s) {
      var x = derive(s);
      return '<article class="adset' + (s.id === leadId ? " adset--lead" : "") + '">' +
        '<div class="adset__eyebrow">Ad set</div><h3>' + esc(s.label) + "</h3>" +
        '<div class="adset__main">' +
          '<div><div class="v">' + int(s.leads) + '</div><div class="l">Meta-reported leads</div></div>' +
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
    var labels = {};
    d.toDate.adsets.forEach(function (s) { labels[s.id] = s.label; });

    var top = d.toDate.ads.filter(function (a) { return a.leads > 0; }).sort(function (a, b) {
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

    var rows = d.toDate.ads.slice().sort(function (a, b) { return b.spend - a.spend; });
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

  function load(path) {
    return fetch(path + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " returned " + r.status);
      return r.json();
    });
  }

  Promise.all([load("data/report.json"), load("data/commentary.json")]).then(function (res) {
    var d = res[0], c = res[1];
    renderHero(d);
    renderResults(d);
    renderMomentum(d);
    renderAdsets(d, c);
    renderAds(d, c);
    renderCommentary(c);
  }).catch(function (err) {
    $("hero-sub").textContent = "The latest figures could not be loaded. Please refresh in a minute.";
    console.error(err);
  });
})();
