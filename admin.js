import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyASl5jV5mLaDh8CoeeofV7ftVJ3gaog64E",
  authDomain: "karwa0.firebaseapp.com",
  projectId: "karwa0",
  storageBucket: "karwa0.firebasestorage.app",
  messagingSenderId: "485451054622",
  appId: "1:485451054622:web:ce9b0e2ff2280870a8780f"
};

const app = initializeApp(firebaseConfig, "karwa-admin-portal");
const auth = getAuth(app);
const db = getFirestore(app);

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الإدارة", error);
}

const byId = id => document.getElementById(id);
const statuses = ["بانتظار كابتن", "الكابتن في الطريق", "وصل الكابتن", "بدأت الرحلة", "تم الوصول"];
const icons = { ride: "🚕", parcel: "📦", food: "🍽️", serviceDelivery: "🛵" };

const state = {
  user: null,
  users: [],
  applications: [],
  serviceApplications: [],
  serviceProfiles: [],
  restaurants: [],
  drivers: [],
  ratings: [],
  orders: [],
  topupRequests: [],
  pricingSettings: null,
  paymentSettings: null,
  roleUnsubscribe: null,
  dashboardUnsubscribes: []
};

const money = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";

async function reviewTopupFirestore(requestId, decision, approvedAmount=0, note="") {
  const requestRef=doc(db,"topupRequests",requestId);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(requestRef);if(!snap.exists())throw new Error("TOPUP_NOT_FOUND");
    const data=snap.data();if(data.status!=="pending")throw new Error("TOPUP_ALREADY_REVIEWED");
    if(decision==="reject"){tx.update(requestRef,{status:"rejected",reviewNote:String(note||"").slice(0,250),reviewedBy:state.user.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});return;}
    const amount=Math.max(0,Math.round(Number(approvedAmount||0)));if(!amount)throw new Error("BAD_AMOUNT");
    const userRef=doc(db,"users",data.userId), userSnap=await tx.get(userRef);if(!userSnap.exists())throw new Error("USER_NOT_FOUND");
    const before=Math.max(0,Number(userSnap.data().balance||0)),after=before+amount;
    tx.update(userRef,{balance:after,lastTopupRequestId:requestId,updatedAt:serverTimestamp()});
    tx.update(requestRef,{status:"approved",approvedAmount:amount,reviewedBy:state.user.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});
    tx.set(doc(collection(db,"walletTransactions")),{userId:data.userId,type:"mastercard_topup",topupRequestId:requestId,amount,balanceAfter:after,approvedBy:state.user.uid,createdAt:serverTimestamp()});
  });
}
async function docsMatching(collectionName, field, uid){try{return (await getDocs(query(collection(db,collectionName),where(field,"==",uid)))).docs;}catch(e){console.warn("cleanup query",collectionName,field,e);return [];}}
async function deleteRefsInChunks(refs){const unique=[...new Map(refs.map(r=>[r.path,r])).values()];for(let i=0;i<unique.length;i+=350){const batch=writeBatch(db);unique.slice(i,i+350).forEach(ref=>batch.delete(ref));await batch.commit();}return unique.length;}
async function disableAndCleanAccountFirestore(uid){
  if(uid===state.user.uid)throw new Error("ADMIN_PROTECTED");
  const userRef=doc(db,"users",uid), snap=await getDoc(userRef);if(!snap.exists())throw new Error("USER_NOT_FOUND");if(snap.data().role==="admin")throw new Error("ADMIN_PROTECTED");
  await setDoc(userRef,{role:"blocked",disabled:true,disabledReason:"deleted_by_admin",name:"حساب محذوف",email:"",balance:0,deletedAt:serverTimestamp(),deletedBy:state.user.uid,updatedAt:serverTimestamp()},{merge:true});
  const refs=[];
  const orderMap=new Map();for(const field of ["userId","driverId","providerId"]){for(const d of await docsMatching("orders",field,uid))orderMap.set(d.id,d);}
  for(const d of orderMap.values()){try{const tracks=await getDocs(collection(db,"orders",d.id,"tracking"));tracks.docs.forEach(t=>refs.push(t.ref));}catch(_){}refs.push(doc(db,"orderSecrets",d.id),d.ref);}
  for(const [name,fields] of [["serviceRequests",["customerId","providerId"]],["ratings",["customerId","driverId"]],["customerRatings",["customerId","driverId"]],["walletTransactions",["userId","driverId"]],["topupRequests",["userId"]],["referrals",["inviteeUid","inviterUid"]],["referralCodes",["ownerUid"]],["supportTickets",["userId"]],["safetyEvents",["reportedBy"]],["roadReports",["reportedBy"]],["landmarks",["createdBy"]],["tripShares",["userId","driverId","customerId"]]]){for(const field of fields){for(const d of await docsMatching(name,field,uid))refs.push(d.ref);}}
  for(const name of ["driverApplications","drivers","publicDrivers","serviceApplications","serviceProfiles","restaurants"]){refs.push(doc(db,name,uid));}
  const deleted=await deleteRefsInChunks(refs);
  return {deletedDocuments:deleted,authAccountRetained:true};
}

function isBikeVehicle(record = {}) {
  return String(record.vehicleType || "").trim().includes("دراجة");
}

function normalizeCaptainServiceType(record = {}) {
  const raw = String(record.serviceType || "").trim();
  const lower = raw.toLowerCase();
  if (lower === "other") return "other";
  if (isBikeVehicle(record)) return "delivery";
  if (["delivery", "parcel", "food", "servicedelivery"].includes(lower) || raw.includes("توصيل")) return "delivery";
  if (["taxi", "ride"].includes(lower) || raw.includes("تكسي")) return "taxi";
  return "";
}

function captainServiceLabel(record = {}) {
  const type = normalizeCaptainServiceType(record);
  if (type === "delivery") return "توصيل أغراض وطعام";
  if (type === "taxi") return "تكسي — نقل ركاب";
  if (type === "other") return "خدمات أخرى";
  return "غير محدد";
}

function captainServiceIcon(record = {}) {
  return normalizeCaptainServiceType(record) === "delivery" ? "🛵" : "🚕";
}

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[char]);

function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.adminToast);
  window.adminToast = setTimeout(() => element.classList.remove("show"), 2800);
}

