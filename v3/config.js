/* Public Supabase config. The publishable/anon key is safe in the browser: every table is locked by row-level security.
   NEVER put a service_role / secret key here. */
window.NOLA_SUPABASE = {
  url: "https://vfawvxxlnnmztkwrgvrr.supabase.co",
  key: "sb_publishable_h_Zq_MFI5FPU5u_sUgBBmg_TMpkC2nw",
  /* First entry stays the original organizer. `admins` is the allowlist the app checks.
     Keep in sync with public.is_admin() in supabase/schema.sql. This list does not create
     a Supabase user or send mail. */
  admin: "will.wiedenmann@gmail.com",
  admins: ["will.wiedenmann@gmail.com", "purplepanic12@gmail.com"]
};
window.NolaIsAdminEmail = function(email){
  var cfg = window.NOLA_SUPABASE || {};
  var raw = cfg.admins || cfg.admin || [];
  if (typeof raw === "string") raw = [raw];
  var e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  for (var i = 0; i < raw.length; i++){
    if (String(raw[i] || "").trim().toLowerCase() === e) return true;
  }
  return false;
};
