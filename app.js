import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  runTransaction,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { requireNativeRegistrationDevice, addDeviceRegistrationWrites, enforceDeviceSession } from "./device-binding.js?v=85";

const firebaseConfig = {
  apiKey: "AIzaSyASl5jV5mLaDh8CoeeofV7ftVJ3gaog64E",
  authDomain: "karwa0.firebaseapp.com",
  projectId: "karwa0",
  storageBucket: "karwa0.firebasestorage.app",
  messagingSenderId: "485451054622",
  appId: "1:485451054622:web:ce9b0e2ff2280870a8780f"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

async function registerNativePushToken(user) {
  if (!user) return false;
  let token=""; try{token=String(window.KarwaNative?.getPushToken?.()||window.KarwaNotify?.getNativePushToken?.()||"").trim()}catch{}
  if (!token) return false;
  const id = `android_${token.slice(-36).replace(/[^a-zA-Z0-9_-]/g,"_")}`;
  try { await setDoc(doc(db,"users",user.uid,"pushTokens",id), { token, platform:"android", app:"karwa", role:"customer", updatedAt:serverTimestamp() }, { merge:true }); return true; }
  catch (error) { console.warn("تعذر تسجيل رمز إشعارات Android", error); return false; }
}
window.addEventListener("karwa-native-push-token", () => { if (auth.currentUser) registerNativePushToken(auth.currentUser); });


function firestoreErrorKey(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toUpperCase();
  const details = typeof error?.details === "string" ? error.details.toUpperCase() : String(error?.details?.message || error?.details?.code || "").toUpperCase();
  const haystack = `${message} ${details}`;
  const known = ["OUTSIDE_SERVICE_AREA","AUTH_REQUIRED","CUSTOMER_ONLY","INVALID_ROUTE","CANNOT_CANCEL","NOT_OWNER","ORDER_NOT_FOUND","BAD_TOKEN"];
  const named = known.find(key => haystack.includes(key));
  return { code, named, raw: haystack };
}

function customerFirestoreMessage(error, action = "تنفيذ العملية") {
  const e = firestoreErrorKey(error);
  if (e.named === "OUTSIDE_SERVICE_AREA") return "نقطة الانطلاق أو الوجهة خارج نطاق خدمة كروة الحالي.";
  if (e.named === "AUTH_REQUIRED" || e.code === "unauthenticated") return "انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى ثم أعد المحاولة.";
  if (e.named === "CUSTOMER_ONLY" || e.code === "permission-denied") return "هذا الحساب غير مخوّل لإنشاء طلب راكب. تحقق من نوع الحساب وصلاحياته.";
  if (e.named === "INVALID_ROUTE" || e.code === "invalid-argument") return "تعذر اعتماد المسار. أعد تحديد الانطلاق والوجهة وانتظر حساب المسافة والوقت.";
  if (e.code === "not-found") return "تعذر العثور على البيانات المطلوبة. حدّث الطلب وحاول مجددًا.";
  if (e.code === "unavailable" || e.code === "deadline-exceeded" || e.raw.includes("NETWORK") || !navigator.onLine) return "تعذر الوصول إلى خادم كروة. تحقق من الإنترنت ثم أعد المحاولة.";
  if (e.code === "failed-precondition") return `تعذر ${action} بسبب شرط في قاعدة البيانات. راجع بيانات الحساب والطلب.`;
  if (e.code === "internal" || e.code === "unknown") return `حدث خطأ أثناء ${action}. حاول مجددًا وتحقق من اتصال Firebase.`;
  return `تعذر ${action}. ${error?.message ? "التفاصيل: " + String(error.message).replace(/^FirebaseError:\s*/i, "") : "تحقق من إعدادات Firebase."}`;
}

const byId = id => document.getElementById(id);
const orderStatuses = [
  "بانتظار كابتن",
  "الكابتن في الطريق",
  "وصل الكابتن",
  "بدأت الرحلة",
  "تم الوصول"
];
const serviceIcons = { ride: "🚕", parcel: "📦", food: "🍽️", service: "🧰", serviceDelivery: "🛵" };
const CUSTOMER_MAP_STYLES = {
  // طابق المظهر النهاري مع خريطة الكابتن: ألوان أوضح وإظهار أفضل للطرق الجانبية.
  day: "https://tiles.openfreemap.org/styles/bright",
  night: "https://tiles.openfreemap.org/styles/dark"
};

const KARWA_CODE128_PATTERNS=["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
function karwaCode128Svg(value){
  const text=String(value||"").trim(); if(!/^\d{4}$/.test(text))return "";
  const codes=[104,...[...text].map(ch=>ch.charCodeAt(0)-32)];
  let checksum=104; for(let i=1;i<codes.length;i++)checksum+=codes[i]*i; codes.push(checksum%103,106);
  const quiet=11; let x=quiet; const bars=[];
  for(const code of codes){const pattern=KARWA_CODE128_PATTERNS[code]||""; for(let i=0;i<pattern.length;i++){const w=Number(pattern[i]); if(i%2===0)bars.push(`<rect x="${x}" y="2" width="${w}" height="46" rx=".25"/>`); x+=w;}}
  const width=x+quiet; return `<svg viewBox="0 0 ${width} 50" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" aria-hidden="true"><rect width="${width}" height="50" fill="#fff"/>${bars.join("")}<text x="${width/2}" y="49" text-anchor="middle" font-size="5.2" font-family="monospace" letter-spacing="1.4" fill="#23343f">${text}</text></svg>`;
}
function renderTripBarcode(value,visible){
  const wrap=byId("tripBarcodeWrap"), box=byId("tripBarcode"); if(!wrap||!box)return;
  const svg=visible?karwaCode128Svg(value):""; wrap.classList.toggle("hidden",!svg); box.innerHTML=svg;
}

function readCustomerPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}

function writeCustomerPreference(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

let customerRegistrationInProgress = false;

const state = {
  user: null,
  role: "customer",
  authMode: "login",
  vehicle: "اقتصادي",
  ridePrice: 0,
  payment: "نقدًا",
  cart: [],
  serviceCart: [],
  serviceEditDraftItems: [],
  restaurants: [],
  restaurantDraftMeals: [],
  restaurantGps: null,
  selectedMeal: null,
  unsubscribeRestaurants: null,
  serviceProfiles: [],
  selectedServiceProfile: null,
  serviceRequests: [],
  serviceDeliveryLocations: {},
  serviceEditRequestId: null,
  parcelEditOrderId: null,
  unsubscribeServiceProfiles: null,
  unsubscribeServiceRequests: null,
  orders: [],
  activeOrder: null,
  balance: 0,
  bonusBalance: 0,
  bonusExpiresAt: null,
  name: "ضيف",
  notifications: true,
  unsubscribeOrders: null,
  unsubscribeRatings: null,
  ratings: [],
  ratingOrderId: null,
  ratingContext: null,
  ratingScore: 0,
  ratingTags: [],
  trackingUnsubscribe: null,
  trackingOrderId: null,
  lastDriverTracking: null,
  customerTripWatchId: null,
  customerTripWatchOrderId: null,
  customerTripLastWrite: 0,
  customerAutoArrivalSince: 0,
  autoArrivalCompleting: false,
  map: null,
  baseLayer: null,
  mapTheme: readCustomerPreference("karwa.customer.mapTheme", "day") === "night" ? "night" : "day",
  mapView: readCustomerPreference("karwa.customer.mapView", "2d") === "3d" ? "3d" : "2d",
  autoFollow: readCustomerPreference("karwa.customer.autoFollow", "true") !== "false",
  mapSearchMarker: null,
  mapSearchSelection: null,
  customerMarker: null,
  serviceMarker: null,
  driverMarker: null,
  driverMarkerStyle: "car",
  driverHeading: null,
  routeLine: null,
  customerLocation: null,
  pickupLocation: null,
  destinationLocation: null,
  pickupMarker: null,
  destinationMarker: null,
  bookingRouteLine: null,
  mapPickMode: "pickup",
  routeDistanceKm: 0,
  routeDurationMin: 0,
  routeSource: "",
  savedAddresses: [],
  centerPickActive: false,
  centerPickTimer: null,
  liveRouteTimer: null,
  lastLiveRouteAt: 0,
  lastLiveRoutePoint: null,
  driverAnimationFrame: null,
  profileRetryTimer: null,
  appSettings: {},
  topupRequests: [],
  unsubscribeTopups: null,
  referralCode: "",
  appliedCoupon: null,
  fareSubtotal: 0,
  trafficMultiplier: 1,
  trafficLabel: "طبيعي",
  routeRequestToken: 0,
  reverseRequestTokens: { pickup: 0, destination: 0 },
  routeDebounceTimer: null,
  mapTapLockedUntil: 0,
  locationRequestToken: 0
};

const formatMoney = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";
const DEFAULT_PLATFORM_FEES = {
  customerOrderFee: 250,
  customerTaxiFee: 250,
  customerDeliveryFee: 250,
  customerServiceFee: 250,
  providerOrderFee: 250,
  providerRestaurantFee: 250,
  providerServiceFee: 250,
  captainOrderFee: 250,
  captainTaxiFee: 250,
  captainDeliveryFee: 250,
  publishFee: 1000
};
const vehiclePricing = {
  "اقتصادي": { base: 1800, perKm: 650, perMin: 55, minimum: 3000, speedFactor: 1.08, perKmSetting: "ridePerKmEconomy" },
  "تكسي": { base: 2300, perKm: 800, perMin: 65, minimum: 4000, speedFactor: 1.00, perKmSetting: "ridePerKmTaxi" },
  "عائلي": { base: 3000, perKm: 980, perMin: 75, minimum: 5000, speedFactor: 1.05, perKmSetting: "ridePerKmFamily" }
};
function numericSetting(key,fallback,min=0,max=100000){const n=Number(state.appSettings?.[key]);return Math.max(min,Math.min(max,Number.isFinite(n)?n:fallback));}
function fixedPlatformFee(key){return Math.round(numericSetting(key,DEFAULT_PLATFORM_FEES[key]??0,0,100000));}
function customerOperationFee(kind){
  const legacy=fixedPlatformFee("customerOrderFee");
  if(kind==="ride")return Math.round(numericSetting("customerTaxiFee",legacy,0,100000));
  if(kind==="parcel")return Math.round(numericSetting("customerDeliveryFee",legacy,0,100000));
  return Math.round(numericSetting("customerServiceFee",legacy,0,100000));
}
function customerFeeSummary(){
  return `تكسي ${formatMoney(customerOperationFee("ride"))} • توصيل ${formatMoney(customerOperationFee("parcel"))} • مطاعم/خدمات ${formatMoney(customerOperationFee("service"))}`;
}
function vehiclePricingFor(vehicle){const base=vehiclePricing[vehicle]||vehiclePricing["اقتصادي"];return {...base,perKm:numericSetting(base.perKmSetting,base.perKm,0,10000)};}
function timestampMillis(value){if(!value)return 0;if(typeof value.toMillis==="function")return value.toMillis();if(Number.isFinite(Number(value?.seconds)))return Number(value.seconds)*1000;const t=new Date(value).getTime();return Number.isFinite(t)?t:0;}
function activeBonusAmount(data={}){const amount=Math.max(0,Number(data.bonusBalance||0));return amount>0&&timestampMillis(data.bonusExpiresAt)>Date.now()?amount:0;}
function walletAvailable(data={balance:state.balance,bonusBalance:state.bonusBalance,bonusExpiresAt:state.bonusExpiresAt}){return Math.max(0,Number(data.balance||0))+activeBonusAmount(data);}
function walletDebitPatch(data,amount){const fee=Math.max(0,Math.round(Number(amount||0)));const paid=Math.max(0,Number(data.balance||0));const bonus=activeBonusAmount(data);if(paid+bonus<fee)return null;const useBonus=Math.min(bonus,fee);const paidDebit=fee-useBonus;return {balance:paid-paidDebit,bonusBalance:Math.max(0,Number(data.bonusBalance||0)-useBonus),updatedAt:serverTimestamp()};}
function applyWalletPatchToState(patch){if(!patch)return;state.balance=Number(patch.balance??state.balance);state.bonusBalance=Number(patch.bonusBalance??state.bonusBalance);renderBalance();}
function signupBonusFields(settings=state.appSettings||{}){const enabled=settings.signupBonusEnabled!==false;const amount=enabled?Math.max(0,Math.round(Number(settings.signupBonusAmount??1000))):0;const hours=Math.max(1,Math.min(168,Math.round(Number(settings.signupBonusHours??24))));return {bonusBalance:amount,bonusExpiresAt:amount?new Date(Date.now()+hours*3600000-60000):null,welcomeBonusGranted:amount>0,welcomeBonusEvaluated:true};}
function haversineKm(a,b){const R=6371,toRad=v=>v*Math.PI/180;const dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function trafficProfile(km, mins) {
  if(!km || !mins) return {multiplier:1,label:"طبيعي",ratio:1};
  const freeFlow=Math.max(1,(km/42)*60);
  const ratio=Math.max(.75,mins/freeFlow);
  if(ratio<=1.12)return {multiplier:1,label:"خفيف",ratio};
  if(ratio<=1.35)return {multiplier:1.06,label:"متوسط",ratio};
  if(ratio<=1.7)return {multiplier:1.13,label:"مزدحم",ratio};
  return {multiplier:1.22,label:"ازدحام شديد",ratio};
}
function fareForVehicle(vehicle) {
  const cfg=vehiclePricingFor(vehicle);
  const traffic=trafficProfile(state.routeDistanceKm,state.routeDurationMin);
  const adjustedMinutes=state.routeDurationMin*Number(cfg.speedFactor||1);
  const raw=(cfg.base+state.routeDistanceKm*cfg.perKm+adjustedMinutes*cfg.perMin)*traffic.multiplier;
  return Math.max(cfg.minimum,Math.ceil(raw/250)*250);
}
function couponDiscountFor(subtotal) {
  const c=state.appliedCoupon; if(!c)return 0;
  if(c.minFare && subtotal<Number(c.minFare))return 0;
  let d=c.type==="fixed"?Number(c.value||0):subtotal*(Number(c.value||0)/100);
  if(Number(c.maxDiscount||0)>0)d=Math.min(d,Number(c.maxDiscount));
  return Math.max(0,Math.min(subtotal,Math.round(d/250)*250));
}
function updateVehicleFareCards(){
  const traffic=trafficProfile(state.routeDistanceKm,state.routeDurationMin);
  state.trafficMultiplier=traffic.multiplier; state.trafficLabel=traffic.label;
  document.querySelectorAll(".vehicle-button").forEach(button=>{
    const fare=state.routeDistanceKm?fareForVehicle(button.dataset.vehicle):Number(button.dataset.price||0);
    const small=button.querySelector("small");
    if(small){
      const eta=state.routeDurationMin?Math.max(1,Math.round(state.routeDurationMin*Number(vehiclePricingFor(button.dataset.vehicle).speedFactor||1))):0;
      small.innerHTML=state.routeDistanceKm?`<b>${formatMoney(fare)}</b><span>${eta} د • ${traffic.label}</span>`:`<b>من ${formatMoney(fare)}</b><span>حدد المسار للسعر الدقيق</span>`;
    }
  });
  const trafficEl=byId("rideTrafficInfo");
  if(trafficEl){
    const arrival=state.routeDurationMin?new Date(Date.now()+state.routeDurationMin*60000).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}):"—";
    trafficEl.textContent=state.routeDistanceKm?`الازدحام: ${traffic.label} • الوصول المتوقع ${arrival}`:"يظهر تقدير الازدحام ووقت الوصول بعد تحديد المسار";
  }
}
function calculateRidePrice(){
  if(!state.routeDistanceKm){
    state.fareSubtotal=0;state.ridePrice=0;
    if(byId("ridePrice"))byId("ridePrice").textContent="حدد المسار";
    updateVehicleFareCards();return;
  }
  const subtotal=fareForVehicle(state.vehicle);
  state.fareSubtotal=subtotal;
  const discount=couponDiscountFor(subtotal);
  state.ridePrice=Math.max(0,subtotal-discount);
  byId("ridePrice").textContent=formatMoney(state.ridePrice);
  if(byId("couponStatus")&&state.appliedCoupon)byId("couponStatus").textContent=`تم تطبيق ${state.appliedCoupon.code} • خصم ${formatMoney(discount)}`;
  updateVehicleFareCards();
}
function pointLabel(prefix,p){return p?.label || `${prefix} (${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})`;}
function cleanPlaceLabel(x){
  const a=x?.address||{}; const parts=[x?.name||a.amenity||a.shop||a.tourism||a.road,a.neighbourhood||a.suburb||a.quarter,a.city||a.town||a.village||a.county,a.state].filter(Boolean);
  return [...new Set(parts)].slice(0,4).join("، ") || x?.display_name || "موقع محدد";
}
async function reverseGeocode(lat,lng){
  try{const u=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`;const r=await fetch(u,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(6000)});if(!r.ok)throw 0;const x=await r.json();return cleanPlaceLabel(x);}catch(e){return null;}
}
function bookingIcon(type){if(!window.L)return null;return window.L.divIcon({className:"",html:`<div class="karwa-map-marker ${type}"><span>${type==="pickup"?"📍":"🏁"}</span></div>`,iconSize:[42,42],iconAnchor:[21,38]});}
function updateRouteSummary(){byId("routeSummary").children[0].textContent=`المسافة: ${state.routeDistanceKm?state.routeDistanceKm.toFixed(1)+" كم":"—"}`;byId("routeSummary").children[1].textContent=`الوقت: ${state.routeDurationMin?Math.round(state.routeDurationMin)+" دقيقة":"—"}`;byId("routeMode").textContent=state.routeSource==="valhalla"?"ملاحة Valhalla":state.routeSource==="osrm"?"مسار احتياطي OSRM":state.routeSource==="fallback"?"تقدير احتياطي مباشر":"اختر نقطتين من الخريطة";}

function decodeValhallaShape(encoded){let index=0,lat=0,lng=0,out=[];while(index<encoded.length){let b,shift=0,result=0;do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);lat+=(result&1)?~(result>>1):(result>>1);shift=0;result=0;do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);lng+=(result&1)?~(result>>1):(result>>1);out.push([lat/1e6,lng/1e6]);}return out;}
async function valhallaRoute(a,b,timeout=6500){const body={locations:[{lat:Number(a.latitude),lon:Number(a.longitude)},{lat:Number(b.latitude),lon:Number(b.longitude)}],costing:"auto",units:"kilometers",language:"ar-IQ",directions_options:{units:"kilometers",language:"ar-IQ"},alternates:1};const r=await fetch("https://valhalla1.openstreetmap.de/route",{method:"POST",headers:{"Content-Type":"application/json","X-Client-Id":"karwa0.app"},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error("VALHALLA_"+r.status);const x=await r.json(),leg=x.trip?.legs?.[0],sum=x.trip?.summary;if(!leg||!sum)throw new Error("VALHALLA_NO_ROUTE");return{coords:decodeValhallaShape(leg.shape),km:Number(sum.length||0),mins:Number(sum.time||0)/60,maneuvers:leg.maneuvers||[],provider:"Valhalla"};}
async function calculateBookingRoute(){
  if(!state.pickupLocation||!state.destinationLocation)return;
  initializeCustomerMap();
  const token=++state.routeRequestToken;
  const a={...state.pickupLocation},b={...state.destinationLocation}; let coords=null;
  try{const route=await valhallaRoute(a,b,5200);if(token!==state.routeRequestToken)return;state.routeDistanceKm=route.km;state.routeDurationMin=route.mins;state.routeSource="valhalla";coords=route.coords;}
  catch(primary){
    if(token!==state.routeRequestToken)return;
    try{const url=`https://router.project-osrm.org/route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;const r=await fetch(url,{signal:AbortSignal.timeout(4200)});if(!r.ok)throw 0;const data=await r.json(),route=data.routes?.[0];if(!route)throw 0;if(token!==state.routeRequestToken)return;state.routeDistanceKm=route.distance/1000;state.routeDurationMin=route.duration/60;state.routeSource="osrm";coords=route.geometry.coordinates.map(([lng,lat])=>[lat,lng]);}
    catch(e){if(token!==state.routeRequestToken)return;const straight=haversineKm(a,b);state.routeDistanceKm=straight*1.28;state.routeDurationMin=(state.routeDistanceKm/28)*60;state.routeSource="fallback";coords=[[a.latitude,a.longitude],[b.latitude,b.longitude]];}
  }
  if(token!==state.routeRequestToken||!state.map)return;
  if(state.bookingRouteLine)state.bookingRouteLine.setLatLngs(coords);else state.bookingRouteLine=window.L.polyline(coords,{color:"#087b75",weight:6,opacity:.92,lineCap:"round",interactive:false}).addTo(state.map);
  calculateRidePrice();updateRouteSummary();
}
function scheduleBookingRoute(){
  clearTimeout(state.routeDebounceTimer);
  state.routeDebounceTimer=setTimeout(()=>calculateBookingRoute().catch(console.warn),220);
}
async function setBookingPoint(type,lat,lng,label=""){
  initializeCustomerMap();
  const p={latitude:Number(lat),longitude:Number(lng),label:label||""};
  const input=byId(type==="pickup"?"rideFrom":"rideTo");
  if(!input)return;
  input.value=label||"جارٍ تحديد اسم المكان…";
  if(type==="pickup"){state.pickupLocation=p;state.customerLocation=p;if(state.pickupMarker)state.pickupMarker.setLatLng([p.latitude,p.longitude]);else state.pickupMarker=window.L.marker([p.latitude,p.longitude],{icon:bookingIcon("pickup"),draggable:true,riseOnHover:true}).addTo(state.map);state.pickupMarker.off("dragend").on("dragend",e=>{const q=e.target.getLatLng();setBookingPoint("pickup",q.lat,q.lng)});state.mapPickMode="destination";}
  else{state.destinationLocation=p;if(state.destinationMarker)state.destinationMarker.setLatLng([p.latitude,p.longitude]);else state.destinationMarker=window.L.marker([p.latitude,p.longitude],{icon:bookingIcon("destination"),draggable:true,riseOnHover:true}).addTo(state.map);state.destinationMarker.off("dragend").on("dragend",e=>{const q=e.target.getLatLng();setBookingPoint("destination",q.lat,q.lng)});}
  document.querySelectorAll(".map-pick-button").forEach(b=>b.classList.toggle("active",b.id===(state.mapPickMode==="pickup"?"pickRideFrom":"pickRideTo")));
  state.routeRequestToken++;
  scheduleBookingRoute();
  if(label){input.value=label;return;}
  const token=++state.reverseRequestTokens[type];
  const found=await reverseGeocode(p.latitude,p.longitude);
  if(token!==state.reverseRequestTokens[type])return;
  p.label=found||pointLabel(type==="pickup"?"نقطة الانطلاق":"الوجهة",p);
  input.value=p.label;
}


function showToast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.karwaToastTimer);
  window.karwaToastTimer = setTimeout(() => element.classList.remove("show"), 2800);
}

function requestCancellationReason(subject = "الطلب") {
  const value = prompt(`اكتب سبب إلغاء ${subject}. السبب مطلوب وسيظهر للإدارة:`, "") ;
  if (value === null) return null;
  const reason = String(value || "").trim();
  if (reason.length < 3) {
    showToast("يجب كتابة سبب واضح للإلغاء (3 أحرف على الأقل).");
    return null;
  }
  return reason.slice(0, 300);
}

function customerCancellationMeta(reason) {
  return {
    cancellationReason: reason,
    cancelledBy: "customer",
    cancelledByRole: "customer",
    cancelledByUserId: state.user?.uid || "",
    cancelledByName: state.name || state.user?.displayName || "عميل كروة",
    cancelledByEmail: state.user?.email || "",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function customerDriverMarkerSvg(style="car") {
  // Same north-facing shapes used by the captain map so the customer sees identical direction.
  if(style==="arrow") return `<svg viewBox="0 0 48 48" aria-hidden="true"><path class="marker-shadow" d="M24 3 39 40 24 33 9 40Z"/><path class="marker-fill" d="M24 5 36 36 24 30 12 36Z"/><path class="marker-accent" d="M24 9v20"/></svg>`;
  if(style==="bike") return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="marker-wheel" cx="24" cy="10" r="6"/><circle class="marker-wheel" cx="24" cy="38" r="6"/><path class="marker-stroke" d="M24 16v7m0 5v4M17 17h14M19 17l5 8 5-8M18 32h12M21 25h6"/><circle class="marker-accent-dot" cx="24" cy="25" r="4"/></svg>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path class="marker-shadow" d="M24 3c7 0 12 5 13 13l2 18c.5 6-3 10-9 10H18c-6 0-9.5-4-9-10l2-18C12 8 17 3 24 3Z"/><path class="marker-fill" d="M24 6c5.2 0 8.7 3.7 9.5 10l1.8 17.5c.3 3.9-1.6 6.5-5.8 6.5h-11c-4.2 0-6.1-2.6-5.8-6.5L14.5 16C15.3 9.7 18.8 6 24 6Z"/><path class="marker-stroke" d="M17 20h14M18 29h12"/><circle class="marker-light" cx="19" cy="11.5" r="2.2"/><circle class="marker-light" cx="29" cy="11.5" r="2.2"/><path class="marker-accent" d="M24 4v8"/></svg>`;
}
function customerDriverMarkerHtml(style="car"){
  const safe=["arrow","car","bike"].includes(style)?style:"car";
  return `<div class="karwa-live-vehicle marker-${safe}" data-marker-style="${safe}">${customerDriverMarkerSvg(safe)}</div>`;
}
function mapIcon(type, style="car") {
  if (!window.L) return null;
  if(type==="driver")return window.L.divIcon({className:"",html:customerDriverMarkerHtml(style),iconSize:[48,48],iconAnchor:[24,24]});
  const emoji = "●";
  return window.L.divIcon({
    className: "",
    html: `<div class="karwa-map-marker ${type}"><span>${emoji}</span></div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 38]
  });
}
function normalizeLiveHeading(value){const n=Number(value);return Number.isFinite(n)?((n%360)+360)%360:null;}
function customerCompassLabel(value){const h=normalizeLiveHeading(value);if(h===null)return "";return ["شمال","شمال شرق","شرق","جنوب شرق","جنوب","جنوب غرب","غرب","شمال غرب"][Math.round(h/45)%8];}
function updateCustomerDriverVisual(heading,style){
  const safe=["arrow","car","bike"].includes(style)?style:"car";
  if(state.driverMarkerStyle!==safe&&state.driverMarker){state.driverMarkerStyle=safe;state.driverMarker.setIcon(mapIcon("driver",safe));}
  const el=state.driverMarker?.getElement()?.querySelector(".karwa-live-vehicle"),h=normalizeLiveHeading(heading);
  if(el&&h!==null)el.style.setProperty("--vehicle-heading",`${h}deg`);
  if(h!==null)state.driverHeading=h;
}