function busy(button, active, text = "جاري التنفيذ…") {
  if (active) {
    button.dataset.label = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function authMessage(error) {
  const messages = {
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/invalid-email": "البريد الإلكتروني غير صحيح.",
    "auth/too-many-requests": "محاولات كثيرة؛ حاول بعد قليل.",
    "auth/network-request-failed": "تعذر الاتصال بالإنترنت."
  };
  return messages[error.code] || "تعذر تسجيل الدخول.";
}

function showView(name) {
  byId("authView").classList.toggle("hidden", name !== "auth");
  byId("deniedView").classList.toggle("hidden", name !== "denied");
  byId("dashboardView").classList.toggle("hidden", name !== "dashboard");
  byId("logoutButton").classList.toggle("hidden", name === "auth");
}

function clearDashboardListeners() {
  state.dashboardUnsubscribes.forEach(unsubscribe => unsubscribe?.());
  state.dashboardUnsubscribes = [];
}

byId("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = byId("loginButton");
  byId("authError").textContent = "";
  busy(button, true, "جاري الدخول…");
  try {
    await signInWithEmailAndPassword(auth, byId("email").value.trim(), byId("password").value);
  } catch (error) {
    byId("authError").textContent = authMessage(error);
  } finally {
    busy(button, false);
  }
});

byId("logoutButton").addEventListener("click", () => signOut(auth));
byId("deniedLogout").addEventListener("click", () => signOut(auth));


function accountRoleLabel(role) {
  return ({customer:"عميل",driverApplicant:"طلب كابتن",driver:"كابتن",serviceApplicant:"طلب خدمة",serviceProvider:"مزود خدمة",admin:"إدارة",blocked:"معطّل"})[role] || role || "عميل";
}

function renderAccounts() {
  const host = byId("accountsList");
  if (!host) return;
  const sorted = [...state.users].sort((a,b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "ar"));
  host.innerHTML = sorted.length ? sorted.map(account => {
    const protectedAccount = account.role === "admin" || account.firestoreId === state.user?.uid;
    const disabledAccount = account.disabled === true || account.role === "blocked";
    return `<div class="order-card">
      <div class="order-top"><span class="order-icon">${account.role === "driver" ? "🚕" : account.role === "serviceProvider" ? "🧰" : account.role === "admin" ? "🔐" : "👤"}</span><div><strong>${escapeHtml(account.name || "حساب كروة")}</strong><small>${escapeHtml(account.email || "بدون بريد محفوظ")}</small></div><span class="status-chip ${protectedAccount ? "approved" : "pending"}">${escapeHtml(accountRoleLabel(account.role))}</span></div>
      <div class="order-meta"><span>UID: <b>${escapeHtml(account.firestoreId)}</b></span>${account.createdAt?.seconds ? `<span>الإنشاء: ${new Date(account.createdAt.seconds*1000).toLocaleDateString("ar-IQ")}</span>` : ""}</div>
      <div class="order-actions">${protectedAccount ? `<span class="notice success" style="margin:0;flex:1">حساب محمي من الحذف</span>` : disabledAccount ? `<span class="notice" style="margin:0;flex:1">الحساب معطّل وتم تنظيف بياناته</span>` : `<button class="danger" data-action="delete-account" data-id="${escapeHtml(account.firestoreId)}">تعطيل الحساب وحذف بيانات Firestore</button>`}</div>
    </div>`;
  }).join("") : `<div class="empty"><span>👤</span>لا توجد حسابات.</div>`;
}

const DEFAULT_ADMIN_PRICING={taxi:{economy:{baseFare:1500,perKm:650,perMinute:65,minimumFare:3000,commissionRate:.15},taxi:{baseFare:2000,perKm:800,perMinute:80,minimumFare:4000,commissionRate:.15},family:{baseFare:2750,perKm:975,perMinute:95,minimumFare:5000,commissionRate:.15}},traffic:{freeFlowSpeedKph:38,trafficWeight:.35,maxMultiplier:1.45,peakExtra:.08,peakWindows:["07:00-09:30","13:30-17:30"]},deliveryCommissions:{parcel:.15,food:.15,serviceDelivery:.15},referral:{enabled:true,inviterReward:2000,inviteeReward:1000}};
function deepMergeAdmin(base,extra){const out={...base};for(const [k,v] of Object.entries(extra||{})){out[k]=v&&typeof v==="object"&&!Array.isArray(v)&&base?.[k]&&typeof base[k]==="object"&&!Array.isArray(base[k])?deepMergeAdmin(base[k],v):v;}return out;}
function fieldNumber(id,fallback){const n=Number(byId(id)?.value);return Number.isFinite(n)?n:fallback;}
function renderPricingSettings(){const p=deepMergeAdmin(DEFAULT_ADMIN_PRICING,state.pricingSettings||{});const map=[['fareEconomyBase',p.taxi.economy.baseFare],['fareEconomyKm',p.taxi.economy.perKm],['fareEconomyMin',p.taxi.economy.perMinute],['fareEconomyMinimum',p.taxi.economy.minimumFare],['commissionEconomy',p.taxi.economy.commissionRate*100],['fareTaxiBase',p.taxi.taxi.baseFare],['fareTaxiKm',p.taxi.taxi.perKm],['fareTaxiMin',p.taxi.taxi.perMinute],['fareTaxiMinimum',p.taxi.taxi.minimumFare],['commissionTaxi',p.taxi.taxi.commissionRate*100],['fareFamilyBase',p.taxi.family.baseFare],['fareFamilyKm',p.taxi.family.perKm],['fareFamilyMin',p.taxi.family.perMinute],['fareFamilyMinimum',p.taxi.family.minimumFare],['commissionFamily',p.taxi.family.commissionRate*100],['commissionParcel',p.deliveryCommissions.parcel*100],['commissionFood',p.deliveryCommissions.food*100],['commissionServiceDelivery',p.deliveryCommissions.serviceDelivery*100],['freeFlowSpeed',p.traffic.freeFlowSpeedKph],['trafficWeight',p.traffic.trafficWeight],['maxTrafficMultiplier',p.traffic.maxMultiplier],['peakExtra',p.traffic.peakExtra],['inviterReward',p.referral.inviterReward],['inviteeReward',p.referral.inviteeReward]];map.forEach(([id,v])=>{if(document.activeElement!==byId(id)&&byId(id))byId(id).value=v;});}
function renderPaymentSettings(){const p=state.paymentSettings||{};if(byId('mastercardEnabled'))byId('mastercardEnabled').checked=p.mastercardEnabled===true;[['adminMastercardNumber',p.mastercardNumber||''],['adminMastercardHolder',p.cardHolder||''],['adminMinTopup',p.minTopup||5000],['adminMaxTopup',p.maxTopup||1000000],['adminTopupInstructions',p.instructions||'']].forEach(([id,v])=>{if(document.activeElement!==byId(id)&&byId(id))byId(id).value=v;});}
function renderTopupRequests(){const host=byId('topupRequestsList');if(!host)return;const list=[...state.topupRequests].sort((a,b)=>{if(a.status==='pending'&&b.status!=='pending')return -1;if(b.status==='pending'&&a.status!=='pending')return 1;return Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0)});const pending=list.filter(x=>x.status==='pending').length;byId('pendingTopupsBadge').textContent=`${pending} بانتظار التحقق`;host.innerHTML=list.length?list.map(x=>`<article class="order-card topup-admin-card ${escapeHtml(x.status||'pending')}"><div class="order-top"><h3>💳 ${escapeHtml(x.customerName||'عميل كروة')}</h3><span class="status-chip ${x.status==='approved'?'approved':x.status==='rejected'?'rejected':'pending'}">${x.status==='approved'?'تمت الإضافة':x.status==='rejected'?'مرفوض':'قيد التحقق'}</span></div><div class="order-meta"><span>${money(x.amount)}</span><span>مرجع: <b>${escapeHtml(x.reference||'—')}</b></span><span>${escapeHtml(x.customerEmail||'')}</span></div>${x.status==='pending'?`<div class="order-actions"><button class="primary" data-action="approve-topup" data-id="${x.firestoreId}">وصل المبلغ — إضافة الرصيد</button><button class="danger" data-action="reject-topup" data-id="${x.firestoreId}">رفض</button></div>`:''}</article>`).join(''):`<div class="empty"><span>💳</span>لا توجد طلبات شحن.</div>`;}
byId('savePricingSettings')?.addEventListener('click',async event=>{const button=event.currentTarget;busy(button,true,'جاري الحفظ…');try{const data={taxi:{economy:{label:'اقتصادي',baseFare:fieldNumber('fareEconomyBase',1500),perKm:fieldNumber('fareEconomyKm',650),perMinute:fieldNumber('fareEconomyMin',65),minimumFare:fieldNumber('fareEconomyMinimum',3000),commissionRate:fieldNumber('commissionEconomy',15)/100},taxi:{label:'تكسي',baseFare:fieldNumber('fareTaxiBase',2000),perKm:fieldNumber('fareTaxiKm',800),perMinute:fieldNumber('fareTaxiMin',80),minimumFare:fieldNumber('fareTaxiMinimum',4000),commissionRate:fieldNumber('commissionTaxi',15)/100},family:{label:'عائلي',baseFare:fieldNumber('fareFamilyBase',2750),perKm:fieldNumber('fareFamilyKm',975),perMinute:fieldNumber('fareFamilyMin',95),minimumFare:fieldNumber('fareFamilyMinimum',5000),commissionRate:fieldNumber('commissionFamily',15)/100}},traffic:{freeFlowSpeedKph:fieldNumber('freeFlowSpeed',38),trafficWeight:fieldNumber('trafficWeight',.35),maxMultiplier:fieldNumber('maxTrafficMultiplier',1.45),peakExtra:fieldNumber('peakExtra',.08),peakWindows:state.pricingSettings?.traffic?.peakWindows||DEFAULT_ADMIN_PRICING.traffic.peakWindows},deliveryCommissions:{parcel:fieldNumber('commissionParcel',15)/100,food:fieldNumber('commissionFood',15)/100,serviceDelivery:fieldNumber('commissionServiceDelivery',15)/100},referral:{enabled:true,inviterReward:fieldNumber('inviterReward',2000),inviteeReward:fieldNumber('inviteeReward',1000)},updatedAt:serverTimestamp(),updatedBy:state.user.uid};await setDoc(doc(db,'platformSettings','pricing'),data,{merge:true});toast('تم حفظ التسعير والعمولات للطلبات الجديدة');}catch(e){console.error(e);toast('تعذر حفظ التسعير');}finally{busy(button,false);}});
byId('savePaymentSettings')?.addEventListener('click',async event=>{const button=event.currentTarget;busy(button,true,'جاري الحفظ…');try{const card=byId('adminMastercardNumber').value.trim();if(byId('mastercardEnabled').checked&&card.replace(/\D/g,'').length<12){toast('أدخل رقم بطاقة صالح قبل تفعيل الشحن');return;}await setDoc(doc(db,'platformSettings','payments'),{mastercardEnabled:byId('mastercardEnabled').checked,mastercardNumber:card,cardHolder:byId('adminMastercardHolder').value.trim().slice(0,80),minTopup:fieldNumber('adminMinTopup',5000),maxTopup:fieldNumber('adminMaxTopup',1000000),instructions:byId('adminTopupInstructions').value.trim().slice(0,300),updatedAt:serverTimestamp(),updatedBy:state.user.uid},{merge:true});toast('تم حفظ إعدادات ماستر كارد');}catch(e){console.error(e);toast('تعذر حفظ إعدادات الشحن');}finally{busy(button,false);}});

