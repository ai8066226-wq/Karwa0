let deferredInstall=null;
const KARWA_BUILD={phase:81,version:"2.3.2"};
let karwaLastVersionCheck=0,karwaUpdateReloading=false,karwaHiddenAt=0;
const karwaIsNative=!!window.KarwaNative;
function banner(){let b=document.getElementById('networkBanner');if(!b){b=document.createElement('div');b.id='networkBanner';b.style.cssText='position:fixed;z-index:99999;top:0;left:0;right:0;padding:9px 16px;text-align:center;font:600 13px system-ui;background:#fff3cd;color:#664d03;display:none';document.body.appendChild(b)}b.textContent=navigator.onLine?'تم استعادة الاتصال بالإنترنت':'أنت غير متصل بالإنترنت — سيستخدم كروة النسخة المحلية حتى عودة الشبكة';b.style.display=navigator.onLine?'none':'block'}
function updateBanner(){let b=document.getElementById('karwaUpdateBanner');if(b)return b;b=document.createElement('div');b.id='karwaUpdateBanner';b.style.cssText='position:fixed;z-index:100000;left:14px;right:14px;bottom:18px;max-width:520px;margin:auto;background:#0b1015;color:#fff;border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 50px rgba(0,0,0,.28);border-radius:16px;padding:12px 14px;display:none;direction:rtl;font:600 13px system-ui';b.innerHTML='<strong>يتوفر تحديث جديد لكروة</strong><span style="display:block;opacity:.75;margin-top:3px">سيتم تطبيق التحديث مرة واحدة فقط.</span>';document.body.appendChild(b);return b}
function karwaVersionKey(v){return `${Number(v?.phase||0)}-${String(v?.version||'')}`}
function cleanAppliedUpdateMarker(){try{const u=new URL(location.href);if(!u.searchParams.has('karwa_update'))return;u.searchParams.delete('karwa_update');u.searchParams.delete('karwa_reload');history.replaceState(history.state,'',u.pathname+(u.searchParams.toString()?`?${u.searchParams}`:'')+u.hash)}catch{}}
async function checkKarwaUpdate(force=false){
  // Android owns update checks natively. Never let web code reload the native WebView.
  if(karwaIsNative||karwaUpdateReloading||!navigator.onLine)return false;
  const now=Date.now();if(!force&&now-karwaLastVersionCheck<60000)return false;karwaLastVersionCheck=now;
  try{
    const r=await fetch(`./version.json?check=${now}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)return false;
    const v=await r.json();const remoteKey=karwaVersionKey(v),buildKey=karwaVersionKey(KARWA_BUILD);
    if(remoteKey===buildKey){try{sessionStorage.removeItem('karwa_update_attempt')}catch{}cleanAppliedUpdateMarker();return false}
    const u=new URL(location.href);const marker=u.searchParams.get('karwa_update');let attempted='';try{attempted=sessionStorage.getItem('karwa_update_attempt')||''}catch{}
    // Guard against a stale pwa.js/version.json mismatch: one reload maximum per target version.
    if(marker===remoteKey||attempted===remoteKey)return false;
    try{sessionStorage.setItem('karwa_update_attempt',remoteKey)}catch{}
    karwaUpdateReloading=true;const b=updateBanner();b.style.display='block';
    try{if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration();await reg?.update();reg?.waiting?.postMessage({type:'SKIP_WAITING'});}}catch{}
    setTimeout(()=>{u.searchParams.set('karwa_update',remoteKey);u.searchParams.set('karwa_reload',String(Date.now()));location.replace(u.toString())},900);return true;
  }catch{return false}
}
window.addEventListener('online',()=>{banner();if(!karwaIsNative)checkKarwaUpdate(true)});window.addEventListener('offline',banner);window.addEventListener('DOMContentLoaded',()=>{banner();if(!karwaIsNative)setTimeout(()=>checkKarwaUpdate(true),1400)});
document.addEventListener('visibilitychange',()=>{if(karwaIsNative)return;if(document.hidden){karwaHiddenAt=Date.now();return}if(!karwaHiddenAt||Date.now()-karwaHiddenAt>20000)checkKarwaUpdate(true);karwaHiddenAt=0});
if(!karwaIsNative)setInterval(()=>{if(!document.hidden)checkKarwaUpdate(false)},120000);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;document.querySelectorAll('[data-install-karwa]').forEach(x=>x.hidden=false)});
window.installKarwa=async()=>{if(!deferredInstall)return false;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;return true};
if(!karwaIsNative&&location.protocol!=='file:'&&'serviceWorker'in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=81',{updateViaCache:'none'}).then(reg=>{reg.update();if(reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'})}).catch(console.error));}
window.KarwaUpdate={check:()=>checkKarwaUpdate(true),build:KARWA_BUILD,native:karwaIsNative};
