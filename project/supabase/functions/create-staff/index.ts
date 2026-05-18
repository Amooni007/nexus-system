import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ✅ Generate a secure random temporary password
function generateTempPassword(): string {
  const upper  = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower  = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "@#$!";
  const all = upper + lower + digits + special;

  // Guarantee at least one of each required character class
  let pwd =
    upper [Math.floor(Math.random() * upper.length)]  +
    lower [Math.floor(Math.random() * lower.length)]  +
    digits[Math.floor(Math.random() * digits.length)] +
    special[Math.floor(Math.random() * special.length)];

  // Fill remaining 8 chars
  for (let i = 0; i < 8; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // ✅ Read body ONCE at the top — req.json() can only be called once
    const body = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── Verify caller is super_admin ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: callerUser }, error: authError } = await supabaseUser.auth.getUser(token);

    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", callerUser.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "super_admin") {
      return new Response(JSON.stringify({ error: "Forbidden: Super admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse & validate body ─────────────────────────────────────────────
    const { full_name, email, role } = body;

    if (!full_name || !email || !role) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["event_manager", "scanner"].includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ✅ Auto-generate secure temporary password
    const tempPassword = generateTempPassword();

    // ── Create auth user ──────────────────────────────────────────────────
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Insert profile with must_change_password = true ───────────────────
    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: newUser.user!.id,
      full_name,
      email,
      role,
      is_active: true,
      must_change_password: true,   // ✅ Force password change on first login
      created_by: callerUser.id,
    });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(newUser.user!.id);
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Send welcome email via Supabase Auth email ────────────────────────
    // This uses Supabase's built-in email (configure SMTP in Dashboard → Auth → SMTP)
    const { error: emailError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        data: {
          temp_password: tempPassword,
          full_name,
        },
      },
    });

    // Even if email fails we still return success — admin can share password manually
    if (emailError) {
      console.warn("Email send failed:", emailError.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUser.user!.id,
        temp_password: tempPassword,   // ✅ Return to admin so they can share manually
        email_sent: !emailError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
})