function renderMetrics() {
  byId("usersCount").textContent = state.users.filter(user => !user.role || user.role === "customer").length;
  byId("driversCount").textContent = state.drivers.length;
  byId("serviceProvidersCount").textContent = state.users.filter(user => user.role === "serviceProvider").length;
  byId("blockedCount").textContent = state.drivers.filter(driver => driver.blocked === true).length;
  byId("pendingCount").textContent =
    state.applications.filter(item => item.status === "pending" && normalizeCaptainServiceType(item) !== "other").length +
    state.serviceApplications.filter(item => item.status === "pending").length +
    state.applications.filter(item => item.status === "pending" && normalizeCaptainServiceType(item) === "other").length;
  byId("ordersCount").textContent = state.orders.length;
  byId("liveTripsCount").textContent = state.orders.filter(o => !o.cancelled && Number(o.statusIndex||0) > 0 && Number(o.statusIndex||0) < 4).length;
  byId("cancelledTripsCount").textContent = state.orders.filter(o => o.cancelled).length;
  byId("onlineDriversCount").textContent = state.drivers.filter(d => d.online === true && d.blocked !== true).length;
  const completed=state.orders.filter(o=>!o.cancelled&&Number(o.statusIndex||0)>=4);
  const gross=completed.reduce((n,o)=>n+Number(o.price||0),0), commission=completed.reduce((n,o)=>n+Number(o.commissionAmount||0),0), payout=completed.reduce((n,o)=>n+Number(o.driverEarnings||0),0);
  byId("grossRevenue").textContent=money(gross);byId("commissionRevenue").textContent=money(commission);byId("driversPayout").textContent=money(payout);
  const byDriver={};completed.forEach(o=>{const k=o.driverName||"غير معيّن";byDriver[k]=(byDriver[k]||0)+Number(o.driverEarnings||0)});
  byId("financialReport").innerHTML=completed.length?`<div class="order-meta"><span>رحلات مكتملة: ${completed.length}</span><span>متوسط الطلب: ${money(gross/completed.length)}</span></div>${Object.entries(byDriver).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,value])=>`<div class="order-meta"><strong>${escapeHtml(name)}</strong><span>${money(value)}</span></div>`).join("")}`:`<p class="muted">لا توجد رحلات مكتملة بعد.</p>`;
}

