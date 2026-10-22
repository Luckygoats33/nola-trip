/* NOLA accounts: sign-up bar, magic link / email code, and cloud sync of this device's saves.
   Design: the app keeps using localStorage exactly as before (works offline and signed out).
   This file mirrors the synced keys to Supabase when signed in, and pulls them back on sign-in. */
(function(){
  "use strict";
  var CFG = window.NOLA_SUPABASE || {};
  // The claude.ai artifact build has its own shared/read-only group plan; leave that mode alone.
  var ARTIFACT = !!(window.claude && window.claude.use);
  if (ARTIFACT || !window.supabase || !CFG.url || !CFG.key) return;

  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "implicit" } });
  window.NolaAccount = { client: sb };

  var LS = window.localStorage;
  var rawSet = LS.setItem.bind(LS);
  var SYNC = {}; (window.nolaUserKeys || ["nola-picks","nola-votes","nola-visited","nola-plan","nola-checks","nola-my-ink","nola-trip","nola-searches","nola-ext-places"]).forEach(function(k){ SYNC[k] = 1; });
  var session = null, pulling = false, timers = {};

  function j(s, d){ try { var v = JSON.parse(s); return v == null ? d : v; } catch(e){ return d; } }
  function uid(){ return session && session.user && session.user.id; }

  /* ---------- push: mirror local writes to the account ---------- */
  LS.setItem = function(k, v){
    rawSet(k, v);
    if (SYNC[k] && uid() && !pulling && LS.getItem("nola-owner") === uid()) { rawSet("nola-dirty-" + uid(), "1"); clearTimeout(timers[k]); timers[k] = setTimeout(function(){ push(k).then(clean, warn); }, 800); }
  };
  function clean(){ if (!Object.keys(timers).some(function(k){ return timers[k]; })) LS.removeItem("nola-dirty-" + uid()); }
  async function flush(){ var ks = Object.keys(timers); ks.forEach(function(k){ clearTimeout(timers[k]); timers[k] = null; });
    for (var i = 0; i < ks.length; i++) await push(ks[i]).catch(warn); if (uid()) LS.removeItem("nola-dirty-" + uid()); }
  window.NolaAccount.signOut = async function(){ try { await flush(); } catch(e){ warn(e); } await sb.auth.signOut(); };
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
  async function push(k, val){
    var v = val !== undefined ? val : LS.getItem(k), me = uid(); if (!me) return; timers[k] = null;
    if (val === undefined && LS.getItem("nola-owner") !== me) return;   // never push another owner's data
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

  /* ---------- pull: the account's data REPLACES the local cache (never merged with another owner) ---------- */
  async function fetchCloud(me){
    var res = await Promise.all([
      sb.from("profiles").select("trip,name").eq("id", me).maybeSingle(),
      sb.from("lists").select("kind,title,data").eq("user_id", me),
      sb.from("likes").select("item_ref,kind,value").eq("user_id", me)
    ]);
    if (res[1].error || res[2].error) throw (res[1].error || res[2].error);
    return { prof: res[0].data || {}, lists: res[1].data || [], likes: res[2].data || [] };
  }
  function cloudToLocal(c){
    var next = {}, picks = [], votes = {}, vis = {}, by = {};
    c.likes.forEach(function(l){ if (l.kind === "like") picks.push(l.item_ref); if (l.kind === "vote") votes[l.item_ref] = l.value; if (l.kind === "visited") vis[l.item_ref] = l.value == null ? true : l.value; });
    if (picks.length) next["nola-picks"] = JSON.stringify(picks);
    if (Object.keys(votes).length) next["nola-votes"] = JSON.stringify(votes);
    if (Object.keys(vis).length) next["nola-visited"] = JSON.stringify(vis);
    c.lists.forEach(function(l){ by[l.kind] = l; });
    if (by.itinerary && by.itinerary.data && by.itinerary.data.days) next["nola-plan"] = JSON.stringify(by.itinerary.data);
    if (by.checklist) next["nola-checks"] = JSON.stringify(by.checklist.data || {});
    if (by.ink) next["nola-my-ink"] = JSON.stringify((by.ink.data || {}).items || []);
    if (by.custom && by.custom.title === "Places from the map") next["nola-ext-places"] = JSON.stringify(by.custom.data || {});
    if (c.prof.trip && Object.keys(c.prof.trip).length) next["nola-trip"] = JSON.stringify(c.prof.trip);
    var srch = c.lists.filter(function(l){ return l.kind === "search"; }).map(function(l){ return l.data; });
    if (srch.length) next["nola-searches"] = JSON.stringify(srch);
    return next;
  }
  // returns true when the visible cache changed (caller reloads so the app re-reads it)
  async function pull(){
    var me = uid(); if (!me) return false;
    var switched = window.nolaSwapOwner ? window.nolaSwapOwner(me) : false;
    if (LS.getItem("nola-dirty-" + me) && !switched) { await flush(); }   // unsynced offline edits by this same user go up first
    var c = await fetchCloud(me), next = cloudToLocal(c);
    var cloudEmpty = !Object.keys(next).length, guest = window.nolaGuestData ? window.nolaGuestData() : {};
    if (cloudEmpty && Object.keys(guest).length) {
      // one-time claim: data made while signed out goes to the FIRST account that signs in with an empty account, then the guest copy is deleted
      for (var k in guest) await push(k, guest[k]);
      next = guest; window.nolaClearGuest(); rawSet("nola-guest-claimed-by", me);
    }
    var changed = false; pulling = true;
    Object.keys(SYNC).forEach(function(k){ var v = next[k]; if (v == null) { if (LS.getItem(k) != null) { LS.removeItem(k); changed = true; } } else if (LS.getItem(k) !== v) { rawSet(k, v); changed = true; } });
    pulling = false; sessionStorage.removeItem("nola-needs-pull");
    return changed || switched;
  }

  /* ---------- saved searches (Explore search box) ---------- */
  function searches(){ return j(LS.getItem("nola-searches"), []); }
  window.NolaAccount.saveSearch = function(q){
    q = (q || "").trim(); if (!q) return;
    var s = searches().filter(function(x){ return x.q !== q; }); s.unshift({ q: q, at: new Date().toISOString() });
    LS.setItem("nola-searches", JSON.stringify(s.slice(0, 30))); toast("Saved search: " + q);
  };
  function toast(m){ var t = document.getElementById("nbar-toast"); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(function(){ t.hidden = true; }, /^Signed in as/.test(m) ? 4000 : 2500); }
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
    ".nbar button{font:inherit}.nbar-cta{background:#FF6B5B;color:#fff;border:0;border-radius:999px;padding:8px 16px;min-height:44px;cursor:pointer;white-space:nowrap}"+
    "body.has-nbar .top{top:calc(var(--nbar-h,44px) + env(safe-area-inset-top,0px))}"+
    ".nmodal{position:fixed;inset:0;z-index:2147483000;background:rgba(35,23,44,.55);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}"+
    "#nmodal{align-items:flex-start;padding-top:max(16px,calc(env(safe-area-inset-top) + 12px))}#nmodal .nform{max-height:calc(100dvh - 32px);overflow:auto}@media(min-height:700px) and (min-width:700px){#nmodal{align-items:center}}"+
    ".nf-tabs{position:sticky;top:-20px;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin:-6px -6px 12px;background:#e9dde0;border-radius:12px}"+
    ".nf-tabs button{min-height:44px;border:0;border-radius:9px;background:transparent;color:#23172C;font:600 15px system-ui,sans-serif;cursor:pointer}.nf-tabs button[aria-selected=true]{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15);color:#c2412f}"+
    ".nf-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}"+
    ".nform{background:#FFF4EF;color:#23172C;border-radius:16px;padding:20px;width:100%;max-width:380px;font:15px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3)}"+
    ".nform h2{margin:0 0 6px;font-size:1.2rem}.nform label{display:block;margin:10px 0 4px;font-weight:600;font-size:.9rem}"+
    ".nform input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9b8bf;border-radius:10px;font:inherit}"+
    ".nform .row{display:flex;gap:8px;margin-top:14px}.nform .row button{flex:1;padding:10px;border-radius:10px;border:0;font:600 15px system-ui;cursor:pointer}"+
    ".nform .go{background:#FF6B5B;color:#fff}.nform .x{background:#e9dde0;color:#23172C}.nform .msg{margin-top:10px;font-size:.9rem;min-height:1.2em}"+
    ".nsave{margin:6px 6px 0 0;padding:6px 10px;border-radius:999px;border:1px solid #c9b8bf;background:transparent;font:600 13px system-ui;cursor:pointer}"+
    ".nsaved{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.nsaved button{padding:4px 10px;border-radius:999px;border:0;background:#e9dde0;font:13px system-ui;cursor:pointer}"+
    "#nbar-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483001;background:#23172C;color:#fff;padding:8px 14px;border-radius:999px;font:14px system-ui}"+
    ".nwel{max-width:440px;max-height:88vh;overflow:auto}.nwel h2{font-size:1.45rem;margin:2px 0 10px}.nwel h3{font-size:.95rem;margin:12px 0 4px}.nwel ul{margin:0;padding-left:1.1em}.nwel li{margin:3px 0}"+
    ".nw-kick{font-family:var(--mono,monospace);font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#FF6B5B}.nw-out{margin:12px 0 0;font-size:.9rem}"+
    ".nhelp{margin:0 0 16px;padding:12px 14px;border:1px solid var(--line,#c9b8bf);border-radius:14px}.nhelp p{margin:6px 0 10px}.nhelp a{margin-left:10px;color:inherit}"+
    ".nbar-in{background:none;border:0;color:#FFF4EF;text-decoration:underline;padding:8px 4px;min-height:44px;cursor:pointer;font-weight:600;white-space:nowrap}@media(max-width:420px){.nbar>span{flex-basis:100%}.nbar{gap:2px 8px;padding-top:6px;padding-bottom:4px}}.nf-switch{margin:10px 0 0;font-size:.9rem;text-align:center}.nf-switch a,.nform .msg a{color:#c2412f;font-weight:600}"+
    ".nme{font:12px system-ui;opacity:.75;text-align:center;padding:6px}.nme a{color:inherit}";
  function el(h){ var d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  var bar, modal;
  function mountBar(){
    if (bar) return;
    bar = el('<div class="nbar" id="nbar" role="region" aria-label="Sign up"><span>Save your picks to your own account</span><button class="nbar-cta" type="button" id="nbar-btn">sign up bitches</button><button class="nbar-in" type="button" id="nbar-signin">Already a user? Sign in</button></div>');
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add("has-nbar");
    document.documentElement.style.setProperty("--nbar-h", bar.offsetHeight + "px");
    bar.querySelector("#nbar-btn").addEventListener("click", function(){ openForm("join"); });
    bar.querySelector("#nbar-signin").addEventListener("click", function(){ openForm("signin"); });
  }
  function hideBar(){ if (bar) { bar.remove(); bar = null; } document.body.classList.remove("has-nbar"); }

  function openForm(mode){
    if (modal) return;
    mode = mode === "signin" ? "signin" : "join";
    modal = el('<div class="nmodal" id="nmodal" role="dialog" aria-modal="true" aria-labelledby="nform-h"><form class="nform" id="nform" novalidate>'+
      '<div class="nf-tabs" role="tablist" aria-label="Sign in or join"><button type="button" role="tab" id="nf-tab-signin" data-m="signin">Sign in</button><button type="button" role="tab" id="nf-tab-join" data-m="join">Join the trip</button></div>'+
      '<h2 id="nform-h" class="nf-vh"></h2><div class="small">We\'ll email you a sign-in link. No password.</div>'+
      '<div id="nf-namewrap"><label for="nf-name">Name</label><input id="nf-name" name="name" autocomplete="name"></div>'+
      '<label for="nf-email">Email</label><input id="nf-email" name="email" type="email" autocomplete="email" inputmode="email" required>'+
      '<div id="nf-codewrap" hidden><label for="nf-code">Or type the code from your email (optional)</label><input id="nf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]{6,10}"></div>'+
      '<div class="row"><button type="button" class="x" id="nf-cancel">Cancel</button><button type="submit" class="go" id="nf-go">Send my link</button></div>'+
      '<div class="msg" id="nf-msg" aria-live="polite"></div></form></div>');
    document.body.appendChild(modal);
    var f = modal.querySelector("form"), msg = modal.querySelector("#nf-msg"), go = modal.querySelector("#nf-go"), stage = "send";
    function setMode(m){
      mode = m; stage = "send"; go.textContent = "Send my link"; msg.textContent = "";
      modal.querySelector("#nf-codewrap").hidden = true;
      modal.querySelector("#nform-h").textContent = m === "join" ? "Join the trip" : "Sign in";
      modal.querySelector("#nf-namewrap").hidden = m !== "join";
      ["signin", "join"].forEach(function(k){ var t = modal.querySelector("#nf-tab-" + k); t.setAttribute("aria-selected", String(k === m)); t.tabIndex = k === m ? 0 : -1; });
      f.dataset.mode = m;
      (m === "join" ? modal.querySelector("#nf-name") : modal.querySelector("#nf-email")).focus();
    }
    modal.querySelectorAll(".nf-tabs button").forEach(function(t){ t.addEventListener("click", function(){ if (t.dataset.m !== mode) setMode(t.dataset.m); }); });
    msg.addEventListener("click", function(e){ if (e.target.id === "nf-tojoin") { e.preventDefault(); setMode("join"); } });
    modal.querySelector("#nf-cancel").addEventListener("click", closeForm);
    modal.addEventListener("click", function(e){ if (e.target === modal) closeForm(); });
    setMode(mode);
    f.addEventListener("submit", async function(e){
      e.preventDefault();
      var name = f.name.value.trim(), email = f.email.value.trim().toLowerCase();
      if (stage === "send") {
        if (mode === "join" && !name) { msg.textContent = "Add your name."; return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "That email doesn't look right."; return; }
        go.disabled = true; msg.textContent = "Sending…";
        var redirect = location.origin + location.pathname;
        // join: creates the account, or just signs in an existing one (Supabase ignores data for existing users, so a saved name is never overwritten)
        var opts = mode === "join" ? { data: { name: name }, emailRedirectTo: redirect, shouldCreateUser: true } : { emailRedirectTo: redirect, shouldCreateUser: false };
        var r = await sb.auth.signInWithOtp({ email: email, options: opts });
        go.disabled = false;
        if (r.error) {
          if (mode === "signin" && /signup|not allowed|not found|otp_disabled|user_not_found/i.test((r.error.code || "") + " " + r.error.message)) {
            msg.innerHTML = 'No account with that email yet. <a href="#" id="nf-tojoin">Join the trip instead.</a>'; return; }
          msg.textContent = "Couldn't send: " + r.error.message; return;
        }
        stage = "code"; go.textContent = "Verify code";
        modal.querySelector("#nf-codewrap").hidden = false; modal.querySelector("#nf-code").focus();
        msg.textContent = "Check " + email + " and tap the link in it. Or type the code from your email here.";
      } else {
        var code = f.querySelector("#nf-code").value.replace(/\s+/g, "");
        if (!/^\d{6,10}$/.test(code)) { msg.textContent = "Enter the code from your email (numbers only)."; return; }
        go.disabled = true; msg.textContent = "Checking…";
        var v = await verifyCode(email, code);
        go.disabled = false;
        if (v.error) { msg.textContent = "That code didn't work: " + v.error.message; return; }
        msg.textContent = "You're in!";
      }
    });
  }
  // Supabase codes are 6-10 digits; try the current type first, then the legacy ones
  async function verifyCode(email, code){
    var types = ["email", "signup", "magiclink"], v;
    for (var i = 0; i < types.length; i++) { v = await sb.auth.verifyOtp({ email: email, token: code, type: types[i] }); if (!v.error) return v; }
    return v;
  }
  window.NolaAccount.verifyCode = verifyCode;
  function closeForm(){ if (modal) { modal.remove(); modal = null; } }

  function helpSignOut(){
    var main = document.getElementById("main"); if (!main || typeof S === "undefined" || S.tab !== "help") return;
    var old = main.querySelector(".nhelp"); if (!session) { if (old) old.remove(); return; } if (old) return;
    var u = session.user, b = el('<div class="nhelp"><div class="nw-kick">Your account</div><p>Signed in as <b>'+esc(nameOf(u))+'</b> ('+esc(u.email)+'). Your likes, plan, lists and saved searches sync to this account.</p><button type="button" class="nbar-cta" id="nhelp-out">Sign out</button>'+(u.email === CFG.admin ? ' <a href="#admin" data-tab="admin">Admin</a>' : '')+'</div>');
    var sec = main.querySelector(".view") || main; sec.insertBefore(b, sec.firstChild);
    b.querySelector("#nhelp-out").addEventListener("click", function(){ window.NolaAccount.signOut(); });
  }
  function footer(){
    var old = document.getElementById("nme"); if (old) old.remove();
    if (!session) return;
    var u = session.user, nm = (u.user_metadata && u.user_metadata.name) || u.email;
    var f = el('<div class="nme" id="nme">Signed in as '+esc(nm)+' · <a href="#" id="nme-out">sign out</a>'+(u.email === CFG.admin ? ' · <a href="#admin" data-tab="admin">admin</a>' : '')+'</div>');
    document.body.appendChild(f);
    f.querySelector("#nme-out").addEventListener("click", function(e){ e.preventDefault(); window.NolaAccount.signOut(); });
  }

  async function onSession(s, evt){
    var had = uid(); session = s;
    window.NolaAccount.email = s && s.user && s.user.email ? String(s.user.email).toLowerCase() : null; window.NolaAccount.isAdmin = !!window.NolaAccount.email && window.NolaAccount.email === String(CFG.admin || "").toLowerCase();
    if (typeof window.nolaAuthChanged === "function") { try { window.nolaAuthChanged(); } catch(e){ warn(e); } }
    if (s) { hideBar(); closeForm(); }
    else mountBar();
    helpSignOut();
    footer();
    if (s && s.user.id !== had) {
      var pk = "nola-pulled-" + s.user.id, owned = LS.getItem("nola-owner") === s.user.id;
      try { if (!owned || !sessionStorage.getItem(pk)) { var changed = await pull(); sessionStorage.setItem(pk, "1");
        if (changed && !sessionStorage.getItem("nola-reloaded-" + s.user.id)) { sessionStorage.setItem("nola-reloaded-" + s.user.id, "1"); sessionStorage.removeItem("nola-greeted"); location.reload(); return "reload"; } } }
      catch(e){ warn(e); }
    }
    if (!s) {
      sessionStorage.removeItem("nola-greeted"); if (had) { sessionStorage.removeItem("nola-pulled-" + had); sessionStorage.removeItem("nola-reloaded-" + had); }
      // signed out: drop this account's data from the device and show the guest state
      if (window.nolaSwapOwner && window.nolaSwapOwner("guest")) { location.reload(); return "reload"; }
    }
  }

  /* handle the email link: implicit (#access_token), PKCE (?code) or token_hash, captured by the inline script in <head> */
  async function consumeReturn(){
    var raw = sessionStorage.getItem("nola-auth-return"); if (!raw) return null;
    sessionStorage.removeItem("nola-auth-return");
    var o = j(raw, {}), r = null;
    try {
      if (o.error || o.error_code) { toast(/expired|invalid/i.test(o.error_description || o.error_code || "") ? "That email link has expired or was already used. Send yourself a new one." : "Sign-in failed: " + (o.error_description || o.error)); return null; }
      if (o.access_token && o.refresh_token) r = await sb.auth.setSession({ access_token: o.access_token, refresh_token: o.refresh_token });
      else if (o.code) r = await sb.auth.exchangeCodeForSession(o.code);
      else if (o.token_hash) r = await sb.auth.verifyOtp({ token_hash: o.token_hash, type: o.type || "email" });
      if (r && r.error) { toast("Sign-in link didn't work: " + r.error.message); return null; }
      return r && r.data && r.data.session;
    } catch(e){ warn(e); toast("Sign-in link didn't work. Try sending a new one."); return null; }
  }
  function nameOf(u){ return (u.user_metadata && u.user_metadata.name) || u.email; }
  function signedToast(s){ toast("Signed in as " + nameOf(s.user)); }
  async function greet(s){
    var u = s.user, key = "nola-welcomed-" + u.id;
    if (LS.getItem(key)) return signedToast(s);
    var r = await sb.from("profiles").select("welcomed_at").eq("id", u.id).maybeSingle();
    if (r.data && r.data.welcomed_at) { rawSet(key, "1"); return signedToast(s); }
    showWelcome(s);
  }
  function showWelcome(s){
    if (document.getElementById("nwelcome")) return;
    var u = s.user, w = el('<div class="nmodal" id="nwelcome" role="dialog" aria-modal="true" aria-labelledby="nw-h"><div class="nform nwel">'+
      '<div class="nw-kick">Welcome to the trip</div><h2 id="nw-h">You\'re in, '+esc(nameOf(u))+'!</h2>'+
      '<h3>What you can do now</h3><ul><li>♥ Like ideas you want to try</li><li>🗓 Build your own day-by-day itinerary</li><li>📋 Make lists</li><li>🔎 Save searches</li><li>✓ Mark places visited</li><li>📍 Search finds real bars and restaurants too, not just the ones in our guide</li></ul>'+
      '<h3>How your info is saved</h3><ul><li>It saves to your account automatically and syncs across your devices when you\'re signed in.</li><li>It still works offline and syncs when you\'re back online.</li><li>Only you can see your lists. Will, the trip organizer, can view them too.</li></ul>'+
      '<p class="nw-out">Sign out lives under <b>Help</b>.</p>'+
      '<div class="row"><button type="button" class="go" id="nw-go">Let\'s go</button></div></div></div>');
    document.body.appendChild(w); var go = w.querySelector("#nw-go"); go.focus();
    go.addEventListener("click", function(){
      rawSet("nola-welcomed-" + u.id, "1"); w.remove();
      sb.from("profiles").update({ welcomed_at: new Date().toISOString() }).eq("id", u.id).then(function(){}, warn);
    });
  }

  function boot(){
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var t = document.createElement("div"); t.id = "nbar-toast"; t.hidden = true; t.setAttribute("role", "status"); document.body.appendChild(t);
    decorateSearch(); new MutationObserver(function(){ decorateSearch(); helpSignOut(); }).observe(document.getElementById("main") || document.body, { childList: true, subtree: true });
    consumeReturn().then(function(fresh){
      return sb.auth.getSession().then(function(r){ var s = r.data.session || fresh; return onSession(s, "INITIAL").then(function(rv){ if (rv === "reload") return;
        if (s && (fresh || !sessionStorage.getItem("nola-greeted"))) { sessionStorage.setItem("nola-greeted", "1"); greet(s).catch(warn); } }); });
    });
    sb.auth.onAuthStateChange(function(evt, s){ if (evt === "INITIAL_SESSION") return; var was = uid(); setTimeout(function(){ onSession(s, evt).then(function(rv){ if (rv === "reload") return; if (evt === "SIGNED_IN" && s && s.user.id !== was && !sessionStorage.getItem("nola-greeted")) { sessionStorage.setItem("nola-greeted", "1"); greet(s).catch(warn); } }); }, 0); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
