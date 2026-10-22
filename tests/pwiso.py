import json,time,base64,re,urllib.parse
from playwright.sync_api import sync_playwright
B="http://127.0.0.1:8811/nola-trip/v3/"; OUT="/workspace/nola-trip-shots/"; res=[]
def ck(n,c):
    if callable(c):
        t=time.time(); ok=False
        while time.time()-t<15:
            try: ok=c()
            except Exception: ok=False
            if ok: break
            WAIT(500)
        c=ok
    res.append(("PASS " if c else "FAIL ")+n); return c
WAIT=lambda ms: time.sleep(ms/1000)
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
exp=int(time.time())+3600
USERS={"A":("aaaaaaaa-1111-1111-1111-00000000000a","alice@example.com","Alice"),"B":("bbbbbbbb-2222-2222-2222-00000000000b","bob@example.com","Bob"),
       "W":("cccccccc-3333-3333-3333-00000000000c","will.wiedenmann@gmail.com","Will")}
def user(k): i,e,n=USERS[k]; return {"id":i,"email":e,"aud":"authenticated","role":"authenticated","user_metadata":{"name":n},"app_metadata":{}}
def tok(k): i,e,n=USERS[k]; return b64({"alg":"HS256","typ":"JWT"})+"."+b64({"sub":i,"email":e,"exp":exp,"role":"authenticated","aud":"authenticated","session_id":k})+".sig"
DB={"profiles":[], "lists":[], "likes":[], "list_items":[]}
for k in USERS: i,e,n=USERS[k]; DB["profiles"].append({"id":i,"email":e,"name":n,"trip":{},"welcomed_at":"2026-10-22T00:00:00Z","created_at":"2026-10-22T00:00:00Z"})
def who(req):
    a=req.headers.get("authorization","")
    try: p=json.loads(base64.urlsafe_b64decode(a.split(" ")[1].split(".")[1]+"==")); return p.get("sub"),p.get("email")
    except Exception: return None,None
LOG=[]
def handler(route):
    req=route.request; LOG.append((time.strftime('%S'),req.method,req.url.split('/v1/')[1][:70])); u=urllib.parse.urlparse(req.url); path=u.path
    if path.endswith("/auth/v1/user"):
        sub,_=who(req); k=[k for k in USERS if USERS[k][0]==sub]
        return route.fulfill(status=200 if k else 401,body=json.dumps(user(k[0]) if k else {}),content_type="application/json")
    if "/auth/v1/logout" in path: return route.fulfill(status=204,body="")
    if "/auth/v1/" in path: return route.fulfill(status=200,body="{}",content_type="application/json")
    if "/rest/v1/" not in path: return route.fulfill(status=404,body="")
    t=path.split("/rest/v1/")[1]; sub,email=who(req); admin=email=="will.wiedenmann@gmail.com"
    q=urllib.parse.parse_qs(u.query); filt={k:v[0][3:] for k,v in q.items() if v[0].startswith("eq.")}
    own="id" if t=="profiles" else "user_id"
    vis=lambda r: r.get(own)==sub or (admin and req.method=="GET")
    rows=[r for r in DB[t] if vis(r) and all(str(r.get(k))==v for k,v in filt.items())]
    if req.method=="GET":
        if "vnd.pgrst.object" in req.headers.get("accept",""):
            return route.fulfill(status=200 if rows else 406,body=json.dumps(rows[0] if rows else {}),content_type="application/json")
        return route.fulfill(status=200,body=json.dumps(rows),content_type="application/json")
    if req.method=="POST":
        body=json.loads(req.post_data); body=body if isinstance(body,list) else [body]
        for r in body:
            if r.get(own,sub)!=sub: return route.fulfill(status=403,body=json.dumps({"message":"RLS"}),content_type="application/json")
            r.setdefault(own,sub); r.setdefault("id",str(len(DB[t])+1)+"-"+t); r.setdefault("created_at","2026-10-22T03:00:00Z"); DB[t].append(r)
        return route.fulfill(status=201,body="")
    if req.method=="PATCH":
        for r in rows: r.update(json.loads(req.post_data))
        return route.fulfill(status=204,body="")
    if req.method=="DELETE":
        DB[t]=[r for r in DB[t] if r not in rows]; return route.fulfill(status=204,body="")