function ratingSummary(driverId) {
  const ratings = state.ratings.filter(item => item.driverId === driverId);
  const average = ratings.length
    ? ratings.reduce((total, item) => total + Number(item.score || 0), 0) / ratings.length
    : 0;
  return { count: ratings.length, average };
}

function driverTripSummary(driverId) {
  const trips = state.orders.filter(order => order.driverId === driverId);
  return {
    total: trips.length,
    completed: trips.filter(order => !order.cancelled && Number(order.statusIndex || 0) >= 4).length,
    cancelled: trips.filter(order => order.cancelled === true).length,
    active: trips.filter(order => !order.cancelled && Number(order.statusIndex || 0) < 4).length
  };
}

function driverOrderState(order) {
  if (order.cancelled) return { label: "ملغاة", css: "cancelled" };
  if (Number(order.statusIndex || 0) >= 4) return { label: "مكتملة", css: "complete" };
  return { label: "جارية", css: "active" };
}

function driverTripDetail(order) {
  const tripState = driverOrderState(order);
  const completed = !order.cancelled && Number(order.statusIndex || 0) >= 4;
  const code = order.id || order.orderCode || order.firestoreId;
  return `
    <div class="captain-trip-row">
      <div class="captain-trip-head">
        <strong>${icons[order.type] || "🧾"} ${escapeHtml(order.title || "رحلة كروة")}</strong>
        <span class="status-chip ${tripState.css}">${tripState.label}</span>
      </div>
      <p class="order-route">${escapeHtml(order.route || "-")}</p>
      <div class="order-meta"><span>رمز الرحلة: <b>${escapeHtml(code)}</b></span><span>قيمة الرحلة: ${money(order.price)}</span></div>
      ${completed ? `<div class="order-meta trip-money"><span>عمولة كروة: ${money(order.commissionAmount)}</span><span>صافي الكابتن: <b>${money(order.driverEarnings)}</b></span></div>` : ""}
      ${order.cancelled && order.cancellationReason ? `<p class="admin-note danger-note">سبب الإلغاء: ${escapeHtml(order.cancellationReason)}</p>` : ""}
      <div class="order-meta trip-dates">${order.acceptedAt?.seconds ? `<span>القبول: ${new Date(order.acceptedAt.seconds*1000).toLocaleString("ar-IQ")}</span>` : ""}${order.completedAt?.seconds ? `<span>الإكمال: ${new Date(order.completedAt.seconds*1000).toLocaleString("ar-IQ")}</span>` : ""}</div>
    </div>`;
}

function driverCard(driver) {
  const rating = ratingSummary(driver.firestoreId);
  const trips = driverTripSummary(driver.firestoreId);
  const driverOrders = state.orders.filter(order => order.driverId === driver.firestoreId)
    .sort((a,b) => Number(b.acceptedAt?.seconds || b.createdAt?.seconds || 0) - Number(a.acceptedAt?.seconds || a.createdAt?.seconds || 0));
  const completedOrders = driverOrders.filter(o => !o.cancelled && Number(o.statusIndex || 0) >= 4);
  const activeOrders = driverOrders.filter(o => !o.cancelled && Number(o.statusIndex || 0) < 4);
  const cancelledOrders = driverOrders.filter(o => o.cancelled === true);
  const captainBalance = completedOrders.reduce((sum,o) => sum + Number(o.driverEarnings || 0), 0);
  const blocked = driver.blocked === true;
  const status = blocked ? "محظور" : driver.online ? "متصل" : "غير متصل";
  const statusClass = blocked ? "rejected" : driver.online ? "approved" : "pending";
  const warningCount = Number(driver.warningCount || 0);
  const blockAction = blocked
    ? `<button class="secondary" data-action="unblock-driver" data-id="${driver.firestoreId}">إعادة التفعيل</button>`
    : `<button class="danger" data-action="block-driver" data-id="${driver.firestoreId}">حظر الكابتن</button>`;
  return `
    <article class="order-card driver-management-card captain-account-card">
      <div class="order-top">
        <h3>${captainServiceIcon(driver)} ${escapeHtml(driver.name || "كابتن كروة")}</h3>
        <span class="status-chip ${statusClass}">${status}</span>
      </div>
      <div class="captain-profile-grid">
        <span><small>رقم الهاتف</small><b>${escapeHtml(driver.phone || "بدون هاتف")}</b></span>
        <span><small>البريد</small><b>${escapeHtml(driver.email || "-")}</b></span>
        <span><small>المدينة</small><b>${escapeHtml(driver.city || "-")}</b></span>
        <span><small>نوع الخدمة</small><b>${captainServiceLabel(driver)}</b></span>
        <span><small>المركبة</small><b>${escapeHtml(driver.vehicleType || "-")}</b></span>
        <span><small>رقم اللوحة</small><b>${escapeHtml(driver.plate || "-")}</b></span>
        ${!isBikeVehicle(driver) ? `<span><small>السيارة / الموديل</small><b>${escapeHtml(driver.vehicleMake || "-")} ${escapeHtml(driver.vehicleModel || "")}</b></span><span><small>حالة السيارة</small><b>${escapeHtml(driver.vehicleCondition || "غير محددة")}</b></span>` : `<span><small>نطاق العمل</small><b>توصيل أغراض وطعام</b></span>`}
      </div>
      <div class="captain-balance"><small>رصيد الكابتن من الرحلات المكتملة</small><strong>${money(captainBalance)}</strong></div>
      <div class="order-meta driver-trip-stats">
        <span><strong>${trips.completed}</strong> مكتملة</span>
        <span><strong>${trips.cancelled}</strong> ملغاة</span>
        <span><strong>${trips.active}</strong> جارية</span>
        <span><strong>${trips.total}</strong> إجمالي الرحلات</span>
      </div>
      <div class="reputation-row"><span class="stars">★ ${rating.count ? rating.average.toFixed(1) : "جديد"}</span><span>${rating.count} تقييم</span><span class="warning-count">⚠ ${warningCount} تنبيه</span></div>
      <div class="captain-trip-groups">
        <details ${activeOrders.length ? "open" : ""}><summary>الرحلات الجارية <b>${activeOrders.length}</b></summary><div class="captain-trip-list">${activeOrders.length ? activeOrders.map(driverTripDetail).join("") : `<p class="muted">لا توجد رحلات جارية.</p>`}</div></details>
        <details><summary>الرحلات المكتملة <b>${completedOrders.length}</b></summary><div class="captain-trip-list">${completedOrders.length ? completedOrders.map(driverTripDetail).join("") : `<p class="muted">لا توجد رحلات مكتملة.</p>`}</div></details>
        <details><summary>الرحلات الملغاة <b>${cancelledOrders.length}</b></summary><div class="captain-trip-list">${cancelledOrders.length ? cancelledOrders.map(driverTripDetail).join("") : `<p class="muted">لا توجد رحلات ملغاة.</p>`}</div></details>
      </div>
      ${driver.warningMessage ? `<p class="admin-note">آخر تنبيه: ${escapeHtml(driver.warningMessage)}</p>` : ""}
      ${blocked && driver.blockReason ? `<p class="admin-note danger-note">سبب الحظر: ${escapeHtml(driver.blockReason)}</p>` : ""}
      <div class="order-actions"><button class="secondary" data-action="warn-driver" data-id="${driver.firestoreId}">إرسال تنبيه</button>${blockAction}</div>
    </article>`;
}
function renderDrivers() {
  const sorted = [...state.drivers].sort((a, b) => {
    if (a.blocked === true && b.blocked !== true) return -1;
    if (b.blocked === true && a.blocked !== true) return 1;
    const completedDiff = driverTripSummary(b.firestoreId).completed - driverTripSummary(a.firestoreId).completed;
    if (completedDiff) return completedDiff;
    return String(a.name || "").localeCompare(String(b.name || ""), "ar");
  });
  byId("driversList").innerHTML = sorted.length
    ? sorted.map(driverCard).join("")
    : `<div class="empty"><span>🚕</span>لا يوجد كباتن معتمدون بعد.</div>`;
}

