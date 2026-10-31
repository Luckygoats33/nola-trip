/* Public Supabase config. The publishable/anon key is safe in the browser: every table is locked by row-level security.
   NEVER put a service_role / secret key here. */
window.NOLA_SUPABASE = {
  url: "https://vfawvxxlnnmztkwrgvrr.supabase.co",
  key: "sb_publishable_h_Zq_MFI5FPU5u_sUgBBmg_TMpkC2nw",
  admin: "will.wiedenmann@gmail.com",
  admins: ["will.wiedenmann@gmail.com", "purplepanic12@gmail.com"]
};
window.nolaIsAdminEmail = function(email){
  var cfg = window.NOLA_SUPABASE || {}, list = Array.isArray(cfg.admins) ? cfg.admins.slice() : [];
  if (cfg.admin) list.push(cfg.admin);
  var e = String(email || "").trim().toLowerCase(), seen = {};
  return !!e && list.some(function(a){
    var x = String(a || "").trim().toLowerCase();
    if (!x || seen[x]) return false;
    seen[x] = 1;
    return x === e;
  });
};
