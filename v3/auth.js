/* NOLA accounts: sign-up bar, magic link / 6-digit code, and cloud sync of this device's saves.
   Design: the app keeps using localStorage exactly as before (works offline and signed out).
   This file mirrors the synced keys to Supabase when signed in, and pulls them back on sign-in. */
(function(){
  "use strict";
  var CFG = window.NOLA_SUPABASE || {};
  // The claude.ai artifact build has its own shared/read-only group plan; leave that mode alone.
  var ARTIFACT = !!(window.claude && window.claude.use);
  if (ARTIFACT || !window.supabase || !CFG.url || !CFG.key) return;

  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
  window.NolaAccount = { client: sb };

  var LS = window.localStorage;
  var rawSet = LS.setItem.bind(LS);
  var SYNC = { "nola-picks":1, "nola-votes":1, "nola-visited":1, "nola-plan":1, "nola-checks":1, "nola-my-ink":1, "nola-trip":1, "nola-searches":1, "nola-ext-places":1 };
  var session = null, pulling = false, timers = {};

  function j(s, d){ try { var v = JSON.parse(s); return v == null ? d : v; } catch(e){ return d; } }
  function uid(){ return session && session.user && session.user.id; }

  /* ---------- push: mirror local writes to the account ---------- */
  LS.setItem = function(k, v){
    rawSet(k, v);
    if (SYNC[k] && uid() && !pulling) { clearTimeout(timers[k]); timers[k] = setTimeout(function(){ push(k).catch(warn); }, 800); }
  };
  function warn(e){ console.warn("[nola sync]", e && e.message || e); }

  async function upsertSingleton(kind, title, data){
    var s = await sb.from("lists").select("id").eq("user_id", uid()).eq("kind", kind).maybeSingle();
    var r = s.data ? await sb.from("lists").update({ data: data, updated_at: new Date().toISOString() }).eq("id", s.data.id)
                   : await sb.from("lists").insert({ user_id: uid(), kind: kind, title: title, data: data });
    if (r.error) throw r.error;
  }
  async function replaceLikes(kind, rows){
    await sb.from("likes").delete().eq("user_id", uid()).eq("kind", kind);
    if (rows.length) { var r = await sb.from("likes").insert(rows); if (r.error) throw r.error; }
  }
  async function push(k){
    var v = LS.getItem(k), me = uid(); if (!me) return;
    if (k === "nola-picks") return replaceLikes("like", j(v, []).map(function(id){ return { user_id: me, item_ref: String(id), kind: "like" }; }));
    if (k === "nola-votes") { var o = j(v, {}); return replaceLikes("vote", Object.keys(o).map(function(id){ return { user_id: me, item_ref: id, kind: "vote", value: o[id] }; })); }
    if (k === "nola-visited") { var w = j(v, {}); return replaceLikes("visited", Object.keys(w).map(function(id){ return { user_id: me, item_ref: id, kind: "visited", value: w[id] }; })); }
    if (k === "nola-plan") return upsertSingleton("itinerary", "My itinerary", j(v, {}));
    if (k === "nola-checks") return upsertSingleton("checklist", "Checklist", j(v, {}));
    if (k === "nola-my-ink") return upsertSingleton("ink", "My ink", { items: j(v, []) });
    if (k === "nola-trip") { var r = await sb.from("profiles").update({ trip: j(v, {}), updated_at: new Date().toISOString() }).eq("id", me); if (r.error) throw r.error; return; }
    if (k === "nola-ext-places") return upsertSingleton("custom", "Places from the map", j(v, {}));
    if (k === "nola-searches") {
      var list = j(v, []);
      await sb.from("lists").delete().eq("user_id", me).eq("kind", "search");
      if (list.length) await sb.from("lists").insert(list.map(function(s){ return { user_id: me, kind: "search", title: s.q, data: s }; }));
    }
  }

  /* ---------- pull + first-sign-in migration ---------- */
  async function pull(){
    var me = uid(); if (!me) return;
    var res = await Promise.all([
      sb.from("profiles").select("trip,name").eq("id", me).maybeSingle(),
      sb.from("lists").select("kind,title,data").eq("user_id", me),
      sb.from("likes").select("item_ref,kind,value").eq("user_id", me)
    ]);
    var prof = res[0].data || {}, lists = res[1].data || [], likes = res[2].data || [];
    var cloudEmpty = !lists.length && !likes.length && !(prof.trip && Object.keys(prof.trip).length);
    var flag = "nola-migrated-" + me;
    if (cloudEmpty) {
      // first sign-in on an empty account: upload whatever this device already has
      for (var k in SYNC) if (LS.getItem(k) != null) await push(k).catch(warn);
      rawSet(flag, "1"); return false;
    }
    // merge: union likes/votes/visited; for plan/trip/checks/ink prefer the account, but keep local if the account lacks it
    var next = {};
    var picks = new Set(j(LS.getItem("nola-picks"), [])), votes = j(LS.getItem("nola-votes"), {}), vis = j(LS.getItem("nola-visited"), {});
    likes.forEach(function(l){ if (l.kind === "like") picks.add(l.item_ref); if (l.kind === "vote") votes[l.item_ref] = l.value; if (l.kind === "visited") vis[l.item_ref] = l.value == null ? true : l.value; });
    next["nola-picks"] = JSON.stringify(Array.from(picks)); next["nola-votes"] = JSON.stringify(votes); next["nola-visited"] = JSON.stringify(vis);
    var by = {}; lists.forEach(function(l){ by[l.kind] = l; });
    if (by.itinerary && by.itinerary.data && by.itinerary.data.days) next["nola-plan"] = JSON.stringify(by.itinerary.data);
    if (by.checklist) next["nola-checks"] = JSON.stringify(by.checklist.data || {});
    if (by.ink) next["nola-my-ink"] = JSON.stringify((by.ink.data || {}).items || []);
    var xp = j(LS.getItem("nola-ext-places"), {}), cx = by.custom && by.custom.title === "Places from the map" ? (by.custom.data || {}) : {};
    Object.keys(cx).forEach(function(id){ if (!xp[id]) xp[id] = cx[id]; }); next["nola-ext-places"] = JSON.stringify(xp);
    if (prof.trip && Object.keys(prof.trip).length) next["nola-trip"] = JSON.stringify(prof.trip);
    var srch = lists.filter(function(l){ return l.kind === "search"; }).map(function(l){ return l.data; });
    var localS = j(LS.getItem("nola-searches"), []); localS.forEach(function(s){ if (!srch.some(function(x){ return x.q === s.q; })) srch.push(s); });
    next["nola-searches"] = JSON.stringify(srch);
    var changed = false; pulling = true;
    Object.keys(next).forEach(function(k){ if (LS.getItem(k) !== next[k]) { rawSet(k, next[k]); changed = true; } });
    pulling = false;
    if (!LS.getItem(flag)) { rawSet(flag, "1"); ["nola-picks","nola-votes","nola-visited","nola-searches","nola-ext-places"].forEach(function(k){ push(k).catch(warn); }); }
    return changed;
  }

  /* ---------- saved searches (Explore search box) ---------- */
  function searches(){ return j(LS.getItem("nola-searches"), []); }
  window.NolaAccount.saveSearch = function(q){
    q = (q || "").trim(); if (!q) return;
    var s = searches().filter(function(x){ return x.q !== q; }); s.unshift({ q: q, at: new Date().toISOString() });
    LS.setItem("nola-searches", JSON.stringify(s.slice(0, 30))); toast("Saved search: " + q);
  };
  function toast(m){ var t = document.getElementById("nbar-toast"); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(function(){ t.hidden = true; }, 2500); }
  function decorateSearch(){
    var q = document.getElementById("q"); if (!q || q.parentNode.querySelector(".nsave")) return;
    var b = document.createElement("button"); b.type = "button"; b.className = "nsave"; b.textContent = "☆ Save search";
    b.addEventListener("click", function(){ window.NolaAccount.saveSearch(q.value); });
    q.insertAdjacentElement("afterend", b);
    if (searches().length) {
      var row = document.createElement("div"); row.className = "nsaved";
      searches().slice(0, 6).forEach(function(s){ var c = document.createElement("button"); c.type = "button"; c.textContent = s.q;
        c.addEventListener("click", function(){ q.value = s.q; q.dispatchEvent(new Event("input", { bubbles: true })); }); row.appendChild(c); });
      b.insertAdjacentElement("afterend", row);
    }
  }

  /* ---------- top bar + sign-up form ---------- */
  var css = ".nbar{position:sticky;top:0;z-index:50;margin:0 -16px;padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));box-sizing:border-box;flex-wrap:wrap;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 12px;background:#23172C;color:#FFF4EF;font:600 14px/1.2 system-ui,sans-serif}"+
    ".nbar button{font:inherit}.nbar-cta{background:#FF6B5B;color:#fff;border:0;border-radius:999px;padding:8px 16px;cursor:pointer}"+
    "body.has-nbar .top{top:calc(var(--nbar-h,44px) + env(safe-area-inset-top,0px))}"+
    ".nmodal{position:fixed;inset:0;z-index:2147483000;background:rgba(35,23,44,.55);display:flex;align-items:center;justify-content:center;padding:16px}"+
    ".nform{background:#FFF4EF;color:#23172C;border-radius:16px;padding:20px;width:100%;max-width:380px;font:15px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3)}"+
    ".nform h2{margin:0 0 6px;font-size:1.2rem}.nform label{display:block;margin:10px 0 4px;font-weight:600;font-size:.9rem}"+
    ".nform input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9b8bf;border-radius:10px;font:inherit}"+
    ".nform .row{display:flex;gap:8px;margin-top:14px}.nform .row button{flex:1;padding:10px;border-radius:10px;border:0;font:600 15px system-ui;cursor:pointer}"+
    ".nform .go{background:#FF6B5B;color:#fff}.nform .x{background:#e9dde0;color:#23172C}.nform .msg{margin-top:10px;font-size:.9rem;min-height:1.2em}"+
    ".nsave{margin:6px 6px 0 0;padding:6px 10px;border-radius:999px;border:1px solid #c9b8bf;background:transparent;font:600 13px system-ui;cursor:pointer}"+
    ".nsaved{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.nsaved button{padding:4px 10px;border-radius:999px;border:0;background:#e9dde0;font:13px system-ui;cursor:pointer}"+
    "#nbar-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483001;background:#23172C;color:#fff;padding:8px 14px;border-radius:999px;font:14px system-ui}"+
    ".nme{font:12px system-ui;opacity:.75;text-align:center;padding:6px}.nme a{color:inherit}";
  function el(h){ var d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  var bar, modal;
  function mountBar(){
    if (bar) return;
    bar = el('<div class="nbar" id="nbar" role="region" aria-label="Sign up"><span>Save your picks to your own account</span><button class="nbar-cta" type="button" id="nbar-btn">sign up bitches</button></div>');
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add("has-nbar");
    document.documentElement.style.setProperty("--nbar-h", bar.offsetHeight + "px");
    bar.querySelector("#nbar-btn").addEventListener("click", openForm);
  }
  function hideBar(){ if (bar) { bar.remove(); bar = null; } document.body.classList.remove("has-nbar"); }

  function openForm(){
    if (modal) return;
    modal = el('<div class="nmodal" id="nmodal" role="dialog" aria-modal="true" aria-labelledby="nform-h"><form class="nform" id="nform" novalidate>'+
      '<h2 id="nform-h">Join the trip</h2><div class="small">We\'ll email you a sign-in link and a 6-digit code. No password.</div>'+
      '<label for="nf-name">Name</label><input id="nf-name" name="name" autocomplete="name" required>'+
      '<label for="nf-email">Email</label><input id="nf-email" name="email" type="email" autocomplete="email" inputmode="email" required>'+
      '<div id="nf-codewrap" hidden><label for="nf-code">6-digit code from the email</label><input id="nf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></div>'+
      '<div class="row"><button type="button" class="x" id="nf-cancel">Cancel</button><button type="submit" class="go" id="nf-go">Send my link</button></div>'+
      '<div class="msg" id="nf-msg" aria-live="polite"></div></form></div>');
    document.body.appendChild(modal);
    var f = modal.querySelector("form"), msg = modal.querySelector("#nf-msg"), go = modal.querySelector("#nf-go"), stage = "send";
    modal.querySelector("#nf-cancel").addEventListener("click", closeForm);
    modal.addEventListener("click", function(e){ if (e.target === modal) closeForm(); });
    modal.querySelector("#nf-name").focus();
    f.addEventListener("submit", async function(e){
      e.preventDefault();
      var name = f.name.value.trim(), email = f.email.value.trim().toLowerCase();
      if (stage === "send") {
        if (!name) { msg.textContent = "Add your name."; return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "That email doesn't look right."; return; }
        go.disabled = true; msg.textContent = "Sending…";
        var redirect = location.origin + location.pathname;
        var r = await sb.auth.signInWithOtp({ email: email, options: { data: { name: name }, emailRedirectTo: redirect, shouldCreateUser: true } });
        go.disabled = false;
        if (r.error) { msg.textContent = "Couldn't send: " + r.error.message; return; }
        stage = "code"; go.textContent = "Verify code";
        modal.querySelector("#nf-codewrap").hidden = false; modal.querySelector("#nf-code").focus();
        msg.textContent = "Check " + email + ". Tap the link, or type the 6-digit code here.";
      } else {
        var code = f.querySelector("#nf-code").value.trim();
        if (!/^\d{6}$/.test(code)) { msg.textContent = "Enter the 6 digits from the email."; return; }
        go.disabled = true; msg.textContent = "Checking…";
        var v = await sb.auth.verifyOtp({ email: email, token: code, type: "email" });
        go.disabled = false;
        if (v.error) { msg.textContent = "That code didn't work: " + v.error.message; return; }
        msg.textContent = "You're in!";
      }
    });
  }
  function closeForm(){ if (modal) { modal.remove(); modal = null; } }

  function footer(){
    var old = document.getElementById("nme"); if (old) old.remove();
    if (!session) return;
    var u = session.user, nm = (u.user_metadata && u.user_metadata.name) || u.email;
    var f = el('<div class="nme" id="nme">Signed in as '+esc(nm)+' · <a href="#" id="nme-out">sign out</a>'+(u.email === CFG.admin ? ' · <a href="admin.html">admin</a>' : '')+'</div>');
    document.body.appendChild(f);
    f.querySelector("#nme-out").addEventListener("click", function(e){ e.preventDefault(); sb.auth.signOut(); });
  }

  async function onSession(s, evt){
    var had = uid(); session = s;
    if (s) { hideBar(); closeForm(); }
    else mountBar();
    footer();
    if (s && s.user.id !== had) {
      try { var changed = await pull(); if (changed && !sessionStorage.getItem("nola-pulled")) { sessionStorage.setItem("nola-pulled", "1"); location.reload(); } }
      catch(e){ warn(e); }
    }
    if (!s) sessionStorage.removeItem("nola-pulled");
  }

  function boot(){
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var t = document.createElement("div"); t.id = "nbar-toast"; t.hidden = true; t.setAttribute("role", "status"); document.body.appendChild(t);
    decorateSearch(); new MutationObserver(decorateSearch).observe(document.getElementById("main") || document.body, { childList: true, subtree: true });
    sb.auth.getSession().then(function(r){ onSession(r.data.session, "INITIAL"); });
    sb.auth.onAuthStateChange(function(evt, s){ if (evt === "INITIAL_SESSION") return; setTimeout(function(){ onSession(s, evt); }, 0); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