function renderRatings() {
  const sorted = [...state.ratings].sort((a, b) =>
    Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0)
  ).slice(0, 12);
  byId("ratingsList").innerHTML = sorted.length
    ? sorted.map(rating => `
      <article class="review-card">
        <div><strong>${escapeHtml(rating.driverName || "كابتن كروة")}</strong><small>${escapeHtml(rating.orderCode || "")}</small></div>
        <span class="stars" aria-label="${Number(rating.score || 0)} من 5">${"★".repeat(Number(rating.score || 0))}${"☆".repeat(5 - Number(rating.score || 0))}</span>
        ${rating.comment ? `<p>${escapeHtml(rating.comment)}</p>` : ""}
      </article>`).join("")
    : `<div class="empty"><span>★</span>لا توجد تقييمات بعد.</div>`;
}

function applicationCard(application) {
  const status = application.status || "pending";
  const labels = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
  const complete = application.profileComplete !== false;
  const actions = status === "pending" ? `<div class="order-actions"><button class="primary" data-action="approve" data-id="${application.firestoreId}" ${complete ? "" : 'disabled title="بانتظار إكمال بيانات الكابتن"'}>${complete ? "قبول وتفعيل" : "بانتظار إكمال البيانات"}</button><button class="danger" data-action="reject" data-id="${application.firestoreId}">رفض</button></div>` : "";
  return `<article class="order-card"><div class="order-top"><h3>${captainServiceIcon(application)} ${escapeHtml(application.name)}</h3><span class="status-chip ${status}">${labels[status] || escapeHtml(status)}</span></div><p class="order-route">${escapeHtml(application.city)} • ${escapeHtml(application.vehicleType)} • ${escapeHtml(application.plate)}</p><div class="order-meta"><span>الخدمة: <b>${captainServiceLabel(application)}</b></span></div>${!isBikeVehicle(application) ? `<div class="order-meta"><span>السيارة: ${escapeHtml(application.vehicleMake || "-")} ${escapeHtml(application.vehicleModel || "")}</span><span>الحالة: ${escapeHtml(application.vehicleCondition || "غير محددة")}</span></div>` : `<div class="order-meta"><span>دراجة — توصيل أغراض وطعام فقط</span></div>`}<div class="order-meta"><span>${escapeHtml(application.phone)}</span><span>${escapeHtml(application.email)}</span></div>${actions}</article>`;
}
function renderApplications() {
  const sorted = state.applications.filter(item => normalizeCaptainServiceType(item) !== "other").sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return String(b.submittedAt?.seconds || "").localeCompare(String(a.submittedAt?.seconds || ""));
  });
  byId("applicationsList").innerHTML = sorted.length
    ? sorted.map(applicationCard).join("")
    : `<div class="empty"><span>🚘</span>لا توجد طلبات انضمام بعد.</div>`;
}

const serviceCategoryLabels = {
  restaurant: "مطعم ومأكولات",
  grocery: "بقالة ومتجر غذائي",
  retail: "تسوق ومنتجات",
  maintenance: "صيانة وإصلاح",
  home: "خدمات منزلية",
  health: "صحة وعناية",
  other: "خدمة أخرى"
};