def photon(route):
    if "/reverse" in route.request.url:
        return route.fulfill(status=200,content_type="application/json",body=json.dumps({"features":[{"geometry":{"coordinates":[-90.0651,29.9583]},"properties":{"name":"Test Corner Bar","osm_key":"amenity","osm_value":"bar","osm_type":"N","osm_id":123456,"housenumber":"500","street":"Bourbon Street","city":"New Orleans"}}]}))
    return route.fulfill(status=200,content_type="application/json",body='{"features":[]}')
def likes(uid): return sorted(r["item_ref"] for r in DB["likes"] if r["user_id"]==uid and r["kind"]=="like")
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":390,"height":844}); pg=ctx.new_page(); errs=[]
    pg.on("pageerror",lambda e: errs.append(str(e))); globals()["WAIT"]=pg.wait_for_timeout
    pg.route("**/*.supabase.co/**",handler); pg.route("**/photon.komoot.io/**",photon)
    pg.add_init_script("localStorage.setItem('nola3-tour-done','1'); setInterval(()=>document.querySelectorAll('.nola-pop').forEach(e=>e.remove()),200)")
    def ready():
        for i in range(6):
            try:
                WAIT(1500); pg.wait_for_load_state("load"); pg.wait_for_function("typeof togglePick==='function' && window.NolaAccount", timeout=15000)
                n0=pg.evaluate("performance.timeOrigin"); WAIT(1500)
                if pg.evaluate("performance.timeOrigin")==n0: return
            except Exception as e: pass
    def picks(): return sorted(pg.evaluate("myPicks ? [...myPicks()] : []"))
    def signin(k):
        pg.goto(B+"?t=%d#access_token="%time.time_ns()+tok(k)+"&refresh_token=r&expires_in=3600&expires_at=%d&token_type=bearer&type=magiclink"%exp); ready()
        for i in range(5):
            try: pg.wait_for_function("document.getElementById('nme') && Object.keys(sessionStorage).some(k=>k.startsWith('nola-pulled-'))", timeout=15000); break
            except Exception: WAIT(1000)
        ready()
    def signout():
        try: pg.evaluate("window.NolaAccount.signOut()")
        except Exception: pass
        ready()
    def save(i): pg.evaluate("id=>{ if(![...myPicks()].includes(id)) togglePick(id) }", i); WAIT(1800)
    A,Bu,W=USERS["A"][0],USERS["B"][0],USERS["W"][0]
    pg.goto(B); ready()
    save("cdm"); ck("guest saves G (cdm) locally", picks()==["cdm"])
    signin("A"); ck("A (empty account) claims guest G once", picks()==["cdm"] and likes(A)==["cdm"] and pg.evaluate("localStorage.getItem('nola-guest-claimed-by')")==A and pg.evaluate("localStorage.getItem('nola-guest-nola-picks')") is None)
    save("preshall"); ck("A saves X (preshall) -> server", lambda: likes(A)==["cdm","preshall"])
    signout(); ck("sign out -> local state empty", picks()==[] and pg.evaluate("localStorage.getItem('nola-picks')") is None and pg.locator("#nbar").count()==1)
    signin("B")
    ck("B (new) sees nothing of A's", picks()==[] and likes(Bu)==[])
    pg.locator("#tabs [data-tab=saved]").click(); WAIT(800); pg.screenshot(path=OUT+"new-user-empty-390.png")
    save("dba"); ck("B saves Y (dba)", lambda: likes(Bu)==["dba"])
    signout(); signin("A"); ck("A back: sees X + G only, no Y", picks()==["cdm","preshall"])
    ck("server: A=[cdm,preshall], B=[dba], no cross-copy", lambda: likes(A)==["cdm","preshall"] and likes(Bu)==["dba"])
    signout(); save("jewel"); signin("B"); ck("guest data NOT claimed by non-empty account B", picks()==["dba"] and likes(Bu)==["dba"])
    signout(); ck("unclaimed guest data comes back as guest", picks()==["jewel"])
    # switch user directly A -> B without sign-out
    signin("A"); signin("B"); ck("direct switch A->B shows only B", picks()==["dba"])
    # map save
    pg.locator("#tabs [data-tab=map]").click(); WAIT(500); pg.evaluate("S.mapShown=true; render()"); pg.wait_for_function("typeof LMAP!=='undefined' && LMAP", timeout=15000); WAIT(1500)
    opened=pg.evaluate("(()=>{ let hit=null; const mine=new Set([...myPicks()].map(id=>BY[id]&&BY[id].n)); LCL.eachLayer(m=>{ if(!hit && m.getTooltip && !mine.has(m.getTooltip().getContent())) hit=m; }); hit.fire('click'); return hit.getTooltip().getContent(); })()"); WAIT(1000)
    ck("pin tap opens the place info sheet with Save + Add to plan (>=44px)", pg.locator(".sheet #sheet-title").count()==1 and pg.inner_text("#sheet-title")==opened and pg.locator(".sheet .sheet-save").count()==1 and pg.locator(".sheet .sheet-plan").count()==1 and pg.evaluate("document.querySelector('.sheet .sheet-save').getBoundingClientRect().height>=44"))
    pg.screenshot(path=OUT+"map-popup-save-390.png")
    pid=pg.evaluate("S.sheet"); pg.click(".sheet .sheet-save"); WAIT(1800)
    ck(f"pin Save adds {opened} to B's likes (synced)", lambda: pid in picks() and pid in likes(Bu))
    pg.evaluate("S.sheet=null; render()"); WAIT(800)
    pg.evaluate("LMAP.fire('click',{latlng:L.latLng(29.9583,-90.0651), originalEvent:{target:document.body}})"); pg.wait_for_selector("[data-xtap][data-which=r]", timeout=10000); WAIT(300)
    pg.screenshot(path=OUT+"map-tap-nearest-390.png")
    ck("map tap offers nearest place + 'Save this spot'", "Test Corner Bar" in pg.inner_text(".mpop") and pg.locator("[data-which=s]").count()==1)
    pg.click("[data-xtap][data-which=r][data-act=heart]"); WAIT(2000)
    ck("tap-saved place in likes + map places list on server", lambda: "osm-n123456" in picks() and "osm-n123456" in likes(Bu) and any(l["kind"]=="custom" and "osm-n123456" in json.dumps(l["data"]) for l in DB["lists"] if l["user_id"]==Bu))
    pg.evaluate("LMAP.fire('click',{latlng:L.latLng(29.9601,-90.0602), originalEvent:{target:document.body}})"); pg.wait_for_selector("[data-which=s]", timeout=10000); pg.click("[data-which=s]"); WAIT(2000)
    ck("'Save this spot' saves a pin", any(x.startswith("osm-s") for x in picks()))
    # admin
    ap=ctx.new_page(); ap.route("**/*.supabase.co/**",handler)
    ap.goto(B+"admin.html#access_token="+tok("W")+"&refresh_token=r&expires_in=3600&expires_at=%d&token_type=bearer&type=magiclink"%exp); ap.wait_for_selector(".card h2",timeout=15000); WAIT(1000)
    ck("admin sees both A and B with their own likes", lambda: "Alice" in ap.inner_text("#app") and "Bob" in ap.inner_text("#app") and "preshall" in ap.inner_text("#app") and "dba" in ap.inner_text("#app"))
    ck("no page errors", not errs or print(errs))
    b.close()
print("\n".join(res))
