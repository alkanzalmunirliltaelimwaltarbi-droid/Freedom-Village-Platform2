(() => {
  'use strict';
  const { createClient } = window.supabase;
  const client = createClient(window.FV_SUPABASE_URL, window.FV_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const collections = ['news','services','emergency','events','directory'];
  async function profile(){
    const {data:{user}} = await client.auth.getUser();
    if(!user) return null;
    const {data,error}=await client.from('profiles').select('*').eq('id',user.id).maybeSingle();
    if(error) throw error;
    return data ? {...data,email:user.email} : {id:user.id,email:user.email,name:user.user_metadata?.name||user.email,is_admin:false,active:true};
  }
  async function loadData(base){
    const out=JSON.parse(JSON.stringify(base));
    for(const c of collections){ const {data,error}=await client.from('content_items').select('*').eq('category',c).order('created_at',{ascending:false}); if(error) throw error; out[c]=data||[]; }
    {const {data,error}=await client.from('requests').select('*').order('created_at',{ascending:false}); if(error) throw error; out.requests=(data||[]).map(x=>({...x,statusLabel:x.status_label||'قيد المراجعة',userId:x.user_id||null,createdAt:x.created_at}));}
    {const {data,error}=await client.from('prayer_times').select('*').eq('id',1).maybeSingle(); if(error) throw error; if(data) out.prayer={...out.prayer,...data};}
    {const {data,error}=await client.from('app_settings').select('*').eq('id',1).maybeSingle(); if(error) throw error; if(data) out.settings={...out.settings,...data,hijriOffset:Number(data.hijri_offset||0),logoUrl:data.logo_url||''};}
    return out;
  }
  async function upsertContent(row, category){
    const payload={id:row.id,category,title:row.title||'',body:row.body||'',date:row.date||null,extra:row.extra||{}};
    const {error}=await client.from('content_items').upsert(payload);
    if(error) throw error;
  }
  async function deleteContent(id){
    const {error}=await client.from('content_items').delete().eq('id',id);
    if(error) throw error;
  }
  async function updateRequest(id, patch){
    const mapped={};
    if(patch.status!==undefined) mapped.status=patch.status;
    if(patch.statusLabel!==undefined) mapped.status_label=patch.statusLabel;
    if(patch.name!==undefined) mapped.name=patch.name;
    if(patch.phone!==undefined) mapped.phone=patch.phone;
    if(patch.body!==undefined) mapped.body=patch.body;
    const {error}=await client.from('requests').update(mapped).eq('id',id);
    if(error) throw error;
  }
  async function deleteRequest(id){
    const {error}=await client.from('requests').delete().eq('id',id);
    if(error) throw error;
  }
  async function savePrayer(data){
    const p={id:1,fajr:data.prayer.fajr||'',sunrise:data.prayer.sunrise||'',dhuhr:data.prayer.dhuhr||'',asr:data.prayer.asr||'',maghrib:data.prayer.maghrib||'',isha:data.prayer.isha||'',image_url:data.prayer.image_url||null};
    const {error}=await client.from('prayer_times').upsert(p);
    if(error) throw error;
  }
  async function saveSettings(settings){
    const s={id:1,village:settings.village||'قرية الحرية',description:settings.description||'',hijri_offset:Number(settings.hijriOffset||0),logo_url:settings.logoUrl||null};
    const {error}=await client.from('app_settings').upsert(s);
    if(error) throw error;
  }
  async function saveData(data){
    await Promise.all([savePrayer(data),saveSettings(data.settings)]);
    return true;
  }
  async function authorize(password){
    const {data,error}=await client.functions.invoke('authorize',{body:{password}});
    if(error) return {ok:false,error:error.message||'تعذر التحقق من كلمة المرور'};
    return data||{ok:false,error:'استجابة غير صالحة'};
  }

  async function logoutAccess(){
    const {data,error}=await client.functions.invoke('authorize',{body:{logout:true}});
    if(error) return {ok:false,error:error.message||'تعذر تسجيل الخروج'};
    await client.auth.refreshSession();
    return data||{ok:false};
  }

  async function uploadImage(file,path){
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const full=`${path}.${ext}`;
    const {error}=await client.storage.from('public-assets').upload(full,file,{upsert:true,contentType:file.type||'image/jpeg',cacheControl:'3600'});
    if(error) throw error;
    const {data}=client.storage.from('public-assets').getPublicUrl(full);
    return data.publicUrl;
  }

  async function restoreData(source){
    for(const category of collections){
      const rows=(source[category]||[]).map(x=>({id:x.id||crypto.randomUUID(),category,title:x.title||'',body:x.body||'',date:x.date||null,extra:x.extra||{}}));
      if(rows.length){ const {error}=await client.from('content_items').upsert(rows); if(error) throw error; }
    }
    if(source.prayer){ await savePrayer(source); }
    if(source.settings){ await saveSettings(source.settings); }
    return true;
  }
  async function resetCloud(){
    for(const category of collections){
      const {error}=await client.from('content_items').delete().eq('category',category); if(error) throw error;
    }
    const {error:reqError}=await client.from('requests').delete().not('id','is',null); if(reqError) throw reqError;
    await savePrayer({prayer:{fajr:'',sunrise:'',dhuhr:'',asr:'',maghrib:'',isha:'',image_url:null}});
    await saveSettings({village:'قرية الحرية',description:'منصة خدمية مركزية للأخبار والخدمات والمعلومات والشكاوى والاقتراحات.',hijriOffset:0,logoUrl:null});
    return true;
  }
  async function deleteImage(path){
    if(!path) return;
    const {error}=await client.storage.from('public-assets').remove([path]);
    if(error) throw error;
  }

  window.FVCloud={client,auth:client.auth,profile,authorize,logoutAccess,loadData,saveData,upsertContent,deleteContent,updateRequest,deleteRequest,savePrayer,saveSettings,uploadImage,deleteImage,restoreData,resetCloud,isReady:true};
})();