function serviceApplicationCard(application) {
  const status = application.status || "pending";
  const labels = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
  const source = application.legacy ? "legacy" : "service";
  const restaurant = state.restaurants.find(item => item.firestoreId === application.firestoreId || item.ownerId === application.userId);
  const profile = state.serviceProfiles.find(item => item.firestoreId === application.firestoreId || item.ownerId === application.userId);
  const category = application.category || profile?.category || (restaurant ? "restaurant" : "other");
  const businessName = application.businessName || profile?.businessName || restaurant?.name || application.name || "مزود خدمة";
  const ownerName = application.ownerName || application.name || "—";
  const address = application.address || profile?.address || restaurant?.address || "—";
  const location = application.location || profile?.location || restaurant?.location;
  const gps = location?.latitude != null && location?.longitude != null ? `${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}` : "غير محدد";
  const items = profile?.items || restaurant?.meals || [];
  const hasLocation = Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
  const actions = status === "pending" ? `<div class="order-actions"><button class="primary" data-action="approve-service" data-source="${source}" data-id="${application.firestoreId}" ${hasLocation ? "" : 'disabled title="يجب أن يحدد المزود موقع GPS أولًا"'}>${hasLocation ? "قبول وتفعيل" : "GPS مطلوب قبل القبول"}</button><button class="danger" data-action="reject-service" data-source="${source}" data-id="${application.firestoreId}">رفض مع ملاحظة</button></div>` : "";
  return `<article class="order-card service-application-card">
    <div class="order-top"><h3>🧰 ${escapeHtml(businessName)}</h3><span class="status-chip ${status}">${labels[status] || escapeHtml(status)}</span></div>
    <p class="order-route">${escapeHtml(serviceCategoryLabels[category] || serviceCategoryLabels.other)} • ${escapeHtml(application.city || profile?.city || "—")}</p>
    <div class="order-meta"><span>صاحب الخدمة: ${escapeHtml(ownerName)}</span><span>الهاتف: ${escapeHtml(application.phone || profile?.phone || restaurant?.phone || "—")}</span></div>
    <div class="order-meta"><span>البريد: ${escapeHtml(application.email || "—")}</span><span>العنوان: ${escapeHtml(address)}</span><span>GPS: ${escapeHtml(gps)}</span></div>
    ${application.description ? `<p class="admin-note">${escapeHtml(application.description)}</p>` : ""}
    <div class="order-meta"><span>العناصر المضافة: ${Array.isArray(items) ? items.length : 0}</span>${application.legacy ? `<span>طلب قديم — مدعوم تلقائيًا</span>` : ""}</div>
    ${application.reviewNote ? `<p class="admin-note danger-note">ملاحظة المراجعة: ${escapeHtml(application.reviewNote)}</p>` : ""}
    ${actions}
  </article>`;
}

function renderServiceApplications() {
  const modernIds = new Set(state.serviceApplications.map(item => item.firestoreId));
  const legacyApplications = state.applications
    .filter(item => item.serviceType === "other" && !modernIds.has(item.firestoreId))
    .map(item => ({ ...item, legacy: true }));
  const sorted = [...state.serviceApplications, ...legacyApplications].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return Number(b.submittedAt?.seconds || b.updatedAt?.seconds || 0) - Number(a.submittedAt?.seconds || a.updatedAt?.seconds || 0);
  });
  byId("serviceApplicationsList").innerHTML = sorted.length
    ? sorted.map(serviceApplicationCard).join("")
    : `<div class="empty"><span>🧰</span>لا توجد طلبات مزودي خدمات بعد.</div>`;
}

function orderCard(order) {
  const statusIndex = Number(order.statusIndex || 0);
  const status = order.cancelled ? "ملغي" : statuses[statusIndex] || "غير معروف";
  const statusClass = order.cancelled ? "cancelled" : statusIndex >= 4 ? "complete" : "active";
  const cancel = !order.cancelled && statusIndex < 4
    ? `<div class="order-actions"><button class="danger" data-action="cancel-order" data-id="${order.firestoreId}">إلغاء إداري</button></div>`
    : "";
  return `
    <article class="order-card">
      <div class="order-top">
        <h3>${icons[order.type] || "🧾"} ${escapeHtml(order.title)}</h3>
        <span class="status-chip ${statusClass}">${escapeHtml(status)}</span>
      </div>
      <p class="order-route">${escapeHtml(order.route)}</p>
      <div class="order-bottom">
        <div class="order-meta">
          <span>${escapeHtml(order.id)}</span>
          <span>${order.driverName ? `الكابتن: ${escapeHtml(order.driverName)}` : "بانتظار كابتن"}</span>
        </div>
        <span class="order-price">${money(order.price)}</span>
        ${order.type==="ride"?`<div class="order-meta"><span>المسافة ${Number(order.distanceKm||0).toFixed(1)} كم</span><span>وقت الطريق ${Math.round(Number(order.durationMin||0))} د</span><span>ازدحام ${escapeHtml(order.congestion||"—")} ×${Number(order.trafficMultiplier||1).toFixed(2)}</span></div>`:""}
        ${Number(order.surgeMultiplier||1)>1?`<div class="order-meta"><span>طلب مرتفع ×${Number(order.surgeMultiplier).toFixed(2)}</span></div>`:""}
        ${Number(order.discountAmount||0)>0?`<div class="order-meta"><span>خصم ${money(order.discountAmount)}</span><span>${escapeHtml(order.couponCode||"")}</span></div>`:""}
        ${Array.isArray(order.dispatchCandidateIds)?`<div class="order-meta"><span>مرشحو التوزيع: ${order.dispatchCandidateIds.length}</span><span>الجولة ${Number(order.dispatchRound||1)}</span></div>`:""}
        ${Number(order.statusIndex||0)>=4&&!order.cancelled?`<div class="order-meta"><span>عمولة كروة: ${money(order.commissionAmount)}</span><span>صافي الكابتن: ${money(order.driverEarnings)}</span></div>`:""}
      </div>
      ${order.cancelled && order.cancellationReason ? `<p class="admin-note danger-note">سبب الإلغاء: ${escapeHtml(order.cancellationReason)}</p>` : ""}
      ${order.acceptedAt ? `<div class="order-meta"><span>قبول: ${new Date(order.acceptedAt.seconds*1000).toLocaleString("ar-IQ")}</span>${order.completedAt ? `<span>إكمال: ${new Date(order.completedAt.seconds*1000).toLocaleString("ar-IQ")}</span>` : ""}</div>` : ""}
      ${cancel}
    </article>`;
}

function renderOrders() {
  const waiting = state.orders.filter(order =>
    !order.cancelled && !order.driverId && Number(order.statusIndex || 0) === 0
  );
  const sorted = [...waiting].sort((a, b) =>
    String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || ""))
  );
  byId("ordersList").innerHTML = sorted.length
    ? sorted.map(orderCard).join("")
    : `<div class="empty"><span>✅</span>لا توجد طلبات بانتظار كابتن حالياً.</div>`;
}
function repairLegacyCaptainService(collectionName, record) {
  const normalized = normalizeCaptainServiceType(record);
  if (!["taxi", "delivery"].includes(normalized) || record.serviceType === normalized) return;
  // تصحيح آمن للسجلات القديمة: الدراجة/قيم التوصيل الوصفية تصبح delivery بدل أن تبقى محسوبة كتكسي.
  updateDoc(doc(db, collectionName, record.firestoreId), {
    serviceType: normalized,
    updatedAt: serverTimestamp()
  }).catch(error => console.warn("تعذر تصحيح نوع خدمة الكابتن القديم", record.firestoreId, error));
}