function initializeCustomerMap() {
  if (!window.L || state.map) return;
  state.map = window.L.map("customerMap", { zoomControl: false, attributionControl: false, preferCanvas: true, zoomAnimation: true, fadeAnimation: false }).setView([36.34, 43.13], 13);
  window.L.control.zoom({position:"bottomleft"}).addTo(state.map);
  state.map.on("click", e => {
    if(state.centerPickActive)return;
    const now=performance.now(); if(now<state.mapTapLockedUntil)return; state.mapTapLockedUntil=now+180;
    setBookingPoint(state.mapPickMode,e.latlng.lat,e.latlng.lng).catch(console.warn);
  });
  state.map.on("move",()=>{if(!state.centerPickActive)return;clearTimeout(state.centerPickTimer);byId("mapCenterLabel").textContent="جارٍ تحديد العنوان…";state.centerPickTimer=setTimeout(async()=>{const c=state.map.getCenter();const name=await reverseGeocode(c.lat,c.lng);byId("mapCenterLabel").textContent=name||`الموقع: ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;},1250);});
  // خريطة متجهية بلا مفتاح API وبنفس نمط Bright/Dark المستخدم في صفحة الكابتن.
  state.baseLayer = window.L.maplibreGL({ style: CUSTOMER_MAP_STYLES[state.mapTheme] }).addTo(state.map);
  const maplibreMap = state.baseLayer.getMaplibreMap?.();
  maplibreMap?.on("style.load", () => window.setTimeout(applyCustomerNightLabels, 0));
  applyCustomerMapPreferences();
  window.setTimeout(applyCustomerNightLabels, 500);
}

function applyCustomerNightLabels() {
  if (state.mapTheme !== "night") return;
  const maplibreMap = state.baseLayer?.getMaplibreMap?.();
  const layers = maplibreMap?.getStyle?.()?.layers || [];
  layers.forEach(layer => {
    if (layer.type !== "symbol" || !layer.layout?.["text-field"]) return;
    try {
      maplibreMap.setPaintProperty(layer.id, "text-color", "#78ffd6");
      maplibreMap.setPaintProperty(layer.id, "text-halo-color", "#001f26");
      maplibreMap.setPaintProperty(layer.id, "text-halo-width", 1.8);
      maplibreMap.setPaintProperty(layer.id, "text-halo-blur", 0.35);
    } catch (_) {}
  });
}

function renderCustomerSettingsInfo() {
  const firstName = state.name.trim().split(" ")[0] || "ضيف";
  const firstLetter = Array.from(firstName)[0] || "ك";
  const activeOrders = state.orders.filter(order => !order.cancelled && Number(order.statusIndex || 0) < orderStatuses.length - 1).length;
  if (byId("customerSettingsAvatar")) byId("customerSettingsAvatar").textContent = firstLetter;
  if (byId("customerSettingsName")) byId("customerSettingsName").textContent = state.name || "ضيف";
  if (byId("customerSettingsEmail")) byId("customerSettingsEmail").textContent = state.user?.email || "سجّل الدخول لمزامنة الحساب";
  if (byId("customerSettingsAccountStatus")) byId("customerSettingsAccountStatus").textContent = state.user ? "✓ حساب متصل" : "وضع الزائر";
  if (byId("customerSettingsLocation")) byId("customerSettingsLocation").textContent = byId("cityLabel")?.textContent || "العراق";
  if (byId("customerSettingsBalance")) byId("customerSettingsBalance").textContent = formatMoney(state.balance || 0);
  if (byId("customerSettingsOrders")) byId("customerSettingsOrders").textContent = String(state.orders.length);
  if (byId("customerSettingsActiveOrders")) byId("customerSettingsActiveOrders").textContent = String(activeOrders);
  if (byId("customerSettingsLogout")) byId("customerSettingsLogout").hidden = !state.user;
}

function applyCustomerMapPreferences() {
  const home = byId("home");
  if (!home) return;
  home.classList.toggle("map-theme-night", state.mapTheme === "night");
  home.classList.toggle("map-view-3d", state.mapView === "3d");
  home.querySelectorAll("[data-customer-map-theme]").forEach(button => {
    const active = button.dataset.customerMapTheme === state.mapTheme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  home.querySelectorAll("[data-customer-map-view]").forEach(button => {
    const active = button.dataset.customerMapView === state.mapView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (byId("customerThemeValue")) byId("customerThemeValue").textContent = state.mapTheme === "night" ? "ليلي" : "نهاري";
  if (byId("customerMapViewValue")) byId("customerMapViewValue").textContent = state.mapView.toUpperCase();
  const follow = byId("customerAutoFollowSetting");
  if (follow) {
    follow.classList.toggle("on", state.autoFollow);
    follow.setAttribute("aria-checked", String(state.autoFollow));
  }
  window.setTimeout(() => state.map?.invalidateSize(), 390);
}

function setCustomerMapTheme(theme) {
  state.mapTheme = theme === "night" ? "night" : "day";
  writeCustomerPreference("karwa.customer.mapTheme", state.mapTheme);
  try {
    const maplibreMap = state.baseLayer?.getMaplibreMap?.();
    if (maplibreMap) maplibreMap.setStyle(CUSTOMER_MAP_STYLES[state.mapTheme]);
  }
  catch (error) { console.warn("تعذر تبديل نمط الخريطة فورًا", error); }
  applyCustomerMapPreferences();
  if (state.mapTheme === "night") window.setTimeout(applyCustomerNightLabels, 450);
  showToast(state.mapTheme === "night" ? "تم تفعيل الخريطة الليلية" : "تم تفعيل الخريطة النهارية");
}

function setCustomerMapView(mode) {
  state.mapView = mode === "3d" ? "3d" : "2d";
  writeCustomerPreference("karwa.customer.mapView", state.mapView);
  applyCustomerMapPreferences();
  showToast(state.mapView === "3d" ? "تم تفعيل منظور 3D" : "تم تفعيل عرض 2D");
}

function setCustomerLocation(latitude, longitude) {
  initializeCustomerMap();
  if (!state.map) return;
  state.customerLocation = { latitude, longitude };
  const point = [latitude, longitude];
  if (state.customerMarker) state.customerMarker.setLatLng(point);
  else state.customerMarker = window.L.marker(point, { icon: mapIcon("customer") })
    .addTo(state.map)
    .bindPopup("موقعك الحالي");
  if (state.autoFollow) state.map.setView(point, 15);
  drawLiveRoute();
}

function liveTargetForOrder(){
  const o=state.activeOrder, s=Number(o?.statusIndex||0);
  if(!o) return state.customerLocation;
  if(s>=3 && o.destinationLocation) return o.destinationLocation;
  return o.pickupLocation || state.customerLocation;
}
function liveDistanceText(km){return km<1?`${Math.max(1,Math.round(km*1000))} م`:`${km.toFixed(1)} كم`;}
function animateDriverMarker(point, heading=null, markerStyle="car"){
  const safe=["arrow","car","bike"].includes(markerStyle)?markerStyle:"car";
  if(!state.driverMarker){state.driverMarkerStyle=safe;state.driverMarker=window.L.marker(point,{icon:mapIcon("driver",safe),zIndexOffset:900}).addTo(state.map).bindPopup("موقع الكابتن");updateCustomerDriverVisual(heading,safe);return;}
  if(state.driverMarkerStyle!==safe){state.driverMarkerStyle=safe;state.driverMarker.setIcon(mapIcon("driver",safe));}
  const from=state.driverMarker.getLatLng(), to=window.L.latLng(point);
  if(state.driverAnimationFrame) cancelAnimationFrame(state.driverAnimationFrame);
  const started=performance.now(), duration=1850;
  const tick=now=>{const t=Math.min(1,(now-started)/duration),e=1-Math.pow(1-t,3);state.driverMarker.setLatLng([from.lat+(to.lat-from.lat)*e,from.lng+(to.lng-from.lng)*e]);updateCustomerDriverVisual(heading,safe);if(t<1)state.driverAnimationFrame=requestAnimationFrame(tick);};
  state.driverAnimationFrame=requestAnimationFrame(tick);
}
async function drawLiveRoute(force=false) {
  if (!state.map || !state.driverMarker) return;
  const target=liveTargetForOrder(); if(!target)return;
  const d=state.driverMarker.getLatLng(), now=Date.now();
  const moved=state.lastLiveRoutePoint?haversineKm({latitude:d.lat,longitude:d.lng},state.lastLiveRoutePoint):Infinity;
  if(!force && now-state.lastLiveRouteAt<12000 && moved<0.12)return;
  state.lastLiveRouteAt=now; state.lastLiveRoutePoint={latitude:d.lat,longitude:d.lng};
  let coords=[[d.lat,d.lng],[target.latitude,target.longitude]],km=haversineKm({latitude:d.lat,longitude:d.lng},target),mins=0,source="تقديري";
  try{const vr=await valhallaRoute({latitude:d.lat,longitude:d.lng},target,5000);coords=vr.coords;km=vr.km;mins=vr.mins;source="Valhalla";}catch(e){try{const u=`https://router.project-osrm.org/route/v1/driving/${d.lng},${d.lat};${target.longitude},${target.latitude}?overview=full&geometries=geojson`;const r=await fetch(u,{signal:AbortSignal.timeout(4500)}),x=await r.json(),route=x.routes?.[0];if(!route)throw 0;coords=route.geometry.coordinates.map(([lng,lat])=>[lat,lng]);km=route.distance/1000;mins=route.duration/60;source="OSRM احتياطي";}catch(_){mins=(km*1.28/28)*60;km*=1.28;source="تقدير مباشر";}}
  if(!mins)mins=(km/28)*60;
  if(state.routeLine)state.routeLine.setLatLngs(coords);else state.routeLine=window.L.polyline(coords,{color:"#087b75",weight:7,opacity:.94,lineCap:"round"}).addTo(state.map);
  byId("liveEta").textContent=`${Math.max(1,Math.round(mins))} دقيقة`; byId("liveDistance").textContent=liveDistanceText(km); byId("liveRouteSource").textContent=source;
  if(force)state.map.fitBounds(state.routeLine.getBounds(),{padding:[55,55],maxZoom:16});
}

function clearDriverLocation() {
  if (state.driverMarker && state.map) state.map.removeLayer(state.driverMarker);
  if (state.routeLine && state.map) state.map.removeLayer(state.routeLine);
  state.driverMarker = null;
  state.driverMarkerStyle = "car";
  state.driverHeading = null;
  state.routeLine = null;
}

function showDriverLocation(data) {
  state.lastDriverTracking = data ? { ...data } : null;
  initializeCustomerMap();
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!state.map || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const point = [latitude, longitude];
  const heading=normalizeLiveHeading(data.heading), markerStyle=["arrow","car","bike"].includes(data.markerStyle)?data.markerStyle:"car";
  animateDriverMarker(point,heading,markerStyle);
  const s=Number(state.activeOrder?.statusIndex||0);
  byId("mapInfoTitle").textContent = s>=3 ? "الرحلة متجهة إلى الوجهة" : "الكابتن يتحرك نحوك";
  const age=data.updatedAt?.toMillis?Math.max(0,Date.now()-data.updatedAt.toMillis()):0;
  const quality=Number(data.accuracy||0)>80?" • دقة GPS منخفضة":"";
  const direction=heading!==null?` • يتجه ${customerCompassLabel(heading)} (${Math.round(heading)}°)`:"";
  const speed=Number.isFinite(Number(data.speed))?` • ${Math.max(0,Math.round(Number(data.speed)*3.6))} كم/س`:"";
  byId("mapInfoText").textContent = `${age>30000?"آخر تحديث منذ "+Math.round(age/1000)+" ث":"الموقع مباشر"}${direction}${speed}${data.accuracy ? ` • دقة ${Math.round(data.accuracy)} م` : ""}${quality}`;
  drawLiveRoute(!state.routeLine);
  evaluateCustomerAutoArrival();
}


const AUTO_ARRIVAL_RADIUS_M = 120;
const AUTO_ARRIVAL_PAIR_M = 180;
const AUTO_ARRIVAL_DWELL_MS = 8000;
const AUTO_ARRIVAL_MAX_ACCURACY_M = 45;

function distanceMeters(a,b){
  if(!a||!b)return Infinity;
  return haversineKm({latitude:Number(a.latitude),longitude:Number(a.longitude)},{latitude:Number(b.latitude),longitude:Number(b.longitude)})*1000;
}
function currentAutoArrivalRide(){
  const order=state.activeOrder;
  const status=Number(order?.statusIndex||0);
  return order&&order.type==="ride"&&order.driverId&&!order.cancelled&&status===2&&order.destinationLocation?order:null;
}
function customerTrackingPointFromPosition(position){
  return {customerId:state.user?.uid||"",latitude:Number(position.coords.latitude),longitude:Number(position.coords.longitude),accuracy:Number(position.coords.accuracy||9999),updatedAt:serverTimestamp()};
}
async function writeCustomerTripPosition(position){
  const order=state.activeOrder;
  if(!state.user||!order?.firestoreId||order.type!=="ride"||!order.driverId||order.cancelled||Number(order.statusIndex||0)>=4)return;
  const accuracy=Number(position.coords?.accuracy||9999);
  if(!Number.isFinite(accuracy)||accuracy>AUTO_ARRIVAL_MAX_ACCURACY_M)return;
  const now=Date.now();
  if(now-state.customerTripLastWrite<5000)return;
  state.customerTripLastWrite=now;
  state.customerLocation={latitude:Number(position.coords.latitude),longitude:Number(position.coords.longitude),accuracy};
  await setDoc(doc(db,"orders",order.firestoreId,"customerTracking","current"),customerTrackingPointFromPosition(position),{merge:true}).catch(error=>console.warn("تعذر إرسال موقع العميل للرحلة",error));
  evaluateCustomerAutoArrival();
}
function stopCustomerTripLocationSharing(){
  if(state.customerTripWatchId!==null){
    try{if(window.KarwaGeo?.clearWatch)window.KarwaGeo.clearWatch(state.customerTripWatchId);else navigator.geolocation?.clearWatch?.(state.customerTripWatchId);}catch{}
  }
  state.customerTripWatchId=null;
  state.customerTripWatchOrderId=null;
  state.customerTripLastWrite=0;
  state.customerAutoArrivalSince=0;
}
function startCustomerTripLocationSharing(){
  const order=state.activeOrder;
  const eligible=order?.firestoreId&&order.type==="ride"&&order.driverId&&!order.cancelled&&Number(order.statusIndex||0)<4;
  if(!eligible){stopCustomerTripLocationSharing();return;}
  if(state.customerTripWatchId!==null&&state.customerTripWatchOrderId===order.firestoreId)return;
  stopCustomerTripLocationSharing();
  state.customerTripWatchOrderId=order.firestoreId;
  const onPosition=position=>{
    const accuracy=Number(position.coords?.accuracy||9999);
    if(!Number.isFinite(accuracy)||accuracy>AUTO_ARRIVAL_MAX_ACCURACY_M)return;
    state.customerLocation={latitude:Number(position.coords.latitude),longitude:Number(position.coords.longitude),accuracy};
    if(state.customerMarker)state.customerMarker.setLatLng([state.customerLocation.latitude,state.customerLocation.longitude]);
    writeCustomerTripPosition(position).catch(console.warn);
    evaluateCustomerAutoArrival();
  };
  const onError=error=>console.warn("تعذر تتبع موقع العميل أثناء الرحلة",error);
  try{
    if(window.KarwaGeo?.watchPosition){
      state.customerTripWatchId=window.KarwaGeo.watchPosition(onPosition,onError,{maxAccuracy:AUTO_ARRIVAL_MAX_ACCURACY_M});
    }else if(navigator.geolocation){
      state.customerTripWatchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    }
  }catch(error){console.warn("تعذر بدء تتبع العميل",error);}
}
function syncCustomerTripLocationSharing(){startCustomerTripLocationSharing();}

function autoArrivalGeometryOk(order,customerPoint,driverPoint){
  if(!order?.destinationLocation||!customerPoint||!driverPoint)return false;
  const ca=Number(customerPoint.accuracy||9999),da=Number(driverPoint.accuracy||9999);
  if(ca>AUTO_ARRIVAL_MAX_ACCURACY_M||da>AUTO_ARRIVAL_MAX_ACCURACY_M)return false;
  return distanceMeters(customerPoint,order.destinationLocation)<=AUTO_ARRIVAL_RADIUS_M
    && distanceMeters(driverPoint,order.destinationLocation)<=AUTO_ARRIVAL_RADIUS_M
    && distanceMeters(customerPoint,driverPoint)<=AUTO_ARRIVAL_PAIR_M;
}
async function autoCompleteTaxiFromCustomer(order){
  if(state.autoArrivalCompleting||!state.user||!order?.firestoreId)return;
  state.autoArrivalCompleting=true;
  try{
    const orderRef=doc(db,"orders",order.firestoreId);
    await runTransaction(db,async transaction=>{
      const driverTrackRef=doc(db,"orders",order.firestoreId,"tracking","current");
      const customerTrackRef=doc(db,"orders",order.firestoreId,"customerTracking","current");
      const [freshSnap,driverTrackSnap,customerTrackSnap]=await Promise.all([transaction.get(orderRef),transaction.get(driverTrackRef),transaction.get(customerTrackRef)]);
      if(!freshSnap.exists()||!driverTrackSnap.exists()||!customerTrackSnap.exists())throw new Error("TRACKING_MISSING");
      const fresh=freshSnap.data(),status=Number(fresh.statusIndex||0);
      if(fresh.userId!==state.user.uid||fresh.type!=="ride"||fresh.cancelled||!fresh.driverId||status!==2)throw new Error("NOT_ELIGIBLE");
      if(fresh.customerFeeCharged!==true||fresh.captainFeeCharged!==true)throw new Error("FEES_PENDING");
      const dp=driverTrackSnap.data(),cp=customerTrackSnap.data();
      const now=Date.now();
      const dt=timestampMillis(dp.updatedAt),ct=timestampMillis(cp.updatedAt);
      if(!dt||!ct||now-dt>75000||now-ct>75000)throw new Error("TRACKING_STALE");
      if(!autoArrivalGeometryOk(fresh,cp,dp))throw new Error("NOT_AT_DESTINATION");
      transaction.update(orderRef,{
        statusIndex:4,
        startedAt:fresh.startedAt||fresh.arrivedAt||serverTimestamp(),
        completedAt:serverTimestamp(),
        paymentStatus:"paid",
        autoCompletedByGPS:true,
        autoCompletionReason:"both_near_destination_without_otp",
        autoCompletedAt:serverTimestamp(),
        autoCompletionActor:state.user.uid,
        autoArrivalRadiusM:AUTO_ARRIVAL_RADIUS_M,
        otpBypassed:true,
        updatedAt:serverTimestamp()
      });
    });
    showToast("تم تأكيد الوصول تلقائيًا عبر GPS وإكمال الرحلة. رسوم كروة محسوبة للطرفين مرة واحدة فقط.");
    state.customerAutoArrivalSince=0;
  }catch(error){
    const quiet=["TRACKING_MISSING","TRACKING_STALE","NOT_AT_DESTINATION","NOT_ELIGIBLE"].includes(error?.message);
    if(!quiet)console.warn("تعذر الإكمال التلقائي للرحلة",error);
  }finally{state.autoArrivalCompleting=false;}
}
function evaluateCustomerAutoArrival(){
  const order=currentAutoArrivalRide(),driverPoint=state.lastDriverTracking,customerPoint=state.customerLocation;
  if(!order||!autoArrivalGeometryOk(order,customerPoint,driverPoint)){state.customerAutoArrivalSince=0;return;}
  if(!state.customerAutoArrivalSince){state.customerAutoArrivalSince=Date.now();return;}
  if(Date.now()-state.customerAutoArrivalSince>=AUTO_ARRIVAL_DWELL_MS)autoCompleteTaxiFromCustomer(order);
}

function syncTrackingSubscription() {
  const order = state.activeOrder;
  const nextId = order?.driverId && order?.firestoreId ? order.firestoreId : null;
  if (state.trackingOrderId === nextId) return;
  if (state.trackingUnsubscribe) state.trackingUnsubscribe();
  state.trackingUnsubscribe = null;
  state.trackingOrderId = nextId;
  state.lastDriverTracking = null;
  clearDriverLocation();
  syncCustomerTripLocationSharing();

  if (!nextId) {
    byId("mapInfoTitle").textContent = order ? "بانتظار قبول كابتن" : "خريطة كروة المباشرة";
    byId("mapInfoText").textContent = order
      ? "سيظهر موقع الكابتن هنا فور قبول الطلب وتفعيل موقعه."
      : "حدد موقعك، وسيظهر الكابتن هنا بعد قبول الطلب.";
    return;
  }

  byId("mapInfoTitle").textContent = "تم تعيين الكابتن";
  byId("mapInfoText").textContent = "بانتظار أول تحديث للموقع…";
  state.trackingUnsubscribe = onSnapshot(
    doc(db, "orders", nextId, "tracking", "current"),
    snapshot => {
      if (snapshot.exists()) showDriverLocation(snapshot.data());
    },
    error => {
      console.error(error);
      byId("mapInfoText").textContent = "تعذر تحميل الموقع المباشر.";
    }
  );
}

function setButtonBusy(button, busy, busyLabel = "جاري التنفيذ…") {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
}

function switchView(viewId) {
  const isMapView = viewId === "home";
  document.body.classList.toggle("customer-map-mode", isMapView);
  if (!isMapView) {
    byId("home")?.classList.remove("customer-options-open");
    setCustomerSettingsOpen(false, false);
  }
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
  if (viewId === "orders") renderOrders();
  if (viewId === "home" && state.map) window.setTimeout(() => state.map.invalidateSize(), 100);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAuthModal() {
  byId("authMessage").textContent = "";
  byId("authModal").classList.add("show");
  byId("roleEntryGrid").hidden = false;
  byId("authFormPanel").hidden = true;
}

function closeAuthModal() {
  byId("authModal").classList.remove("show");
  byId("authForm").reset();
  byId("authMessage").textContent = "";
}

function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === "register";
  byId("loginTab").classList.toggle("active", !registering);
  byId("registerTab").classList.toggle("active", registering);
  byId("nameField").hidden = !registering;
  byId("roleField").hidden = !registering;
  if(byId("inviteField"))byId("inviteField").hidden=!registering;
  byId("authName").required = registering;
  byId("authPassword").autocomplete = registering ? "new-password" : "current-password";
  byId("authSubmit").textContent = registering ? "إنشاء الحساب" : "تسجيل الدخول";
  byId("authMessage").textContent = "";
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "هذا البريد مستخدم في حساب آخر.",
    "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة.",
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/missing-password": "أدخل كلمة المرور.",
    "auth/weak-password": "كلمة المرور يجب أن تكون ستة أحرف على الأقل.",
    "auth/too-many-requests": "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.",
    "auth/network-request-failed": "تعذر الاتصال بالإنترنت.",
    "auth/operation-not-allowed": "فعّل Email/Password من إعدادات Firebase Authentication.",
    "auth/unauthorized-domain": "أضف نطاق GitHub Pages إلى Authorized domains في Firebase."
  };
  return messages[error.code] || "تعذر إكمال العملية. حاول مرة أخرى.";
}

function makeReferralCode(uid){return `KW${String(uid||"").replace(/[^a-z0-9]/gi,"").slice(0,12).toUpperCase()}`;}
async function ensureReferralCode(user, existingCode=""){
  if(!user)return "";
  const code=(existingCode||makeReferralCode(user.uid)).toUpperCase();
  state.referralCode=code;
  try{
    const batch=writeBatch(db);
    if(!existingCode)batch.set(doc(db,"users",user.uid),{referralCode:code,updatedAt:serverTimestamp()},{merge:true});
    batch.set(doc(db,"referralCodes",code),{code,ownerId:user.uid,ownerName:state.name||"",active:true,updatedAt:serverTimestamp()},{merge:true});
    await batch.commit();
  }catch(error){console.warn("تعذر تجهيز كود الدعوة",error);}
  renderReferralCard();
  return code;
}
function renderReferralCard(){
  if(byId("referralCodeValue"))byId("referralCodeValue").textContent=state.referralCode||"—";
  if(byId("referralDiscountValue"))byId("referralDiscountValue").textContent=`خصم ${Number(state.appSettings.referralDiscountPercent||10)}% حتى ${formatMoney(state.appSettings.referralMaxDiscount||3000)}`;
}
function renderTopupDestination(){
  const cfg=state.appSettings||{};
  if(byId("customerOrderFeeLabel"))byId("customerOrderFeeLabel").textContent=customerFeeSummary();
  if(byId("topupTransferLabel"))byId("topupTransferLabel").textContent=cfg.topupTransferLabel||"Mastercard محلي";
  if(byId("topupTransferId"))byId("topupTransferId").textContent=cfg.topupTransferId||"أضف معرف التحويل من لوحة الإدارة";
  if(byId("topupCardHolder"))byId("topupCardHolder").textContent=cfg.topupCardHolder||"إدارة كروة";
}
function subscribeToAppSettings(){
  onSnapshot(doc(db,"appSettings","pricing"),snap=>{state.appSettings=snap.exists()?snap.data():{};calculateRidePrice();renderReferralCard();renderTopupDestination();},error=>console.warn("تعذر تحميل إعدادات التسعير",error));
}
function customerHasPendingTopup(){return state.topupRequests.some(x=>(x.status||"pending")==="pending");}
function updateCustomerTopupFormState(){
  const pending=customerHasPendingTopup();
  [byId("topupAmount"),byId("topupReference"),byId("submitTopup")].forEach(el=>{if(el)el.disabled=pending;});
  const submit=byId("submitTopup");if(submit)submit.textContent=pending?"يوجد طلب شحن قيد المراجعة":"إرسال طلب الشحن";
}
function renderTopupRequests(){
  const box=byId("topupRequestsList"); if(!box)return;
  if(!state.user){box.innerHTML='<p class="muted">سجّل الدخول لعرض طلبات الشحن.</p>';updateCustomerTopupFormState();return;}
  if(!state.topupRequests.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';updateCustomerTopupFormState();return;}
  const labels={pending:"قيد المراجعة",approved:"تمت الإضافة",rejected:"مرفوض",cancelled:"ملغي"};
  const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  box.innerHTML=state.topupRequests.map(x=>`<div class="topup-history-row"><div><strong>${formatMoney(x.amount)}</strong><small>${safe(x.transferReference||"بدون مرجع")}</small></div><span class="topup-status ${safe(x.status||"pending")}">${labels[x.status]||safe(x.status)}</span></div>`).join("");
  updateCustomerTopupFormState();
}
function subscribeToTopups(user){
  if(state.unsubscribeTopups)state.unsubscribeTopups();
  state.unsubscribeTopups=onSnapshot(query(collection(db,"topupRequests"),where("userId","==",user.uid)),snap=>{state.topupRequests=snap.docs.map(d=>({...d.data(),firestoreId:d.id})).sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));renderTopupRequests();},error=>console.warn("تعذر تحميل طلبات الشحن",error));
}

async function saveUserData(values) {
  if (!state.user) return;
  await setDoc(doc(db, "users", state.user.uid), {
    ...values,
    email: state.user.email || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function loadUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);
  let profileNeedsMigration = false;
  if (snapshot.exists()) {
    const data = snapshot.data();
    const storedName = typeof data.name === "string" ? data.name.trim() : "";
    const storedBalance = Number(data.balance ?? 0);
    state.role = typeof data.role === "string" && data.role ? data.role : "customer";
    state.name = storedName || user.displayName || user.email?.split("@")[0] || "مستخدم كروة";
    state.balance = Number.isFinite(storedBalance) ? storedBalance : 0;
    state.bonusBalance = Math.max(0,Number(data.bonusBalance||0));
    state.bonusExpiresAt = data.bonusExpiresAt || null;
    state.notifications = data.notifications !== false;
    state.referralCode = typeof data.referralCode === "string" ? data.referralCode : "";
    if(data.invitedByCode && byId("couponCode") && !byId("couponCode").value){byId("couponCode").value=String(data.invitedByCode).toUpperCase();if(byId("couponStatus"))byId("couponStatus").textContent="كود الدعوة محفوظ — حدّد المسار ثم اضغط تطبيق";}
    if (!data.role) {
      try {
        await setDoc(userRef, {
          role: "customer",
          email: typeof data.email === "string" ? data.email : (user.email || ""),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        profileNeedsMigration = true;
        console.warn("تعذر إكمال ترقية ملف العميل القديم؛ انشر قواعد Firestore المرفقة", error);
      }
    }
    if (!storedName) {
      try {
        await setDoc(userRef, {
          name: state.name,
          email: typeof data.email === "string" ? data.email : (user.email || ""),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        profileNeedsMigration = true;
        console.warn("تعذر حفظ اسم العميل القديم", error);
      }
    }
  } else {
    state.role = "customer";
    state.name = user.displayName || user.email?.split("@")[0] || "مستخدم كروة";
    state.balance = 0;
    const settingsSnapshot = await getDoc(doc(db, "appSettings", "pricing"));
    state.appSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
    const welcomeBonus=signupBonusFields();
    state.bonusBalance=Number(welcomeBonus.bonusBalance||0);
    state.bonusExpiresAt=welcomeBonus.bonusExpiresAt;
    state.notifications = true;
    await setDoc(userRef, {
      name: state.name,
      email: user.email || "",
      role: "customer",
      balance: state.balance,
      ...welcomeBonus,
      notifications: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  await ensureReferralCode(user,state.referralCode);
  renderProfile();
  renderNotificationSwitch();
  renderBalance();
  renderTopupDestination();
  return { profileNeedsMigration };
}

function subscribeToOrders(user) {
  if (state.unsubscribeOrders) state.unsubscribeOrders();
  const ordersQuery = query(
    collection(db, "orders"),
    where("userId", "==", user.uid)
  );
  state.unsubscribeOrders = onSnapshot(ordersQuery, snapshot => {
    state.orders = snapshot.docs.map(item => {
      const data = item.data();
      return {
        ...data,
        firestoreId: item.id,
        createdAtISO: data.createdAt?.toDate?.().toISOString() || data.createdAtISO || new Date().toISOString()
      };
    }).sort((a, b) => new Date(b.createdAtISO) - new Date(a.createdAtISO));

    state.activeOrder = state.orders.find(order =>
      !order.cancelled && Number(order.statusIndex || 0) < orderStatuses.length - 1
    ) || null;
    if (state.activeOrder?.firestoreId && !state.activeOrder.tripOtp) {
      getDoc(doc(db, "orderSecrets", state.activeOrder.firestoreId)).then(secret => {
        if (secret.exists() && state.activeOrder?.firestoreId === secret.id) {
          state.activeOrder.tripOtp = secret.data().tripOtp;
          renderTracking();
        }
      }).catch(() => {});
    }
    renderOrders();
    renderTracking();
    syncTrackingSubscription();
    syncCustomerTripLocationSharing();
  }, error => {
    console.error(error);
    showToast("تعذر قراءة الطلبات. تحقق من قواعد Firestore.");
  });
}

function subscribeToRatings(user) {
  if (state.unsubscribeRatings) state.unsubscribeRatings();
  const ratingsQuery = query(
    collection(db, "ratings"),
    where("customerId", "==", user.uid)
  );
  state.unsubscribeRatings = onSnapshot(ratingsQuery, snapshot => {
    state.ratings = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderOrders();
  }, error => {
    console.error(error);
    showToast("تعذر تحميل تقييماتك");
  });
}

document.querySelectorAll(".role-auth-action").forEach(button => {
  button.addEventListener("click", () => {
    const role = button.dataset.role || "customer";
    const mode = button.dataset.mode || "login";
    if (role === "serviceApplicant") {
      window.location.assign(`./services.html?mode=${mode}`);
      return;
    }
    if (role === "driverApplicant") {
      window.location.assign(`./driver.html?mode=${mode}`);
      return;
    }
    byId("authRole").value = role;
    const meta = role === "customer" ? ["👤","عميل"] : role === "driverApplicant" ? ["🚕","كابتن"] : ["🧰","خدمات أخرى"];
    byId("selectedRoleIcon").textContent = meta[0];
    byId("selectedRoleLabel").textContent = meta[1] + " • " + (mode === "register" ? "إنشاء حساب" : "تسجيل الدخول");
    byId("roleEntryGrid").hidden = true;
    byId("authFormPanel").hidden = false;
    setAuthMode(mode);
    window.setTimeout(() => byId(mode === "register" ? "authName" : "authEmail")?.focus(), 80);
  });
});
byId("authBackToRoles").addEventListener("click", () => {
  byId("authFormPanel").hidden = true;
  byId("roleEntryGrid").hidden = false;
  byId("authForm").reset();
  byId("authMessage").textContent = "";
});

byId("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = byId("authEmail").value.trim();
  const password = byId("authPassword").value;
  const name = byId("authName").value.trim();
  const selectedRole = byId("authRole")?.value || "customer";
  const inviteCode = byId("authInviteCode")?.value.trim().toUpperCase() || "";
  if (selectedRole === "driverApplicant" || selectedRole === "serviceApplicant") {
    window.location.assign(selectedRole === "driverApplicant" ? `./driver.html?mode=${state.authMode}` : `./services.html?mode=${state.authMode}`);
    return;
  }
  const submit = byId("authSubmit");
  byId("authMessage").textContent = "";

  if (state.authMode === "register" && name.length < 2) {
    byId("authMessage").textContent = "اكتب اسمًا صحيحًا.";
    return;
  }

  setButtonBusy(submit, true);
  try {
    if (state.authMode === "register") {
      customerRegistrationInProgress = true;
      let credential = null;
      let profileSaved = false;
      try {
        try {
          const settingsSnapshot = await getDoc(doc(db, "appSettings", "pricing"));
          state.appSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
        } catch (settingsError) {
          console.warn("تعذر تحميل إعدادات التسجيل؛ سيتم استخدام القيم الافتراضية", settingsError);
          state.appSettings = state.appSettings || {};
        }
        const deviceInfo = requireNativeRegistrationDevice();
        credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName: name });
        const ownReferral=makeReferralCode(credential.user.uid);
        let invitedByUserId="";
        if(inviteCode){try{const rs=await getDoc(doc(db,"referralCodes",inviteCode));if(rs.exists()&&rs.data().ownerId!==credential.user.uid)invitedByUserId=rs.data().ownerId;}catch(_){}}
        const welcomeBonus=signupBonusFields();
        const registrationBatch=writeBatch(db);
        registrationBatch.set(doc(db, "users", credential.user.uid), {
          name,email,role:"customer",balance:0,...welcomeBonus,notifications:true,referralCode:ownReferral,deviceBound:true,
          ...(inviteCode&&invitedByUserId?{invitedByCode:inviteCode,invitedByUserId}:{}),createdAt:serverTimestamp(),updatedAt:serverTimestamp()
        });
        addDeviceRegistrationWrites(registrationBatch,db,credential.user.uid,"customer",deviceInfo);
        await registrationBatch.commit();
        profileSaved = true;
        try {
          await setDoc(doc(db,"referralCodes",ownReferral),{code:ownReferral,ownerId:credential.user.uid,ownerName:name,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        } catch (referralError) { console.warn("سيعاد إنشاء كود الدعوة بعد الدخول", referralError); }
        state.name = name;
        state.role = "customer";
        state.balance = 0;
        state.bonusBalance = Number(welcomeBonus.bonusBalance||0);
        state.bonusExpiresAt = welcomeBonus.bonusExpiresAt;
        state.notifications = true;
        state.referralCode = ownReferral;
        if(inviteCode&&invitedByUserId&&byId("couponCode")){byId("couponCode").value=inviteCode;if(byId("couponStatus"))byId("couponStatus").textContent="كود الدعوة محفوظ — حدّد المسار ثم اضغط تطبيق";}
        customerRegistrationInProgress = false;
        await startVerifiedCustomerSession(credential.user);
        closeAuthModal();
        showToast("تم إنشاء حساب العميل بنجاح");
      } catch (registrationError) {
        if (credential?.user && !profileSaved) {
          try { await deleteUser(credential.user); } catch (rollbackError) { console.warn("تعذر حذف حساب التسجيل غير المكتمل", rollbackError); }
        }
        throw registrationError;
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("مرحبًا بعودتك");
    }
  } catch (error) {
    customerRegistrationInProgress = false;
    console.error(error);
    const deviceError = error?.message === "DEVICE_NATIVE_REQUIRED" || error?.code === "device/native-required"
      ? "إنشاء حساب جديد متاح من تطبيق كروة على Android فقط حتى يتم ربط الحساب بهذا الهاتف."
      : (state.authMode === "register" && String(error?.code||"").includes("permission-denied")
        ? "هذا الهاتف مرتبط بالفعل بحساب كروة آخر، أو لم تُنشر قواعد Phase 81 الجديدة."
        : "");
    byId("authMessage").textContent = deviceError || authErrorMessage(error);
  } finally {
    setButtonBusy(submit, false);
    setAuthMode(state.authMode);
  }
});

byId("logoutButton").addEventListener("click", async () => {
  if (!state.user || !confirm("هل تريد تسجيل الخروج؟")) return;
  try {
    await signOut(auth);
    switchView("home");
    showToast("تم تسجيل الخروج");
  } catch {
    showToast("تعذر تسجيل الخروج الآن");
  }
});

byId("accountButton").addEventListener("click", () => {
  if (state.user) switchView("profile");
  else openAuthModal();
});

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.addEventListener("click", event => {
  const button = event.target.closest("[data-service]");
  if (!button) return;
  document.querySelectorAll("[data-service]").forEach(item => item.classList.remove("active"));
  document.querySelectorAll(".service-panel").forEach(panel => panel.classList.remove("active"));
  button.classList.add("active");
  const panelId = button.dataset.service === "profession" ? "otherPanel" : button.dataset.service + "Panel";
  byId(panelId)?.classList.add("active");
  if (button.dataset.service === "profession") { state.selectedProfession = button.dataset.profession || ""; renderOtherServices(); }
});

document.querySelectorAll(".vehicle-button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".vehicle-button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    state.vehicle = button.dataset.vehicle;
    calculateRidePrice();
  });
});

byId("parcelSize").addEventListener("change", event => {
  byId("parcelPrice").textContent = formatMoney(event.target.value);
});

function setCenterPick(active=true){
  initializeCustomerMap(); state.centerPickActive=active;
  document.querySelector(".map-card")?.classList.toggle("center-pick",active);
  byId("mapConfirmBar")?.classList.toggle("show",active);
  byId("mapCenterPick")?.classList.toggle("active",active);
  if(active){const c=state.map.getCenter();state.map.fire("move");showToast(state.mapPickMode==="pickup"?"حرّك الخريطة لتحديد نقطة الانطلاق":"حرّك الخريطة لتحديد الوجهة");}
}
async function confirmCenterPick(){if(!state.centerPickActive)return;const c=state.map.getCenter();setCenterPick(false);await setBookingPoint(state.mapPickMode,c.lat,c.lng);}
function distanceFromMapCenter(x){const c=state.map?.getCenter();if(!c)return null;return haversineKm({latitude:c.lat,longitude:c.lng},{latitude:Number(x.lat),longitude:Number(x.lon)});}

function locationErrorMessage(error) {
  if (error?.code === 1) return "فعّل إذن الموقع للتطبيق ثم اضغط علامة الموقع مرة أخرى";
  if (error?.code === 2) return "تعذر الحصول على إشارة GPS. تأكد من تشغيل الموقع في جهازك";
  if (error?.code === 3) return "تأخر تحديد الموقع. حاول مرة أخرى في مكان تكون فيه إشارة GPS أفضل";
  return "تعذر تحديد موقعك الحالي";
}

async function getKarwaPrecisePosition(options = {}) {
  if (window.KarwaGeo?.getPrecisePosition) {
    return window.KarwaGeo.getPrecisePosition({
      targetAccuracy: 20,
      acceptableAccuracy: 35,
      maxWait: 18000,
      ...options
    });
  }
  if (!navigator.geolocation) throw Object.assign(new Error("GPS غير مدعوم"), { code: "UNSUPPORTED" });
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 }));
}

function handlePreciseLocationFailure(error) {
  console.warn("Karwa precise location", error);
  const code = String(error?.code || "");
  if (code === "PRECISE_PERMISSION_REQUIRED" || code === "PERMISSION_DENIED" || error?.code === 1) {
    showToast("فعّل «الموقع الدقيق» لكروة ثم حاول مرة أخرى");
    window.KarwaGeo?.promptPreciseSettings?.("اختر إذن الموقع ثم فعّل «استخدام الموقع الدقيق». الموقع التقريبي قد يعطي خطأ يصل إلى مئات الأمتار.");
    return;
  }
  if (code === "GPS_DISABLED") {
    showToast("شغّل GPS للحصول على موقع دقيق");
    try { window.KarwaNative?.openLocationSettings?.(); } catch {}
    return;
  }
  if (code === "ACCURACY_TOO_LOW") {
    const acc = Number(error?.bestAccuracy || 0);
    showToast(acc ? `دقة GPS الحالية ${Math.round(acc)} م؛ انتقل لمكان مفتوح وحاول مجددًا` : "لم تصل إشارة GPS للدقة المطلوبة. انتقل لمكان مفتوح وحاول مجددًا");
    return;
  }
  showToast(locationErrorMessage(error));
}

async function locateUser(targetInput) {
  initializeCustomerMap();
  const requestToken = ++state.locationRequestToken;
  showToast("جارٍ تثبيت GPS بدقة عالية…");
  const info = byId("mapInfoText");
  try {
    const position = await getKarwaPrecisePosition({
      onProgress: ({ bestAccuracy }) => {
        if (requestToken !== state.locationRequestToken) return;
        if (info && Number(bestAccuracy) > 35) info.textContent = `جاري تحسين دقة GPS… ${Math.round(bestAccuracy)} م`;
      }
    });
    if (requestToken !== state.locationRequestToken) return;

    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Math.round(Number(position.coords.accuracy || 0));
    const point = [latitude, longitude];

    setCenterPick(false);
    state.customerLocation = { latitude, longitude, accuracy };
    if (state.map) {
      state.map.stop();
      state.map.setView(point, Math.max(17, state.map.getZoom() || 17), { animate: false });
    }

    if (targetInput) {
      targetInput.value = `موقعي الحالي (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
      if (targetInput.id === "rideFrom") {
        setBookingPoint("pickup", latitude, longitude).catch(console.warn);
      } else {
        setCustomerLocation(latitude, longitude);
      }
    } else {
      setCustomerLocation(latitude, longitude);
    }

    if (state.customerLocation) state.customerLocation.accuracy = accuracy;
    const cityLabel = byId("cityLabel");
    if (cityLabel) cityLabel.textContent = "موقعك الحالي";
    if (info) info.textContent = accuracy ? `الموقع مباشر • دقة ${accuracy} م` : "الموقع مباشر";
    renderCustomerSettingsInfo();
    showToast(accuracy ? `تم تثبيت موقعك بدقة ${accuracy} م` : "تم تثبيت موقعك بدقة عالية");
  } catch (error) {
    if (requestToken !== state.locationRequestToken) return;
    handlePreciseLocationFailure(error);
  }
}

byId("useRideLocation").addEventListener("click", () => locateUser(byId("rideFrom")));
byId("useParcelLocation").addEventListener("click", () => locateUser(byId("parcelFrom")));
byId("headerLocation").addEventListener("click", () => locateUser(byId("rideFrom")));
byId("pickRideFrom").addEventListener("click",()=>{state.mapPickMode="pickup";document.querySelectorAll(".map-pick-button").forEach(b=>b.classList.toggle("active",b.id==="pickRideFrom"));});
byId("mapCenterPick")?.addEventListener("click",()=>setCenterPick(!state.centerPickActive));
byId("confirmMapCenter")?.addEventListener("click",confirmCenterPick);
byId("pickRideTo").addEventListener("click",()=>{state.mapPickMode="destination";document.querySelectorAll(".map-pick-button").forEach(b=>b.classList.toggle("active",b.id==="pickRideTo"));});

function requireUser() {
  if (state.user) return true;
  openAuthModal();
  showToast("سجّل الدخول أولًا لإتمام الطلب");
  return false;
}

async function createOrder(type, title, route, price, options = {}) {
  if (!requireUser()) return false;
  const createdAtISO = new Date().toISOString();
  const orderRef = doc(collection(db, "orders"));
  const customerFee = customerOperationFee(type);
  const order = {
    id: "KW-" + String(Date.now()).slice(-6),
    userId: state.user.uid,
    customerName: state.name || state.user.displayName || "عميل كروة",
    type,
    requiredDriverService: type === "ride" ? "taxi" : (["parcel", "food", "serviceDelivery"].includes(type) ? "delivery" : ""),
    title,
    route,
    price: Number(price),
    payment: options.payment || "نقدًا",
    driverId: null,
    driverName: "",
    driverPhone: "",
    assignmentStatus: "available",
    pickupLocation: options.pickupLocation || (state.customerLocation ? { ...state.customerLocation } : null),
    destinationLocation: options.destinationLocation || null,
    distanceKm: Number(options.distanceKm || 0),
    durationMin: Number(options.durationMin || 0),
    routeSource: options.routeSource || "",
    fareSubtotal: Number(options.fareSubtotal || price),
    discountAmount: Number(options.discountAmount || 0),
    couponCode: options.couponCode || "",
    commissionRate: 0,
    commissionAmount: 0,
    driverEarnings: Number(price),
    customerPlatformFee: customerFee,
    customerFeeCharged: true,
    captainPlatformFee: 0,
    captainFeeCharged: false,
    tripOtp: String(Math.floor(1000 + Math.random() * 9000)),
    paymentStatus: options.payment === "المحفظة" ? "paid" : "pending",
    acceptedAt: null, arrivedAt: null, startedAt: null, completedAt: null,
    cancellationReason: "",
    statusIndex: 0,
    cancelled: false,
    createdAt: serverTimestamp(),
    createdAtISO,
    ...(options.foodDetails ? { foodDetails: options.foodDetails } : {}),
    ...(options.parcelDetails ? { parcelDetails: options.parcelDetails } : {})
  };

  const walletPatch=walletDebitPatch({balance:state.balance,bonusBalance:state.bonusBalance,bonusExpiresAt:state.bonusExpiresAt},customerFee);
  if(customerFee>0&&!walletPatch) throw new Error(`الرصيد غير كافٍ. يلزم ${formatMoney(customerFee)} رسم كروة لإنشاء الطلب. اشحن المحفظة ثم أعد المحاولة.`);
  const batch = writeBatch(db);
  batch.set(orderRef, order);
  if(walletPatch) batch.set(doc(db,"users",state.user.uid),walletPatch,{merge:true});
  if(options.referralRedemption){
    batch.set(doc(db,"referralRedemptions",state.user.uid),{
      userId:state.user.uid,
      code:options.referralRedemption.code,
      inviterId:options.referralRedemption.inviterId,
      discountAmount:Number(options.referralRedemption.discountAmount||0),
      createdAt:serverTimestamp()
    });
  }
  await batch.commit();
  applyWalletPatchToState(walletPatch);

  state.activeOrder = { ...order, firestoreId: orderRef.id, createdAt: null };
  state.orders.unshift(state.activeOrder);
  renderBalance();
  renderTracking();
  renderOrders();
  syncTrackingSubscription();
  switchView("home");
  showToast("تم إنشاء الطلب وحفظه بنجاح");
  return true;
}

byId("applyCoupon")?.addEventListener("click", async () => {
  if (!requireUser() || !state.routeDistanceKm) return showToast("حدد المسار أولًا");
  const code = byId("couponCode").value.trim().toUpperCase();
  if(!code){state.appliedCoupon=null;calculateRidePrice();byId("couponStatus").textContent="أدخل رمز الخصم أو الدعوة";return;}
  byId("couponStatus").textContent="جارٍ التحقق من الرمز…";
  try{
    const couponSnap=await getDoc(doc(db,"coupons",code));
    if(couponSnap.exists()){
      const c=couponSnap.data();
      const expired=c.expiresAt?.toMillis?.() && c.expiresAt.toMillis()<Date.now();
      if(c.active!==true||expired)throw new Error("INVALID");
      state.appliedCoupon={code,type:c.type==="fixed"?"fixed":"percent",value:Number(c.value||0),maxDiscount:Number(c.maxDiscount||0),minFare:Number(c.minFare||0),kind:"coupon"};
      calculateRidePrice();return;
    }
    const referralSnap=await getDoc(doc(db,"referralCodes",code));
    if(!referralSnap.exists()||referralSnap.data().active===false||referralSnap.data().ownerId===state.user.uid)throw new Error("INVALID");
    const used=await getDoc(doc(db,"referralRedemptions",state.user.uid));
    if(used.exists())throw new Error("USED");
    const pct=Math.max(0,Math.min(100,Number(state.appSettings.referralDiscountPercent||10)));
    state.appliedCoupon={code,type:"percent",value:pct,maxDiscount:Number(state.appSettings.referralMaxDiscount||3000),minFare:0,kind:"referral",ownerId:referralSnap.data().ownerId};
    calculateRidePrice();
  }catch(error){state.appliedCoupon=null;calculateRidePrice();byId("couponStatus").textContent=error.message==="USED"?"استخدمت كود دعوة سابقًا":"الرمز غير صالح أو منتهي";}
});

byId("bookRide").addEventListener("click", async event => {
  if (!requireUser()) return;
  const from = byId("rideFrom").value.trim();
  const to = byId("rideTo").value.trim();
  if (!from || !to || !state.pickupLocation || !state.destinationLocation) {
    showToast("أدخل نقطة الانطلاق والوجهة");
    return;
  }
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الحجز…");
  try {
    await createOrder("ride", `مشوار ${state.vehicle}`, `${from} ← ${to}`, state.ridePrice, {
      payment: "نقدًا",
      pickupLocation: state.pickupLocation, destinationLocation: state.destinationLocation,
      distanceKm: state.routeDistanceKm, durationMin: state.routeDurationMin, routeSource: state.routeSource,
      fareSubtotal: state.fareSubtotal, discountAmount: Math.max(0,state.fareSubtotal-state.ridePrice), couponCode: state.appliedCoupon?.code || "",
      referralRedemption: state.appliedCoupon?.kind==="referral" ? {code:state.appliedCoupon.code,inviterId:state.appliedCoupon.ownerId,discountAmount:Math.max(0,state.fareSubtotal-state.ridePrice)} : null,
      scheduledAt: byId("scheduleRideAt")?.value || null
    });
    state.appliedCoupon=null; if(byId("couponCode"))byId("couponCode").value="";
  } catch (error) {
    console.error(error);
    showToast(customerFirestoreMessage(error, "تأكيد الحجز"));
  } finally {
    setButtonBusy(button, false);
  }
});

byId("bookParcel").addEventListener("click", async event => {
  if (!requireUser()) return;
  const from = byId("parcelFrom").value.trim();
  const to = byId("parcelTo").value.trim();
  const recipientName = byId("recipientName").value.trim();
  const recipientPhone = byId("recipientPhone").value.trim();
  const price = Number(byId("parcelSize").value);
  if (!from || !to || !recipientName) {
    showToast("أكمل عناوين التوصيل واسم المستلم");
    return;
  }
  if (!validServiceLocation(state.customerLocation)) {
    showToast("حدد موقع استلام الغرض عبر GPS حتى يصل الطلب إلى كباتن التوصيل ضمن نطاق 10 كم");
    return;
  }
  if (recipientPhone.replace(/\D/g, "").length < 8) {
    showToast("أدخل رقم هاتف صحيحًا");
    return;
  }
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الطلب…");
  try {
    const parcelNotes = byId("parcelNotes")?.value.trim() || "";
    await createOrder("parcel", `توصيل غرض إلى ${recipientName}`, `${from} ← ${to}`, price, {
      payment: "نقدًا",
      pickupLocation: { ...state.customerLocation },
      parcelDetails: { from, to, recipientName, recipientPhone, notes: parcelNotes }
    });
  } catch (error) {
    console.error(error);
    showToast(String(error?.message||"").includes("الرصيد غير كافٍ") ? error.message : "تعذر حفظ طلب التوصيل.");
  } finally {
    setButtonBusy(button, false);
  }
});


function restaurantSafeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
}

function karwaServiceTheme(input = {}) {
  return window.KarwaServiceThemes?.resolve?.(input) || { key:"parcel", image:"./theme-parcel.webp?v=73", accent:"#087b75", icon:"🧰" };
}
function karwaServiceThemeStyle(input = {}) {
  const theme = karwaServiceTheme(input);
  return `--karwa-service-theme:url('${theme.image}');--karwa-service-accent:${theme.accent};`;
}

function renderRestaurantDraftMeals() {
  const host = byId("draftMeals"); if (!host) return;
  host.innerHTML = state.restaurantDraftMeals.map((meal, index) => `<span class="draft-meal"><strong>${restaurantSafeText(meal.name)}</strong><span>${formatMoney(meal.price)}</span><button type="button" data-remove-draft-meal="${index}" aria-label="حذف">×</button></span>`).join("");
  host.querySelectorAll("[data-remove-draft-meal]").forEach(button => button.addEventListener("click", () => {
    state.restaurantDraftMeals.splice(Number(button.dataset.removeDraftMeal), 1); renderRestaurantDraftMeals();
  }));
}

function renderRestaurants() {
  const host = byId("restaurantMarketplace"); if (!host) return;
  const approved = state.restaurants.filter(r => r.active === true && r.approvalStatus === "approved");
  // بطاقة واحدة فقط لكل صاحب مطعم. إن وُجد أكثر من إعلان لنفس الشخص نعرض الأحدث/الأكمل فقط.
  const unique = new Map();
  approved.forEach(r => {
    const ownerKey = String(r.ownerId || r.providerId || r.userId || "").trim();
    const fallbackKey = `${String(r.name||"").trim().toLowerCase()}|${String(r.phone||"").replace(/\D/g,"")}`;
    const key = ownerKey ? `owner:${ownerKey}` : `restaurant:${fallbackKey}`;
    const current = unique.get(key);
    const score = (x) => (Array.isArray(x.meals)?x.meals.length:0) + (x.address?2:0) + (x.phone?1:0);
    if (!current || score(r) >= score(current)) unique.set(key, r);
  });
  const restaurants = [...unique.values()].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ar"));
  if (!restaurants.length) { host.innerHTML = '<div class="restaurant-empty">لا توجد مطاعم معلنة ومعتمدة حاليًا.</div>'; return; }
  host.innerHTML = restaurants.map(restaurant => {
    const meals = Array.isArray(restaurant.meals) ? restaurant.meals : [];
    const themeInput = { category:"restaurant", serviceType:"restaurant", description:restaurant.description || "", items:meals };
    const theme = karwaServiceTheme(themeInput);
    return `<article class="restaurant-card open" data-theme="${restaurantSafeText(theme.key)}" data-restaurant-card="${restaurantSafeText(restaurant.firestoreId)}" style="${karwaServiceThemeStyle(themeInput)}"><header class="restaurant-card-head"><h3>${theme.icon} ${restaurantSafeText(restaurant.name)}</h3><div class="restaurant-card-meta"><span>📍 ${restaurantSafeText(restaurant.address || "العنوان غير محدد")}</span><span>• ${meals.length} وجبة متوفرة</span></div></header><div class="restaurant-card-contact"><span>📍 العنوان بالتفصيل: ${restaurantSafeText(restaurant.address || "غير محدد")}</span><span>☎️ رقم الهاتف: ${restaurantSafeText(restaurant.phone || "غير محدد")}</span></div><div class="restaurant-meals">${meals.map((meal, index) => { const normalized = normalizedClientItem(meal); return `<button type="button" class="restaurant-meal-card" data-restaurant-id="${restaurantSafeText(restaurant.firestoreId)}" data-meal-index="${index}"><span class="restaurant-meal-icon">${theme.icon}</span><span><strong>${restaurantSafeText(normalized.name)}</strong><small>${restaurantSafeText(normalized.description || `اضغط لعرض تفاصيل الوجبة`)}</small></span><span class="restaurant-meal-price">${formatMoney(normalized.price)}<small>/${restaurantSafeText(otherItemUnitLabels[normalized.unit])}</small></span></button>`; }).join("") || '<small>لا توجد وجبات متاحة حاليًا</small>'}</div></article>`;
  }).join("");
  host.querySelectorAll(".restaurant-meal-card").forEach(button => button.addEventListener("click", () => {
    const restaurant = state.restaurants.find(item => item.firestoreId === button.dataset.restaurantId);
    const mealIndex=Number(button.dataset.mealIndex); const meal = restaurant?.meals?.[mealIndex]; if (!restaurant || !meal) return;
    state.selectedMeal = { ...meal, mealIndex, restaurantId: restaurant.firestoreId, restaurantName: restaurant.name, restaurantAddress: restaurant.address, restaurantPhone: restaurant.phone, restaurantLocation: restaurant.location || null };
    byId("mealDetailRestaurant").textContent = `مطعم ${restaurant.name}`;
    byId("mealRestaurantInfo").innerHTML = `<span>📍 <b>العنوان:</b> ${restaurantSafeText(restaurant.address || "غير محدد")}</span><span>☎️ <b>الهاتف:</b> ${restaurantSafeText(restaurant.phone || "غير محدد")}</span>`;
    byId("mealDetailTitle").textContent = meal.name;
    const normalizedMeal = normalizedClientItem(meal); byId("mealDetailIcon").textContent = "🍽️";
    byId("mealDetailDescription").textContent = normalizedMeal.description || "لا توجد تفاصيل إضافية لهذه الوجبة.";
    const mealSpec = itemUnitSpec(normalizedMeal.unit);
    byId("mealDetailPrice").textContent = `${formatMoney(normalizedMeal.price)} / ${mealSpec.label}`;
    configureQuantityInput(byId("mealQuantity"), normalizedMeal.unit, true);
    if (byId("mealQuantityLabel")) byId("mealQuantityLabel").textContent = mealSpec.quantityLabel;
    if (byId("mealQuantityHint")) byId("mealQuantityHint").textContent = `سعر الوحدة ${formatMoney(normalizedMeal.price)} لكل ${mealSpec.label}`;
    const choice=byId("mealDeliveryChoice"), toggle=byId("mealDeliveryRequested"), hint=byId("mealDeliveryChoiceHint");
    if(choice) choice.hidden=!normalizedMeal.deliveryAvailable;
    if(toggle){toggle.disabled=!normalizedMeal.deliveryAvailable; toggle.checked=false;}
    if(hint) hint.textContent=normalizedMeal.deliveryAvailable ? `التوصيل متاح مقابل ${formatMoney(normalizedMeal.deliveryFee)}، أو يمكنك الاستلام من المطعم` : "هذه الوجبة للاستلام من المطعم فقط";
    updateMealQuantityTotal();
    byId("addDetailedMeal").disabled = false; byId("addDetailedMeal").textContent = "إضافة الطلب بالكمية المحددة"; byId("mealDetailBackdrop").hidden = false;
  }));
}
function subscribeRestaurants() {
  state.unsubscribeRestaurants?.();
  state.unsubscribeRestaurants = onSnapshot(query(collection(db, "restaurants"), where("active", "==", true)), snapshot => {
    state.restaurants = snapshot.docs.map(item => ({ firestoreId: item.id, ...item.data() })).filter(item => item.active !== false).sort((a,b) => String(a.name||"").localeCompare(String(b.name||""), "ar"));
    renderRestaurants();
  }, error => { console.error(error); const host=byId("restaurantMarketplace"); if(host) host.innerHTML='<div class="restaurant-empty">تعذر تحميل المطاعم. تأكد من نشر قواعد Firestore الجديدة.</div>'; });
}

byId("openRestaurantCreator")?.addEventListener("click", () => { if (!requireUser()) return; byId("restaurantCreator").hidden = false; byId("restaurantCreator").scrollIntoView({behavior:"smooth",block:"nearest"}); });
byId("closeRestaurantCreator")?.addEventListener("click", () => byId("restaurantCreator").hidden = true);
byId("captureRestaurantGps")?.addEventListener("click", async () => {
  const button=byId("captureRestaurantGps"); button.disabled=true; button.textContent="جارٍ تثبيت GPS بدقة عالية…";
  try {
    const position=await getKarwaPrecisePosition();
    state.restaurantGps={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy};
    byId("restaurantGpsStatus").textContent=`تم تحديد الموقع ✓ دقة ${Math.round(position.coords.accuracy||0)} م (${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)})`;
    button.textContent="📍 تحديث موقع GPS";
  } catch(error) { handlePreciseLocationFailure(error); button.textContent="📍 تحديد موقعي الحالي"; }
  finally { button.disabled=false; }
});
byId("addRestaurantMeal")?.addEventListener("click", () => {
  const name=byId("mealName").value.trim(), description=byId("mealDescription").value.trim(), price=Number(byId("mealPrice").value);
  if (!name || !Number.isFinite(price) || price <= 0) { showToast("أدخل اسم الوجبة وسعرًا صحيحًا"); return; }
  if (state.restaurantDraftMeals.length >= 30) { showToast("الحد الأقصى 30 وجبة لكل إعلان"); return; }
  state.restaurantDraftMeals.push({name,description,price:Math.round(price)}); byId("mealName").value=""; byId("mealDescription").value=""; byId("mealPrice").value=""; renderRestaurantDraftMeals();
});
byId("publishRestaurant")?.addEventListener("click", async event => {
  if (!requireUser()) return;
  const name=byId("restaurantName").value.trim(), address=byId("restaurantAddress").value.trim(), phone=byId("restaurantPhone").value.trim();
  if (name.length<2 || address.length<3 || phone.replace(/\D/g,"").length<8) { showToast("أكمل اسم المطعم والعنوان ورقم الهاتف بشكل صحيح"); return; }
  if (!state.restaurantGps) { showToast("حدد موقع المطعم GPS قبل النشر"); return; }
  if (!state.restaurantDraftMeals.length) { showToast("أضف وجبة واحدة على الأقل"); return; }
  const button=event.currentTarget; setButtonBusy(button,true,"جاري النشر…");
  try {
    await addDoc(collection(db,"restaurants"), {ownerId:state.user.uid,name,address,phone,location:{...state.restaurantGps},meals:state.restaurantDraftMeals.map(m=>({...m})),active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    state.restaurantDraftMeals=[]; state.restaurantGps=null; renderRestaurantDraftMeals(); ["restaurantName","restaurantAddress","restaurantPhone"].forEach(id=>byId(id).value=""); byId("restaurantGpsStatus").textContent="لم يتم تحديد الموقع بعد"; byId("restaurantCreator").hidden=true; showToast("تم نشر إعلان المطعم بنجاح");
  } catch(error) { console.error(error); showToast("تعذر نشر المطعم. تأكد من نشر قواعد Firestore الجديدة."); }
  finally { setButtonBusy(button,false); }
});
function updateMealQuantityTotal(){
  const meal = state.selectedMeal;
  const input = byId("mealQuantity");
  const totalEl = byId("mealQuantityTotal");
  if (!meal || !input || !totalEl) return;
  const normalized = normalizedClientItem(meal);
  const spec = itemUnitSpec(normalized.unit);
  const quantity = Number(input.value || 0);
  const valid = quantityIsValid(quantity, normalized.unit);
  const subtotal = valid ? Math.round(normalized.price * quantity) : 0;
  const delivery = Boolean(normalized.deliveryAvailable && byId("mealDeliveryRequested")?.checked) ? normalized.deliveryFee : 0;
  totalEl.textContent = valid ? `${formatServiceQuantity(quantity)} ${spec.short} = ${formatMoney(subtotal)}${delivery ? ` • مع التوصيل ${formatMoney(subtotal + delivery)}` : ""}` : `أدخل ${spec.quantityLabel} بشكل صحيح`;
}
function changeMealQuantity(direction){
  const meal = state.selectedMeal; const input = byId("mealQuantity"); if(!meal || !input) return;
  const normalized = normalizedClientItem(meal); const spec = itemUnitSpec(normalized.unit);
  const current = quantityIsValid(input.value, normalized.unit) ? Number(input.value) : spec.min;
  const next = Math.min(spec.max, Math.max(spec.min, Math.round(((current + direction * spec.step) / spec.step)) * spec.step));
  input.value = String(Number(next.toFixed(2))); updateMealQuantityTotal();
}
byId("mealQuantity")?.addEventListener("input", updateMealQuantityTotal);
byId("mealDeliveryRequested")?.addEventListener("change", updateMealQuantityTotal);
byId("mealQuantityMinus")?.addEventListener("click",()=>changeMealQuantity(-1));
byId("mealQuantityPlus")?.addEventListener("click",()=>changeMealQuantity(1));
byId("closeMealDetail")?.addEventListener("click",()=>byId("mealDetailBackdrop").hidden=true);
byId("mealDetailBackdrop")?.addEventListener("click",event=>{if(event.target===event.currentTarget) event.currentTarget.hidden=true;});
byId("addDetailedMeal")?.addEventListener("click",()=>{
  const meal=state.selectedMeal; if(!meal)return; const normalized=normalizedClientItem(meal);
  const quantity=Number(byId("mealQuantity")?.value||0); const spec=itemUnitSpec(normalized.unit);
  if(!quantityIsValid(quantity, normalized.unit)) return showToast(`حدد ${spec.quantityLabel} بشكل صحيح`);
  if (state.cart.length && state.cart[0].restaurantId !== meal.restaurantId) {
    if (!confirm("السلة تحتوي أصنافًا من مطعم آخر. هل تريد تفريغها والطلب من هذا المطعم؟")) return;
    state.cart = [];
  }
  const subtotal=Math.round(normalized.price*quantity);
  const existing=state.cart.find(item=>Number(item.mealIndex)===Number(meal.mealIndex));
  const line={name:normalized.name,price:subtotal,unitPrice:normalized.price,subtotal,quantity,description:normalized.description||"",unit:normalized.unit,deliveryAvailable:normalized.deliveryAvailable,deliveryFee:normalized.deliveryFee,mealIndex:meal.mealIndex,restaurantId:meal.restaurantId,restaurantName:meal.restaurantName,restaurantAddress:meal.restaurantAddress,restaurantPhone:meal.restaurantPhone,restaurantLocation:meal.restaurantLocation};
  if(existing) Object.assign(existing,line);
  else {
    if(state.cart.length>=MAX_MULTI_ORDER_ITEMS) return showToast(`الحد الأقصى ${MAX_MULTI_ORDER_ITEMS} أصناف في الطلب الواحد`);
    state.cart.push(line);
  }
  const canDeliver=state.cart.every(item=>item.deliveryAvailable===true);
  if(byId("foodDeliveryRequested")){
    if(!canDeliver) byId("foodDeliveryRequested").checked=false;
    else if(state.cart.length===1) byId("foodDeliveryRequested").checked=Boolean(byId("mealDeliveryRequested")?.checked);
  }
  renderCart(); byId("mealDetailBackdrop").hidden=true; showToast(`تمت إضافة ${normalized.name} إلى الطلب • ${state.cart.length} صنف`);
});

const otherServiceCategories = {
  restaurant: ["🍴", "مطعم ومأكولات"],
  grocery: ["🛒", "بقالة ومتجر غذائي"],
  retail: ["🛍️", "تسوق ومنتجات"],
  maintenance: ["🔧", "صيانة وإصلاح"],
  home: ["🏠", "خدمات منزلية"],
  health: ["🩺", "صحة وعناية"],
  other: ["🧰", "خدمة أخرى"]
};
const otherRequestStatuses = {
  pending: ["قيد انتظار المزود", "pending"],
  accepted: ["تم قبول الطلب", "accepted"],
  completed: ["اكتملت الخدمة", "completed"],
  rejected: ["اعتذر المزود", "rejected"],
  cancelled: ["ملغي", "cancelled"]
};
const otherItemUnits = {
  item: { label: "قطعة / طلب", short: "قطعة", quantityLabel: "عدد القطع / الطلبات", min: 1, step: 1, max: 100, integer: true },
  meal: { label: "وجبة", short: "وجبة", quantityLabel: "عدد الوجبات", min: 1, step: 1, max: 100, integer: true },
  person: { label: "نفر", short: "نفر", quantityLabel: "عدد النفرات", min: 1, step: 1, max: 100, integer: true },
  kg: { label: "كيلوغرام", short: "كغم", quantityLabel: "الوزن المطلوب (كغم)", min: 0.25, step: 0.25, max: 100, integer: false },
  pack: { label: "عبوة / باكيت", short: "عبوة", quantityLabel: "عدد العبوات", min: 1, step: 1, max: 100, integer: true },
  liter: { label: "لتر", short: "لتر", quantityLabel: "الكمية باللتر", min: 0.25, step: 0.25, max: 100, integer: false },
  meter: { label: "متر", short: "متر", quantityLabel: "الطول بالمتر", min: 0.5, step: 0.5, max: 100, integer: false },
  hour: { label: "ساعة", short: "ساعة", quantityLabel: "عدد الساعات", min: 0.5, step: 0.5, max: 100, integer: false },
  day: { label: "يوم", short: "يوم", quantityLabel: "عدد الأيام", min: 1, step: 1, max: 100, integer: true }
};
const otherItemUnitLabels = Object.fromEntries(Object.entries(otherItemUnits).map(([key, spec]) => [key, spec.label]));
function itemUnitSpec(unit) { return otherItemUnits[unit] || otherItemUnits.item; }
function formatServiceQuantity(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? number.toLocaleString("ar-IQ") : number.toLocaleString("ar-IQ", { maximumFractionDigits: 2 });
}
function quantityIsValid(value, unit) {
  const spec = itemUnitSpec(unit);
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < spec.min || quantity > spec.max) return false;
  if (spec.integer && !Number.isInteger(quantity)) return false;
  const scaled = quantity / spec.step;
  return Math.abs(scaled - Math.round(scaled)) < 1e-7;
}
function configureQuantityInput(input, unit, reset = false) {
  if (!input) return;
  const spec = itemUnitSpec(unit);
  input.min = String(spec.min);
  input.step = String(spec.step);
  input.max = String(spec.max);
  if (reset || !quantityIsValid(input.value, unit)) input.value = String(spec.min);
}

const MAX_MULTI_ORDER_ITEMS = 8;
function requestItemsOf(request = {}) {
  if (Array.isArray(request.items) && request.items.length) {
    return request.items.map((entry, index) => ({
      itemIndex: Number(entry.itemIndex ?? index),
      itemName: String(entry.itemName || entry.name || "صنف"),
      itemUnit: otherItemUnitLabels[entry.itemUnit || entry.unit] ? (entry.itemUnit || entry.unit) : "item",
      quantity: Number(entry.quantity || 1),
      unitPrice: Math.max(0, Number(entry.unitPrice ?? entry.itemPrice ?? entry.price ?? 0)),
      subtotal: Math.max(0, Number(entry.subtotal ?? 0)),
      deliveryAvailable: entry.deliveryAvailable === true,
      deliveryFee: Math.max(0, Number(entry.deliveryFee || 0))
    }));
  }
  if (!request.itemName) return [];
  return [{
    itemIndex: Number(request.itemIndex || 0),
    itemName: String(request.itemName || "صنف"),
    itemUnit: otherItemUnitLabels[request.itemUnit] ? request.itemUnit : "item",
    quantity: Number(request.quantity || 1),
    unitPrice: Math.max(0, Number(request.unitPrice ?? request.itemPrice ?? 0)),
    subtotal: Math.max(0, Number(request.subtotal ?? ((request.unitPrice || request.itemPrice || 0) * (request.quantity || 1)))),
    deliveryAvailable: request.itemDeliveryAvailable === true || request.deliveryRequested === true,
    deliveryFee: Math.max(0, Number(request.itemDeliveryFee || request.deliveryFee || 0))
  }];
}
function orderItemsSubtotal(items = []) { return Math.round(items.reduce((sum, item) => sum + Math.max(0, Number(item.subtotal ?? (Number(item.unitPrice || 0) * Number(item.quantity || 0)))), 0)); }
function orderItemsDeliverable(items = []) { return items.length > 0 && items.every(item => item.deliveryAvailable === true); }
function orderItemsDeliveryFee(items = []) { return items.reduce((max, item) => Math.max(max, Math.max(0, Number(item.deliveryFee || 0))), 0); }
function orderItemsTitle(items = []) {
  if (!items.length) return "طلب";
  if (items.length === 1) return items[0].itemName;
  return `${items[0].itemName} + ${items.length - 1} أصناف`;
}
function orderItemsText(items = []) {
  return items.map(item => `${item.itemName} × ${formatServiceQuantity(item.quantity)} ${itemUnitSpec(item.itemUnit).short}`).join("، ");
}
function orderItemsHtml(items = []) {
  return items.map(item => `<div class="multi-order-line"><span><b>${restaurantSafeText(item.itemName)}</b><small>${formatServiceQuantity(item.quantity)} ${restaurantSafeText(itemUnitSpec(item.itemUnit).short)} × ${formatMoney(item.unitPrice)}</small></span><strong>${formatMoney(item.subtotal)}</strong></div>`).join("");
}

function parcelOrderParts(order) {
  const details = order?.parcelDetails || {};
  const routeParts = String(order?.route || "").split("←").map(x => x.trim());
  const titleName = String(order?.title || "").replace(/^توصيل غرض إلى\s*/u, "").trim();
  return {
    from: String(details.from || routeParts[0] || ""),
    to: String(details.to || routeParts[1] || ""),
    recipientName: String(details.recipientName || titleName || ""),
    recipientPhone: String(details.recipientPhone || ""),
    notes: String(details.notes || "")
  };
}

function canCustomerEditParcelOrder(order) {
  return !!(order && state.user && order.userId === state.user.uid && order.type === "parcel" && !order.cancelled && Number(order.statusIndex || 0) < 3);
}

function closeParcelEditModal() {
  state.parcelEditOrderId = null;
  byId("parcelEditModal")?.classList.remove("show");
}

function openParcelEditModal(orderId) {
  const order = state.orders.find(item => item.firestoreId === orderId);
  if (!canCustomerEditParcelOrder(order)) return showToast("تم استلام الغرض من مندوب التوصيل؛ لم يعد تعديل الطلب متاحًا.");
  state.parcelEditOrderId = orderId;
  const d = parcelOrderParts(order);
  byId("parcelEditFrom").value = d.from;
  byId("parcelEditTo").value = d.to;
  byId("parcelEditRecipientName").value = d.recipientName;
  byId("parcelEditRecipientPhone").value = d.recipientPhone;
  byId("parcelEditNotes").value = d.notes;
  const hint = byId("parcelEditHint");
  if (hint) hint.textContent = order.driverId ? "المندوب متجه للاستلام. يمكنك تعديل التفاصيل حتى يؤكد استلام الغرض." : "يمكنك تعديل تفاصيل التوصيل حتى يستلم المندوب الغرض فعليًا.";
  byId("parcelEditModal")?.classList.add("show");
}

async function saveParcelOrderEdit(button) {
  const orderId = state.parcelEditOrderId;
  if (!orderId || !state.user) return;
  const from = byId("parcelEditFrom").value.trim();
  const to = byId("parcelEditTo").value.trim();
  const recipientName = byId("parcelEditRecipientName").value.trim();
  const recipientPhone = byId("parcelEditRecipientPhone").value.trim();
  const notes = byId("parcelEditNotes").value.trim();
  if (from.length < 3 || to.length < 3) return showToast("أدخل عنوان الاستلام والتسليم بوضوح.");
  if (recipientName.length < 2) return showToast("أدخل اسم المستلم.");
  if (recipientPhone.replace(/\D/g, "").length < 8) return showToast("أدخل رقم هاتف صحيحًا للمستلم.");
  if (notes.length > 500) return showToast("الملاحظات يجب ألا تتجاوز 500 حرف.");
  setButtonBusy(button, true, "جاري حفظ التعديل…");
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, "orders", orderId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("ORDER_NOT_FOUND");
      const fresh = snap.data();
      if (fresh.userId !== state.user.uid || fresh.type !== "parcel" || fresh.cancelled || Number(fresh.statusIndex || 0) >= 3) throw new Error("EDIT_LOCKED");
      tx.update(ref, {
        title: `توصيل غرض إلى ${recipientName}`,
        route: `${from} ← ${to}`,
        parcelDetails: { from, to, recipientName, recipientPhone, notes },
        customerEditedAt: serverTimestamp(),
        customerEditCount: Number(fresh.customerEditCount || 0) + 1,
        updatedAt: serverTimestamp()
      });
    });
    closeParcelEditModal();
    showToast("تم تحديث تفاصيل التوصيل وإبلاغ المندوب بالتغييرات.");
  } catch (error) {
    console.error(error);
    showToast(String(error?.message || "").includes("EDIT_LOCKED") ? "تم استلام الغرض؛ لم يعد التعديل مسموحًا." : "تعذر تعديل طلب التوصيل.");
  } finally { setButtonBusy(button, false); }
}

function serviceDeliveryOrderFor(request) {
  if (!request) return null;
  return state.orders.find(order =>
    order.firestoreId === request.deliveryOrderId ||
    (order.type === "serviceDelivery" && order.serviceRequestId === request.firestoreId)
  ) || null;
}

function canCustomerEditServiceRequest(request) {
  if (!request || !state.user || request.customerId !== state.user.uid) return false;
  if (!["pending", "accepted"].includes(String(request.status || ""))) return false;
  const deliveryOrder = serviceDeliveryOrderFor(request);
  if (!deliveryOrder) return true;
  if (deliveryOrder.cancelled) return false;
  return Number(deliveryOrder.statusIndex || 0) < 3;
}

function serviceEditLockLabel(request) {
  const order = serviceDeliveryOrderFor(request);
  if (!order) return "يمكنك تعديل الكمية والملاحظات قبل اكتمال الطلب.";
  const step = Number(order.statusIndex || 0);
  if (step >= 3) return "تم استلام الطلب من مندوب التوصيل وأصبحت التعديلات مقفلة.";
  if (order.driverId) return "المندوب متجه للاستلام. يمكنك التعديل حتى يؤكد استلام الطلب.";
  return "يمكنك التعديل ما دام الطلب لم يُستلم من مندوب التوصيل.";
}

function renderServiceEditItems() {
  const host = byId("serviceEditItems");
  if (!host) return;
  const items = state.serviceEditDraftItems || [];
  host.innerHTML = items.length ? items.map((item,index)=>{
    const spec=itemUnitSpec(item.itemUnit);
    return `<div class="service-edit-item"><div><strong>${restaurantSafeText(item.itemName)}</strong><small style="display:block;color:#6b7d8e;margin-top:3px">${formatMoney(item.unitPrice)} / ${restaurantSafeText(spec.label)}</small></div><div class="field"><label>${restaurantSafeText(spec.quantityLabel)}</label><input type="number" inputmode="decimal" data-service-edit-qty="${index}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${Number(item.quantity)}"></div><button type="button" data-service-edit-remove="${index}" aria-label="حذف الصنف">×</button></div>`;
  }).join("") : '<div class="restaurant-empty">يجب أن يحتوي الطلب على صنف واحد على الأقل.</div>';
  serviceEditPreview();
}

function serviceEditPreview() {
  const total = byId("serviceEditTotal");
  const request = state.serviceRequests.find(item => item.firestoreId === state.serviceEditRequestId);
  const items = state.serviceEditDraftItems || [];
  let subtotal=0; let valid=items.length>0;
  items.forEach(item=>{ if(!quantityIsValid(item.quantity,item.itemUnit)) valid=false; subtotal+=Math.round(Number(item.unitPrice||0)*Number(item.quantity||0)); });
  if (!total) return;
  if (!valid) { total.textContent="أدخل كميات صحيحة لكل الأصناف"; return; }
  const deliveryFee=Math.max(0,Number(request?.deliveryFee||0));
  total.textContent=`${items.length} ${items.length===1?"صنف":"أصناف"} • ${formatMoney(subtotal+deliveryFee)}${deliveryFee?` (يشمل توصيل ${formatMoney(deliveryFee)})`:""}`;
}

function closeServiceEditModal() {
  state.serviceEditRequestId = null;
  state.serviceEditDraftItems = [];
  byId("serviceEditModal")?.classList.remove("show");
}

function openServiceEditModal(requestId) {
  const request = state.serviceRequests.find(item => item.firestoreId === requestId);
  if (!request) return showToast("تعذر العثور على الطلب.");
  if (!canCustomerEditServiceRequest(request)) return showToast("انتهت مهلة تعديل الطلب بعد استلامه من مندوب التوصيل.");
  state.serviceEditRequestId = requestId;
  state.serviceEditDraftItems = requestItemsOf(request).map(item=>({...item}));
  byId("serviceEditTitle").textContent = `تعديل الطلب • ${state.serviceEditDraftItems.length} ${state.serviceEditDraftItems.length===1?"صنف":"أصناف"}`;
  byId("serviceEditProvider").textContent = `${request.providerName || "مزود الخدمة"} • ${serviceEditLockLabel(request)}`;
  byId("serviceEditNote").value = String(request.requestText || "");
  renderServiceEditItems();
  byId("serviceEditModal")?.classList.add("show");
}

byId("serviceEditItems")?.addEventListener("input", event => {
  const input=event.target.closest("[data-service-edit-qty]");
  if(!input) return;
  const index=Number(input.dataset.serviceEditQty);
  if(state.serviceEditDraftItems[index]) state.serviceEditDraftItems[index].quantity=Number(input.value||0);
  serviceEditPreview();
});
byId("serviceEditItems")?.addEventListener("click", event => {
  const button=event.target.closest("[data-service-edit-remove]");
  if(!button) return;
  if(state.serviceEditDraftItems.length<=1) return showToast("يجب أن يبقى صنف واحد على الأقل في الطلب");
  state.serviceEditDraftItems.splice(Number(button.dataset.serviceEditRemove),1);
  renderServiceEditItems();
});

async function saveCustomerServiceEdit(button) {
  const requestId = state.serviceEditRequestId;
  const local = state.serviceRequests.find(item => item.firestoreId === requestId);
  if (!requestId || !local || !state.user) return;
  const note = String(byId("serviceEditNote")?.value || "").trim();
  const draft=(state.serviceEditDraftItems||[]).map(item=>({...item,quantity:Number(item.quantity||0)}));
  if (!draft.length || draft.length>MAX_MULTI_ORDER_ITEMS) return showToast("يجب أن يحتوي الطلب على صنف واحد على الأقل");
  if (draft.some(item=>!quantityIsValid(item.quantity,item.itemUnit))) return showToast("راجع كميات الأصناف قبل الحفظ");
  if (note.length < 3 || note.length > 500) return showToast("اكتب ملاحظة طلب واضحة بين 3 و500 حرف.");
  setButtonBusy(button, true, "جاري حفظ التعديل…");
  try {
    await runTransaction(db, async tx => {
      const requestRef = doc(db, "serviceRequests", requestId);
      const snap = await tx.get(requestRef);
      if (!snap.exists()) throw new Error("REQUEST_NOT_FOUND");
      const fresh = { firestoreId: requestId, ...snap.data() };
      if (fresh.customerId !== state.user.uid) throw new Error("NOT_OWNER");
      if (!["pending", "accepted"].includes(String(fresh.status || ""))) throw new Error("EDIT_LOCKED");
      let deliveryRef = null; let delivery = null;
      if (fresh.deliveryOrderId) {
        deliveryRef = doc(db, "orders", fresh.deliveryOrderId);
        const deliverySnap = await tx.get(deliveryRef);
        if (!deliverySnap.exists()) throw new Error("DELIVERY_NOT_FOUND");
        delivery = deliverySnap.data();
        if (delivery.cancelled || Number(delivery.statusIndex || 0) >= 3) throw new Error("EDIT_LOCKED");
      }
      const profileRef=doc(db,"serviceProfiles",fresh.providerId);
      const profileSnap=await tx.get(profileRef);
      if(!profileSnap.exists()) throw new Error("PROVIDER_NOT_FOUND");
      const catalog=Array.isArray(profileSnap.data().items)?profileSnap.data().items:[];
      const items=draft.map(entry=>{
        const current=normalizedClientItem(catalog[Number(entry.itemIndex)]);
        if(!current?.name || current.name!==entry.itemName || current.unit!==entry.itemUnit) throw new Error("ITEM_CHANGED");
        if(!quantityIsValid(entry.quantity,current.unit)) throw new Error("BAD_QUANTITY");
        return {itemIndex:Number(entry.itemIndex),itemName:current.name,itemUnit:current.unit,quantity:Number(entry.quantity),unitPrice:current.price,subtotal:Math.round(current.price*Number(entry.quantity)),deliveryAvailable:current.deliveryAvailable===true,deliveryFee:current.deliveryAvailable?Math.max(0,Number(current.deliveryFee||0)):0};
      });
      const subtotal=orderItemsSubtotal(items); const lead=items[0];
      const patch={items,itemCount:items.length,itemIndex:lead.itemIndex,itemName:lead.itemName,itemUnit:lead.itemUnit,quantity:lead.quantity,unitPrice:lead.unitPrice,itemPrice:lead.unitPrice,subtotal,totalPrice:subtotal+Math.max(0,Number(fresh.deliveryFee||0)),requestText:note.slice(0,500),customerEditedAt:serverTimestamp(),customerEditCount:Number(fresh.customerEditCount||0)+1,updatedAt:serverTimestamp()};
      if(fresh.providerCategory!=="restaurant"){
        const allDelivery=orderItemsDeliverable(items);
        patch.itemDeliveryAvailable=allDelivery; patch.itemDeliveryFee=allDelivery?orderItemsDeliveryFee(items):0;
        if(!fresh.deliveryOrderId && fresh.deliveryStatus!=="awaitingCaptain") patch.deliveryStatus=fresh.status==="accepted"?(allDelivery?"awaitingCustomerChoice":"notAvailable"):(allDelivery?"pendingProvider":"notAvailable");
      } else if(fresh.deliveryRequested && !orderItemsDeliverable(items)) throw new Error("DELIVERY_ITEM_LOCKED");
      tx.update(requestRef,patch);
      if (deliveryRef && delivery) tx.update(deliveryRef, { serviceTotal: patch.totalPrice, title:`توصيل ${orderItemsTitle(items)} من ${fresh.providerName}`, updatedAt: serverTimestamp() });
    });
    closeServiceEditModal();
    showToast("تم تعديل أصناف الطلب وإبلاغ مزود الخدمة بالتغييرات.");
  } catch (error) {
    console.error(error); const code=String(error?.message||"");
    showToast(code.includes("EDIT_LOCKED")?"تم استلام الطلب من مندوب التوصيل؛ لم يعد التعديل مسموحًا.":code.includes("ITEM_CHANGED")?"تغير أحد الأصناف لدى مزود الخدمة؛ أعد فتح الطلب.":"تعذر حفظ التعديل. تأكد أن الطلب لم يُستلم بعد.");
  } finally { setButtonBusy(button, false); }
}

function normalizedClientItem(item = {}) {
  const unit = otherItemUnitLabels[item.unit] ? item.unit : "item";
  return {
    ...item,
    name: String(item.name || "خدمة"),
    price: Math.max(0, Number(item.price || 0)),
    description: String(item.description || ""),
    unit,
    deliveryAvailable: item.deliveryAvailable === true,
    deliveryFee: item.deliveryAvailable === true ? Math.max(0, Number(item.deliveryFee || 0)) : 0
  };
}

function validServiceLocation(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function serviceLocationText(location) {
  return validServiceLocation(location)
    ? `${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}`
    : "غير محدد";
}

function professionLabel(profile = {}) { return (otherServiceCategories[profile.category] || ["🧰", String(profile.category || "مهنة")])[1]; }
function professionIcon(profile = {}) { return (otherServiceCategories[profile.category] || ["🧰", ""])[0]; }
function renderProfessionTabs() {
  const host = byId("professionServiceTabs"); if (!host) return;
  const professions = [...new Set(state.serviceProfiles.filter(p => p.category !== "restaurant").map(p => professionLabel(p)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
  host.innerHTML = professions.map(name => { const sample=state.serviceProfiles.find(p=>professionLabel(p)===name); const theme=karwaServiceTheme(sample||{category:"other"}); return `<button class="service-button" data-service="profession" data-profession="${restaurantSafeText(name)}"><span>${theme.icon}</span>${restaurantSafeText(name)}</button>`; }).join("");
  if (state.selectedProfession && !professions.includes(state.selectedProfession)) state.selectedProfession = "";
}

function renderOtherServices() {
  const host = byId("otherServicesMarketplace");
  if (!host) return;
  if (!state.user) {
    host.innerHTML = '<div class="restaurant-empty">سجّل الدخول لعرض مزودي الخدمات المعتمدين.</div>';
    return;
  }
  const visibleProfiles = state.serviceProfiles.filter(profile => profile.category !== "restaurant" && (!state.selectedProfession || professionLabel(profile) === state.selectedProfession));
  if (!visibleProfiles.length) {
    host.innerHTML = '<div class="restaurant-empty">لا توجد أنشطة معتمدة ضمن هذا التصنيف حاليًا.</div>';
    return;
  }
  host.innerHTML = visibleProfiles.map(profile => {
    const category = professionLabel(profile);
    const items = Array.isArray(profile.items) ? profile.items.map(normalizedClientItem) : [];
    const theme = karwaServiceTheme({ ...profile, items });
    const icon = theme.icon || professionIcon(profile);
    const locationAvailable = validServiceLocation(profile.location);
    return `<article class="other-service-card" data-theme="${restaurantSafeText(theme.key)}" style="${karwaServiceThemeStyle({ ...profile, items })}">
      <div class="other-service-theme" aria-hidden="true"><span class="other-service-theme-icon">${icon}</span></div>
      <div class="other-service-copy">
        <small>${restaurantSafeText(category)} • مزود معتمد</small>
        <h3>${restaurantSafeText(profile.businessName || "نشاط كروة")}</h3>
        <p>${restaurantSafeText(profile.description || "خدمة موثقة ومتاحة للطلب عبر كروة.")}</p>
        <div class="other-service-location"><span>📍 ${restaurantSafeText(profile.address || profile.city || "العنوان غير محدد")}</span><span>GPS: ${restaurantSafeText(serviceLocationText(profile.location))}</span></div>
        <div class="other-service-actions"><button class="secondary-button" type="button" data-show-service-location="${restaurantSafeText(profile.firestoreId)}" ${locationAvailable ? "" : "disabled"}>عرض موقع النشاط</button><span>${items.length ? `${items.length} خدمة/منتج` : "لا توجد عناصر منشورة"}</span></div>
        <div class="other-item-grid">${items.map((item, index) => `<article class="other-item-card"><div class="other-item-picture">${icon}</div><div class="other-item-body"><h4>${restaurantSafeText(item.name)}</h4><p>${restaurantSafeText(item.description || "لا توجد تفاصيل إضافية.")}</p><div class="other-item-price"><strong>${formatMoney(item.price)}</strong><small>لكل ${restaurantSafeText(otherItemUnitLabels[item.unit])}</small></div><small>${item.deliveryAvailable ? `يمكن اختيار التوصيل بعد موافقة النشاط • ${formatMoney(item.deliveryFee)}` : "استلام من النشاط بعد الموافقة"}</small><button type="button" data-select-service="${restaurantSafeText(profile.firestoreId)}" data-item-index="${index}">عرض التفاصيل واختيار الحاجة</button></div></article>`).join("") || '<div class="restaurant-empty">لم ينشر صاحب النشاط خدمات أو وجبات بعد.</div>'}</div>
      </div>
    </article>`;
  }).join("");
}

function renderOtherServiceCart() {
  const host = byId("otherServiceCart");
  const profile = state.selectedServiceProfile;
  const items = state.serviceCart || [];
  if (!host) return;
  if (!profile || !items.length) {
    host.innerHTML = '<div class="multi-service-cart-empty">أضف صنفًا واحدًا أو عدة أصناف من هذا النشاط.</div>';
    if (byId("bookOtherService")) { byId("bookOtherService").disabled = true; byId("bookOtherService").textContent = "إرسال الطلب إلى النشاط للموافقة"; }
    return;
  }
  const subtotal = orderItemsSubtotal(items);
  host.innerHTML = items.map((item,index)=>`<div class="multi-service-line"><span><b>${restaurantSafeText(item.itemName)}</b><small>${formatServiceQuantity(item.quantity)} ${restaurantSafeText(itemUnitSpec(item.itemUnit).short)} × ${formatMoney(item.unitPrice)}</small></span><strong>${formatMoney(item.subtotal)}</strong><button type="button" data-remove-service-cart="${index}" aria-label="حذف الصنف">×</button></div>`).join("") + `<div class="multi-service-cart-total"><span>${items.length} ${items.length===1?"صنف":"أصناف"}</span><strong>${formatMoney(subtotal)}</strong></div>`;
  if (byId("bookOtherService")) { byId("bookOtherService").disabled = false; byId("bookOtherService").textContent = `إرسال ${items.length} ${items.length===1?"صنف":"أصناف"} إلى النشاط`; }
}

function updateSelectedServicePrice() {
  const select = byId("otherServiceItem");
  const profile = state.selectedServiceProfile;
  if (!select || !profile) return;
  const item = select.value === "" ? null : normalizedClientItem(profile.items?.[Number(select.value)]);
  const quantityInput = byId("otherServiceQuantity");
  const deliveryNote = byId("selectedServiceDeliveryNote");
  if (!item) {
    byId("selectedItemImage").textContent = "🧰";
    byId("selectedItemName").textContent = "اختر خدمة لعرض التفاصيل";
    byId("selectedItemDescription").textContent = "سيظهر وصف الخدمة وسعر الوحدة هنا.";
    byId("selectedServicePrice").textContent = "—";
    byId("otherServiceGrandTotal").textContent = formatMoney(0);
    byId("otherServiceTotalBreakdown").textContent = "—";
    if (deliveryNote) deliveryNote.innerHTML = "<b>اختيار التوصيل بعد الموافقة</b><small>اختر خدمة أولًا لمعرفة إمكانية التوصيل.</small>";
    return;
  }
  byId("selectedItemImage").textContent = karwaServiceTheme({ ...profile, items:profile.items || [] }).icon || professionIcon(profile) || "🧰";
  byId("selectedItemName").textContent = item.name;
  byId("selectedItemDescription").textContent = item.description || "لا توجد تفاصيل إضافية.";
  const unitSpec = itemUnitSpec(item.unit);
  byId("selectedServicePrice").textContent = `${formatMoney(item.price)} لكل ${unitSpec.label}`;
  byId("otherServiceQuantityLabel").textContent = unitSpec.quantityLabel;
  configureQuantityInput(quantityInput, item.unit);
  if (deliveryNote) deliveryNote.innerHTML = item.deliveryAvailable
    ? `<b>التوصيل متاح بعد موافقة النشاط</b><small>بعد الموافقة تختار التوصيل مقابل ${formatMoney(item.deliveryFee)} أو الاستلام من النشاط.</small>`
    : `<b>الاستلام من النشاط</b><small>هذه الخدمة لا تتضمن توصيلًا. بعد الموافقة تستلمها من النشاط.</small>`;
  const quantity = Math.max(Number(quantityInput.min), Number(quantityInput.value || 1));
  const subtotal = Math.round(item.price * quantity);
  byId("otherServiceTotalBreakdown").textContent = `${formatServiceQuantity(quantity)} ${itemUnitSpec(item.unit).short} × ${formatMoney(item.price)}`;
  byId("otherServiceGrandTotal").textContent = formatMoney(subtotal);
  renderOtherServiceCart();
}

function selectServiceProfile(profile, itemIndex = 0) {
  if (!profile) return;
  if (state.selectedServiceProfile?.firestoreId !== profile.firestoreId) state.serviceCart = [];
  state.selectedServiceProfile = profile;
  const [, category] = otherServiceCategories[profile.category] || otherServiceCategories.other;
  byId("selectedServiceCategory").textContent = category;
  byId("selectedServiceName").textContent = profile.businessName || "نشاط كروة";
  byId("selectedServiceAddress").textContent = profile.address || profile.city || "العنوان غير محدد";
  byId("selectedServiceGps").textContent = serviceLocationText(profile.location);
  byId("locateSelectedService").disabled = !validServiceLocation(profile.location);
  const items = Array.isArray(profile.items) ? profile.items.map(normalizedClientItem) : [];
  byId("otherServiceItem").innerHTML = items.map((item, index) =>
    `<option value="${index}">${restaurantSafeText(item.name)} — ${restaurantSafeText(formatMoney(item.price))} / ${restaurantSafeText(otherItemUnitLabels[item.unit])}</option>`
  ).join("") || '<option value="">لا توجد خدمات منشورة</option>';
  byId("otherServiceItem").value = items[itemIndex] ? String(itemIndex) : (items.length ? "0" : "");
  byId("otherServiceQuantity").value = "1";
  byId("selectedServiceBox").hidden = false;
  updateSelectedServicePrice();
  renderOtherServiceCart();
  byId("selectedServiceBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function focusServiceLocation(profile) {
  if (!profile || !validServiceLocation(profile.location)) return showToast("لم يحدد مزود الخدمة موقع GPS بعد");
  initializeCustomerMap();
  const coordinates = [Number(profile.location.latitude), Number(profile.location.longitude)];
  if (state.serviceMarker) state.serviceMarker.setLatLng(coordinates);
  else state.serviceMarker = window.L.marker(coordinates).addTo(state.map);
  state.serviceMarker.bindPopup(`<div dir="rtl"><b>${restaurantSafeText(profile.businessName || "موقع الخدمة")}</b><br>${restaurantSafeText(profile.address || "")}</div>`).openPopup();
  state.map.setView(coordinates, 16);
  byId("mapInfoTitle").textContent = profile.businessName || "موقع الخدمة";
  byId("mapInfoText").textContent = profile.address || "موقع النشاط المعتمد";
  byId("customerOptionsClose")?.click();
  const mapCard = document.querySelector(".map-card");
  mapCard?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => state.map?.invalidateSize(), 250);
}

function subscribeServiceProfiles() {
  state.unsubscribeServiceProfiles?.();
  state.unsubscribeServiceProfiles = onSnapshot(
    query(collection(db, "serviceProfiles"), where("active", "==", true), where("approvalStatus", "==", "approved")),
    snapshot => {
      state.serviceProfiles = snapshot.docs.map(item => ({ firestoreId: item.id, ...item.data() }))
        .sort((a, b) => String(a.businessName || "").localeCompare(String(b.businessName || ""), "ar"));
      renderProfessionTabs();
      renderOtherServices();
      if (state.selectedServiceProfile) {
        const freshProfile = state.serviceProfiles.find(item => item.firestoreId === state.selectedServiceProfile.firestoreId);
        if (freshProfile) {
          state.selectedServiceProfile = freshProfile;
          byId("selectedServiceName").textContent = freshProfile.businessName || "نشاط كروة";
          byId("selectedServiceAddress").textContent = freshProfile.address || freshProfile.city || "العنوان غير محدد";
          updateSelectedServicePrice();
        }
        else {
          state.selectedServiceProfile = null;
          byId("selectedServiceBox").hidden = true;
        }
      }
    },
    error => {
      console.error(error);
      byId("otherServicesMarketplace").innerHTML = '<div class="restaurant-empty">تعذر تحميل الخدمات. انشر قواعد Firestore المرفقة.</div>';
    }
  );
}

function renderMyServiceRequests() {
  const host = byId("myServiceRequests");
  if (!host) return;
  if (!state.user) {
    host.innerHTML = '<div class="restaurant-empty">سجّل الدخول لمتابعة طلباتك.</div>';
    return;
  }
  host.innerHTML = state.serviceRequests.length ? state.serviceRequests.map(request => {
    const [statusLabel, statusClass] = otherRequestStatuses[request.status] || otherRequestStatuses.pending;
    const date = request.createdAt?.toDate?.();
    const deliveryOrder = state.orders.find(order => order.firestoreId === request.deliveryOrderId);
    const isRestaurantRequest = request.providerCategory === "restaurant";
    const deliveryAvailable = request.itemDeliveryAvailable === true || request.deliveryRequested === true || Number(request.itemDeliveryFee || request.deliveryFee || 0) > 0;
    const deliveryStatus = request.deliveryStatus || (request.deliveryRequested ? "awaitingCaptain" : "notRequested");
    let deliveryLabel = "استلام من النشاط";
    if (request.status === "pending") deliveryLabel = isRestaurantRequest
      ? (request.deliveryRequested ? "التوصيل ينتظر موافقة المطعم" : "تم اختيار الاستلام من المطعم")
      : (deliveryAvailable ? "بعد موافقة النشاط ستختار التوصيل أو الاستلام" : "هذه الخدمة للاستلام من النشاط");
    else if (request.status === "rejected" || request.status === "cancelled") deliveryLabel = "لم يتم إنشاء طلب توصيل";
    else if (deliveryStatus === "awaitingCustomerChoice") deliveryLabel = "تمت موافقة النشاط — اختر الآن التوصيل أو الاستلام";
    else if (deliveryStatus === "awaitingCaptain") {
      deliveryLabel = deliveryOrder?.cancelled
        ? "طلب التوصيل ملغي"
        : deliveryOrder?.driverId
          ? `${orderStatuses[Number(deliveryOrder.statusIndex || 0)] || "مع كابتن التوصيل"}${deliveryOrder.driverName ? ` • ${deliveryOrder.driverName}` : ""}`
          : "تم إرسال الطلب إلى كباتن التوصيل المطابقين داخل 10 كم";
    } else if (deliveryStatus === "notAvailable") deliveryLabel = "التوصيل غير متاح لهذه الخدمة";
    else if (deliveryStatus === "notRequested") deliveryLabel = "تم اختيار الاستلام من النشاط";

    const choiceBox = request.status === "accepted" && deliveryStatus === "awaitingCustomerChoice" && deliveryAvailable
      ? `<div class="service-delivery-choice-box">
          <strong>✓ وافق النشاط على طلبك</strong>
          <p>اختر طريقة استلام حاجتك. عند اختيار التوصيل سيُرسل الطلب فورًا إلى كابتن توصيل مؤهل ضمن 10 كم من موقع النشاط.</p>
          <input data-service-delivery-address="${restaurantSafeText(request.firestoreId)}" maxlength="180" placeholder="عنوانك بالتفصيل: الحي، الشارع، أقرب نقطة دالة">
          <button class="secondary-button" type="button" data-service-delivery-locate="${restaurantSafeText(request.firestoreId)}">📍 تحديد موقعي للتوصيل</button>
          <small class="service-delivery-location-status ${validServiceLocation(state.serviceDeliveryLocations[request.firestoreId]) ? "ready" : ""}" data-service-delivery-location-status="${restaurantSafeText(request.firestoreId)}">${validServiceLocation(state.serviceDeliveryLocations[request.firestoreId]) ? "تم تحديد موقعك GPS ✓" : "حدد موقعك GPS قبل اختيار التوصيل"}</small>
          <div class="service-delivery-choice-actions"><button class="primary-button" type="button" data-service-delivery-confirm="${restaurantSafeText(request.firestoreId)}">توصيل • ${formatMoney(request.itemDeliveryFee || request.deliveryFee || 0)}</button><button class="secondary-button" type="button" data-service-pickup-confirm="${restaurantSafeText(request.firestoreId)}">استلام من النشاط</button></div>
        </div>`
      : "";

    const displayedTotal = isRestaurantRequest || deliveryStatus === "awaitingCaptain" ? Number(request.totalPrice || request.subtotal || 0) : Number(request.subtotal || request.totalPrice || request.itemPrice || 0);
    const requestItems = requestItemsOf(request);
    return `<article class="my-service-request-card" data-service-request-card="${restaurantSafeText(request.firestoreId)}">
      <div class="service-request-head"><div><small>${restaurantSafeText(orderItemsTitle(requestItems))}</small><h3>${restaurantSafeText(request.providerName || "مزود خدمة")}</h3></div><span class="service-request-status ${statusClass}">${statusLabel}</span></div>
      <p>${restaurantSafeText(request.requestText || "")}</p>
      <div class="multi-order-items">${orderItemsHtml(requestItems)}</div>
      <div class="service-request-meta"><span>📍 ${restaurantSafeText(request.providerAddress || "العنوان غير محدد")}</span><span>${requestItems.length} ${requestItems.length===1?"صنف":"أصناف"}</span><span>قيمة الطلب ${formatMoney(displayedTotal)}</span>${date ? `<span>${date.toLocaleDateString("ar-IQ")}</span>` : ""}</div>
      <div class="service-provider-note">🚚 ${restaurantSafeText(deliveryLabel)}${deliveryStatus === "awaitingCaptain" ? ` • أجرة التوصيل ${formatMoney(request.deliveryFee)}` : ""}</div>
      ${request.providerNote ? `<div class="service-provider-note">ملاحظة المزود: ${restaurantSafeText(request.providerNote)}</div>` : ""}
      ${request.customerEditedAt ? `<div class="service-provider-note service-edit-note">✏️ تم تعديل الطلب ${Number(request.customerEditCount || 1).toLocaleString("ar-IQ")} مرة — آخر تعديل ${request.customerEditedAt?.toDate?.()?.toLocaleString?.("ar-IQ") || "حديثًا"}</div>` : ""}
      ${choiceBox}
      ${canCustomerEditServiceRequest(request) ? `<button class="secondary-button service-edit-button" type="button" data-edit-service-request="${restaurantSafeText(request.firestoreId)}">✏️ تعديل الطلب</button>` : (serviceDeliveryOrderFor(request) && Number(serviceDeliveryOrderFor(request).statusIndex || 0) >= 3 ? `<div class="service-edit-locked">🔒 تم استلام الطلب من المندوب — التعديل مقفل</div>` : "")}
      ${(() => {
        const deliveryFinished = !request.deliveryRequested || !request.deliveryOrderId || (deliveryOrder && !deliveryOrder.cancelled && Number(deliveryOrder.statusIndex || 0) >= 4);
        if (request.status !== "completed" || !deliveryFinished) return "";
        const savedProviderRating = findServiceRating(request.firestoreId);
        return savedProviderRating
          ? `<div class="service-rating-result"><span class="rating-result">${"★".repeat(Number(savedProviderRating.score||0))}${"☆".repeat(5-Number(savedProviderRating.score||0))}</span><small>تم تقييم ${restaurantSafeText(request.providerName || "الخدمة")}</small></div>`
          : `<button class="primary-button service-rate-button" type="button" data-rate-service-request="${restaurantSafeText(request.firestoreId)}">★ قيّم الخدمة</button>`;
      })()}
      ${request.status === "pending" ? `<button class="secondary-button danger-button" type="button" data-cancel-service-request="${restaurantSafeText(request.firestoreId)}">إلغاء الطلب</button>` : ""}
    </article>`;
  }).join("") : '<div class="restaurant-empty">لا توجد طلبات خدمات بعد.</div>';
}

function subscribeServiceRequests(user) {
  state.unsubscribeServiceRequests?.();
  state.unsubscribeServiceRequests = onSnapshot(
    query(collection(db, "serviceRequests"), where("customerId", "==", user.uid)),
    snapshot => {
      state.serviceRequests = snapshot.docs.map(item => ({ firestoreId: item.id, ...item.data() }))
        .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
      renderMyServiceRequests();
    },
    error => {
      console.error(error);
      byId("myServiceRequests").innerHTML = '<div class="restaurant-empty">تعذر تحميل طلبات الخدمات.</div>';
    }
  );
}

byId("otherServicesMarketplace")?.addEventListener("click", event => {
  const selectButton = event.target.closest("[data-select-service]");
  const locationButton = event.target.closest("[data-show-service-location]");
  const id = selectButton?.dataset.selectService || locationButton?.dataset.showServiceLocation;
  const profile = state.serviceProfiles.find(item => item.firestoreId === id);
  if (selectButton) selectServiceProfile(profile, Number(selectButton.dataset.itemIndex || 0));
  if (locationButton) focusServiceLocation(profile);
});
byId("otherServiceItem")?.addEventListener("change", updateSelectedServicePrice);
byId("otherServiceQuantity")?.addEventListener("input", updateSelectedServicePrice);
byId("closeSelectedService")?.addEventListener("click", () => {
  state.selectedServiceProfile = null;
  state.serviceCart = [];
  renderOtherServiceCart();
  byId("selectedServiceBox").hidden = true;
});
byId("locateSelectedService")?.addEventListener("click", () => focusServiceLocation(state.selectedServiceProfile));
byId("addOtherServiceItem")?.addEventListener("click", () => {
  const profile = state.selectedServiceProfile;
  if (!profile) return showToast("اختر نشاطًا أولًا");
  const selectedValue = byId("otherServiceItem")?.value ?? "";
  if (selectedValue === "") return showToast("اختر الخدمة أو المنتج");
  const itemIndex = Number(selectedValue);
  const item = normalizedClientItem(profile.items?.[itemIndex]);
  const quantity = Number(byId("otherServiceQuantity")?.value || 0);
  if (!quantityIsValid(quantity, item.unit)) return showToast(`أدخل ${itemUnitSpec(item.unit).quantityLabel} بشكل صحيح`);
  const line = { itemIndex, itemName:item.name, itemUnit:item.unit, quantity, unitPrice:item.price, subtotal:Math.round(item.price*quantity), deliveryAvailable:item.deliveryAvailable===true, deliveryFee:item.deliveryAvailable?Math.max(0,Number(item.deliveryFee||0)):0 };
  const existing = state.serviceCart.find(entry => Number(entry.itemIndex) === itemIndex);
  if (existing) Object.assign(existing, line);
  else {
    if (state.serviceCart.length >= MAX_MULTI_ORDER_ITEMS) return showToast(`الحد الأقصى ${MAX_MULTI_ORDER_ITEMS} أصناف في الطلب الواحد`);
    state.serviceCart.push(line);
  }
  renderOtherServiceCart();
  showToast(`تمت إضافة ${item.name} إلى الطلب`);
});

byId("otherServiceCart")?.addEventListener("click", event => {
  const button = event.target.closest("[data-remove-service-cart]");
  if (!button) return;
  state.serviceCart.splice(Number(button.dataset.removeServiceCart),1);
  renderOtherServiceCart();
});

async function createServiceRequestWithCustomerFee(payload){
  const fee=customerOperationFee("service");
  const walletPatch=walletDebitPatch({balance:state.balance,bonusBalance:state.bonusBalance,bonusExpiresAt:state.bonusExpiresAt},fee);
  if(fee>0&&!walletPatch)throw new Error(`الرصيد غير كافٍ. يلزم ${formatMoney(fee)} رسم كروة لإرسال الطلب. اشحن المحفظة ثم أعد المحاولة.`);
  const requestRef=doc(collection(db,"serviceRequests"));
  const batch=writeBatch(db);
  batch.set(requestRef,{...payload,customerPlatformFee:fee,customerFeeCharged:true,providerPlatformFee:0,providerFeeCharged:false});
  if(walletPatch)batch.set(doc(db,"users",state.user.uid),walletPatch,{merge:true});
  await batch.commit();
  applyWalletPatchToState(walletPatch);
  return requestRef;
}

byId("bookOtherService")?.addEventListener("click", async event => {
  if (!requireUser()) return;
  const profile = state.selectedServiceProfile;
  if (!profile) return showToast("اختر مزود خدمة أولًا");
  if (!state.serviceCart.length) return showToast("أضف صنفًا واحدًا على الأقل إلى الطلب");
  const orderItems=[];
  for (const chosen of state.serviceCart) {
    const item=normalizedClientItem(profile.items?.[chosen.itemIndex]);
    if(!item?.name || item.name!==chosen.itemName) return showToast("تغيرت قائمة النشاط. أعد اختيار الأصناف.");
    const quantity=Number(chosen.quantity||0);
    if(!quantityIsValid(quantity,item.unit)) return showToast(`الكمية المختارة لـ ${item.name} لم تعد صالحة`);
    orderItems.push({itemIndex:Number(chosen.itemIndex),itemName:item.name,itemUnit:item.unit,quantity,unitPrice:item.price,subtotal:Math.round(item.price*quantity),deliveryAvailable:item.deliveryAvailable===true,deliveryFee:item.deliveryAvailable?Math.max(0,Number(item.deliveryFee||0)):0});
  }
  const requestText = byId("otherServiceRequest").value.trim() || `طلب: ${orderItemsText(orderItems)}`;
  const subtotal=orderItemsSubtotal(orderItems);
  const lead=orderItems[0];
  const allDelivery=orderItemsDeliverable(orderItems);
  const itemDeliveryFee=allDelivery?orderItemsDeliveryFee(orderItems):0;
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري إرسال الطلب…");
  try {
    await createServiceRequestWithCustomerFee({
      customerId: state.user.uid, customerName: state.name, providerId: profile.firestoreId, providerName: profile.businessName,
      providerCategory: profile.category || "other", providerCity: profile.city || "", providerAddress: profile.address || profile.city || "غير محدد",
      providerLocation: validServiceLocation(profile.location) ? { ...profile.location } : null,
      items:orderItems, itemCount:orderItems.length, itemIndex:lead.itemIndex, itemName:lead.itemName, itemUnit:lead.itemUnit, quantity:lead.quantity, unitPrice:lead.unitPrice, itemPrice:lead.unitPrice, subtotal,
      itemDeliveryAvailable:allDelivery, itemDeliveryFee, deliveryRequested:false, deliveryFee:0, totalPrice:subtotal, deliveryStatus:allDelivery?"pendingProvider":"notAvailable", deliveryOrderId:"",
      requestText, customerAddress:"", customerLocation:null, status:"pending", createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    state.serviceCart=[]; renderOtherServiceCart(); byId("otherServiceRequest").value="";
    showToast(`تم إرسال ${orderItems.length} ${orderItems.length===1?"صنف":"أصناف"} إلى ${profile.businessName} بقيمة ${formatMoney(subtotal)}.`);
  } catch (error) {
    console.error(error);
    showToast(String(error?.message||"").includes("الرصيد غير كافٍ") ? error.message : "تعذر إرسال الطلب. تأكد من نشر قواعد Firestore الجديدة.");
  } finally { setButtonBusy(button, false); }
});

byId("myServiceRequests")?.addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit-service-request]");
  if (editButton) {
    openServiceEditModal(editButton.dataset.editServiceRequest);
    return;
  }
  const ratingButton = event.target.closest("[data-rate-service-request]");
  if (ratingButton) {
    openRatingModal("service", ratingButton.dataset.rateServiceRequest);
    return;
  }
  const cancelButton = event.target.closest("[data-cancel-service-request]");
  const locateButton = event.target.closest("[data-service-delivery-locate]");
  const deliveryButton = event.target.closest("[data-service-delivery-confirm]");
  const pickupButton = event.target.closest("[data-service-pickup-confirm]");

  if (cancelButton) {
    if (!confirm("هل تريد إلغاء طلب الخدمة؟")) return;
    const reason = requestCancellationReason("طلب الخدمة");
    if (!reason) return;
    setButtonBusy(cancelButton, true, "جاري الإلغاء…");
    try {
      await updateDoc(doc(db, "serviceRequests", cancelButton.dataset.cancelServiceRequest), {
        status: "cancelled",
        ...customerCancellationMeta(reason)
      });
      showToast("تم إلغاء طلب الخدمة وتسجيل السبب للإدارة");
    } catch (error) {
      console.error(error);
      showToast("تعذر إلغاء الطلب");
    } finally {
      setButtonBusy(cancelButton, false);
    }
    return;
  }

  const requestId = locateButton?.dataset.serviceDeliveryLocate || deliveryButton?.dataset.serviceDeliveryConfirm || pickupButton?.dataset.servicePickupConfirm;
  if (!requestId) return;
  const request = state.serviceRequests.find(item => item.firestoreId === requestId);
  if (!request || request.status !== "accepted" || request.deliveryStatus !== "awaitingCustomerChoice") return showToast("هذا الطلب لم يعد ينتظر اختيار طريقة الاستلام.");

  if (locateButton) {
    setButtonBusy(locateButton, true, "جاري تثبيت GPS…");
    try {
      const position = await getKarwaPrecisePosition();
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      state.serviceDeliveryLocations[requestId] = location;
      setCustomerLocation(location.latitude, location.longitude);
      if (state.customerLocation) state.customerLocation.accuracy = location.accuracy;
      const card = locateButton.closest("[data-service-request-card]");
      const status = card?.querySelector("[data-service-delivery-location-status]");
      if (status) { status.textContent = `تم تحديد موقعك GPS ✓ دقة ${Math.round(location.accuracy||0)} م`; status.classList.add("ready"); }
      showToast("تم تحديد موقع التوصيل بدقة عالية");
    } catch(error) { handlePreciseLocationFailure(error); }
    finally { setButtonBusy(locateButton, false); }
    return;
  }

  if (pickupButton) {
    setButtonBusy(pickupButton, true, "جاري الحفظ…");
    try {
      await updateDoc(doc(db, "serviceRequests", requestId), {
        deliveryRequested: false,
        deliveryFee: 0,
        totalPrice: Number(request.subtotal || 0),
        deliveryStatus: "notRequested",
        customerAddress: "استلام من النشاط",
        customerLocation: null,
        deliveryChosenAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      delete state.serviceDeliveryLocations[requestId];
      showToast("تم اختيار الاستلام من النشاط");
    } catch (error) {
      console.error(error);
      showToast("تعذر حفظ اختيار الاستلام");
    } finally {
      setButtonBusy(pickupButton, false);
    }
    return;
  }

  if (deliveryButton) {
    const card = deliveryButton.closest("[data-service-request-card]");
    const address = card?.querySelector("[data-service-delivery-address]")?.value.trim() || "";
    const location = state.serviceDeliveryLocations[requestId] || null;
    if (address.length < 3) return showToast("اكتب عنوان التوصيل بالتفصيل");
    if (!validServiceLocation(location)) return showToast("حدد موقعك GPS قبل طلب التوصيل");
    if (!validServiceLocation(request.providerLocation)) return showToast("موقع النشاط غير محدد؛ اطلب من مزود الخدمة تحديث موقعه");
    const deliveryFee = Math.max(0, Number(request.itemDeliveryFee || 0));
    const subtotal = Math.max(0, Number(request.subtotal || 0));
    const totalPrice = subtotal + deliveryFee;
    const orderRef = doc(collection(db, "orders"));
    const createdAtISO = new Date().toISOString();
    setButtonBusy(deliveryButton, true, "جاري إرسال التوصيل…");
    try {
      const batch = writeBatch(db);
      batch.set(orderRef, {
        id: "KW-D" + String(Date.now()).slice(-6),
        userId: state.user.uid,
        customerName: request.customerName || state.name || state.user.displayName || "عميل كروة",
        providerId: request.providerId,
        serviceRequestId: requestId,
        type: "serviceDelivery",
        title: `توصيل ${orderItemsTitle(requestItemsOf(request))} من ${request.providerName}`,
        route: `${request.providerAddress} ← ${address}`,
        price: deliveryFee,
        serviceTotal: totalPrice,
        payment: "نقدًا",
        driverId: null,
        driverName: "",
        driverPhone: "",
        assignmentStatus: "available",
        pickupLocation: { ...request.providerLocation },
        destinationLocation: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        serviceCity: request.providerCity || "",
        requiredDriverService: "delivery",
        distanceKm: 0,
        durationMin: 0,
        routeSource: "serviceDelivery",
        commissionRate: 0,
        commissionAmount: 0,
        driverEarnings: deliveryFee,
        customerPlatformFee: 0,
        customerFeeCharged: true,
        captainPlatformFee: 0,
        captainFeeCharged: false,
        tripOtp: String(Math.floor(1000 + Math.random() * 9000)),
        paymentStatus: "pending",
        acceptedAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
        cancellationReason: "",
        statusIndex: 0,
        cancelled: false,
        createdAt: serverTimestamp(),
        createdAtISO,
        updatedAt: serverTimestamp()
      });
      batch.update(doc(db, "serviceRequests", requestId), {
        deliveryRequested: true,
        deliveryFee,
        totalPrice,
        deliveryStatus: "awaitingCaptain",
        deliveryOrderId: orderRef.id,
        pickupOtp: String(Math.floor(1000 + Math.random() * 9000)),
        customerAddress: address,
        customerLocation: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        deliveryChosenAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await batch.commit();
      delete state.serviceDeliveryLocations[requestId];
      showToast("تم إرسال طلب التوصيل مباشرة إلى كباتن التوصيل المؤهلين ضمن 10 كم");
    } catch (error) {
      console.error(error);
      showToast("تعذر إنشاء طلب التوصيل. تأكد من نشر قواعد Firestore الجديدة.");
    } finally {
      setButtonBusy(deliveryButton, false);
    }
  }
});

byId("closeServiceEdit")?.addEventListener("click", closeServiceEditModal);
byId("serviceEditModal")?.addEventListener("click", event => { if (event.target === event.currentTarget) closeServiceEditModal(); });
byId("serviceEditForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  await saveCustomerServiceEdit(byId("saveServiceEdit"));
});

document.querySelectorAll(".add-food-button").forEach(button => {
  button.addEventListener("click", () => {
    state.cart.push({ name: button.dataset.food, price: Number(button.dataset.price) });
    renderCart();
    showToast("تمت الإضافة إلى السلة");
  });
});

function renderCart() {
  const items=state.cart;
  const first=items[0];
  const deliveryToggle=byId("foodDeliveryRequested");
  const canDeliver=orderItemsDeliverable(items.map(item=>({deliveryAvailable:item.deliveryAvailable})));
  if(deliveryToggle){ deliveryToggle.disabled=!canDeliver; if(!canDeliver) deliveryToggle.checked=false; }
  const wantsDelivery=Boolean(first && canDeliver && deliveryToggle?.checked);
  const subtotal=items.reduce((sum,item)=>sum+Number(item.subtotal??item.price??0),0);
  const deliveryFee=wantsDelivery ? items.reduce((max,item)=>Math.max(max,Number(item.deliveryFee||0)),0) : 0;
  const total=subtotal+deliveryFee;
  byId("cartBar").classList.toggle("show", Boolean(first));
  byId("cartCount").textContent = first ? `${items.length} ${items.length===1?"صنف":"أصناف"} من ${first.restaurantName}` : "";
  byId("cartPrice").textContent = first ? `${formatMoney(total)} • ${wantsDelivery ? "مع التوصيل" : "استلام من المطعم"}` : "";
  const list=byId("foodCartItems");
  if(list) list.innerHTML=items.map((item,index)=>`<div class="food-cart-line"><span><b>${restaurantSafeText(item.name)}</b><small>${formatServiceQuantity(item.quantity||1)} ${restaurantSafeText(itemUnitSpec(item.unit).short)} × ${formatMoney(item.unitPrice||0)}</small></span><strong>${formatMoney(item.subtotal||0)}</strong><button type="button" data-remove-food-item="${index}" aria-label="حذف الصنف">×</button></div>`).join("");
  if(byId("foodDeliveryFeeLabel")) byId("foodDeliveryFeeLabel").textContent = first ? (canDeliver ? `أجرة التوصيل للطلب ${formatMoney(items.reduce((max,item)=>Math.max(max,Number(item.deliveryFee||0)),0))} — تدفع مرة واحدة مهما تعددت الأصناف` : "يوجد صنف لا يدعم التوصيل — الطلب متاح للاستلام من المطعم") : "";
  if(byId("foodDeliveryDetails")) byId("foodDeliveryDetails").style.display=wantsDelivery?"contents":"none";
}

byId("foodCartItems")?.addEventListener("click", event => {
  const button=event.target.closest("[data-remove-food-item]");
  if(!button) return;
  state.cart.splice(Number(button.dataset.removeFoodItem),1);
  renderCart();
  showToast(state.cart.length?"تم حذف الصنف من الطلب":"تم تفريغ الطلب");
});

byId("foodDeliveryRequested")?.addEventListener("change", renderCart);
byId("useFoodCustomerLocation")?.addEventListener("click",async()=>{
  const btn=byId("useFoodCustomerLocation"); setButtonBusy(btn,true,"جارٍ تثبيت GPS…");
  try {
    const pos=await getKarwaPrecisePosition();
    setCustomerLocation(pos.coords.latitude,pos.coords.longitude);
    if(state.customerLocation)state.customerLocation.accuracy=pos.coords.accuracy;
    byId("foodLocationStatus").textContent=`تم تحديد موقع العميل ✓ دقة ${Math.round(pos.coords.accuracy||0)} م`;
  } catch(error) { handlePreciseLocationFailure(error); }
  finally { setButtonBusy(btn,false); }
});

byId("orderFood").addEventListener("click", async event => {
  if (!requireUser() || !state.cart.length) return;
  const cart=[...state.cart]; const first=cart[0];
  if(cart.some(item=>item.restaurantId!==first.restaurantId)) return showToast("يجب أن تكون جميع أصناف الطلب من نفس المطعم");
  const restaurant=state.restaurants.find(r=>r.firestoreId===first.restaurantId);
  const profile=state.serviceProfiles.find(p=>p.firestoreId===first.restaurantId && p.category==="restaurant" && p.active===true && p.approvalStatus==="approved");
  if(!restaurant||!profile)return showToast("المطعم لم يعد متاحًا أو غير معتمد");
  const orderItems=[];
  for(const line of cart){
    const normalized=normalizedClientItem(profile.items?.[line.mealIndex]);
    if(!normalized?.name || normalized.name!==line.name) return showToast("تغيرت قائمة المطعم. أعد اختيار الأصناف.");
    if(line.unit!==normalized.unit) return showToast(`تغيرت وحدة تسعير ${line.name}. أعد اختياره.`);
    const quantity=Number(line.quantity||1); if(!quantityIsValid(quantity,normalized.unit)) return showToast(`الكمية المختارة لـ ${line.name} لم تعد صالحة.`);
    orderItems.push({itemIndex:Number(line.mealIndex),itemName:normalized.name,itemUnit:normalized.unit,quantity,unitPrice:normalized.price,subtotal:Math.round(normalized.price*quantity),deliveryAvailable:normalized.deliveryAvailable===true,deliveryFee:normalized.deliveryAvailable?Math.max(0,Number(normalized.deliveryFee||0)):0});
  }
  const canDeliver=orderItemsDeliverable(orderItems);
  const deliveryRequested=Boolean(byId("foodDeliveryRequested")?.checked && canDeliver);
  const address=deliveryRequested ? byId("foodCustomerAddress").value.trim() : "استلام من المطعم";
  if(deliveryRequested && address.length<3)return showToast("اكتب عنوان العميل بالتفصيل");
  if(deliveryRequested && !validServiceLocation(state.customerLocation))return showToast("حدد موقع العميل GPS قبل إرسال طلب التوصيل");
  const subtotal=orderItemsSubtotal(orderItems);
  const deliveryFee=deliveryRequested ? orderItemsDeliveryFee(orderItems) : 0;
  const lead=orderItems[0];
  const button=event.currentTarget; setButtonBusy(button,true,"جاري إرسال الطلب للمطعم…");
  try {
    await createServiceRequestWithCustomerFee({customerId:state.user.uid,customerName:state.name,providerId:first.restaurantId,providerName:profile.businessName,providerCategory:"restaurant",providerCity:profile.city||"",providerAddress:profile.address,providerLocation:{...profile.location},items:orderItems,itemCount:orderItems.length,itemIndex:lead.itemIndex,itemName:lead.itemName,itemUnit:lead.itemUnit,quantity:lead.quantity,unitPrice:lead.unitPrice,itemPrice:lead.unitPrice,subtotal,deliveryRequested,deliveryFee,totalPrice:subtotal+deliveryFee,deliveryStatus:deliveryRequested ? "pendingProvider" : "notRequested",deliveryOrderId:"",requestText:`طلب طعام: ${orderItemsText(orderItems)}`,customerAddress:address,customerLocation:deliveryRequested ? {...state.customerLocation} : null,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    state.cart=[]; renderCart(); byId("foodCustomerAddress").value=""; byId("foodLocationStatus").textContent="يجب تحديد موقعك قبل إرسال طلب التوصيل للمطعم."; showToast(deliveryRequested ? `تم إرسال ${orderItems.length} أصناف للمطعم مع طلب التوصيل.` : `تم إرسال ${orderItems.length} أصناف للمطعم للاستلام.`);
  } catch(error){console.error(error);showToast(String(error?.message||"").includes("الرصيد غير كافٍ") ? error.message : "تعذر إرسال الطلب. تأكد أن بيانات المطعم منشورة ومعتمدة.");} finally {setButtonBusy(button,false);}
});

byId("foodFilter")?.addEventListener("click", () => showToast("المطاعم مرتبة حسب وقت التوصيل"));

function renderTracking() {
  const card = byId("trackingCard");
  const tripToggle = byId("tripPanelToggle");
  card.classList.toggle("show", Boolean(state.activeOrder));
  tripToggle?.classList.toggle("hidden", !state.activeOrder);
  if (!state.activeOrder) {
    byId("home")?.classList.remove("trip-panel-hidden");
    if (tripToggle) {
      tripToggle.setAttribute("aria-expanded", "true");
      tripToggle.setAttribute("aria-label", "إخفاء معلومات الرحلة");
      const label = tripToggle.querySelector("strong");
      if (label) label.textContent = "إخفاء الرحلة";
    }
    return;
  }
  const order = state.activeOrder;
  const statusIndex = Number(order.statusIndex || 0);
  byId("trackingTitle").textContent = order.title;
  byId("trackingRoute").textContent = order.route;
  byId("trackingCode").textContent = "رقم الطلب: " + order.id;
  byId("trackingDriver").textContent = order.driverName ? ` • الكابتن: ${order.driverName}` : " • بانتظار قبول كابتن";
  const call=byId("callDriver"); if(call){call.classList.toggle("hidden",!order.driverPhone);call.href=order.driverPhone?`tel:${String(order.driverPhone).replace(/[^+\d]/g,"")}`:"#";}
  const stageHint=byId("tripStageHint"); if(stageHint)stageHint.textContent=order.type==="serviceDelivery"?(statusIndex===0?"بانتظار كابتن توصيل":statusIndex===1?"الكابتن في الطريق إلى المطعم":statusIndex===2?"الكابتن وصل إلى المطعم لاستلام الطلب":statusIndex===3?"الطلب في الطريق إليك — أعطِ رمز التسليم للكابتن فقط عند وصوله":"تم تسليم الطلب"):(statusIndex===0?"نبحث عن كابتن قريب":statusIndex===1?"الكابتن في الطريق إلى نقطة الانطلاق":statusIndex===2?"الكابتن وصل — أعطه رمز الرحلة. وإذا لم يُدخل الرمز، سيتحقق كروة تلقائيًا عند وصولكما معًا إلى الوجهة":statusIndex===3?"الرحلة جارية نحو الوجهة":"وصلت بالسلامة");
  if(order.driverId && state.driverMarker) drawLiveRoute(true);
  byId("trackingStatus").textContent = order.type === "serviceDelivery"
    ? (["بانتظار كابتن", "الكابتن في الطريق إلى الاستلام", "وصل الكابتن إلى نقطة الاستلام", "الطلب في الطريق إليك", "تم التسليم"][statusIndex] || "قيد المتابعة")
    : (orderStatuses[statusIndex] || "قيد المتابعة");
  const showTripOtp = Boolean(order.driverId && (order.type === "serviceDelivery" ? statusIndex < 4 : statusIndex < 3));
  byId("tripOtpBox").classList.toggle("hidden", !showTripOtp);
  byId("tripOtp").textContent = order.tripOtp || "—";
  renderTripBarcode(order.tripOtp, showTripOtp);
  byId("paymentTripStatus").textContent = order.paymentStatus === "paid" ? "مكتمل" : "يُسوّى عند الإكمال";
  byId("progressBar").style.width = `${((statusIndex + 1) / orderStatuses.length) * 100}%`;
  const completed = statusIndex >= orderStatuses.length - 1;
  const cancellationLockedAfterCode = order.type === "ride" && statusIndex >= 3;
  byId("advanceOrder").disabled = true;
  byId("advanceOrder").textContent = completed ? "تم إكمال الطلب" : "تحديث مباشر من الكابتن";
  byId("cancelOrder").style.display = (completed || cancellationLockedAfterCode) ? "none" : "block";
}

byId("cancelOrder").addEventListener("click", async event => {
  if (!state.activeOrder?.firestoreId) return;
  if (state.activeOrder.type === "ride" && Number(state.activeOrder.statusIndex || 0) >= 3) { showToast("لا يمكن إلغاء الرحلة بعد قراءة الكابتن لرمز بدء الرحلة."); return; }
  if (!confirm("هل تريد إلغاء الطلب؟")) return;
  const reason = requestCancellationReason("الطلب");
  if (!reason) return;
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الإلغاء…");
  try {
    await updateDoc(doc(db, "orders", state.activeOrder.firestoreId), {
      cancelled: true,
      ...customerCancellationMeta(reason)
    });
    showToast("تم إلغاء الطلب وتسجيل السبب للإدارة");
  } catch (error) {
    console.error(error);
    showToast("تعذر إلغاء الطلب");
  } finally {
    setButtonBusy(button, false);
  }
});

function renderOrders() {
  const container = byId("ordersList");
  container.innerHTML = "";
  const customerOrders = state.orders || [];
  const activeOrders = customerOrders.filter(order => !order.cancelled && Number(order.statusIndex || 0) < orderStatuses.length - 1).length;
  const completedOrders = customerOrders.filter(order => !order.cancelled && Number(order.statusIndex || 0) >= orderStatuses.length - 1).length;
  if (byId("ordersTotalCount")) byId("ordersTotalCount").textContent = String(customerOrders.length);
  if (byId("ordersActiveCount")) byId("ordersActiveCount").textContent = String(activeOrders);
  if (byId("ordersCompletedCount")) byId("ordersCompletedCount").textContent = String(completedOrders);
  renderCustomerSettingsInfo();
  if (!state.user) {
    container.innerHTML = `<div class="card empty-state"><span>🔐</span><strong>سجّل الدخول لعرض طلباتك</strong><p>طلبات كل مستخدم محفوظة في حسابه.</p></div>`;
    return;
  }
  if (!state.orders.length) {
    container.innerHTML = `<div class="card empty-state"><span>🧾</span><strong>لا توجد طلبات بعد</strong><p>سيظهر أول طلب تنشئه هنا.</p></div>`;
    return;
  }
  state.orders.forEach(order => {
    const article = document.createElement("article");
    article.className = "card order-item";
    const icon = document.createElement("div");
    icon.className = "order-icon";
    icon.textContent = serviceIcons[order.type] || "🧾";
    const details = document.createElement("div");
    details.className = "order-details";
    const title = document.createElement("strong");
    title.textContent = order.title;
    const route = document.createElement("small");
    const date = new Date(order.createdAtISO || Date.now());
    route.textContent = `${order.route} • ${date.toLocaleDateString("ar-IQ")}`;
    if (order.driverName) route.textContent += ` • الكابتن: ${order.driverName}`;
    if (order.scheduledAt) route.textContent += ` • مجدولة: ${new Date(order.scheduledAt).toLocaleString("ar-IQ")}`;
    details.append(title, route);
    if (order.type === "ride") {
      const actions=document.createElement("div"); actions.className="order-actions";
      const repeat=document.createElement("button"); repeat.className="mini-action"; repeat.textContent="↻ إعادة الحجز"; repeat.onclick=()=>{ if(order.pickupLocation&&order.destinationLocation){ setBookingPoint("pickup",order.pickupLocation.latitude,order.pickupLocation.longitude); setBookingPoint("destination",order.destinationLocation.latitude,order.destinationLocation.longitude); switchView("home"); showToast("تم تحميل مسار الرحلة السابقة"); } }; actions.appendChild(repeat);
      if (!order.cancelled && Number(order.statusIndex||0)>=4){ const inv=document.createElement("button"); inv.className="mini-action"; inv.textContent="🧾 الفاتورة"; inv.onclick=()=>printInvoice(order); actions.appendChild(inv); }
      details.appendChild(actions);
    }
    if (order.type === "parcel") {
      const actions = document.createElement("div"); actions.className = "order-actions";
      if (canCustomerEditParcelOrder(order)) {
        const edit = document.createElement("button"); edit.className = "mini-action"; edit.type = "button"; edit.textContent = "✏️ تعديل التوصيل"; edit.onclick = () => openParcelEditModal(order.firestoreId); actions.appendChild(edit);
      } else if (!order.cancelled && Number(order.statusIndex || 0) >= 3) {
        const locked = document.createElement("small"); locked.className = "service-edit-locked"; locked.textContent = "🔒 تم استلام الغرض — التعديل مقفل"; actions.appendChild(locked);
      }
      if (order.customerEditedAt) { const edited = document.createElement("small"); edited.className = "service-edit-note"; edited.textContent = `✏️ عُدّل الطلب ${Number(order.customerEditCount || 1).toLocaleString("ar-IQ")} مرة`; actions.appendChild(edited); }
      if (actions.childNodes.length) details.appendChild(actions);
    }
    const price = document.createElement("div");
    price.className = "order-price";
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(order.price);
    const status = document.createElement("small");
    status.className = "order-status";
    const statusIndex = Number(order.statusIndex || 0);
    status.textContent = order.cancelled ? "ملغي" : orderStatuses[statusIndex];
    if (order.cancelled) status.style.color = "var(--danger)";
    article.classList.add(order.cancelled ? "is-cancelled" : statusIndex >= orderStatuses.length - 1 ? "is-completed" : "is-active");
    price.append(amount, status);

    const completed = !order.cancelled && statusIndex >= orderStatuses.length - 1 && order.driverId;
    if (completed) {
      const review = document.createElement("div");
      review.className = "order-review";
      const savedRating = findOrderRating(order.firestoreId);
      if (savedRating) {
        review.innerHTML = `<span class="rating-result" aria-label="تقييم ${savedRating.score} من 5">${"★".repeat(Number(savedRating.score||0))}${"☆".repeat(5 - Number(savedRating.score||0))}</span><small>${order.type === "ride" ? "تم تقييم كابتن التكسي" : "تم تقييم كابتن التوصيل"}</small>`;
      } else {
        const rateButton = document.createElement("button");
        rateButton.type = "button";
        rateButton.className = "rate-driver-button";
        rateButton.textContent = order.type === "ride" ? "★ قيّم كابتن التكسي" : "★ قيّم كابتن التوصيل";
        rateButton.addEventListener("click", () => openRatingModal("order", order.firestoreId));
        review.appendChild(rateButton);
      }
      details.appendChild(review);
    }

    const main = document.createElement("div");
    main.className = "order-card-main";
    main.append(icon, details);
    article.append(main, price);
    container.appendChild(article);
  });
  renderMyServiceRequests();
}

byId("closeParcelEdit")?.addEventListener("click", closeParcelEditModal);
byId("parcelEditModal")?.addEventListener("click", event => { if (event.target === event.currentTarget) closeParcelEditModal(); });
byId("parcelEditForm")?.addEventListener("submit", async event => { event.preventDefault(); await saveParcelOrderEdit(byId("saveParcelEdit")); });

const ratingModal = byId("ratingModal");
const RATING_TAGS = {
  taxi: ["قيادة آمنة", "التزام بالوقت", "سيارة نظيفة", "تعامل ممتاز"],
  delivery: ["توصيل سريع", "حفظ الطلب", "التزام بالوقت", "تعامل ممتاز"],
  service: ["جودة ممتازة", "التزام بالموعد", "سعر مناسب", "تعامل ممتاز"]
};

function findOrderRating(orderId) {
  return state.ratings.find(item =>
    (item.referenceType === "order" && item.referenceId === orderId) || item.orderId === orderId || item.firestoreId === orderId
  );
}

function findServiceRating(requestId) {
  return state.ratings.find(item =>
    (item.referenceType === "serviceRequest" && item.referenceId === requestId) || item.serviceRequestId === requestId || item.firestoreId === `service_${requestId}`
  );
}

function ratingTypeForOrder(order) {
  return order?.type === "ride" ? "taxi" : "delivery";
}

function renderRatingTags() {
  const host = byId("ratingTags");
  if (!host) return;
  const type = state.ratingContext?.ratingType || "taxi";
  const tags = RATING_TAGS[type] || RATING_TAGS.service;
  host.innerHTML = tags.map(tag => `<button type="button" class="rating-tag-button ${state.ratingTags.includes(tag) ? "active" : ""}" data-rating-tag="${restaurantSafeText(tag)}">${restaurantSafeText(tag)}</button>`).join("");
}

function renderRatingPicker() {
  document.querySelectorAll("[data-rating-score]").forEach(button => {
    const active = Number(button.dataset.ratingScore) <= state.ratingScore;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  byId("ratingLabel").textContent = state.ratingScore
    ? ["", "ضعيف", "مقبول", "جيد", "جيد جدًا", "ممتاز"][state.ratingScore]
    : "اختر تقييمك";
  renderRatingTags();
}

function openRatingModal(kind, referenceId) {
  let context = null;
  if (kind === "order") {
    const order = state.orders.find(item => item.firestoreId === referenceId);
    if (!order || order.cancelled || Number(order.statusIndex || 0) < 4 || !order.driverId) {
      showToast("يمكن تقييم الكابتن بعد اكتمال الرحلة أو التوصيل فقط");
      return;
    }
    if (findOrderRating(referenceId)) return showToast("تم تقييم هذا الطلب سابقًا");
    const ratingType = ratingTypeForOrder(order);
    context = {
      kind: "order", referenceId, ratingType,
      targetType: "driver", targetId: order.driverId,
      targetName: order.driverName || (ratingType === "taxi" ? "كابتن التكسي" : "كابتن التوصيل"),
      referenceCode: order.id || referenceId,
      order
    };
    byId("ratingTitle").textContent = ratingType === "taxi" ? "قيّم تجربة التكسي" : "قيّم تجربة التوصيل";
    byId("ratingIntro").textContent = ratingType === "taxi" ? "تقييمك يساعدنا على متابعة جودة الكباتن وسلامة الرحلات." : "قيّم سرعة التوصيل والتعامل والمحافظة على الطلب.";
  } else if (kind === "service") {
    const request = state.serviceRequests.find(item => item.firestoreId === referenceId);
    const deliveryOrder = state.orders.find(order => order.firestoreId === request?.deliveryOrderId);
    const deliveryFinished = !request?.deliveryRequested || !request?.deliveryOrderId || (deliveryOrder && !deliveryOrder.cancelled && Number(deliveryOrder.statusIndex || 0) >= 4);
    if (!request || request.status !== "completed" || !deliveryFinished || !request.providerId) {
      showToast("يمكن تقييم الخدمة بعد اكتمالها فقط");
      return;
    }
    if (findServiceRating(referenceId)) return showToast("تم تقييم هذه الخدمة سابقًا");
    context = {
      kind: "service", referenceId, ratingType: "service",
      targetType: "provider", targetId: request.providerId,
      targetName: request.providerName || "مزود الخدمة",
      referenceCode: request.itemName || referenceId,
      request
    };
    byId("ratingTitle").textContent = "قيّم الخدمة";
    byId("ratingIntro").textContent = "شارك رأيك في جودة الخدمة والالتزام والتعامل. يظهر التقييم للإدارة لمتابعة الجودة.";
  }
  if (!context) return;
  state.ratingContext = context;
  state.ratingOrderId = context.kind === "order" ? context.referenceId : null;
  state.ratingScore = 0;
  state.ratingTags = [];
  byId("ratingComment").value = "";
  byId("ratingDriverName").textContent = context.targetName;
  byId("ratingOrderCode").textContent = context.kind === "order" ? `الطلب ${context.referenceCode}` : context.referenceCode;
  renderRatingPicker();
  ratingModal.classList.add("show");
}

function closeRatingModal() {
  ratingModal.classList.remove("show");
  state.ratingContext = null;
  state.ratingOrderId = null;
  state.ratingScore = 0;
  state.ratingTags = [];
}

document.querySelectorAll("[data-rating-score]").forEach(button => {
  button.addEventListener("click", () => {
    state.ratingScore = Number(button.dataset.ratingScore);
    renderRatingPicker();
  });
});

byId("ratingTags")?.addEventListener("click", event => {
  const button = event.target.closest("[data-rating-tag]");
  if (!button) return;
  const tag = button.dataset.ratingTag;
  state.ratingTags = state.ratingTags.includes(tag)
    ? state.ratingTags.filter(item => item !== tag)
    : [...state.ratingTags, tag].slice(-4);
  renderRatingTags();
});

byId("closeRating").addEventListener("click", closeRatingModal);
ratingModal.addEventListener("click", event => {
  if (event.target === ratingModal) closeRatingModal();
});

byId("ratingForm").addEventListener("submit", async event => {
  event.preventDefault();
  const context = state.ratingContext;
  if (!context || !state.user) return;
  if (!state.ratingScore) {
    showToast("اختر عدد النجوم أولًا");
    return;
  }
  const button = byId("submitRating");
  setButtonBusy(button, true, "جاري الإرسال…");
  try {
    const base = {
      ratingType: context.ratingType,
      targetType: context.targetType,
      targetId: context.targetId,
      targetName: context.targetName,
      referenceType: context.kind === "order" ? "order" : "serviceRequest",
      referenceId: context.referenceId,
      referenceCode: context.referenceCode || "",
      customerId: state.user.uid,
      customerName: state.name || "عميل كروة",
      score: state.ratingScore,
      comment: byId("ratingComment").value.trim().slice(0, 300),
      tags: [...state.ratingTags],
      createdAt: serverTimestamp()
    };
    let ratingId = context.referenceId;
    let payload = base;
    if (context.kind === "order") {
      payload = {
        ...base,
        orderId: context.referenceId,
        orderCode: context.order?.id || "",
        driverId: context.targetId,
        driverName: context.targetName
      };
    } else {
      ratingId = context.referenceId;
      payload = {
        ...base,
        serviceRequestId: context.referenceId,
        providerId: context.targetId,
        providerName: context.targetName,
        providerCategory: context.request?.providerCategory || "other",
        itemName: context.request?.itemName || "خدمة"
      };
    }
    await setDoc(doc(db, "ratings", ratingId), payload);
    closeRatingModal();
    showToast("شكرًا، تم إرسال تقييمك للإدارة");
  } catch (error) {
    console.error(error);
    showToast("تعذر إرسال التقييم أو تم تقييم الطلب سابقًا");
  } finally {
    setButtonBusy(button, false);
  }
});

function renderBalance() {
  const available=walletAvailable();
  byId("walletBalance").textContent = Number(available).toLocaleString("ar-IQ");
  const bonus=activeBonusAmount({bonusBalance:state.bonusBalance,bonusExpiresAt:state.bonusExpiresAt});
  const bonusStatus=byId("walletBonusStatus");
  if(bonusStatus){const expiry=timestampMillis(state.bonusExpiresAt);bonusStatus.textContent=bonus>0?`يتضمن ${formatMoney(bonus)} رصيدًا مجانيًا صالحًا حتى ${new Date(expiry).toLocaleString("ar-IQ")}`:(Number(state.bonusBalance||0)>0?"انتهت صلاحية الرصيد المجاني — الرصيد المشحون محفوظ":"الرصيد المتاح من الشحن");}
  renderCustomerSettingsInfo();
}

byId("topupForm")?.addEventListener("submit",async event=>{
  event.preventDefault(); if(!requireUser())return;
  const amount=Math.round(Number(byId("topupAmount")?.value||0));
  const transferReference=byId("topupReference")?.value.trim()||"";
  if(!Number.isFinite(amount)||amount<1000||amount>1000000)return showToast("أدخل مبلغًا بين 1,000 و1,000,000 د.ع");
  if(transferReference.length<3)return showToast("اكتب رقم/مرجع التحويل أو آخر أرقام العملية");
  if(customerHasPendingTopup())return showToast("لديك طلب شحن قيد المراجعة. انتظر اعتماد الإدارة أو رفضها قبل إرسال طلب جديد.");
  const button=event.submitter||byId("submitTopup"); setButtonBusy(button,true,"جارٍ إرسال الطلب…");
  try{
    const requestRef=doc(collection(db,"topupRequests"));
    const batch=writeBatch(db);
    batch.set(requestRef,{userId:state.user.uid,customerName:state.name,email:state.user.email||"",amount,transferReference:transferReference.slice(0,80),method:"mastercard_local",accountType:"customer",accountRole:state.role||"customer",status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(db,"topupLocks",state.user.uid),{userId:state.user.uid,requestId:requestRef.id,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    await batch.commit();state.topupRequests=[{firestoreId:requestRef.id,userId:state.user.uid,amount,transferReference,status:"pending",createdAt:null},...state.topupRequests.filter(x=>x.firestoreId!==requestRef.id)];renderTopupRequests();event.currentTarget.reset();showToast("تم إرسال طلب الشحن مرة واحدة. لا يمكن إرسال طلب جديد حتى تراجعه الإدارة.");
  }catch(error){console.error(error);showToast(error?.code==="permission-denied"?"يوجد طلب شحن قيد المراجعة بالفعل أو لم تُنشر قواعد Phase 79 بعد.":"تعذر إرسال طلب الشحن");}finally{setButtonBusy(button,false);updateCustomerTopupFormState();}
});
byId("shareReferral")?.addEventListener("click",async()=>{
  if(!requireUser())return; const code=state.referralCode||await ensureReferralCode(state.user);
  const text=`حمّل كروة واستخدم كود الدعوة ${code} للحصول على خصم على أول مشوار.`;
  try{if(navigator.share)await navigator.share({title:"دعوة كروة",text});else await navigator.clipboard.writeText(text);showToast("تم تجهيز كود الدعوة للمشاركة");}catch(error){if(error?.name!=="AbortError")showToast("تعذر فتح المشاركة");}
});
byId("copyReferral")?.addEventListener("click",async()=>{if(!state.referralCode)return;try{await navigator.clipboard.writeText(state.referralCode);showToast("تم نسخ كود الدعوة");}catch(_){showToast(state.referralCode);}});

function renderProfile() {
  const firstName = state.name.trim().split(" ")[0] || "ضيف";
  const firstLetter = firstName.charAt(0) || "ك";
  byId("firstName").textContent = firstName;
  byId("profileName").textContent = state.name;
  byId("profileEmail").textContent = state.user?.email || "سجّل الدخول لمزامنة بياناتك";
  byId("smallAvatar").textContent = firstLetter;
  byId("bigAvatar").textContent = firstLetter;
  byId("logoutButton").style.display = state.user ? "inline-block" : "none";
  byId("adminPortalSetting").hidden = state.role !== "admin";
  renderCustomerSettingsInfo();
}

byId("editName").addEventListener("click", async () => {
  if (!requireUser()) return;
  const name = prompt("اكتب اسمك", state.name)?.trim();
  if (!name) return;
  try {
    await updateProfile(auth.currentUser, { displayName: name });
    await saveUserData({ name });
    state.name = name;
    renderProfile();
    showToast("تم تحديث الاسم");
  } catch (error) {
    console.error(error);
    showToast("تعذر تحديث الاسم");
  }
});

function renderNotificationSwitch() {
  byId("notificationSwitch").classList.toggle("off", !state.notifications);
  const setting = byId("customerNotificationSetting");
  if (setting) {
    setting.classList.toggle("on", state.notifications);
    setting.setAttribute("aria-checked", String(state.notifications));
  }
}

byId("notificationSwitch").addEventListener("click", async () => {
  if (!requireUser()) return;
  const previous = state.notifications;
  state.notifications = !previous;
  renderNotificationSwitch();
  try {
    await saveUserData({ notifications: state.notifications });
    showToast(state.notifications ? "تم تشغيل الإشعارات" : "تم إيقاف الإشعارات");
  } catch (error) {
    state.notifications = previous;
    renderNotificationSwitch();
    console.error(error);
    showToast("تعذر حفظ إعداد الإشعارات");
  }
});

byId("notificationButton").addEventListener("click", () => {
  showToast(state.activeOrder ? "لديك تحديث على طلبك" : "لا توجد إشعارات جديدة");
});

function setCustomerSettingsOpen(open, restoreFocus = true) {
  const home = byId("home");
  const panel = byId("customerSettingsPanel");
  const toggle = byId("customerSettingsToggle");
  if (!home || !panel || !toggle) return;
  if (open) {
    byId("customerOptionsClose")?.click();
    renderCustomerSettingsInfo();
    renderNotificationSwitch();
    applyCustomerMapPreferences();
  }
  home.classList.toggle("customer-settings-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  panel.setAttribute("aria-hidden", String(!open));
  panel.inert = !open;
  if (open) window.setTimeout(() => byId("customerSettingsClose")?.focus({ preventScroll: true }), 80);
  else if (restoreFocus) toggle.focus({ preventScroll: true });
}

byId("customerSettingsPanel").inert = true;
byId("customerSettingsToggle").addEventListener("click", () => setCustomerSettingsOpen(true));
byId("customerSettingsClose").addEventListener("click", () => setCustomerSettingsOpen(false));
byId("customerSettingsScrim").addEventListener("click", () => setCustomerSettingsOpen(false));
byId("customerSettingsPanel").querySelectorAll("[data-customer-map-theme]").forEach(button => {
  button.addEventListener("click", () => setCustomerMapTheme(button.dataset.customerMapTheme));
});
byId("customerSettingsPanel").querySelectorAll("[data-customer-map-view]").forEach(button => {
  button.addEventListener("click", () => setCustomerMapView(button.dataset.customerMapView));
});
byId("customerAutoFollowSetting").addEventListener("click", () => {
  state.autoFollow = !state.autoFollow;
  writeCustomerPreference("karwa.customer.autoFollow", String(state.autoFollow));
  applyCustomerMapPreferences();
  if (state.autoFollow && state.customerLocation) {
    state.map?.setView([state.customerLocation.latitude, state.customerLocation.longitude], 15);
  }
  showToast(state.autoFollow ? "تم تفعيل متابعة موقعك" : "يمكنك الآن تحريك الخريطة بحرية");
});
byId("customerNotificationSetting").addEventListener("click", () => byId("notificationSwitch").click());
byId("customerSettingsServices").addEventListener("click", () => {
  setCustomerSettingsOpen(false);
  window.setTimeout(() => byId("customerOptionsToggle")?.click(), 120);
});
document.querySelectorAll("[data-customer-settings-view]").forEach(button => {
  button.addEventListener("click", () => {
    setCustomerSettingsOpen(false, false);
    switchView(button.dataset.customerSettingsView);
  });
});
byId("customerSettingsAddresses").addEventListener("click", () => {
  setCustomerSettingsOpen(false, false);
  byId("savedAddresses")?.click();
});
byId("customerSettingsSupport").addEventListener("click", () => {
  setCustomerSettingsOpen(false, false);
  document.querySelector("[data-open-support]")?.click();
});
byId("customerSettingsLogout").addEventListener("click", () => byId("logoutButton").click());
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && byId("home")?.classList.contains("customer-settings-open")) {
    setCustomerSettingsOpen(false);
  }
});

const addressesModal=byId("addressesModal");
async function loadSavedAddresses(){ if(!state.user)return; const snap=await getDoc(doc(db,"users",state.user.uid)); state.savedAddresses=snap.data()?.savedAddresses||[]; renderSavedAddresses(); }
function renderSavedAddresses(){ const box=byId("savedAddressList"); if(!box)return; box.innerHTML=state.savedAddresses.length?"":"<div class=\"empty-state\">لا توجد عناوين محفوظة</div>"; state.savedAddresses.forEach((a,i)=>{const el=document.createElement("div");el.className="card order-item";el.innerHTML=`<div class="order-icon">⌖</div><div class="order-details"><strong>${a.label}</strong><small>${a.text}</small></div>`;el.onclick=()=>{setBookingPoint("destination",a.latitude,a.longitude);addressesModal.classList.remove("show");switchView("home");};box.appendChild(el);}); }
byId("savedAddresses").addEventListener("click", async()=>{if(!requireUser())return;await loadSavedAddresses();addressesModal.classList.add("show");});
byId("closeAddresses").onclick=()=>addressesModal.classList.remove("show");
byId("addressForm").onsubmit=async e=>{e.preventDefault();if(!state.destinationLocation)return showToast("حدد وجهة على الخريطة أولًا");const a={label:byId("addressLabel").value.trim(),text:byId("addressText").value.trim(),...state.destinationLocation};state.savedAddresses=[...state.savedAddresses,a].slice(-10);await updateDoc(doc(db,"users",state.user.uid),{savedAddresses:state.savedAddresses,updatedAt:serverTimestamp()});renderSavedAddresses();showToast("تم حفظ العنوان");};

const supportModal = byId("supportModal");
document.querySelectorAll("[data-open-support]").forEach(button => {
  button.addEventListener("click", () => supportModal.classList.add("show"));
});
byId("closeSupport").addEventListener("click", () => supportModal.classList.remove("show"));
byId("startSupportChat").addEventListener("click", async () => {
  if(!requireUser())return; const message=byId("supportMessage").value.trim(); if(message.length<5)return showToast("اكتب تفاصيل المشكلة");
  await setDoc(doc(collection(db,"supportTickets")),{userId:state.user.uid,category:byId("supportCategory").value,message,status:"open",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  byId("supportMessage").value=""; supportModal.classList.remove("show"); showToast("تم إرسال تذكرة الدعم");
});
supportModal.addEventListener("click", event => {
  if (event.target === supportModal) supportModal.classList.remove("show");
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") supportModal.classList.remove("show");
  if (event.key === "Escape") closeRatingModal();
});


function printInvoice(order){const w=window.open("","_blank","width=520,height=700");if(!w)return showToast("اسمح بالنوافذ المنبثقة لعرض الفاتورة");w.document.write(`<html dir="rtl"><head><title>فاتورة ${order.id}</title><style>body{font-family:Arial;padding:30px}h1{color:#0b4f70}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:10px 0}</style></head><body><h1>كروة — فاتورة رحلة</h1><div class="row"><b>رقم الرحلة</b><span>${order.id}</span></div><div class="row"><b>المسار</b><span>${order.route}</span></div><div class="row"><b>الكابتن</b><span>${order.driverName||"—"}</span></div><div class="row"><b>المبلغ</b><span>${formatMoney(order.price)}</span></div><div class="row"><b>الدفع</b><span>${order.payment||"—"}</span></div><div class="row"><b>التاريخ</b><span>${new Date(order.createdAtISO||Date.now()).toLocaleString("ar-IQ")}</span></div><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();}
let geoTimer;
const placeSearchCache=new Map();
function normalizeArabicSearch(v){return String(v||"").trim().replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[\u064B-\u065F]/g,"").replace(/\s+/g," ");}
function arabicPlaceName(x){const n=x?.namedetails||{},a=x?.address||{};return n["name:ar"]||n.name||x?.name||a.amenity||a.shop||a.tourism||a.office||a.road||cleanPlaceLabel(x);}
function placeRank(x,q,center){const text=normalizeArabicSearch([arabicPlaceName(x),x.display_name,Object.values(x.namedetails||{}).join(" ")].join(" ")).toLowerCase();const needle=normalizeArabicSearch(q).toLowerCase();let score=0;if(text===needle)score+=100;if(text.startsWith(needle))score+=55;if(text.includes(needle))score+=30;if(["amenity","shop","tourism","office","leisure","building","place","highway"].includes(x.category||x.class))score+=8;if(center){const d=haversineKm({latitude:center.lat,longitude:center.lng},{latitude:Number(x.lat),longitude:Number(x.lon)});score+=Math.max(0,18-Math.min(18,d/4));}return score+(Number(x.importance)||0)*15;}
const PLACE_CATEGORY_TERMS={restaurant:"مطعم",medical:"مستشفى",shop:"سوق",education:"مدرسة",fuel:"محطة وقود",hotel:"فندق"};
function localPlaceMatchesCategory(item,category){if(!category)return true;const value=String(item?.category||"").toLowerCase();if(category==="education")return ["education","school","university","college"].includes(value);if(category==="hotel")return ["hotel","tourism","other"].includes(value);return value===category;}
async function searchPlaces(q,options={}){
  initializeCustomerMap();
  const category=options.category||"",scope=options.scope==="nearby"?"nearby":"iraq";
  const center=state.map?.getCenter(),bounds=state.map?.getBounds?.();
  const locationKey=scope==="nearby"&&center?`${center.lat.toFixed(2)},${center.lng.toFixed(2)}`:"iq";
  const key=[normalizeArabicSearch(q).toLowerCase(),category,scope,locationKey].join("|"); if(placeSearchCache.has(key))return placeSearchCache.get(key);
  const view=scope==="nearby"?(bounds?`&viewbox=${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}`:(center?`&viewbox=${center.lng-1.5},${center.lat+1.0},${center.lng+1.5},${center.lat-1.0}`:"")):"";
  const categoryTerm=PLACE_CATEGORY_TERMS[category]||"",base=[q,categoryTerm].filter(Boolean).join(" ");
  const queries=[base,`${base} العراق`,...(category?[q]:[])]; let out=[];
  for(const term of queries){try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&extratags=1&dedupe=1&limit=18&countrycodes=iq&accept-language=ar,ku,en${view}&bounded=${scope==="nearby"?1:0}&q=${encodeURIComponent(term)}`,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(7000)});if(r.ok)out.push(...await r.json())}catch(e){} if(out.length>=14)break;}
  const needle=normalizeArabicSearch(q).toLowerCase();
  const local=(customerCommunity?.landmarkData||[]).filter(x=>normalizeArabicSearch(x.name).toLowerCase().includes(needle)&&localPlaceMatchesCategory(x,category)).map(x=>({lat:x.latitude,lon:x.longitude,name:x.name,display_name:`${x.name} — معلم مضاف في كروة`,namedetails:{"name:ar":x.name},category:x.category||"place",class:"place",importance:1.4,osm_type:"karwa",osm_id:x.id})); out.unshift(...local);
  const seen=new Set(); const result=out.filter(x=>{const k=x.osm_type&&x.osm_id?`${x.osm_type}:${x.osm_id}`:`${Number(x.lat).toFixed(5)},${Number(x.lon).toFixed(5)}`;if(seen.has(k)||!Number.isFinite(Number(x.lat))||!Number.isFinite(Number(x.lon)))return false;seen.add(k);return true}).sort((a,b)=>placeRank(b,q,center)-placeRank(a,q,center)).slice(0,12);
  placeSearchCache.set(key,result); if(placeSearchCache.size>50)placeSearchCache.delete(placeSearchCache.keys().next().value); return result;
}
function setupPlaceSearch(inputId,resultsId,type){
  const input=byId(inputId),box=byId(resultsId); let seq=0, busy=false;
  const run=async()=>{
    const q=input.value.trim(); const my=++seq;
    if(q.length<2){box.innerHTML="";return}
    if(busy)return; busy=true; box.innerHTML='<div class="place-search-state">جاري البحث…</div>';
    try{
      const data=await searchPlaces(q); if(my!==seq)return; box.innerHTML="";
      if(!data.length){box.innerHTML='<div class="place-search-state">لم نجد المكان. جرّب اسم الحي أو أقرب معلم، أو حدده من الخريطة.</div>';return}
      data.forEach(x=>{const b=document.createElement("button");b.type="button";b.className="place-result";const title=arabicPlaceName(x),full=x.display_name||cleanPlaceLabel(x),dist=distanceFromMapCenter(x);b.innerHTML=`<span class="place-pin">⌖</span><span><strong>${title}</strong><small>${full}</small>${dist!=null?`<span class="distance">يبعد تقريبًا ${dist<1?Math.round(dist*1000)+" م":dist.toFixed(1)+" كم"} عن مركز الخريطة</span>`:""}</span>`;b.onclick=()=>{box.innerHTML="";input.value=title;setBookingPoint(type,Number(x.lat),Number(x.lon),title);state.map?.setView([Number(x.lat),Number(x.lon)],16)};box.appendChild(b)});
    } finally {busy=false}
  };
  input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();run()}});
  const btn=document.createElement("button"); btn.type="button"; btn.className="map-search-button"; btn.textContent="بحث"; btn.setAttribute("aria-label","البحث عن المكان"); btn.onclick=run;
  input.insertAdjacentElement("afterend",btn);
}

setupPlaceSearch("rideFrom","rideFromResults","pickup");setupPlaceSearch("rideTo","rideToResults","destination");

function customerMapSearchIcon() {
  return window.L.divIcon({ className: "", html: '<div class="map-search-marker"><span>⌖</span></div>', iconSize: [42, 42], iconAnchor: [21, 38] });
}

function setupCustomerMapPlaceTool() {
  const input = byId("customerMapPlaceSearch");
  const button = byId("customerMapPlaceSearchButton");
  const locateButton = byId("customerMapPlaceLocate");
  const category = byId("customerMapPlaceCategory");
  const scope = byId("customerMapPlaceScope");
  const results = byId("customerMapPlaceResults");
  const selection = byId("customerMapPlaceSelection");
  if (!input || !button || !results || !selection) return;
  let sequence = 0;
  const selectPlace = place => {
    const latitude = Number(place.lat);
    const longitude = Number(place.lon);
    const name = arabicPlaceName(place);
    state.mapSearchSelection = { latitude, longitude, name };
    input.value = name;
    byId("customerMapLandmarkName").value ||= name;
    selection.textContent = `تم تحديد: ${name}`;
    results.innerHTML = "";
    initializeCustomerMap();
    const point = [latitude, longitude];
    if (state.mapSearchMarker) state.mapSearchMarker.setLatLng(point);
    else state.mapSearchMarker = window.L.marker(point, { icon: customerMapSearchIcon() }).addTo(state.map);
    const popupLabel = document.createElement("strong");
    popupLabel.textContent = name;
    state.mapSearchMarker.bindPopup(popupLabel).openPopup();
    state.map.setView(point, 16);
    showToast("تم تحديد المكان على الخريطة");
  };
  const run = async () => {
    const queryText = input.value.trim();
    const requestId = ++sequence;
    if (queryText.length < 2) {
      results.innerHTML = '<div class="map-place-state">اكتب حرفين على الأقل للبحث.</div>';
      return;
    }
    button.disabled = true;
    results.innerHTML = '<div class="map-place-state">جاري البحث عن المكان…</div>';
    try {
      const places = await searchPlaces(queryText, { category: category?.value || "", scope: scope?.value || "nearby" });
      if (requestId !== sequence) return;
      results.innerHTML = "";
      if (!places.length) {
        results.innerHTML = '<div class="map-place-state">لم نجد نتيجة. جرّب اسم الحي أو شارعًا قريبًا.</div>';
        return;
      }
      places.slice(0, 8).forEach(place => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "map-place-result";
        const pin = document.createElement("span");
        pin.textContent = "⌖";
        const copy = document.createElement("span");
        const title = document.createElement("strong");
        const detail = document.createElement("small");
        const distance = document.createElement("span");
        title.textContent = arabicPlaceName(place);
        detail.textContent = place.display_name || cleanPlaceLabel(place);
        const distanceKm = distanceFromMapCenter(place);
        distance.className = "map-place-distance";
        distance.textContent = distanceKm == null ? "" : `يبعد ${distanceKm < 1 ? Math.max(1, Math.round(distanceKm * 1000)) + " م" : distanceKm.toFixed(1) + " كم"} عن مركز الخريطة`;
        copy.append(title, detail, distance);
        item.append(pin, copy);
        item.addEventListener("click", () => selectPlace(place));
        results.appendChild(item);
      });
    } catch (error) {
      console.error(error);
      results.innerHTML = '<div class="map-place-state">تعذر البحث الآن. تحقق من الإنترنت وحاول مجددًا.</div>';
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener("click", run);
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); run(); } });
  [category, scope].forEach(control => control?.addEventListener("change", () => { if (input.value.trim().length >= 2) run(); }));
  locateButton?.addEventListener("click", async () => {
    locateButton.disabled = true;
    locateButton.textContent = "جاري تثبيت GPS…";
    try {
      const position=await getKarwaPrecisePosition();
      const latitude = position.coords.latitude, longitude = position.coords.longitude;
      setCustomerLocation(latitude, longitude);
      if(state.customerLocation)state.customerLocation.accuracy=position.coords.accuracy;
      selectPlace({ lat: latitude, lon: longitude, name: "موقعي الحالي", display_name: `دقة الموقع نحو ${Math.round(position.coords.accuracy || 0)} متر`, namedetails: { "name:ar": "موقعي الحالي" } });
    } catch(error) { handlePreciseLocationFailure(error); }
    finally { locateButton.disabled = false; locateButton.textContent = "⌖ تحديد موقعي على الخريطة"; }
  });
  byId("customerSaveMapLandmark")?.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return showToast("سجّل الدخول أولًا");
    const name = byId("customerMapLandmarkName")?.value.trim();
    if (!name || name.length < 3) return showToast("اكتب اسم المعلم بوضوح");
    initializeCustomerMap();
    const center = state.map.getCenter();
    const point = state.mapSearchSelection || { latitude: center.lat, longitude: center.lng };
    try {
      await addDoc(collection(db, "landmarks"), {
        name,
        category: byId("customerMapLandmarkCategory")?.value || "place",
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        createdBy: user.uid,
        createdByName: state.name || "مستخدم كروة",
        createdByRole: "customer",
        status: "active",
        createdAt: serverTimestamp(),
        createdAtISO: new Date().toISOString()
      });
      byId("customerMapLandmarkName").value = "";
      placeSearchCache.clear();
      selection.textContent = `تمت إضافة المعلم: ${name}`;
      showToast("تمت إضافة المعلم إلى خريطة كروة");
    } catch (error) {
      console.error(error);
      showToast("تعذر إضافة المعلم — تحقق من الاتصال والصلاحيات");
    }
  });
}

setupCustomerMapPlaceTool();
subscribeToAppSettings();

setAuthMode("login");
document.body.classList.add("customer-map-mode");
initializeCustomerMap();
renderProfile();
renderNotificationSwitch();
renderTracking();
renderOrders();
renderCart();
renderOtherServices();
renderMyServiceRequests();
renderBalance();

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الدخول", error);
}

async function startVerifiedCustomerSession(user) {
  const profileStatus = await loadUserProfile(user);
  if (auth.currentUser?.uid !== user.uid) return false;
  if (state.role !== "customer") {
    const roleName = state.role === "driver" ? "كابتن" : "مدير";
    const destination = state.role === "driver" ? "بوابة الكابتن" : "لوحة الإدارة";
    await signOut(auth);
    openAuthModal();
    byId("authMessage").textContent = `هذا حساب ${roleName} ومخصص لـ${destination} فقط. استخدم حساب عميل مستقلًا.`;
    return false;
  }
  subscribeToOrders(user);
  subscribeToRatings(user);
  subscribeToTopups(user);
  subscribeRestaurants();
  subscribeServiceProfiles();
  subscribeServiceRequests(user);
  try {
    startCustomerCommunityLayers();
  } catch (communityError) {
    console.warn("تعذر تشغيل طبقة مجتمع كروة دون التأثير على مزامنة الحساب", communityError);
  }
  byId("connectionBadge").textContent = profileStatus?.profileNeedsMigration
    ? "متصل • مزامنة الحساب قيد التحديث"
    : "متصل ومحفوظ سحابيًا";
  return true;
}

function scheduleProfileRetry(user, attempt = 1) {
  if (state.profileRetryTimer) clearTimeout(state.profileRetryTimer);
  if (attempt > 4) {
    state.profileRetryTimer = null;
    byId("connectionBadge").textContent = "متصل • تعذر التحقق من الحساب";
    return;
  }
  const delay = Math.min(12000, 1500 * (2 ** (attempt - 1)));
  state.profileRetryTimer = setTimeout(async () => {
    state.profileRetryTimer = null;
    if (auth.currentUser?.uid !== user.uid) return;
    try {
      const started = await startVerifiedCustomerSession(user);
      if (started) showToast("تمت استعادة مزامنة الحساب");
    } catch (retryError) {
      console.warn(`تعذرت محاولة مزامنة الحساب رقم ${attempt}`, retryError);
      scheduleProfileRetry(user, attempt + 1);
    }
  }, delay);
}

onAuthStateChanged(auth, async user => {
  state.user = user;
  if (!user) {
    if (state.profileRetryTimer) clearTimeout(state.profileRetryTimer);
    state.profileRetryTimer = null;
    if (state.unsubscribeOrders) {
      state.unsubscribeOrders();
      state.unsubscribeOrders = null;
    }
    if (state.unsubscribeRatings) {
      state.unsubscribeRatings();
      state.unsubscribeRatings = null;
    }
    if (state.unsubscribeRestaurants) {
      state.unsubscribeRestaurants();
      state.unsubscribeRestaurants = null;
    }
    if (state.unsubscribeServiceProfiles) {
      state.unsubscribeServiceProfiles();
      state.unsubscribeServiceProfiles = null;
    }
    if (state.unsubscribeServiceRequests) {
      state.unsubscribeServiceRequests();
      state.unsubscribeServiceRequests = null;
    }
    if(state.unsubscribeTopups){state.unsubscribeTopups();state.unsubscribeTopups=null;}
    state.name = "ضيف";
    state.role = "customer";
    state.balance = 0;
    state.referralCode = "";
    state.topupRequests = [];
    state.orders = [];
    state.ratings = [];
    state.restaurants = [];
    state.serviceProfiles = [];
    state.serviceRequests = [];
    state.selectedServiceProfile = null;
    state.activeOrder = null;
    stopCustomerTripLocationSharing();
    if (state.trackingUnsubscribe) state.trackingUnsubscribe();
    state.trackingUnsubscribe = null;
    state.trackingOrderId = null;
    clearDriverLocation();
    byId("connectionBadge").textContent = "تسجيل الدخول مطلوب";
    renderProfile();
    renderBalance();
    renderOrders();
    renderTracking();
    renderRestaurants();
    renderOtherServices();
    renderMyServiceRequests();
    byId("selectedServiceBox").hidden = true;
    openAuthModal();
    return;
  }

  if (customerRegistrationInProgress) {
    byId("connectionBadge").textContent = "جاري إنشاء الحساب…";
    return;
  }

  closeAuthModal();
  if (state.profileRetryTimer) clearTimeout(state.profileRetryTimer);
  state.profileRetryTimer = null;
  byId("connectionBadge").textContent = "متصل ومحفوظ سحابيًا";
  try {
    const roleSnap = await getDoc(doc(db, "users", user.uid));
    const accountData = roleSnap.exists() ? roleSnap.data() : null;
    const accountRole = accountData?.role || null;
    if (accountData) {
      const deviceCheck = await enforceDeviceSession(db,user,accountData);
      if (!deviceCheck.ok) {
        await signOut(auth);
        openAuthModal();
        byId("authMessage").textContent = deviceCheck.message;
        byId("connectionBadge").textContent = "الجهاز غير معتمد لهذا الحساب";
        return;
      }
    }
    if (["driver","driverApplicant"].includes(accountRole)) {
      window.location.replace("./driver.html");
      return;
    }
    if (["serviceApplicant","serviceProvider"].includes(accountRole)) {
      window.location.replace("./services.html");
      return;
    }
    if (accountRole && accountRole !== "customer") {
      await signOut(auth);
      openAuthModal();
      byId("authMessage").textContent = "هذا الحساب غير مخصص لتطبيق العميل.";
      return;
    }
    await startVerifiedCustomerSession(user);
    registerNativePushToken(user);
    window.setTimeout(()=>registerNativePushToken(user),5000);
  } catch (error) {
    console.error(error);
    const errorCode = String(error?.code || "");
    if (errorCode.includes("permission-denied")) {
      showToast("تعذر الوصول إلى ملف الحساب. انشر قواعد Firestore المرفقة ثم أعد فتح التطبيق.");
      byId("connectionBadge").textContent = "متصل • صلاحيات الحساب غير مكتملة";
    } else {
      byId("connectionBadge").textContent = "متصل • إعادة المزامنة تلقائيًا";
      scheduleProfileRetry(user);
    }
    state.name = user.displayName || user.email?.split("@")[0] || "مستخدم كروة";
    renderProfile();
  }
});

// Phase 11 — passenger safety center
function karwaShareToken(){
  try{return crypto.randomUUID().replace(/-/g,"").slice(0,24)}catch{}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,14)}`.slice(0,24);
}
byId("shareTrip")?.addEventListener("click",async()=>{
  if(!state.activeOrder?.firestoreId||!state.user)return showToast("لا توجد رحلة نشطة");
  try{
    const token=karwaShareToken();
    await setDoc(doc(db,"tripShares",token),{token,orderId:state.activeOrder.firestoreId,customerId:state.user.uid,createdAt:serverTimestamp(),expiresAtMs:Date.now()+6*60*60*1000});
    const text=`كروة — مشاركة رحلة ${state.activeOrder.id}\nرمز مشاركة آمن: ${token}\nصالح لمدة 6 ساعات.`;
    if(navigator.share)await navigator.share({title:"مشاركة رحلة كروة",text});else await navigator.clipboard.writeText(text);
    showToast("تم تجهيز مشاركة الرحلة");
  }catch(e){console.error(e);showToast("تعذر إنشاء مشاركة آمنة");}
});
byId("sosTrip")?.addEventListener("click",async()=>{
  if(!state.activeOrder?.firestoreId||!state.user||!confirm("إرسال تنبيه سلامة عاجل للإدارة لهذه الرحلة؟"))return;
  const send=async pos=>{
    try{
      await addDoc(collection(db,"safetyEvents"),{orderId:state.activeOrder.firestoreId,reportedBy:state.user.uid,reporterRole:"customer",kind:"sos",latitude:pos?.coords?.latitude??null,longitude:pos?.coords?.longitude??null,note:"SOS من الراكب",createdAt:serverTimestamp()});
      showToast("تم إرسال تنبيه السلامة للإدارة");
    }catch(e){console.error(e);showToast("تعذر إرسال التنبيه");}
  };
  navigator.geolocation?navigator.geolocation.getCurrentPosition(send,()=>send(null),{timeout:5000}):send(null);
});

// Phase 19 — verified community traffic + shared landmarks
const customerCommunity={reports:new Map(),landmarks:new Map(),landmarkData:[],started:false};
const customerReportMeta={traffic:["🚦","ازدحام"],accident:["💥","حادث"],closure:["⛔","شارع مغلق"],roadwork:["🚧","حفريات / أعمال طريق"],hazard:["⚠️","عائق على الطريق"]};
function customerCommunityIcon(kind,type="report",confirmations=0,name=""){
 const meta=customerReportMeta[kind]||["📌","بلاغ"],badge=type==='report'&&confirmations?`<b class="confirm-badge">${confirmations}</b>`:"";
 if(type==='landmark'){
  const label=restaurantSafeText(name||"معلم كروة");
  return window.L.divIcon({className:"karwa-landmark-div-icon",html:`<div class="karwa-landmark-label" title="${label}"><span>${label}</span></div>`,iconSize:[180,34],iconAnchor:[90,17]});
 }
 return window.L.divIcon({className:"",html:`<div class="road-report-marker">${meta[0]}${badge}</div>`,iconSize:[38,38],iconAnchor:[19,19]});
}
function customerReportLifetime(x){const c=Number(x.confirmations||0);if(x.type==='closure')return c>=2?6*3600000:2*3600000;if(c>=3)return 4*3600000;if(c>=1)return 2*3600000;return 60*60000;}
function customerReportLive(x){const ts=x.createdAt?.toMillis?.()||Date.parse(x.createdAtISO||0);return x.active!==false&&ts&&Date.now()-ts<customerReportLifetime(x);}
function startCustomerCommunityLayers(){if(customerCommunity.started||!state.map||!auth.currentUser)return;customerCommunity.started=true;
 onSnapshot(collection(db,"roadReports"),snap=>{const live=new Set();snap.forEach(d=>{const x=d.data();if(!customerReportLive(x))return;live.add(d.id);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;const c=Number(x.confirmations||0);let m=customerCommunity.reports.get(d.id);if(!m){m=window.L.marker(ll,{icon:customerCommunityIcon(x.type,"report",c)}).addTo(state.map);customerCommunity.reports.set(d.id,m)}else{m.setLatLng(ll);m.setIcon(customerCommunityIcon(x.type,"report",c));}const label=customerReportMeta[x.type]?.[1]||"بلاغ طريق";m.bindPopup(`<div dir="rtl"><b>${label}</b>${x.note?`<br>${x.note}`:""}<br><small>${c?`مؤكد من ${c} كابتن`:'بلاغ حديث من مجتمع كروة'}</small></div>`)});for(const [id,m] of customerCommunity.reports)if(!live.has(id)){state.map.removeLayer(m);customerCommunity.reports.delete(id)}});
 onSnapshot(collection(db,"landmarks"),snap=>{const live=new Set(),data=[];snap.forEach(d=>{const x=d.data();if(x.status==="hidden")return;data.push({...x,id:d.id});live.add(d.id);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;let m=customerCommunity.landmarks.get(d.id);const landmarkName=x.name||"معلم كروة",landmarkCategory=x.category||"معلم محلي",landmarkIcon=customerCommunityIcon(null,"landmark",0,landmarkName);if(!m){m=window.L.marker(ll,{icon:landmarkIcon,riseOnHover:true,title:landmarkName}).addTo(state.map);customerCommunity.landmarks.set(d.id,m)}else{m.setLatLng(ll);m.setIcon(landmarkIcon)}m.bindPopup(`<div dir="rtl"><b>${restaurantSafeText(landmarkName)}</b><br><small>${restaurantSafeText(landmarkCategory)} · أضيف بواسطة ${x.createdByRole==='driver'?'كابتن':'عميل'}</small></div>`)});customerCommunity.landmarkData=data;placeSearchCache.clear();for(const [id,m] of customerCommunity.landmarks)if(!live.has(id)){state.map.removeLayer(m);customerCommunity.landmarks.delete(id)}});
}

const karwaBonusExpiryRefresh=setInterval(()=>{if(state.user)renderBalance();},60000);
