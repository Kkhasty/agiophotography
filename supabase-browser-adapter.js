/* Agio Photography Supabase browser adapter. Publishable key only. */
const AGIO_SUPABASE_URL='https://tltjytmdymwwerzmjohf.supabase.co';
const AGIO_SUPABASE_PUBLISHABLE_KEY='sb_publishable_udEMpYufW_SsVVDt4oa7-g_k_N1Lma07';
if(!window.supabase?.createClient) throw new Error('Supabase client library did not load. Refresh the page.');
const agioSupabase=window.supabase.createClient(AGIO_SUPABASE_URL,AGIO_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const AGIO_ROLE_LABELS={super_admin:'Super Administrator',administrator:'Administrator',staff:'Staff',photographer:'Photographer'};
const AGIO_ROLE_KEYS={'Super Administrator':'super_admin',Administrator:'administrator',Staff:'staff',Photographer:'photographer'};
async function agioSupabaseApi(action,payload={}){
 const fail=e=>({ok:false,error:e?.message||'The request could not be completed.'});
 try{
  if(action==='login'){
   const {data,error}=await agioSupabase.auth.signInWithPassword({email:String(payload.email||'').trim().toLowerCase(),password:String(payload.password||'')});if(error)throw error;
   const {data:p,error:pe}=await agioSupabase.from('agio_staff_profiles').select('user_id,full_name,role,photographer_id,active').eq('user_id',data.user.id).maybeSingle();if(pe)throw pe;
   if(!p||!p.active){await agioSupabase.auth.signOut();throw new Error('This account is inactive or not authorized.');}
   return {ok:true,token:data.session.access_token,user:{id:p.user_id,name:p.full_name,email:data.user.email,role:AGIO_ROLE_LABELS[p.role]||'Staff',photographerId:p.photographer_id||''}};
  }
  if(action==='logout'){const {error}=await agioSupabase.auth.signOut();if(error)throw error;return {ok:true};}
  if(action==='createBooking'){const {data,error}=await agioSupabase.functions.invoke('create-booking',{body:{record:payload.record||{}}});if(error)throw error;return data;}
  if(action==='listStaff'){
   const {data,error}=await agioSupabase.functions.invoke('admin-staff',{method:'GET'});if(error)throw error;
   return {ok:true,records:(data?.records||[]).map(p=>({id:p.user_id,name:p.full_name,email:p.email,role:AGIO_ROLE_LABELS[p.role]||p.role,active:p.active,photographerId:p.photographer_id||''}))};
  }
  if(action==='createStaff'){
   const s=payload.staff||{};const {data,error}=await agioSupabase.functions.invoke('admin-staff',{body:{...s,role:AGIO_ROLE_KEYS[s.role]||s.role}});if(error)throw error;
   if(data?.staff)data.staff={...data.staff,role:AGIO_ROLE_LABELS[data.staff.role]||data.staff.role};return data;
  }
  if(action==='setStaffActive'){const {data,error}=await agioSupabase.functions.invoke('admin-staff',{method:'PATCH',body:{userId:payload.id,active:payload.active===true}});if(error)throw error;return data;}
  if(['listBookings','updateBooking','bootstrapData','saveCollection','getCollection'].includes(action)){
   const {data,error}=await agioSupabase.functions.invoke('workspace',{body:{action,...payload}});if(error)throw error;return data;
  }
  throw new Error('Unsupported backend action: '+action);
 }catch(e){return fail(e);}
}
async function agioSupabaseRequest(path,options={}){
 const {data:{session}}=await agioSupabase.auth.getSession();
 const headers={apikey:AGIO_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session?.access_token||AGIO_SUPABASE_PUBLISHABLE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})};
 const response=await fetch(`${AGIO_SUPABASE_URL}/rest/v1/${path}`,{...options,headers});const result=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(result?.message||'Supabase request failed.');return result;
}