function openDashboard() {
  clearDashboardListeners();
  showView("dashboard");
  const usersUnsubscribe = onSnapshot(collection(db, "users"), snapshot => {
    state.users = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderAccounts();
    renderMetrics();
  });
  const applicationsUnsubscribe = onSnapshot(collection(db, "driverApplications"), snapshot => {
    state.applications = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    state.applications.forEach(item => repairLegacyCaptainService("driverApplications", item));
    renderApplications();
    renderServiceApplications();
    renderMetrics();
  });
  const serviceApplicationsUnsubscribe = onSnapshot(collection(db, "serviceApplications"), snapshot => {
    state.serviceApplications = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderServiceApplications();
    renderMetrics();
  });
  const serviceProfilesUnsubscribe = onSnapshot(collection(db, "serviceProfiles"), snapshot => {
    state.serviceProfiles = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderServiceApplications();
    renderMetrics();
  });
  const restaurantsUnsubscribe = onSnapshot(collection(db, "restaurants"), snapshot => {
    state.restaurants = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderServiceApplications();
  });
  const ordersUnsubscribe = onSnapshot(collection(db, "orders"), snapshot => {
    state.orders = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderOrders();
    renderDrivers();
    renderMetrics();
  });
  const driversUnsubscribe = onSnapshot(collection(db, "drivers"), snapshot => {
    state.drivers = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    state.drivers.forEach(item => repairLegacyCaptainService("drivers", item));
    renderDrivers();
    renderMetrics();
  });
  const topupsUnsubscribe = onSnapshot(collection(db, "topupRequests"), snapshot => { state.topupRequests = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id })); renderTopupRequests(); });
  const pricingUnsubscribe = onSnapshot(doc(db, "platformSettings", "pricing"), snapshot => { state.pricingSettings = snapshot.exists() ? snapshot.data() : null; renderPricingSettings(); });
  const paymentsUnsubscribe = onSnapshot(doc(db, "platformSettings", "payments"), snapshot => { state.paymentSettings = snapshot.exists() ? snapshot.data() : null; renderPaymentSettings(); });
  const ratingsUnsubscribe = onSnapshot(collection(db, "ratings"), snapshot => {
    state.ratings = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderDrivers();
    renderRatings();
  });
  state.dashboardUnsubscribes.push(
    usersUnsubscribe,
    applicationsUnsubscribe,
    serviceApplicationsUnsubscribe,
    serviceProfilesUnsubscribe,
    restaurantsUnsubscribe,
    ordersUnsubscribe,
    driversUnsubscribe,
    topupsUnsubscribe, pricingUnsubscribe, paymentsUnsubscribe,
    ratingsUnsubscribe
  );
}

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.user) return;
  const id = button.dataset.id;
  busy(button, true);
  try {
    if (button.dataset.action === "approve-topup" || button.dataset.action === "reject-topup") {
      const topup=state.topupRequests.find(x=>x.firestoreId===id);if(!topup)throw new Error("NOT_FOUND");
      if(button.dataset.action === "approve-topup"){const received=Number(prompt(`المبلغ المطلوب ${money(topup.amount)}. أدخل المبلغ الذي وصل فعليًا إلى بطاقتك:`,String(Number(topup.amount||0)))||0);if(!Number.isFinite(received)||received<=0){toast("أدخل مبلغًا صحيحًا");return;}if(!confirm(`سيضاف ${money(received)} إلى رصيد العميل. تأكيد؟`))return;await reviewTopupFirestore(id,"approve",received);toast(`تمت إضافة ${money(received)} إلى رصيد العميل`);}
      else {const note=prompt("سبب الرفض (اختياري)","")||"";await reviewTopupFirestore(id,"reject",0,note);toast("تم رفض طلب الشحن");}
    } else if (button.dataset.action === "delete-account") {
      const account = state.users.find(item => item.firestoreId === id);
      if (!account) throw new Error("NOT_FOUND");
      if (account.role === "admin" || id === state.user.uid) { toast("حساب الإدارة محمي من الحذف"); return; }
      const name = account.name || account.email || "هذا الحساب";
      const confirmation = prompt(`سيتم تعطيل ${name} نهائيًا داخل كروة وحذف بيانات Firestore المرتبطة. حساب Firebase Authentication نفسه سيبقى موجودًا في نسخة Firestore-only.\n\nاكتب كلمة حذف للتأكيد:`)?.trim();
      if (confirmation !== "حذف") { toast("تم إلغاء الحذف"); return; }
      button.textContent = "جاري التعطيل والتنظيف…";
      const result = await disableAndCleanAccountFirestore(id);
      toast(`تم تعطيل الحساب وحذف بيانات Firestore المرتبطة • ${result.deletedDocuments} سجل`);
    } else if (button.dataset.action === "approve-service") {
      const legacy = button.dataset.source === "legacy";
      const application = legacy
        ? state.applications.find(item => item.firestoreId === id && normalizeCaptainServiceType(item) === "other")
        : state.serviceApplications.find(item => item.firestoreId === id);
      if (!application) throw new Error("NOT_FOUND");
      const existingProfile = state.serviceProfiles.find(item => item.firestoreId === id || item.ownerId === id);
      const restaurant = state.restaurants.find(item => item.firestoreId === id || item.ownerId === id);
      const category = application.category || existingProfile?.category || (restaurant ? "restaurant" : "other");
      const businessName = application.businessName || existingProfile?.businessName || restaurant?.name || application.name || "مزود خدمة";
      const ownerName = application.ownerName || application.name || "";
      const phone = application.phone || existingProfile?.phone || restaurant?.phone || "";
      const address = application.address || existingProfile?.address || restaurant?.address || "";
      const location = application.location || existingProfile?.location || restaurant?.location || null;
      if (!Number.isFinite(Number(location?.latitude)) || !Number.isFinite(Number(location?.longitude))) {
        toast("لا يمكن اعتماد النشاط قبل أن يحدد مزود الخدمة موقع GPS.");
        return;
      }
      const items = Array.isArray(existingProfile?.items) ? existingProfile.items : Array.isArray(restaurant?.meals) ? restaurant.meals : [];
      const batch = writeBatch(db);
      batch.update(doc(db, legacy ? "driverApplications" : "serviceApplications", id), {
        status: "approved",
        reviewNote: "",
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "users", id), { role: "serviceProvider", updatedAt: serverTimestamp() }, { merge: true });
      batch.set(doc(db, "serviceProfiles", id), {
        ownerId: id,
        ownerName,
        businessName,
        category,
        phone,
        city: application.city || existingProfile?.city || "",
        address,
        description: application.description || existingProfile?.description || "",
        location,
        items,
        active: true,
        approvalStatus: "approved",
        approvedBy: state.user.uid,
        approvedAt: serverTimestamp(),
        createdAt: existingProfile?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      if (category === "restaurant") {
        const restaurantPayload = {
          ownerId: id,
          name: businessName,
          phone,
          address,
          meals: items,
          active: true,
          approvalStatus: "approved",
          approvedBy: state.user.uid,
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        if (location) restaurantPayload.location = location;
        batch.set(doc(db, "restaurants", id), restaurantPayload, { merge: true });
      }
      await batch.commit();
      toast("تم قبول مزود الخدمة وفتح لوحته الخاصة");
    } else if (button.dataset.action === "reject-service") {
      const note = prompt("سبب الرفض أو البيانات المطلوب تعديلها:", "يرجى استكمال بيانات النشاط")?.trim();
      if (!note) return;
      const legacy = button.dataset.source === "legacy";
      const application = legacy
        ? state.applications.find(item => item.firestoreId === id && normalizeCaptainServiceType(item) === "other")
        : state.serviceApplications.find(item => item.firestoreId === id);
      if (!application) throw new Error("NOT_FOUND");
      if (application.profileComplete === false) { toast("لا يمكن اعتماد الكابتن قبل إكمال بيانات الطلب"); return; }
      const batch = writeBatch(db);
      batch.update(doc(db, legacy ? "driverApplications" : "serviceApplications", id), {
        status: "rejected",
        reviewNote: note.slice(0, 300),
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      if (legacy) {
        batch.set(doc(db, "restaurants", id), {
          active: false,
          approvalStatus: "rejected",
          reviewNote: note.slice(0, 300),
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
      await batch.commit();
      toast("تم رفض الطلب وإرسال الملاحظة لمزود الخدمة");
    } else if (button.dataset.action === "approve") {
      const application = state.applications.find(item => item.firestoreId === id);
      if (!application) throw new Error("NOT_FOUND");
      const normalizedServiceType = normalizeCaptainServiceType(application);
      if (!["taxi", "delivery"].includes(normalizedServiceType)) {
        toast("نوع خدمة الكابتن غير صالح للاعتماد. اختر تكسي أو توصيل.");
        return;
      }
      // الدراجة تُعامل دائمًا كتوصيل، كما يتم توحيد أي قيمة قديمة مثل «توصيل أغراض وطعام» إلى delivery.
      const batch = writeBatch(db);
      batch.update(doc(db, "driverApplications", id), {
        serviceType: normalizedServiceType,
        status: "approved",
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "users", id), {
        role: "driver",
        updatedAt: serverTimestamp()
      }, { merge: true });
      batch.set(doc(db, "drivers", id), {
        userId: id, name: application.name, email: application.email, phone: application.phone,
        serviceType: normalizedServiceType, vehicleType: application.vehicleType,
        vehicleMake: application.vehicleMake || "", vehicleModel: application.vehicleModel || "",
        vehicleCondition: application.vehicleCondition || "", plate: application.plate, city: application.city,
        online: false, blocked: false, warningCount: 0, warningMessage: "",
        approvedAt: serverTimestamp(), updatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      toast("تم قبول الكابتن وتفعيل حسابه");
    } else if (button.dataset.action === "reject") {
      const note = prompt("سبب الرفض أو المطلوب تعديله:", "يرجى مراجعة بيانات المركبة")?.trim();
      if (!note) return;
      const rejectBatch = writeBatch(db);
      rejectBatch.update(doc(db, "driverApplications", id), {
        status: "rejected",
        reviewNote: note,
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await rejectBatch.commit();
      toast("تم رفض الطلب مع إرسال الملاحظة");
    } else if (button.dataset.action === "warn-driver") {
      const note = prompt("اكتب التنبيه الذي سيظهر للكابتن:", "يرجى الالتزام بسياسة الخدمة")?.trim();
      if (!note) return;
      await updateDoc(doc(db, "drivers", id), {
        warningCount: increment(1),
        warningMessage: note.slice(0, 300),
        lastWarnedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تم إرسال التنبيه للكابتن");
    } else if (button.dataset.action === "block-driver") {
      const reason = prompt("اكتب سبب حظر الكابتن:", "مخالفة سياسة الخدمة")?.trim();
      if (!reason) return;
      await updateDoc(doc(db, "drivers", id), {
        blocked: true,
        online: false,
        blockReason: reason.slice(0, 300),
        blockedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تم حظر الكابتن وإيقاف استقبال الطلبات");
    } else if (button.dataset.action === "unblock-driver") {
      if (!confirm("هل تريد إعادة تفعيل هذا الكابتن؟")) return;
      await updateDoc(doc(db, "drivers", id), {
        blocked: false,
        online: false,
        blockReason: "",
        unblockedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تمت إعادة تفعيل الكابتن");
    } else if (button.dataset.action === "cancel-order") {
      if (!confirm("هل تريد إلغاء هذا الطلب إداريًا؟")) return;
      await updateDoc(doc(db, "orders", id), {
        cancelled: true,
        cancelledBy: "admin",
        updatedAt: serverTimestamp()
      });
      toast("تم إلغاء الطلب");
    }
  } catch (error) {
    console.error(error);
    toast("تعذر تنفيذ العملية. تحقق من قواعد Firestore.");
  } finally {
    busy(button, false);
  }
});

onAuthStateChanged(auth, user => {
  state.user = user;
  if (state.roleUnsubscribe) state.roleUnsubscribe();
  clearDashboardListeners();
  if (!user) {
    showView("auth");
    return;
  }

  state.roleUnsubscribe = onSnapshot(doc(db, "users", user.uid), snapshot => {
    if (snapshot.exists() && snapshot.data().role === "admin") openDashboard();
    else showView("denied");
  }, error => {
    console.error(error);
    showView("denied");
  });
});
