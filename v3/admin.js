/* fix6: in-app Admin tab. Shown only when the signed-in email is the admin (config.js). Row-level security is the real gate:
   anyone else's queries only ever return their own rows, and this view refuses to load for them anyway. */
(function(){
  var CFG = window.NOLA_SUPABASE || {};

  /* ---------- pure logic (unit-tested) ---------- */
  function isAdminEmail(email){
    if (typeof window.NolaIsAdminEmail === "function") return window.NolaIsAdminEmail(email);
    var raw = CFG.admins || CFG.admin || [];
    if (typeof raw === "string") raw = [raw];
    var e = String(email || "").trim().toLowerCase();
    if (!e) return false;
    for (var i = 0; i < raw.length; i++){ if (String(raw[i] || "").trim().toLowerCase() === e) return true; }
    return false;
  }
  function planRefs(list){ var out = []; ((list && list.data && list.data.days) || []).forEach(function(d){ (d.items || []).forEach(function(it){ (it.p || []).forEach(function(id){ out.push({ id: String(id), day: d.n, t: it.t, h: it.h }); }); }); }); return out; }
  /* per person: what they saved, grouped */
  function summarize(people, lists, items, likes){
    lists = lists || []; likes = likes || []; items = items || [];
    return (people || []).map(function(p){
      var ls = lists.filter(function(l){ return l.user_id === p.id; }), ks = likes.filter(function(k){ return k.user_id === p.id; });
      var plan = []; ls.filter(function(l){ return l.kind === "itinerary"; }).forEach(function(l){ plan = plan.concat(planRefs(l)); });
      var mapl = ls.filter(function(l){ return l.kind === "custom" && l.data && typeof l.data === "object"; });
      var mapPlaces = []; mapl.forEach(function(l){ Object.keys(l.data).forEach(function(k){ mapPlaces.push({ id: k, n: (l.data[k] && (l.data[k].n || l.data[k].name)) || k }); }); });
      var groups = [];
      var liked = ks.filter(function(k){ return k.kind === "like"; }).map(function(k){ return k.item_ref; });
      var voted = ks.filter(function(k){ return k.kind === "vote"; }).map(function(k){ return k.item_ref; });
      var visited = ks.filter(function(k){ return k.kind === "visited"; }).map(function(k){ return k.item_ref; });
      if (liked.length) groups.push({ title: "Saved (kitchen table)", how: "saved", ids: liked });
      if (plan.length) groups.push({ title: "In their plan", how: "in their plan", ids: plan.map(function(x){ return x.id; }), plan: plan });
      if (voted.length) groups.push({ title: "Voted for", how: "voted", ids: voted });
      if (visited.length) groups.push({ title: "Visited", how: "visited", ids: visited });
      ls.forEach(function(l){ if (l.kind === "itinerary" || l.kind === "custom") return;
        var its = items.filter(function(i){ return i.list_id === l.id; }).map(function(i){ return i.item_ref; });
        if (l.kind === "search") return;
        if (its.length) groups.push({ title: (l.title || l.kind), how: (l.title || l.kind), ids: its }); });
      if (mapPlaces.length) groups.push({ title: "Places from the map", how: "saved on the map", ids: mapPlaces.map(function(x){ return x.id; }) });
      return { id: p.id, name: p.name || (p.email || "").split("@")[0] || "Someone", email: p.email || "", created_at: p.created_at,
        likes: liked.length, lists: ls.length, planItems: plan.length, searches: ls.filter(function(l){ return l.kind === "search"; }).map(function(l){ return l.title; }),
        groups: groups, mapNames: mapPlaces.reduce(function(o, x){ o[x.id] = x.n; return o; }, {}) };
    });
  }
  /* places ranked by how many different people liked/saved/planned/voted them */
  function rankOverlap(summary, opts){
    opts = opts || {}; var byPlace = {}, names = {};
    summary.forEach(function(s){ Object.assign(names, s.mapNames || {}); s.groups.forEach(function(g){ g.ids.forEach(function(id){ (byPlace[id] = byPlace[id] || {})[s.id] = true; }); }); });
    var active = summary.filter(function(s){ return s.groups.length; }).length || summary.length || 1;
    var rows = Object.keys(byPlace).map(function(id){ var who = Object.keys(byPlace[id]); return { id: id, who: who, n: who.length, name: (opts.nameOf && opts.nameOf(id)) || names[id] || id }; });
    rows.sort(function(a, b){ return b.n - a.n || String(a.name).localeCompare(String(b.name)); });
    var total = summary.length || 1;
    rows.forEach(function(r){ r.pct = Math.round(r.n / total * 100); r.tier = (r.n >= active && active > 1) ? "everyone" : (r.n > 1 && r.n > active / 2) ? "most" : r.n > 1 ? "some" : "one"; });
    return { rows: rows, active: active, total: total };
  }
  window.NolaAdminLogic = { isAdminEmail: isAdminEmail, summarize: summarize, rankOverlap: rankOverlap, planRefs: planRefs };

  /* ---------- view ---------- */
  var A = { savedMode: "mine", data: null, loading: false, err: null, sec: "align", person: "all", cat: "all", open: { solo: true } };
  /* fix7: Saved > All trip plans also waits on this data, so re-render there too (was Admin tab only, which left Saved > All stuck on "Loading everyone…") */
  function needsData(){ return typeof S !== "undefined" && (S.tab === "admin" || (S.tab === "saved" && A.savedMode === "all")); }
  function amAdmin(){ return !!(window.NolaAccount && window.NolaAccount.isAdmin); }
  function e(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function place(id){ return (typeof BY !== "undefined" && BY[id]) || null; }
  function pname(id){ var p = place(id); return p ? p.n : (A.data && A.data.names[id]) || id; }
  function catsOf(id){ var p = place(id); return p && p.c ? p.c : []; }
  var COLORS = ["var(--coral)", "var(--lav)", "var(--gold)", "var(--accent)", "var(--leaf)", "var(--ink)"];
  function initial(s, i){ return '<span class="adm-av" style="background:' + COLORS[i % COLORS.length] + '" title="' + e(s.name) + '">' + e((s.name || "?").trim().charAt(0).toUpperCase()) + '</span>'; }
  function howsFor(personId, placeId){
    var s = null;
    (A.data.summary || []).forEach(function(x){ if (x.id === personId) s = x; });
    if (!s) return [];
    var hows = [];
    s.groups.forEach(function(g){
      if (g.ids.indexOf(placeId) < 0) return;
      var label = g.how || g.title;
      if (label && hows.indexOf(label) < 0) hows.push(label);
    });
    return hows;
  }
  /* Visible names, not just avatar initials. Each chip says who, and how they picked it. */
  function whoLine(r){
    var S2 = A.data.summary || [];
    var chips = r.who.map(function(id){
      var i = S2.findIndex(function(s){ return s.id === id; });
      var s = i < 0 ? { name: "Someone" } : S2[i];
      var hows = howsFor(id, r.id);
      return '<span class="adm-pick">' + (i < 0 ? "" : initial(s, i)) + '<b>' + e(s.name) + '</b>'
        + (hows.length ? '<span class="adm-how">' + e(hows.join(" · ")) + '</span>' : "") + '</span>';
    }).join("");
    return '<div class="adm-who"><span class="adm-who-k">Picked by</span>' + chips + '</div>';
  }
  async function load(){
    if (A.loading || !amAdmin()) return; A.loading = true; A.err = null;
    try {
      var sb = window.NolaAccount.client;
      var r = await Promise.all([sb.from("profiles").select("*").order("created_at"), sb.from("lists").select("*"), sb.from("list_items").select("*"), sb.from("likes").select("*")]);
      var bad = r.find(function(x){ return x.error; }); if (bad) throw bad.error;
      var summary = summarize(r[0].data, r[1].data, r[2].data, r[3].data), names = {};
      summary.forEach(function(s){ Object.assign(names, s.mapNames); });
      A.data = { summary: summary, names: names };
    } catch (x) { A.err = (x && x.message) || String(x); }
    A.loading = false; A.at = Date.now(); if (needsData()) render();
  }
  window.NolaAdminSetData = function(d){ var summary = summarize(d.profiles, d.lists, d.list_items, d.likes), names = {}; summary.forEach(function(s){ Object.assign(names, s.mapNames); }); A.data = { summary: summary, names: names }; if (needsData()) render(); };
  function chip(attr, val, cur, label){ return '<button class="chip" ' + attr + '="' + e(val) + '" aria-pressed="' + (cur === val) + '">' + label + '</button>'; }
  function vAdmin(){
    var h = '<div class="head" style="position:relative"><span class="eyebrow">Only you can see this</span><h2>Admin</h2><p class="muted small">Who saved what, and where the group lines up.</p><button class="btn" data-go="help" style="position:absolute;top:12px;right:0;padding:6px 14px;font-size:.85rem">? Help</button></div>';
    if (!amAdmin()) return '<div class="head"><span class="eyebrow">Admin</span><h2>Admin only</h2></div><div class="empty" id="adm-denied"><p><b>Sorry, this page is just for the trip organizer.</b></p><p class="small">Your saves are still yours. Head back to Home to keep planning.</p><button class="btn primary" data-tab="home">Back to Home</button></div>';
    if (!A.data){ if (!A.loading && !A.err) setTimeout(load, 0); return h + (A.err ? '<div class="empty">Couldn\'t load: ' + e(A.err) + ' <button class="btn" data-admreload="1">Try again</button></div>' : '<div class="empty">Loading everyone…</div>'); }
    var sum = A.data.summary, people = sum.filter(function(s){ return A.person === "all" || s.id === A.person; });
    h += '<div class="seg adm-seg" role="tablist">' + [["align", "Where we align"], ["people", "People"]].map(function(x){ return '<button role="tab" data-admsec="' + x[0] + '" aria-selected="' + (A.sec === x[0]) + '" aria-pressed="' + (A.sec === x[0]) + '">' + x[1] + '</button>'; }).join("") + '</div>';
    h += '<div class="row hscroll adm-filter">' + chip("data-admperson", "all", A.person, "Everyone") + sum.map(function(s, i){ return '<button class="chip" data-admperson="' + e(s.id) + '" aria-pressed="' + (A.person === s.id) + '">' + initial(s, i) + ' ' + e(s.name) + '</button>'; }).join("") + '</div>';
    var rank = rankOverlap(sum, { nameOf: pname }), cats = {};
    rank.rows.forEach(function(r){ catsOf(r.id).forEach(function(c){ cats[c] = 1; }); });
    var catKeys = Object.keys(cats).filter(function(c){ return typeof CATS !== "undefined" && CATS[c]; });
    if (catKeys.length) h += '<div class="row hscroll adm-filter">' + chip("data-admcat", "all", A.cat, "All types") + catKeys.map(function(c){ return chip("data-admcat", c, A.cat, e(CATS[c])); }).join("") + '</div>';
    var okCat = function(id){ return A.cat === "all" || catsOf(id).indexOf(A.cat) >= 0; };
    if (A.sec === "people") return h + peopleHtml(sum, people, okCat);
    return h + groupPicksHtml(rank, okCat);
  }
  function peopleHtml(sum, people, okCat){ var h = "";
    {
      h += '<p class="small muted">' + sum.length + ' people · ' + sum.reduce(function(a, s){ return a + s.likes; }, 0) + ' saves · ' + sum.reduce(function(a, s){ return a + s.planItems; }, 0) + ' plan stops</p>';
      people.forEach(function(s){ var i = sum.indexOf(s), open = !!A.open[s.id] || A.person === s.id;
        h += '<div class="card adm-person"><button class="adm-ptop" data-admopen="' + e(s.id) + '" aria-expanded="' + open + '">' + initial(s, i) + '<span class="adm-pn"><b>' + e(s.name) + '</b><span class="small muted">' + e(s.email) + '</span></span><span class="adm-caret">' + (open ? "–" : "+") + '</span></button>' +
          '<div class="adm-stats"><span class="st open">♥ ' + s.likes + ' saved</span><span class="st later">📋 ' + s.lists + ' lists</span><span class="st now">🗓 ' + s.planItems + ' plan stops</span></div>';
        if (open){
          if (!s.groups.length) h += '<p class="small muted">Nothing saved yet.</p>';
          s.groups.forEach(function(g){ var ids = g.ids.filter(okCat); if (!ids.length) return;
            h += '<div class="adm-group"><div class="eyebrow">' + e(g.title) + ' · ' + ids.length + '</div><div class="adm-tags">' + ids.map(function(id){ return place(id) ? '<button class="chip" data-open="' + e(id) + '">' + e(pname(id)) + '</button>' : '<span class="chip">' + e(pname(id)) + '</span>'; }).join("") + '</div></div>'; });
          if (s.searches.length) h += '<div class="adm-group"><div class="eyebrow">Saved searches</div><p class="small">' + s.searches.map(e).join(" · ") + '</p></div>';
        }
        h += '</div>'; });
      return h;
    }
  }
  function groupPicksHtml(rank, okCat){ var h = "";
    var rows = rank.rows.filter(function(r){ return okCat(r.id) && (A.person === "all" || r.who.indexOf(A.person) >= 0); });
    var row = function(r){
      var p = place(r.id);
      var area = p && p.a ? '<span>' + e(p.a) + '</span>' : "";
      var cat = (catsOf(r.id)[0] && typeof CATS !== "undefined" && CATS[catsOf(r.id)[0]]) ? '<span>' + e(CATS[catsOf(r.id)[0]]) + '</span>' : "";
      var agree = r.tier === "everyone" ? '<span class="st open">Everyone agrees</span>' : r.tier === "most" ? '<span class="st later">Most of you</span>' : r.tier === "some" ? '<span class="st">Some of you</span>' : '<span class="st">Only one person</span>';
      return '<div class="res adm-row adm-' + r.tier + '"><button class="nm" ' + (p ? 'data-open="' + e(r.id) + '"' : "") + '>' + e(r.name) + '</button><div class="right"><span class="mono adm-n">' + r.pct + '%</span><span class="small muted">' + r.n + ' of ' + rank.total + ' agree</span></div>' + whoLine(r) + '<div class="sub2">' + agree + area + cat + '</div></div>';
    };
    var shared = rows.filter(function(r){ return r.n > 1; }), solo = rows.filter(function(r){ return r.n === 1; });
    h += '<div class="box adm-sum"><b>' + rows.filter(function(r){ return r.tier === "everyone"; }).length + ' everyone agrees on</b><span class="small muted">' + rows.filter(function(r){ return r.tier === "most"; }).length + ' most of you like · ' + solo.length + ' only one person picked</span></div>';
    var top = shared.slice(0, 3);
    if (top.length) h += '<div class="box adm-top"><div class="eyebrow">Top picks</div>' + top.map(function(r, i){ return '<div>' + (i + 1) + '. <b>' + e(r.name) + '</b> <span class="small muted">' + r.pct + '% · ' + r.who.map(function(id){ var x = A.data.summary.find(function(s){ return s.id === id; }); return e(x ? x.name : "?"); }).join(", ") + '</span></div>'; }).join("") + '</div>';
    h += '<h3 class="adm-h" id="group-picks">Group picks · where we align</h3>' + (shared.length ? shared.map(row).join("") : '<div class="empty">No overlap yet.</div>');
    h += '<details class="cat adm-solo"' + (A.open.solo ? " open" : "") + '><summary data-admsolo="1"><span class="t2">Unique to one person</span><span class="c">' + solo.length + '</span></summary><div class="body">' + (solo.length ? solo.map(row).join("") : '<p class="small muted">None.</p>') + '</div></details>';
    return h;
  }
  var css = ".adm-av{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;color:var(--surface);font-weight:800;font-size:.8rem;border:2px solid var(--surface);flex:none}" +
    ".adm-avs{display:inline-flex}.adm-avs .adm-av{margin-left:-7px;width:26px;height:26px}.adm-avs .adm-av:first-child{margin-left:0}" +
    ".adm-seg{display:flex;gap:6px;margin:8px 0}.adm-seg button{flex:1;border:1px solid var(--line);background:var(--surface);border-radius:999px;font-weight:800;color:var(--ink)}.adm-seg button[aria-selected=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}" +
    ".adm-filter{margin:6px 0}.adm-filter .chip{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.adm-filter .adm-av{width:22px;height:22px;font-size:.7rem;border:0}" +
    ".adm-person{margin:10px 0}.adm-ptop{all:unset;cursor:pointer;display:flex;gap:10px;align-items:center;min-height:44px}.adm-ptop .adm-av{width:40px;height:40px;font-size:1rem}.adm-pn{display:grid;flex:1;min-width:0}.adm-pn .small{overflow:hidden;text-overflow:ellipsis}.adm-caret{font-size:1.4rem;color:var(--muted)}" +
    ".adm-stats{display:flex;flex-wrap:wrap;gap:6px}.adm-group{display:grid;gap:6px;margin-top:6px}.adm-tags{display:flex;flex-wrap:wrap;gap:6px}" +
    ".adm-h{margin:14px 0 6px}.adm-row{margin:8px 0}.adm-everyone{border-color:var(--leaf);box-shadow:inset 4px 0 0 var(--leaf)}.adm-most{box-shadow:inset 4px 0 0 var(--gold)}.adm-n{font-weight:800}.adm-sum{margin:10px 0}.adm-solo{margin-top:14px}.adm-top{margin:10px 0}.adm-row .right{display:grid;justify-items:end}" +
    ".adm-who{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:6px;align-items:center}" +
    ".adm-who-k{font-family:var(--mono,ui-monospace,monospace);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;font-weight:800;color:var(--muted)}" +
    ".adm-pick{display:inline-flex;align-items:center;gap:5px;max-width:100%;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 8px 2px 2px;color:var(--ink);font-size:.84rem;line-height:1.2}" +
    ".adm-pick b{font-weight:800}.adm-pick .adm-how{color:var(--muted);font-weight:600;font-size:.75rem}.adm-pick .adm-av{width:22px;height:22px;font-size:.68rem;border:0}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- wire into the app ---------- */
  if (typeof TAB_ICON !== "undefined") TAB_ICON.admin = '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>';
  if (typeof PAGE_NAMES !== "undefined") PAGE_NAMES.admin = "Admin";
  function syncTabs(){ var i = TABS.findIndex(function(t){ return t[0] === "admin"; });
    if (amAdmin() && i < 0) TABS.push(["admin", "Admin"]); else if (!amAdmin() && i >= 0) TABS.splice(i, 1); }
  var _render = render;
  render = function(){ syncTabs(); var r = _render.apply(this, arguments);
    if (S.tab === "admin"){ var m = document.getElementById("main"); if (m) m.innerHTML = '<section class="view adm-view">' + vAdmin() + '</section>'; }
    if (S.tab === "saved" && amAdmin()){ var m2 = document.getElementById("main"); if (m2){
      var tg = '<div class="seg adm-seg adm-savedtoggle" role="tablist" aria-label="Whose trip plans">' + [["mine", "My trip plans"], ["all", "All trip plans"]].map(function(x){ return '<button role="tab" data-admsaved="' + x[0] + '" aria-selected="' + (A.savedMode === x[0]) + '" aria-pressed="' + (A.savedMode === x[0]) + '">' + x[1] + '</button>'; }).join("") + '</div>';
      if (A.savedMode === "all"){
        var body;
        if (!A.data){ if (!A.loading && !A.err) setTimeout(load, 0); body = '<div class="empty">' + (A.err ? "Couldn't load: " + e(A.err) : "Loading everyone…") + '</div>'; }
        else { var sm = A.data.summary, rk = rankOverlap(sm, { nameOf: pname }), all = function(){ return true; };
          body = '<div class="head"><span class="eyebrow">Everyone\'s saves</span><h2>All trip plans</h2></div>' + groupPicksHtml(rk, all) + '<h3 class="adm-h">By person</h3>' + peopleHtml(sm, sm, all); }
        m2.innerHTML = '<section class="view adm-view">' + tg + body + '</section>';
      } else { var sec = m2.querySelector("section.view"); if (sec) sec.insertAdjacentHTML("afterbegin", tg); }
    } }
    return r; };
  window.nolaAuthChanged = function(){ if (!amAdmin()) A.data = null; render(); };
  document.addEventListener("click", function(ev){
    var el = ev.target.closest && ev.target.closest("[data-admsec],[data-admperson],[data-admcat],[data-admopen],[data-admsolo],[data-admreload],[data-admsaved]"); if (!el) return;
    var d = el.dataset;
    if (d.admsolo){ ev.preventDefault(); A.open.solo = !A.open.solo; }
    if (d.admsaved){ A.savedMode = d.admsaved; if (d.admsaved === "all" && A.data && (!A.at || Date.now() - A.at > 30000)) { A.data = null; } } if (d.admsec) A.sec = d.admsec; if (d.admperson) A.person = d.admperson; if (d.admcat) A.cat = d.admcat;
    if (d.admopen) A.open[d.admopen] = !A.open[d.admopen]; if (d.admreload){ A.err = null; load(); }
    render();
  });
  render();
})();
