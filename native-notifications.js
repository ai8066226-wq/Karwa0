(()=>{
  const KEY='karwa.notification.center.v2';
  const ENABLED_KEY='karwa.notifications.enabled';
  const MAX=60;
  const labels={order:'طلب',wallet:'محفظة',service:'خدمة',driver:'كابتن',admin:'إدارة',system:'النظام'};
  let items=[];
  const now=()=>Date.now();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const enabled=()=>localStorage.getItem(ENABLED_KEY)!=='0';
  function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');items=Array.isArray(x)?x.slice(0,MAX):[]}catch{items=[]}}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(items.slice(0,MAX)))}catch{}}
  function ensureUi(){
    if(document.getElementById('karwaNotificationDrawer'))return;
    const existing=document.getElementById('notificationButton');
    if(existing){existing.dataset.karwaNotificationAnchor='1'; existing.innerHTML='<span aria-hidden="true">🔔</span><span class="karwa-notification-badge" id="karwaHeaderNotificationBadge" hidden>0</span>'; existing.style.position='relative'}
    else{
      const fab=document.createElement('button');fab.id='karwaNotificationFab';fab.type='button';fab.setAttribute('aria-label','الإشعارات');fab.innerHTML='🔔<span class="karwa-notification-badge" id="karwaFabNotificationBadge" hidden>0</span>';document.body.appendChild(fab);
    }
    const scrim=document.createElement('div');scrim.id='karwaNotificationScrim';
    const drawer=document.createElement('aside');drawer.id='karwaNotificationDrawer';drawer.setAttribute('aria-hidden','true');drawer.innerHTML=`
      <div class="kn-head"><div><h2>مركز الإشعارات</h2><p id="karwaNotificationSummary">آخر تحديثات حسابك وطلباتك</p></div><div class="kn-head-actions"><button class="kn-icon-btn" id="karwaNotificationClose" type="button" aria-label="إغلاق">✕</button></div></div>
      <div class="kn-permission" id="karwaNotificationPermission"><div><strong>فعّل إشعارات الجهاز</strong><small>لتصلك تحديثات الطلب والمحفظة بشكل أسرع.</small></div><button id="karwaNotificationPermissionButton" type="button">تفعيل</button></div>
      <div class="kn-toolbar"><button class="kn-chip primary" id="karwaNotificationReadAll" type="button">تحديد الكل كمقروء</button><button class="kn-chip" id="karwaNotificationClear" type="button">مسح السجل</button></div>
      <div id="karwaNotificationList"></div>`;
    document.body.append(scrim,drawer);
    document.getElementById('karwaNotificationClose').onclick=close;
    scrim.onclick=close;
    document.getElementById('karwaNotificationReadAll').onclick=()=>{items=items.map(x=>({...x,read:true}));save();render()};
    document.getElementById('karwaNotificationClear').onclick=()=>{items=[];save();render()};
    document.getElementById('karwaNotificationPermissionButton').onclick=()=>requestPermission(true);
    (existing||document.getElementById('karwaNotificationFab')).addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();open()},{capture:true});
    render();
  }
  function typeLabel(t){return labels[t]||labels.system}
  function render(){
    const list=document.getElementById('karwaNotificationList');if(!list)return;
    const unread=items.filter(x=>!x.read).length;
    ['karwaHeaderNotificationBadge','karwaFabNotificationBadge'].forEach(id=>{const b=document.getElementById(id);if(!b)return;b.hidden=!unread;b.textContent=unread>99?'99+':String(unread)});
    const s=document.getElementById('karwaNotificationSummary');if(s)s.textContent=unread?`${unread.toLocaleString('ar-IQ')} إشعار غير مقروء`:'لا توجد إشعارات غير مقروءة';
    if(!items.length){list.innerHTML='<div class="kn-empty"><div style="font-size:30px;margin-bottom:8px">🔔</div><strong>لا توجد إشعارات بعد</strong><div style="margin-top:5px">ستظهر هنا تحديثات الطلبات والشحن والخدمات.</div></div>';return}
    list.innerHTML=items.map(x=>`<article class="kn-item ${x.read?'':'unread'}" data-kn-id="${esc(x.id)}"><div class="kn-item-title">${esc(x.title)}</div><div class="kn-item-body">${esc(x.body)}</div><div class="kn-item-meta"><span class="kn-type">${esc(typeLabel(x.type))}</span><time>${new Date(x.at).toLocaleString('ar-IQ',{dateStyle:'short',timeStyle:'short'})}</time></div></article>`).join('');
    list.querySelectorAll('[data-kn-id]').forEach(el=>el.onclick=()=>{const id=el.dataset.knId;const item=items.find(x=>x.id===id);items=items.map(x=>x.id===id?{...x,read:true}:x);save();render();if(item?.route)navigate(item.route)});
  }
  function open(){ensureUi();document.getElementById('karwaNotificationDrawer')?.classList.add('open');document.getElementById('karwaNotificationScrim')?.classList.add('open');document.getElementById('karwaNotificationDrawer')?.setAttribute('aria-hidden','false');items=items.map(x=>({...x,read:true}));save();render();updatePermissionCard()}
  function close(){document.getElementById('karwaNotificationDrawer')?.classList.remove('open');document.getElementById('karwaNotificationScrim')?.classList.remove('open');document.getElementById('karwaNotificationDrawer')?.setAttribute('aria-hidden','true')}
  function navigate(route){if(!route)return;try{if(route.startsWith('#'))location.hash=route;else if(route.startsWith('./')||route.startsWith('/')||/^https?:/.test(route))location.href=route}catch{}}
  function nativeAvailable(){return !!(window.KarwaNative&&typeof window.KarwaNative.notify==='function')}
  function requestPermission(userInitiated=false){
    try{if(window.KarwaNative?.requestNotificationPermission){window.KarwaNative.requestNotificationPermission();setTimeout(updatePermissionCard,800);return}}
    catch{}
    if('Notification'in window&&Notification.permission==='default'&&userInitiated)Notification.requestPermission().finally(updatePermissionCard);else updatePermissionCard();
  }
  function updatePermissionCard(){const box=document.getElementById('karwaNotificationPermission');if(!box)return;let granted=false;try{if(window.KarwaNative?.notificationPermissionGranted)granted=!!window.KarwaNative.notificationPermissionGranted()}catch{}if(!granted&&'Notification'in window)granted=Notification.permission==='granted';box.hidden=granted}
  function push(input={}){
    if(!enabled())return null;
    const title=String(input.title||'كروة').trim().slice(0,90),body=String(input.body||'لديك تحديث جديد').trim().slice(0,240),type=String(input.type||'system'),route=String(input.route||''),tag=String(input.tag||'');
    if(tag&&items.some(x=>x.tag===tag&&now()-Number(x.at||0)<90000))return null;
    const item={id:`n_${now()}_${Math.random().toString(36).slice(2,8)}`,title,body,type,route,tag,at:now(),read:false};items.unshift(item);items=items.slice(0,MAX);save();render();
    if(input.native!==false){
      try{if(nativeAvailable()){if(document.hidden||input.forceNative===true)window.KarwaNative.notify(title,body,type,route)}else if('Notification'in window&&Notification.permission==='granted')new Notification(title,{body,tag:tag||item.id,icon:'./karwa-icon-192.png'})}catch{}
    }
    return item;
  }
  function setEnabled(v){localStorage.setItem(ENABLED_KEY,v?'1':'0');if(v)requestPermission(false)}
  function getNativePushToken(){try{return window.KarwaNative?.getPushToken?.()||''}catch{return''}}
  window.addEventListener('karwa-native-notification-open',event=>{const d=event.detail||{};if(d.route)navigate(d.route)});
  window.addEventListener('karwa-native-push-received',event=>{const d=event.detail||{};push({title:d.title||'كروة',body:d.body||'لديك تحديث جديد',type:d.type||'system',route:d.route||'',tag:d.tag||'',native:false});});
  window.KarwaNotify={push,open,close,setEnabled,isEnabled:enabled,requestPermission,getNativePushToken,render};
  load(); if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureUi);else ensureUi();
})();
