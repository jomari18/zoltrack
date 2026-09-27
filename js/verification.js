function safeText(value) { return String(value ?? ''); }
async function loadVerifiedProfile() {
  if (!Database.initialized) Database.init();
  const { data: { session }, error } = await Database.supabase.auth.getSession();
  if (error || !session?.user) { window.location.replace('login.html'); return null; }
  const { data: profile, error: profileError } = await Database.supabase.from('profiles').select('id,full_name,role,approved,rejection_reason,verification_document,verification_document_name').eq('id',session.user.id).single();
  if (profileError || !profile) { await Database.supabase.auth.signOut(); window.location.replace('login.html'); return null; }
  return { session, profile };
}
async function signOutToLogin() { if (!Database.initialized) Database.init(); await Database.supabase.auth.signOut(); localStorage.removeItem('currentUser'); window.location.replace('login.html'); }
async function initVerification() {
  const ctx = await loadVerifiedProfile(); if (!ctx) return;
  const { session, profile } = ctx;
  if (profile.approved) { window.location.replace('dashboard.html'); return; }
  if (profile.verification_document && !profile.rejection_reason) { window.location.replace('pending-approval.html'); return; }
  if (profile.rejection_reason) { document.getElementById('verification-title').textContent='Resubmit Account Verification'; document.getElementById('verification-copy').textContent='Your previous document needs to be replaced before your account can be reviewed again.'; document.getElementById('rejection-box').hidden=false; document.getElementById('rejection-reason').textContent=safeText(profile.rejection_reason); }
  const input=document.getElementById('verification-file'), info=document.getElementById('verification-file-info');
  input.addEventListener('change',()=>{ const f=input.files?.[0]; if(!f){info.hidden=true;return;} info.hidden=false; info.innerHTML=`<i class="fa-solid fa-file-shield"></i><div><strong></strong><span></span></div>`; info.querySelector('strong').textContent=f.name; info.querySelector('span').textContent=`${(f.size/1024/1024).toFixed(2)} MB`; });
  document.getElementById('verification-form').addEventListener('submit',async e=>{ e.preventDefault(); const f=input.files?.[0]; if(!f)return; const allowed=['image/jpeg','image/png','application/pdf']; if(!allowed.includes(f.type)){return Swal.fire({icon:'error',title:'Invalid File',text:'Only PDF, JPG, and PNG files are allowed.',confirmButtonColor:'#d32f2f'});} if(f.size>5*1024*1024){return Swal.fire({icon:'error',title:'File Too Large',text:'Maximum file size is 5 MB.',confirmButtonColor:'#d32f2f'});} const btn=e.currentTarget.querySelector('button[type=submit]'); btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting...'; try { await Database.createPendingRegistration({file:f,documentName:f.name}); if(typeof emailConfirmation!=='undefined'){try{emailConfirmation.init();await emailConfirmation.sendEmail(session.user.email,profile.full_name||session.user.email,'Your verification document has been submitted successfully.','PENDING REVIEW','Your registration is under review. You will receive an email once approved.');if(emailConfirmation.superAdminEmail) await emailConfirmation.sendEmail(emailConfirmation.superAdminEmail,'Admin',`New verification submission from ${profile.full_name||session.user.email} (${session.user.email}).`,'ACTION REQUIRED','Login to the Super Admin approval queue to review the submitted document.');}catch(err){console.warn('Notification email failed:',err);}} window.location.replace('pending-approval.html'); } catch(err){ Swal.fire({icon:'error',title:'Submission Failed',text:err?.message||'Could not submit your document.',confirmButtonColor:'#d32f2f'}); btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit for Approval'; }});
  document.getElementById('verification-signout').addEventListener('click',signOutToLogin);
}
async function initPending() {
 const ctx=await loadVerifiedProfile(); if(!ctx)return; const {profile}=ctx;
 if(profile.approved){window.location.replace('dashboard.html');return;} if(!profile.verification_document || profile.rejection_reason){window.location.replace('verification.html');return;}
 const file=document.getElementById('pending-file'); if(file) file.textContent=profile.verification_document_name||'Verification document submitted';
 document.getElementById('pending-refresh')?.addEventListener('click',()=>window.location.reload()); document.getElementById('pending-signout')?.addEventListener('click',signOutToLogin);
}
document.addEventListener('DOMContentLoaded',()=>{const page=location.pathname.split('/').pop(); if(page==='verification.html')initVerification(); if(page==='pending-approval.html')initPending();});
