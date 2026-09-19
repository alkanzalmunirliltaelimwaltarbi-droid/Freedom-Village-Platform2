# منصة قرية الحرية — الإصدار النهائي 5.0.0

## البنية النهائية
- GitHub: المصدر الوحيد لكود التطبيق وملفات Supabase والمراجعات.
- Netlify أو GitHub Pages: نشر واجهة التطبيق.
- Supabase: PostgreSQL + Realtime + Storage + جلسات Anonymous Auth + Edge Function للتحقق من كلمة المرور.
- لا يوجد بريد إلكتروني للمستخدم.
- شاشة الدخول تحتوي على حقل كلمة مرور واحد فقط.

## لماذا يوجد Anonymous Auth رغم أن المستخدم لا يرى حساباً؟
لأن Supabase RLS يحتاج جلسة موثقة حتى يحمي قاعدة البيانات. الجلسة المجهولة لا تعرض للمستخدم بريداً أو اسماً، وتُستخدم فقط كهوية تقنية للجهاز. كلمة المرور نفسها لا تُحفظ في GitHub؛ التحقق يتم في Edge Function، ثم تُمنح الجلسة صلاحية مؤقتة/مستمرة حسب JWT metadata.

## كلمات المرور الأولية
يتم تسليم كلمات المرور الأولية خارج ملفات GitHub. قاعدة البيانات تحفظ PBKDF2-HMAC-SHA-256 مع salt وعدد دورات مرتفع، ولا تحفظ كلمة المرور نفسها.

## تغيير كلمات المرور
بعد تطبيق migration، يمكن تغييرها من SQL Editor باستخدام pgcrypto:

```sql
create extension if not exists pgcrypto;
تغيير كلمات المرور يتم عبر Edge Function/أداة إدارة مخصصة، لأن الحقول تستخدم PBKDF2 مع salt ولا ينبغي إدخال hash يدوي ضعيف.

لإعادة ضبط كلمات المرور بأمان، عدّل قيم hash/salt بعد توليدها عبر أداة إدارة موثوقة، أو اطلب إصدار إدارة مخصص لتغييرها من داخل لوحة المشرف.
```

## إعداد Supabase مرة واحدة
1. اربط مستودع GitHub الحالي من Supabase > Project Settings > Integrations > GitHub.
2. اجعل مجلد العمل هو جذر المستودع لأن `supabase/` موجود في الجذر.
3. فعّل Anonymous Sign-ins في Auth إذا كان إعداد المشروع الحالي لا يطبق `config.toml` تلقائياً على المشروع المستضاف.
4. طبّق migrations من `supabase/migrations/` أو فعّل Deploy to production من تكامل GitHub.
5. فعّل Storage bucket `public-assets` إذا لم يكن موجوداً؛ migration/config ينشئانه عند النشر.
6. لا تضع Secret Key في GitHub. مفتاح `sb_publishable_...` فقط في الواجهة.

## الربط النهائي بدون ZIP متكرر
بعد وضع محتويات المشروع في مستودع GitHub، اربط المستودع من Supabase > Project Settings > Integrations > GitHub، واجعل مجلد العمل هو جذر المستودع. فعّل Deploy to production. عندها تُنشر migrations وEdge Function من GitHub وفق إعداد التكامل. لا تحتاج إلى GitHub Actions أو رفع ملفات إلى Supabase يدويًا في كل تحديث.

يلزم مرة واحدة فقط من Supabase Auth تفعيل **Anonymous Sign-ins**، لأن شاشة البرنامج لا تستخدم البريد الإلكتروني لكنها تحتاج جلسة تقنية موثقة حتى تعمل RLS بأمان.

## الاختبارات المنفذة محلياً
- فحص syntax لـ `app.js`.
- فحص syntax لـ `supabase-backend.js`.
- فحص وجود ملفات المشروع.
- فحص صورة الشعار وتحويلها إلى PNG حقيقي بدل ملف JPEG باسم `.png`، لمعالجة مشكلة الصورة المفقودة في GitHub Pages.
- فحص إعدادات Netlify وService Worker وSupabase config.
- فحص migration وEdge Function من ناحية البنية والاتساق.

## ملاحظة مهمة
الاختبار الحي النهائي لاتصال المشروع بقاعدة Supabase لا يمكن اعتباره منفذاً من بيئة البناء وحدها؛ يجب بعد النشر اختبار تسجيل الدخول، RLS، Realtime، Storage وCRUD على مشروع Supabase الفعلي.
