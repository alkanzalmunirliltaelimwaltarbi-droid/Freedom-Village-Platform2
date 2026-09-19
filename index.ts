import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

async function pbkdf2(password: string, saltHex: string, iterations: number) {
  const salt = Uint8Array.from((saltHex.match(/.{1,2}/g) || []).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new Error('جلسة الدخول غير موجودة');

    const url = Deno.env.get('SUPABASE_URL')!;
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const publishableKey = publishableKeys.default;
    const secretKey = secretKeys.default;
    if (!publishableKey || !secretKey) throw new Error('إعدادات Supabase السرية غير مكتملة');

    const publicClient = createClient(url, publishableKey);
    const { data: userData, error: userError } = await publicClient.auth.getUser(token);
    if (userError || !userData.user || !userData.user.is_anonymous) throw new Error('جلسة غير صالحة');

    const adminClient = createClient(url, secretKey);
    const body = await req.json().catch(() => ({}));
    if (body.logout === true) {
      const { error: logoutError } = await adminClient.auth.admin.updateUserById(userData.user.id, {
        app_metadata: { access_granted: false, is_admin: false },
      });
      if (logoutError) throw logoutError;
      return new Response(JSON.stringify({ ok: true, loggedOut: true }), { headers: corsHeaders });
    }
    const password = String(body.password || '');
    if (!password) throw new Error('أدخل كلمة المرور');
    const { data: cfg, error: cfgError } = await adminClient
      .from('access_config')
      .select('access_password_hash,access_password_salt,admin_password_hash,admin_password_salt,pbkdf2_iterations')
      .eq('id', 1)
      .single();
    if (cfgError || !cfg) throw new Error('إعدادات الدخول غير موجودة');

    const iterations = Number(cfg.pbkdf2_iterations || 310000);
    const userHash = await pbkdf2(password, cfg.access_password_salt, iterations);
    const adminHash = await pbkdf2(password, cfg.admin_password_salt, iterations);
    const isAdmin = adminHash === cfg.admin_password_hash;
    const isUser = userHash === cfg.access_password_hash;
    if (!isAdmin && !isUser) throw new Error('كلمة المرور غير صحيحة');

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userData.user.id, {
      app_metadata: { access_granted: true, is_admin: isAdmin },
    });
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ ok: true, isAdmin }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'تعذر التحقق من كلمة المرور' }), { status: 401, headers: corsHeaders });
  }
});
