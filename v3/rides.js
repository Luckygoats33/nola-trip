/* Ride links that open the Uber / Lyft APPS on phones.
   - Uber: the m.uber.com/ul universal link opens the app when installed (web otherwise). Same-window on mobile,
     because target=_blank breaks universal links inside in-app browsers.
   - Lyft: lyft:// deep link first; if the page is still visible ~1.5s later, fall back to ride.lyft.com.
   - Desktop: unchanged web links. Works for every Uber/Lyft link in the app (guide, chat, search cards, map popups). */
(function(){
  "use strict";
  var UA = navigator.userAgent || "";
  function isMobile(){ return /iPhone|iPad|iPod|Android/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1); }
  function q(u){ var o = {}; try { new URL(u).searchParams.forEach(function(v, k){ o[k] = v; }); } catch(e){} return o; }
  var enc = encodeURIComponent;
  function lyftParams(p){
    var s = "id=" + enc(p.id || "lyft");
    ["pickup[latitude]","pickup[longitude]","destination[latitude]","destination[longitude]"].forEach(function(k){ if (p[k]) s += "&" + k + "=" + enc(p[k]); });
    return s;
  }
  // href -> {kind, app, web}
  function rideUrls(href){
    var u; try { u = new URL(href, location.href); } catch(e){ return null; }
    var h = u.hostname.replace(/^www\./, "");
    if (/(^|\.)uber\.com$/.test(h)) {
      var p = q(u.href), web = "https://m.uber.com/ul/?action=setPickup";
      if (p["pickup[latitude]"]) web += "&pickup[latitude]=" + enc(p["pickup[latitude]"]) + "&pickup[longitude]=" + enc(p["pickup[longitude]"]) + (p["pickup[nickname]"] ? "&pickup[nickname]=" + enc(p["pickup[nickname]"]) : "");
      else web += "&pickup=my_location";
      ["dropoff[latitude]","dropoff[longitude]","dropoff[nickname]","dropoff[formatted_address]"].forEach(function(k){ if (p[k]) web += "&" + k + "=" + enc(p[k]); });
      return { kind: "uber", app: web, web: web };
    }
    if (/(^|\.)lyft\.com$/.test(h) || u.protocol === "lyft:") {
      var s = lyftParams(q(u.href));
      return { kind: "lyft", app: "lyft://ridetype?" + s, web: "https://ride.lyft.com/ridetype?" + s };
    }
    return null;
  }
  window.nolaRideUrls = rideUrls;
  window.nolaIsMobile = isMobile;

  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest("a[href]"); if (!a) return;
    var r = rideUrls(a.getAttribute("href")); if (!r) return;
    if (!isMobile()) { if (a.href !== r.web) a.href = r.web; return; }          // desktop: normal web link
    e.preventDefault(); e.stopPropagation();
    if (r.kind === "uber") { location.href = r.app; return; }                // universal link, same window
    var t0 = Date.now();
    location.href = r.app;                                                   // try the Lyft app
    setTimeout(function(){ if (!document.hidden && Date.now() - t0 < 4000) location.href = r.web; }, 1500);
  }, true);
})();
