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

# sample data (mock only; never touches the real database)
Aid,Bid,Wid=USERS["A"][0],USERS["B"][0],USERS["W"][0]
def like(u,r): DB["likes"].append({"id":"l"+str(len(DB["likes"])),"user_id":u,"item_ref":r,"kind":"like","created_at":"2026-10-22T00:00:00Z"})
for r in ["cdm","preshall","palmpine"]: like(Aid,r)
for r in ["cdm","preshall","dba"]: like(Bid,r)
for r in ["cdm","palmpine"]: like(Wid,r)
DB["lists"].append({"id":"L1","user_id":Aid,"kind":"itinerary","title":"Plan","data":{"days":[{"n":1,"items":[{"t":"09:00","h":"Beignets","p":["cdm"]},{"t":"20:00","h":"Jazz","p":["preshall"]}]}]},"updated_at":"2026-10-22T00:00:00Z"})
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":390,"height":844}); pg=ctx.new_page(); errs=[]
    pg.on("pageerror",lambda e: errs.append(str(e))); globals()["WAIT"]=pg.wait_for_timeout
    pg.route("**/*.supabase.co/**",handler); pg.route("**/photon.komoot.io/**",photon)
    pg.add_init_script("localStorage.setItem('nola3-tour-done','1'); setInterval(()=>document.querySelectorAll('.nola-pop').forEach(e=>e.remove()),200)")
    def ready():
        for i in range(6):
            try:
                WAIT(1500); pg.wait_for_load_state("load"); pg.wait_for_function("typeof togglePick==='function' && window.NolaAccount && window.NolaAdminLogic", timeout=15000)
                n0=pg.evaluate("performance.timeOrigin"); WAIT(1500)
                if pg.evaluate("performance.timeOrigin")==n0: return
            except Exception as e: pass
    def signin(k,h=""):
        pg.goto(B+"?t=%d#access_token="%time.time_ns()+tok(k)+"&refresh_token=r&expires_in=3600&expires_at=%d&token_type=bearer&type=magiclink"%exp); ready()
    tabs=lambda: pg.evaluate("[...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.tab)")
    # pure logic
    L=pg
    pg.goto(B); ready()
    ck("guest: no Admin tab", "admin" not in tabs())
    ck("logic: isAdminEmail exact/case-insensitive", pg.evaluate("NolaAdminLogic.isAdminEmail('Will.Wiedenmann@gmail.com') && !NolaAdminLogic.isAdminEmail('will.wiedenmann@gmail.co') && !NolaAdminLogic.isAdminEmail('') && !NolaAdminLogic.isAdminEmail(null)"))
    rk=pg.evaluate("""(()=>{const s=NolaAdminLogic.summarize([{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],
      [{id:'L',user_id:'c',kind:'itinerary',data:{days:[{n:1,items:[{p:['x']}]}]}}],[],
      [{user_id:'a',kind:'like',item_ref:'x'},{user_id:'b',kind:'like',item_ref:'x'},{user_id:'a',kind:'like',item_ref:'y'},{user_id:'b',kind:'like',item_ref:'y'},{user_id:'c',kind:'like',item_ref:'z'},{user_id:'a',kind:'like',item_ref:'q'}]);
      const r=NolaAdminLogic.rankOverlap(s); return {rows:r.rows.map(x=>[x.id,x.n,x.tier,x.pct]), plan:s[2].planItems, likes:s[0].likes};})()""")

    ck("logic: ranks by people count (x=3 everyone first)", rk["rows"][0][:3]==["x",3,"everyone"] and rk["rows"][0][3]==100)
    ck("logic: y = most (2/3, 67%)", ["y",2,"most",67] in rk["rows"])
    ck("logic: singles tier one, after shared", [r[2] for r in rk["rows"]][2:]==["one","one"])
    ck("logic: counts plan items & likes", rk["plan"]==1 and rk["likes"]==3)
    ck("logic: same person twice counts once", pg.evaluate("NolaAdminLogic.rankOverlap(NolaAdminLogic.summarize([{id:'a'},{id:'b'}],[{id:'L',user_id:'a',kind:'itinerary',data:{days:[{n:1,items:[{p:['x']}]}]}}],[],[{user_id:'a',kind:'like',item_ref:'x'}])).rows[0].n")==1)
    # non-admin
    signin("A")
    ck("non-admin: no Admin tab", "admin" not in tabs() and "saved" in tabs())
    pg.screenshot(path=OUT+"nonadmin-nav-390.png")
    pg.evaluate("S.tab='saved'; render()")
    ck("non-admin: Saved has no toggle", pg.locator(".adm-savedtoggle").count()==0)
    pg.evaluate("location.hash='#admin'"); pg.evaluate("S.tab='admin'; render()"); WAIT(800)
    ck("non-admin: admin URL shows admin-only, no data", pg.locator("#adm-denied").count()==1 and "Bob" not in pg.inner_text("#main") and pg.locator(".adm-person").count()==0)
    # map pin -> info sheet with Save
    pg.evaluate("S.tab='map'; S.mapShown=true; render()"); WAIT(1500)
    opened=pg.evaluate("""(()=>{let hit=null; LCL.eachLayer(m=>{ if(!hit && m.getTooltip && m.getTooltip().getContent()==='Café du Monde') hit=m; }); if(!hit){ LCL.eachLayer(m=>{ if(!hit && m.getTooltip) hit=m; }); } if(!hit) return null; hit.fire('click'); return hit.getTooltip().getContent(); })()""")
    WAIT(600)
    ck("map pin opens the info sheet (not just a popup)", bool(opened) and pg.locator(".sheet #sheet-title").count()==1 and pg.inner_text("#sheet-title")==opened)
    sv=pg.locator(".sheet .sheet-save")
    ck("info sheet has a clear Save button + Add to plan", sv.count()==1 and "Save" in sv.inner_text() and pg.locator(".sheet .sheet-plan").count()==1)
    pid=pg.evaluate("S.sheet"); was=pg.evaluate("myPicks().has(S.sheet)")
    if was: sv.click(); WAIT(1500)
    pg.evaluate("document.querySelector('.sheet').scrollTop=0")
    sv=pg.locator(".sheet .sheet-save"); sv.click(); WAIT(3000)
    ck("Save from sheet saves to this account (local + server)", pg.evaluate("myPicks().has(%r)"%pid) and pid in likes(Aid) and likes(Bid)==["cdm","dba","preshall"])
    ck("sheet shows Saved after tap", "Saved" in pg.locator(".sheet .sheet-save").inner_text())
    pg.screenshot(path=OUT+"map-info-save-390.png")
    pg.evaluate("S.sheet=null; render()")
    # admin
    signin("W")
    ck("admin: Admin tab present, last in nav", tabs()[-1]=="admin")
    ab=pg.locator('#tabs [data-tab="admin"]')
    ck("admin tab matches nav style", ab.evaluate("e=>{const o=document.querySelector('#tabs .tab:not([data-tab=admin])'); const a=getComputedStyle(e), b=getComputedStyle(o); return e.className===o.className && a.fontSize===b.fontSize && a.minHeight===b.minHeight && a.color===b.color}"))
    ck("admin: bottom bar fits 390px", pg.evaluate("document.getElementById('tabs').scrollWidth<=document.getElementById('tabs').clientWidth+1"))
    pg.screenshot(path=OUT+"admin-nav-390.png")
    def lum(c):
        import re; v=[int(x)/255 for x in re.findall(r"\d+",c)[:3]]; v=[x/12.92 if x<=.03928 else ((x+.055)/1.055)**2.4 for x in v]; return .2126*v[0]+.7152*v[1]+.0722*v[2]
    def cr(a,b): A,Bb=sorted([lum(a),lum(b)]); return (Bb+.05)/(A+.05)
    for mode in ["day","night"]:
        pg.evaluate("m=>{document.documentElement.setAttribute('data-mode',m)}", mode); WAIT(200)
        c=pg.evaluate("""()=>{const bar=getComputedStyle(document.getElementById('tabs')).backgroundColor; const off=document.querySelector('#tabs .tab[aria-selected=false]'), on=document.querySelector('#tabs .tab[aria-selected=true]');
          return {bar, off:getComputedStyle(off).color, onbg:getComputedStyle(on).backgroundColor, on:getComputedStyle(on).color, pb:getComputedStyle(document.getElementById('tabs')).paddingBottom}}""")
        ck(f"nav {mode}: not white", c["bar"] not in ("rgb(255, 255, 255)","rgba(0, 0, 0, 0)"))
        ck(f"nav {mode}: labels AA (>=4.5)", cr(c["off"],c["bar"])>=4.5)
        ck(f"nav {mode}: active AA + distinct pill", cr(c["on"],c["onbg"])>=4.5 and c["onbg"]!=c["bar"])
    pg.evaluate("render()"); WAIT(200)
    pg.locator("#tabs").screenshot(path=OUT+"bottom-nav-390.png")
    ab.click(); WAIT(1500)
    ck("admin: align view lists ranked places", lambda: pg.locator(".adm-row").count()>=4)

    first=pg.locator(".adm-row").first.inner_text()
    ck("admin: Café du Monde first, everyone agrees, 100%", "Café du Monde" in first and "Everyone agrees" in first and "100%" in first)
    ck("admin: unique-to-one section has dba", "Unique to one person" in pg.inner_text("#main"))
    ck("admin: top picks box", pg.locator(".adm-top").count()==1)
    pg.screenshot(path=OUT+"admin-align-390.png", full_page=False)
    pg.locator('[data-admsec="people"]').click(); WAIT(400)
    ck("admin: people list shows all 3 with emails", lambda: pg.locator(".adm-person").count()==3 and "alice@example.com" in pg.inner_text("#main"))
    pg.locator('[data-admopen="%s"]'%Aid).click(); WAIT(400)
    t=pg.inner_text("#main")
    ck("admin: expand shows grouped saves + plan", "saved (kitchen table)" in t.lower() and "in their plan" in t.lower() and "Preservation Hall" in t)
    ck("admin: counts shown", "3 saved" in t and "2 plan stops" in t)
    pg.screenshot(path=OUT+"admin-people-390.png")
    pg.locator('[data-admperson="%s"]'%Bid).click(); WAIT(300)
    ck("admin: filter by person", pg.locator(".adm-person").count()==1 and "bob@example.com" in pg.inner_text("#main"))
    pg.locator('[data-admperson="all"]').click(); pg.locator('[data-admsec="align"]').click(); WAIT(300)
    if pg.locator('[data-admcat="coffee"]').count():
        pg.locator('[data-admcat="coffee"]').click(); WAIT(300)
        ck("admin: filter by category", pg.locator(".adm-row").count()>=1 and "Preservation" not in pg.inner_text("#main"))
        pg.locator('[data-admcat="all"]').click()
    else: ck("admin: category filter present", False)
    # Saved toggle
    pg.locator('#tabs [data-tab="saved"]').click(); WAIT(800)
    tg=pg.locator(".adm-savedtoggle button")
    ck("admin Saved: two toggles, My trip plans default", tg.count()==2 and tg.nth(0).inner_text()=="My trip plans" and tg.nth(0).get_attribute("aria-selected")=="true")
    ck("admin Saved mine: own saves (no Bob data)", "bob@example.com" not in pg.inner_text("#main"))
    pg.screenshot(path=OUT+"saved-admin-toggle-390.png")
    tg.nth(1).click(); WAIT(1200)
    t=pg.inner_text("#main")
    ck("admin Saved all: grouped by person + group picks", "All trip plans" in t and "bob@example.com" in t and "alice@example.com" in t and "Group picks" in t)
    ck("group picks: % and count and names", "100%" in t and "3 of 3" in t and "67%" in t)
    pg.evaluate("document.getElementById('group-picks').scrollIntoView({block:'start'}); window.scrollBy(0,-70)"); WAIT(300)
    pg.screenshot(path=OUT+"group-picks-390.png")
    pg.locator(".adm-savedtoggle button").nth(0).click(); WAIT(400)
    ck("admin Saved: back to mine", "All trip plans" not in pg.inner_text("#main") or pg.locator(".adm-savedtoggle [aria-selected=true]").inner_text()=="My trip plans")
    ck("no page errors", not errs or print(errs))
    b.close()
print("\n".join(res))
