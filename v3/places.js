/* Real-place search: every search box (Explore, Today, Open now, universal search, add-to-plan, Ask) also looks up
   real venues in free OpenStreetMap data. Photon (komoot) biased to New Orleans first, Nominatim as fallback.
   No keys, no cost. Found places become first-class places (id "osm-…") so they can be saved, added to the plan,
   and synced to the account like any built-in place. */
(function(){
  "use strict";
  if (typeof P === "undefined" || typeof BY === "undefined") return;
  var NOLA = [29.9566, -90.0659], BB = {w:-90.40, s:29.80, e:-89.70, n:30.40};
  var STORE = "nola-ext-places", cache = {}, inflight = {}, timer = null;
  var FILL = /^(the|a|an|of|bar|bars|pub|lounge|restaurant|cafe|café|new|orleans|nola|la|louisiana|in|near|at|nearby|french|quarter)$/;
  var LOCWORDS = /\b(new orleans|nola|louisiana|la|usa|french quarter)\b/g;

  /* ---------- text helpers ---------- */
  function fold(s){ return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function norm(s){ return fold(s).replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|and)\b/g, " ").replace(/\s+/g, " ").trim(); }
  function clean(q){ return fold(q).replace(LOCWORDS, " ").replace(/[,]+/g, " ").replace(/\s+/g, " ").trim(); }
  function toks(s){ return norm(s).split(" ").filter(Boolean); }
  // consonant skeleton: "aaron"→"rn", "erin"→"rn", "rose"→"rs" (catches spoken/misheard spellings)
  function skel(w){ return w.replace(/ph/g, "f").replace(/ck/g, "k").replace(/[aeiouyhw]/g, "").replace(/(.)\1+/g, "$1"); }
  function lev(a, b){ var m = a.length, n = b.length, d = []; for (var i = 0; i <= m; i++){ d[i] = [i]; } for (var j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)); return d[m][n]; }
  function tokMatch(q, n){
    if (q === n) return 1;
    if (q.length >= 4 && (n.indexOf(q) === 0 || q.indexOf(n) === 0) && Math.min(q.length, n.length) >= 3) return 0.85;
    if (q.length >= 4 && lev(q, n) <= (q.length >= 7 ? 2 : 1)) return 0.75;
    var a = skel(q), b = skel(n); if (a.length >= 2 && a === b) return 0.65;
    return 0;
  }
  // how well a result name matches the query, 0..1 (filler words like "bar" count only half)
  function score(query, name){
    var qt = toks(clean(query)), nt = toks(name); if (!qt.length || !nt.length) return 0;
    var tot = 0, got = 0;
    qt.forEach(function(q){ var w = FILL.test(q) ? 0.35 : 1; tot += w; var best = 0; nt.forEach(function(n){ best = Math.max(best, tokMatch(q, n)); }); got += w * best; });
    var s = got / tot; if (norm(name) === norm(clean(query))) s = Math.max(s, 1.05);
    return s;
  }
  function meters(a, b){ var R = 6371000, r = Math.PI / 180, dl = (b[0]-a[0]) * r, dn = (b[1]-a[1]) * r;
    var x = Math.sin(dl/2) * Math.sin(dl/2) + Math.cos(a[0]*r) * Math.cos(b[0]*r) * Math.sin(dn/2) * Math.sin(dn/2); return 2 * R * Math.asin(Math.sqrt(x)); }

  async function getJSON(url, ms){
    var c = new AbortController(), t = setTimeout(function(){ c.abort(); }, ms || 7000);
    try { var r = await fetch(url, { signal: c.signal }); return r.ok ? await r.json() : null; } catch(e){ return null; } finally { clearTimeout(t); }
  }
  var SKIP = /^(boundary|highway|landuse|railway|natural|waterway|route|place)$/;
  function fromPhoton(j){ return (j && j.features || []).map(function(f){ var p = f.properties || {}; if (!p.name || SKIP.test(p.osm_key)) return null;
    return { name: p.name, key: p.osm_key, v: p.osm_value, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      addr: [p.housenumber && p.street ? p.housenumber + " " + p.street : p.street, p.city || p.district].filter(Boolean).join(", "),
      osm: (p.osm_type || "N")[0].toUpperCase() + p.osm_id }; }).filter(Boolean); }
  function fromNominatim(j){ return (Array.isArray(j) ? j : []).map(function(x){ if (!x.name || SKIP.test(x.category)) return null; var a = x.address || {};
    return { name: x.name, key: x.category, v: x.type, lat: +x.lat, lon: +x.lon,
      addr: [a.house_number && a.road ? a.house_number + " " + a.road : a.road, a.city || a.town || a.village].filter(Boolean).join(", "),
      osm: (x.osm_type || "node")[0].toUpperCase() + x.osm_id }; }).filter(Boolean); }
  function photon(q, extra){ return photon1(q, extra).then(function(r){ return r || new Promise(function(ok){ setTimeout(ok, 700); }).then(function(){ return photon1(q, extra); }).then(function(r2){ return r2 || []; }); }); }
  function photon1(q, extra){ var bb = extra ? "-90.15,29.90,-89.95,30.05" : [BB.w, BB.s, BB.e, BB.n].join(","); return getJSON("https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&lat=" + NOLA[0] + "&lon=" + NOLA[1] +
    "&bbox=" + bb + "&limit=15&lang=en" + (extra || "")).then(function(j){ return j ? fromPhoton(j) : null; }); }
  function nominatim(q){ return getJSON("https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(q) + "&format=jsonv2&limit=10&addressdetails=1&bounded=1&viewbox=" +
    [BB.w, BB.n, BB.e, BB.s].join(",")).then(fromNominatim); }
  var BARISH = /\b(bar|pub|lounge|tavern|saloon|club)\b/;

  async function lookup(raw){
    var q = clean(raw); if (q.length < 3) return [];
    var all = await photon(q);
    if (norm(q) !== q) all = all.concat(await photon(norm(q)));   // "&", "and", "the", apostrophes
    var best = function(){ return all.reduce(function(m, r){ return Math.max(m, score(raw, r.name)); }, 0); };
    if (best() < 0.6) {
      // variants: without "&"/"the", then the most distinctive words alone (catches misheard first words, e.g. "aaron rose")
      var core = toks(q).filter(function(w){ return !FILL.test(w); });
      var tag = BARISH.test(fold(raw)) ? "&osm_tag=amenity:bar&osm_tag=amenity:pub&osm_tag=amenity:nightclub" : "";
      var tries = [core.join(" ")].concat(core.slice().sort(function(a, b){ return b.length - a.length; }).slice(0, 2).reverse());
      for (var i = 0; i < tries.length && best() < 0.6; i++) if (tries[i] && tries[i] !== q) all = all.concat(await photon(tries[i], tag));
    }
    if (best() < 0.6) all = all.concat(await nominatim(q));
    var seen = {};
    return all.map(function(r){ r.s = score(raw, r.name); r.m = meters(NOLA, [r.lat, r.lon]); return r; })
      .filter(function(r){ return r.s >= 0.5; })
      .sort(function(a, b){ return (b.s - a.s) || (a.m - b.m); })
      .filter(function(r){ var k = norm(r.name) + "|" + Math.round(r.lat * 500); if (seen[k] || seen[r.osm]) return false; seen[k] = seen[r.osm] = 1; return true; })
      .slice(0, 6);
  }
  function search(raw){
    var k = clean(raw); if (cache[k]) return Promise.resolve(cache[k]);
    if (!inflight[k]) inflight[k] = lookup(raw).then(function(r){ cache[k] = r; delete inflight[k]; return r; }, function(){ delete inflight[k]; return []; });
    return inflight[k];
  }
  window.nolaPlaceSearch = search;

  /* ---------- turn a found place into an app place ---------- */
  var CATOF = function(r){ var v = r.v || "", k = r.key || "";
    if (/bar|pub|nightclub|biergarten/.test(v)) return ["drink"];
    if (/cafe|bakery|ice_cream|coffee|confectionery/.test(v)) return ["coffee"];
    if (/restaurant|fast_food|food_court|deli/.test(v)) return ["eat"];
    if (/museum|attraction|monument|memorial|artwork|gallery/.test(v) || k === "historic" || k === "tourism") return ["history"];
    if (/park|garden|nature/.test(v) || k === "leisure") return ["nature"];
    if (/tattoo/.test(v)) return ["tattoo"];
    return ["shop"]; };
  var KIND = { bar:"Bar", pub:"Pub", nightclub:"Club", restaurant:"Restaurant", cafe:"Café", fast_food:"Quick bite", bakery:"Bakery", museum:"Museum", hotel:"Hotel", attraction:"Attraction" };
  function kindOf(r){ return KIND[r.v] || (r.v ? r.v.replace(/_/g, " ").replace(/^./, function(c){ return c.toUpperCase(); }) : "Place"); }
  function ext(){ try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch(e){ return {}; } }
  function install(p){ if (!BY[p.id]) { P.push(p); BY[p.id] = p; } else Object.assign(BY[p.id], p); if (typeof COORD !== "undefined" && p.lat) COORD[p.id] = [p.lat, p.lon]; }
  function register(r){
    if (window.nolaRequireAccount && !window.nolaRequireAccount("You need an account to save a place. Join the trip or sign in.")) return null;
    var id = "osm-" + r.osm.toLowerCase();
    var p = { id: id, n: r.name, c: CATOF(r), a: "From the map", d: r.m < 2500 ? 0 : 1, ad: r.addr || "", lat: r.lat, lon: r.lon, ext: true,
      note: kindOf(r) + (r.addr ? " at " + r.addr : "") + ". Found in OpenStreetMap; hours and details aren't verified by us." };
    install(p);
    var e = ext(); if (!e[id]) { e[id] = p; localStorage.setItem(STORE, JSON.stringify(e)); }
    return id;
  }
  window.nolaRegisterPlace = register;
  // places found earlier (and synced from the account) come back on load
  var had = ext(), n = 0; Object.keys(had).forEach(function(id){ install(had[id]); n++; });

  /* ---------- results under each search box ---------- */
  var BOXES = { q: "explore", uq: "all", nowq: "now", hq: "open", altq: "sheet" };
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
  function mi(m){ return (m / 1609.34).toFixed(m < 16000 ? 1 : 0) + " mi from the Quarter"; }
  function builtinIds(raw){ var nq = norm(clean(raw)); return P.filter(function(p){ return !p.ext && (norm(p.n).indexOf(nq) >= 0 || score(raw, p.n) >= 0.8); }).map(function(p){ return p.id; }); }
  function rowHtml(r, mode){
    var id = "osm-" + r.osm.toLowerCase(), ro = typeof readOnly !== "undefined" && readOnly, mine = typeof myPicks === "function" && new Set(myPicks()).has(id);
    var btns = mode === "sheet"
      ? (ro ? "" : '<button class="btn" data-xreg="' + esc(r.osm) + '" data-xact="swap">Swap in</button><button class="btn" data-xreg="' + esc(r.osm) + '" data-xact="addp">Add</button>')
      : '<button class="btn" data-xreg="' + esc(r.osm) + '" data-xact="heart" aria-pressed="' + mine + '">' + (mine ? "✓ Saved · Remove" : "Save") + '</button>' +
        (ro ? "" : '<button class="btn" data-xreg="' + esc(r.osm) + '" data-xact="addto">Add to trip</button>') +
        '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.name + (r.addr ? ", " + r.addr : "") + ", New Orleans") + '">Maps</a>';
    return '<div class="xres"><div class="xn">' + esc(r.name) + '</div><div class="xm">' + esc(kindOf(r)) + (r.addr ? " · " + esc(r.addr) : "") + " · " + esc(mi(r.m)) + '</div><div class="xb">' + btns + '</div></div>';
  }
  function paint(input, mode){
    var raw = (input.value || "").trim(), host = input.closest(".fg, .row, .sheet-top") || input.parentNode, box = host.parentNode.querySelector(":scope > .xbox[data-for='" + input.id + "']");
    if (raw.length < 3) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement("div"); box.className = "xbox"; box.dataset.for = input.id; host.insertAdjacentElement("afterend", box); }
    var k = clean(raw), res = cache[k];
    if (!res) { box.innerHTML = '<div class="xh">Real places on the map</div><div class="xm">Searching OpenStreetMap…</div>'; return; }
    var known = new Set(builtinIds(raw)), list = res.filter(function(r){ return !known.has("osm-" + r.osm.toLowerCase()); });
    box.innerHTML = '<div class="xh">Real places on the map' + (list.length ? "" : "") + '</div>' +
      (list.length ? list.map(function(r){ return rowHtml(r, mode); }).join("") : '<div class="xm">No other matches on the map for “' + esc(raw) + '”.</div>') +
      '<div class="xsrc">From OpenStreetMap via Photon/Nominatim. Save and it syncs to your account.</div>';
    box._res = list;
  }
  function refresh(){
    Object.keys(BOXES).forEach(function(id){
      var inp = document.getElementById(id); if (!inp) return;
      var raw = (inp.value || "").trim(); paint(inp, BOXES[id]);
      if (raw.length >= 3 && !cache[clean(raw)]) search(raw).then(function(){ var i2 = document.getElementById(id); if (i2 && i2.value.trim() === raw) paint(i2, BOXES[id]); });
    });
  }
  var _render = render;
  render = function(){ var r = _render.apply(this, arguments); clearTimeout(timer); timer = setTimeout(refresh, 350); return r; };

  document.addEventListener("click", function(e){
    var b = e.target.closest("[data-xreg]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var box = b.closest(".xbox"), r = (box && box._res || []).find(function(x){ return x.osm === b.dataset.xreg; }); if (!r) return;
    var id = register(r); if (!id) return; var act = b.dataset.xact;
    if (act === "heart") { togglePick(id); return; }
    var fake = document.createElement("button");
    if (act === "addto") fake.dataset.addto = id; else if (act === "addp") fake.dataset.addp = id; else if (act === "swap") fake.dataset.swap = id;
    if (typeof planClick === "function") planClick(fake);
  }, true);

  /* Ask chat: use the same name-aware search first */
  var oldFind = window.nolaFindNearby;
  window.nolaFindNearby = async function(term){
    var res = await search(term);
    if (res.length) return { text: "Not in our guide, but here's what I found on the map:", actions: [],
      results: res.map(function(r){ return Object.assign({}, r, { from: "the Quarter", kind: kindOf(r), food: /restaurant|cafe|bar|pub|fast_food|bakery/.test(r.v || "") }); }) };
    return oldFind ? oldFind(term) : null;
  };


  /* ---------- map: Save / Add to plan on every pin, and tap anywhere to save the nearest real place ---------- */
  function pinHtml(p){
    var mine = typeof myPicks === "function" && new Set(myPicks()).has(p.id), ro = typeof readOnly !== "undefined" && readOnly;
    return '<div class="mpop"><div class="mpop-n">' + esc(p.n) + '</div>' + (p.ad ? '<div class="mpop-a">' + esc(p.ad) + '</div>' : '') +
      '<div class="mpop-b"><button type="button" class="mbtn save" data-heart="' + esc(p.id) + '" aria-pressed="' + mine + '">' + (mine ? "✓ Saved · Remove" : "Save") + '</button>' +
      (ro ? '' : '<button type="button" class="mbtn" data-addto="' + esc(p.id) + '">Add to trip</button>') +
      '<a class="mbtn ghost" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((p.n || "Place") + (p.ad ? ", " + p.ad : ", New Orleans")) + '" target="_blank" rel="noopener">Maps</a>' +
      '<button type="button" class="mbtn ghost" data-open="' + esc(p.id) + '">Details</button></div></div>';
  }
  function hookMarkers(){
    if (typeof LCL === "undefined" || !LCL || typeof updateMarkers !== "function" || updateMarkers._x) return;
    var orig = updateMarkers;
    updateMarkers = function(){
      var r = orig.apply(this, arguments);
      try {
        var byName = {}; mapList().forEach(function(p){ byName[p.n] = p; });
        LCL.eachLayer(function(mk){ var t = mk.getTooltip && mk.getTooltip(), p = t && byName[t.getContent()]; if (!p) return;
          /* fix6: a pin opens the place's info sheet (as before fix5); the sheet carries Save + Add to plan */
          mk.off("click"); mk.options.bubblingMouseEvents = false; if (mk.unbindPopup) mk.unbindPopup();
          mk.on("click", function(ev){ if (ev && ev.originalEvent && L.DomEvent) L.DomEvent.stopPropagation(ev); S.sheet = p.id; render(); var c = document.querySelector(".sheet .close"); if (c) c.focus(); }); });
      } catch(e){ console.warn(e); }
      return r;
    };
    updateMarkers._x = 1;
  }
  async function reverse(lat, lon){
    var j = await getJSON("https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lon + "&limit=5&lang=en&radius=0.08");
    var c = fromPhoton(j || {}).filter(function(r){ return r.name; }).map(function(r){ r.m = meters(NOLA, [r.lat, r.lon]); r.d0 = meters([lat, lon], [r.lat, r.lon]); return r; })
      .sort(function(a, b){ return a.d0 - b.d0; });
    return c[0] || null;
  }
  var tapRes = {};
  function hookTap(){
    if (typeof LMAP === "undefined" || !LMAP || LMAP._xtap) return; LMAP._xtap = 1;
    LMAP.on("click", async function(e){
      var t = e.originalEvent && e.originalEvent.target; if (t && t.classList && t.classList.contains("leaflet-interactive")) return;
      var lat = +e.latlng.lat.toFixed(6), lon = +e.latlng.lng.toFixed(6), key = lat + "," + lon;
      var pop = L.popup({ className: "mpopw", maxWidth: 300 }).setLatLng(e.latlng).setContent('<div class="mpop"><div class="mpop-a">Looking up what\'s here…</div></div>').openOn(LMAP);
      var r = await reverse(lat, lon);
      var spot = { name: "Saved spot", v: "spot", key: "spot", lat: lat, lon: lon, addr: r && r.addr || "", osm: "S" + key.replace(/[^0-9]/g, "") };
      spot.m = meters(NOLA, [lat, lon]);
      tapRes[key] = { r: r, spot: spot };
      var ro = typeof readOnly !== "undefined" && readOnly, h = '<div class="mpop">';
      if (r) h += '<div class="mpop-k">Nearest place</div><div class="mpop-n">' + esc(r.name) + '</div><div class="mpop-a">' + esc(kindOf(r)) + (r.addr ? " · " + esc(r.addr) : "") + '</div>' +
        '<div class="mpop-b"><button type="button" class="mbtn save" data-xtap="' + key + '" data-which="r" data-act="heart">Save</button>' + (ro ? "" : '<button type="button" class="mbtn" data-xtap="' + key + '" data-which="r" data-act="addto">Add to trip</button>') +
        '<a class="mbtn ghost" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.lat + "," + r.lon) + '" target="_blank" rel="noopener">Maps</a></div>';
      else h += '<div class="mpop-a">No named place right here.</div>';
      h += '<div class="mpop-b"><button type="button" class="mbtn ghost" data-xtap="' + key + '" data-which="s" data-act="heart">📍 Save this spot</button></div></div>';
      if (LMAP.hasLayer && pop.isOpen()) pop.setContent(h);
    });
  }
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest("[data-xtap]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var t = tapRes[b.dataset.xtap]; if (!t) return; var r = b.dataset.which === "r" ? t.r : t.spot; if (!r) return;
    var id = register(r); if (!id) return;
    if (b.dataset.act === "heart") { if (!new Set(myPicks()).has(id)) togglePick(id); if (new Set(myPicks()).has(id)) { b.textContent = "♥ Saved"; b.setAttribute("aria-pressed", "true"); } try { LMAP.closePopup(); } catch(_){} return; }
    var fake = document.createElement("button"); fake.dataset.addto = id; try { LMAP.closePopup(); } catch(_){} planClick(fake);
  }, true);
  // keep popup heart labels fresh after a save
  // Leaflet stops clicks inside popups from bubbling, so pin buttons are handled here (capture phase)
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest(".mpop [data-heart], .mpop [data-addto], .mpop [data-open]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); try { LMAP.closePopup(); } catch(_){}
    if (b.dataset.heart) { togglePick(b.dataset.heart); return; }
    if (b.dataset.addto) { var f = document.createElement("button"); f.dataset.addto = b.dataset.addto; planClick(f); return; }
    S.sheet = b.dataset.open; render();
  }, true);
  if (typeof ensureMap === "function") { var _em = ensureMap; ensureMap = function(){ var r = _em.apply(this, arguments); hookMarkers(); hookTap(); try { updateMarkers(); } catch(_){} return r; }; }
  var st = document.createElement("style");
  st.textContent = ".xbox{margin:10px 0 14px;padding:10px 12px;border:1px dashed var(--line,#c9b8bf);border-radius:14px}" +
    ".xh{font-family:var(--mono,monospace);font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--coral,#FF6B5B);margin-bottom:6px}" +
    ".xres{padding:8px 0;border-top:1px solid var(--line,#e5d8dc)}.xres:first-of-type{border-top:0}.xn{font-weight:700}.xm{font-size:.85rem;color:var(--muted,#7a6670)}" +
    ".mpopw .leaflet-popup-content{margin:12px 14px;min-width:220px}.mpop-k{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:#c2412f}.mpop-n{font-weight:700;font-size:1rem}.mpop-a{font-size:.85rem;color:#6b5a63;margin-top:2px}" +
    ".mpop-b{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.mbtn{min-height:44px;min-width:44px;padding:0 14px;border-radius:999px;border:1px solid #23172C;background:#fff;color:#23172C;font:600 14px system-ui,sans-serif;cursor:pointer}.mbtn.save{background:#FF6B5B;border-color:#FF6B5B;color:#fff}.mbtn.ghost{border-style:dashed}" +
    ".xb{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.xsrc{font-size:.72rem;color:var(--muted,#7a6670);margin-top:6px}";
  document.head.appendChild(st);
  window.nolaPaintOsm = function(el, raw){
    if(!el) return;
    var q = (raw || "").trim();
    el.className = "xbox"; el.dataset.for = "gs";
    if(q.length < 3){ el.innerHTML = ""; el._res = []; return; }
    var res = cache[clean(q)];
    if(!res){
      el.innerHTML = '<div class="xh">Real places on the map</div><div class="xm">Searching OpenStreetMap…</div>';
      el._res = [];
      search(q).then(function(){ var inp = document.getElementById("gs"); if(inp && inp.value.trim() === q) window.nolaPaintOsm(el, q); });
      return;
    }
    var known = new Set(builtinIds(q));
    var list = res.filter(function(r){ return !known.has("osm-" + r.osm.toLowerCase()); });
    el._res = list;
    el.innerHTML = '<div class="xh">Real places on the map</div>' + (list.length ? list.map(function(r){ return rowHtml(r, "all"); }).join("") : '<div class="xm">No other matches on the map for “' + esc(q) + '”.</div>') + '<div class="xsrc">From OpenStreetMap via Photon/Nominatim. Save and it syncs to your account.</div>';
  };
  if (n) try { render(); } catch(e){}
})();
