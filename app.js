import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
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
const functions = getFunctions(firebaseApp);
const createRideOrderSecure = httpsCallable(functions, "createRideOrderV2");
const quoteRideSecure = httpsCallable(functions, "quoteRide");
const cancelOrderSecure = httpsCallable(functions, "cancelOrderV2");

function callableErrorKey(error) {
  const code = String(error?.code || "").replace(/^functions\//, "").toLowerCase();
  const message = String(error?.message || "").toUpperCase();
  const details = typeof error?.details === "string" ? error.details.toUpperCase() : String(error?.details?.message || error?.details?.code || "").toUpperCase();
  const haystack = `${message} ${details}`;
  const known = ["OUTSIDE_SERVICE_AREA","AUTH_REQUIRED","CUSTOMER_ONLY","INVALID_ROUTE","CANNOT_CANCEL","NOT_OWNER","ORDER_NOT_FOUND","BAD_TOKEN"];
  const named = known.find(key => haystack.includes(key));
  return { code, named, raw: haystack };
}

function customerCallableMessage(error, action = "تنفيذ العملية") {
  const e = callableErrorKey(error);
  if (e.named === "OUTSIDE_SERVICE_AREA") return "نقطة الانطلاق أو الوجهة خارج نطاق خدمة كروة الحالي.";
  if (e.named === "AUTH_REQUIRED" || e.code === "unauthenticated") return "انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى ثم أعد المحاولة.";
  if (e.named === "CUSTOMER_ONLY" || e.code === "permission-denied") return "هذا الحساب غير مخوّل لإنشاء طلب راكب. تحقق من نوع الحساب وصلاحياته.";
  if (e.named === "INVALID_ROUTE" || e.code === "invalid-argument") return "تعذر اعتماد المسار. أعد تحديد الانطلاق والوجهة وانتظر حساب المسافة والوقت.";
  if (e.code === "not-found" || e.raw.includes("NOT FOUND") || e.raw.includes("404")) return "خدمة الحجز الخلفية غير منشورة. انشر Firebase Functions ثم أعد المحاولة.";
  if (e.code === "unavailable" || e.code === "deadline-exceeded" || e.raw.includes("NETWORK") || !navigator.onLine) return "تعذر الوصول إلى خادم كروة. تحقق من الإنترنت ثم أعد المحاولة.";
  if (e.code === "failed-precondition") return `تعذر ${action} بسبب شرط في الخادم. راجع إعدادات مناطق الخدمة وبيانات الحساب.`;
  if (e.code === "internal" || e.code === "unknown") return `حدث خطأ في خدمة كروة أثناء ${action}. افتح سجل Cloud Functions لمعرفة السبب.`;
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
  day: "https://tiles.openfreemap.org/styles/positron",
  night: "https://tiles.openfreemap.org/styles/dark"
};

function readCustomerPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}

function writeCustomerPreference(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

const state = {
  user: null,
  role: "customer",
  authMode: "login",
  vehicle: "اقتصادي",
  ridePrice: 0,
  payment: "نقدًا",
  cart: [],
  restaurants: [],
  restaurantDraftMeals: [],
  restaurantGps: null,
  selectedMeal: null,
  unsubscribeRestaurants: null,
  serviceProfiles: [],
  selectedServiceProfile: null,
  serviceRequests: [],
  serviceDeliveryLocations: {},
  unsubscribeServiceProfiles: null,
  unsubscribeServiceRequests: null,
  orders: [],
  activeOrder: null,
  balance: 0,
  name: "ضيف",
  notifications: true,
  unsubscribeOrders: null,
  unsubscribeRatings: null,
  ratings: [],
  ratingOrderId: null,
  ratingScore: 0,
  trackingUnsubscribe: null,
  trackingOrderId: null,
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
const DEFAULT_COMMISSION_RATE = 0.15;
const vehiclePricing = {
  "اقتصادي": { base: 1800, perKm: 650, perMin: 55, minimum: 3000, speedFactor: 1.08 },
  "تكسي": { base: 2300, perKm: 800, perMin: 65, minimum: 4000, speedFactor: 1.00 },
  "عائلي": { base: 3000, perKm: 980, perMin: 75, minimum: 5000, speedFactor: 1.05 }
};
function haversineKm(a,b){const R=6371,toRad=v=>v*Math.PI/180;const dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function commissionRateFor(type, category="") {
  const cfg=state.appSettings||{};
  const categoryKey={restaurant:"commissionRestaurant",grocery:"commissionGrocery",retail:"commissionRetail",maintenance:"commissionMaintenance",home:"commissionHome",health:"commissionHealth",other:"commissionOther"}[category];
  const typeKey={ride:"commissionRide",parcel:"commissionParcel",food:"commissionFood",serviceDelivery:"commissionServiceDelivery"}[type];
  const raw=categoryKey && Number.isFinite(Number(cfg[categoryKey])) ? Number(cfg[categoryKey]) : Number(cfg[typeKey]);
  return Math.min(.5,Math.max(0,Number.isFinite(raw)?raw:DEFAULT_COMMISSION_RATE));
}
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
  const cfg=vehiclePricing[vehicle]||vehiclePricing["اقتصادي"];
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
      const eta=state.routeDurationMin?Math.max(1,Math.round(state.routeDurationMin*Number((vehiclePricing[button.dataset.vehicle]||{}).speedFactor||1))):0;
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

function mapIcon(type) {
  if (!window.L) return null;
  const emoji = type === "driver" ? "🚗" : "●";
  return window.L.divIcon({
    className: "",
    html: `<div class="karwa-map-marker ${type}"><span>${emoji}</span></div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 38]
  });
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
  // خريطة متجهية بلا مفتاح API، ويتحكم العميل بمظهرها من لوحة الإعدادات.
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
function animateDriverMarker(point){
  if(!state.driverMarker){state.driverMarker=window.L.marker(point,{icon:mapIcon("driver")}).addTo(state.map).bindPopup("موقع الكابتن");return;}
  const from=state.driverMarker.getLatLng(), to=window.L.latLng(point);
  if(state.driverAnimationFrame) cancelAnimationFrame(state.driverAnimationFrame);
  const started=performance.now(), duration=900;
  const tick=now=>{const t=Math.min(1,(now-started)/duration),e=1-Math.pow(1-t,3);state.driverMarker.setLatLng([from.lat+(to.lat-from.lat)*e,from.lng+(to.lng-from.lng)*e]);if(t<1)state.driverAnimationFrame=requestAnimationFrame(tick);};
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
  state.routeLine = null;
}

function showDriverLocation(data) {
  initializeCustomerMap();
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!state.map || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const point = [latitude, longitude];
  animateDriverMarker(point);
  const s=Number(state.activeOrder?.statusIndex||0);
  byId("mapInfoTitle").textContent = s>=3 ? "الرحلة متجهة إلى الوجهة" : "الكابتن يتحرك نحوك";
  const age=data.updatedAt?.toMillis?Math.max(0,Date.now()-data.updatedAt.toMillis()):0;
  const quality=Number(data.accuracy||0)>80?" • دقة GPS منخفضة":"";
  byId("mapInfoText").textContent = `${age>30000?"آخر تحديث منذ "+Math.round(age/1000)+" ث":"الموقع مباشر"}${data.accuracy ? ` • دقة ${Math.round(data.accuracy)} م` : ""}${quality}`;
  drawLiveRoute(!state.routeLine);
}

function syncTrackingSubscription() {
  const order = state.activeOrder;
  const nextId = order?.driverId && order?.firestoreId ? order.firestoreId : null;
  if (state.trackingOrderId === nextId) return;
  if (state.trackingUnsubscribe) state.trackingUnsubscribe();
  state.trackingUnsubscribe = null;
  state.trackingOrderId = nextId;
  clearDriverLocation();

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
  if(byId("topupTransferLabel"))byId("topupTransferLabel").textContent=cfg.topupTransferLabel||"Mastercard محلي";
  if(byId("topupTransferId"))byId("topupTransferId").textContent=cfg.topupTransferId||"أضف معرف التحويل من لوحة الإدارة";
  if(byId("topupCardHolder"))byId("topupCardHolder").textContent=cfg.topupCardHolder||"إدارة كروة";
}
function subscribeToAppSettings(){
  onSnapshot(doc(db,"appSettings","pricing"),snap=>{state.appSettings=snap.exists()?snap.data():{};calculateRidePrice();renderReferralCard();renderTopupDestination();},error=>console.warn("تعذر تحميل إعدادات التسعير",error));
}
function renderTopupRequests(){
  const box=byId("topupRequestsList"); if(!box)return;
  if(!state.user){box.innerHTML='<p class="muted">سجّل الدخول لعرض طلبات الشحن.</p>';return;}
  if(!state.topupRequests.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';return;}
  const labels={pending:"قيد المراجعة",approved:"تمت الإضافة",rejected:"مرفوض"};
  const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  box.innerHTML=state.topupRequests.map(x=>`<div class="topup-history-row"><div><strong>${formatMoney(x.amount)}</strong><small>${safe(x.transferReference||"بدون مرجع")}</small></div><span class="topup-status ${safe(x.status||"pending")}">${labels[x.status]||safe(x.status)}</span></div>`).join("");
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
    state.notifications = true;
    await setDoc(userRef, {
      name: state.name,
      email: user.email || "",
      role: "customer",
      balance: state.balance,
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
  if (selectedRole === "driverApplicant") {
    window.location.assign(`./driver.html?mode=${state.authMode}`);
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
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      const ownReferral=makeReferralCode(credential.user.uid);
      let invitedByUserId="";
      if(selectedRole==="customer"&&inviteCode){try{const rs=await getDoc(doc(db,"referralCodes",inviteCode));if(rs.exists()&&rs.data().ownerId!==credential.user.uid)invitedByUserId=rs.data().ownerId;}catch(_){}}
      const registerBatch=writeBatch(db);
      registerBatch.set(doc(db, "users", credential.user.uid), {
        name,email,role:selectedRole,balance:0,notifications:true,referralCode:ownReferral,
        ...(inviteCode&&invitedByUserId?{invitedByCode:inviteCode,invitedByUserId}:{}),createdAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
      registerBatch.set(doc(db,"referralCodes",ownReferral),{code:ownReferral,ownerId:credential.user.uid,ownerName:name,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      await registerBatch.commit();
      state.name = name;
      state.role = selectedRole;
      state.balance = 0;
      state.notifications = true;
      state.referralCode = ownReferral;
      if(inviteCode&&invitedByUserId&&byId("couponCode")){byId("couponCode").value=inviteCode;if(byId("couponStatus"))byId("couponStatus").textContent="كود الدعوة محفوظ — حدّد المسار ثم اضغط تطبيق";}
      renderProfile();
      renderBalance();
      renderNotificationSwitch();
      if (selectedRole === "driverApplicant") { window.location.replace("./driver.html"); return; }
      if (selectedRole === "serviceApplicant") { window.location.replace("./services.html"); return; }
      showToast("تم إنشاء حساب العميل بنجاح");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("مرحبًا بعودتك");
    }
  } catch (error) {
    console.error(error);
    byId("authMessage").textContent = authErrorMessage(error);
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

function locateUser(targetInput) {
  initializeCustomerMap();
  if (!navigator.geolocation) {
    showToast("هذا الجهاز أو المتصفح لا يدعم تحديد الموقع");
    return;
  }

  const requestToken = ++state.locationRequestToken;
  showToast("جارٍ جلب موقعك الحالي…");

  navigator.geolocation.getCurrentPosition(position => {
    if (requestToken !== state.locationRequestToken) return;

    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Math.round(Number(position.coords.accuracy || 0));
    const point = [latitude, longitude];

    // أولاً: انقل الخريطة إلى GPS فوراً، قبل أي reverse-geocoding أو حساب مسار شبكي.
    setCenterPick(false);
    state.customerLocation = { latitude, longitude };
    if (state.map) {
      state.map.stop();
      state.map.setView(point, Math.max(16, state.map.getZoom() || 16), { animate: false });
    }

    if (targetInput) {
      targetInput.value = `موقعي الحالي (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
      if (targetInput.id === "rideFrom") {
        // المؤشر يظهر مباشرة، واسم المكان يُحدّث لاحقاً في الخلفية.
        setBookingPoint("pickup", latitude, longitude).catch(console.warn);
      } else {
        setCustomerLocation(latitude, longitude);
      }
    } else {
      setCustomerLocation(latitude, longitude);
    }

    const cityLabel = byId("cityLabel");
    if (cityLabel) cityLabel.textContent = "موقعك الحالي";
    renderCustomerSettingsInfo();
    showToast(accuracy ? `تم جلب موقعك مباشرة • دقة ${accuracy} م` : "تم جلب موقعك مباشرة");
  }, error => {
    if (requestToken !== state.locationRequestToken) return;
    // لا نضع موقعاً افتراضياً حتى لا يظهر للعميل مكان غير حقيقي.
    showToast(locationErrorMessage(error));
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 5000
  });
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
  const order = {
    id: "KW-" + String(Date.now()).slice(-6),
    userId: state.user.uid,
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
    commissionRate: commissionRateFor(type, options.providerCategory || ""),
    commissionAmount: Math.round(Number(price) * commissionRateFor(type, options.providerCategory || "")),
    driverEarnings: Number(price) - Math.round(Number(price) * commissionRateFor(type, options.providerCategory || "")),
    tripOtp: String(Math.floor(1000 + Math.random() * 9000)),
    paymentStatus: options.payment === "المحفظة" ? "paid" : "pending",
    acceptedAt: null, arrivedAt: null, startedAt: null, completedAt: null,
    cancellationReason: "",
    statusIndex: 0,
    cancelled: false,
    createdAt: serverTimestamp(),
    createdAtISO,
    ...(options.foodDetails ? { foodDetails: options.foodDetails } : {})
  };

  const batch = writeBatch(db);
  batch.set(orderRef, order);
  if(options.referralRedemption){
    batch.set(doc(db,"referralRedemptions",state.user.uid),{
      userId:state.user.uid,
      code:options.referralRedemption.code,
      inviterId:options.referralRedemption.inviterId,
      discountAmount:Number(options.referralRedemption.discountAmount||0),
      createdAt:serverTimestamp()
    });
  }
  if (options.walletCharge) {
    const newBalance = state.balance - Number(options.walletCharge);
    batch.set(doc(db, "users", state.user.uid), {
      balance: newBalance,
      updatedAt: serverTimestamp()
    }, { merge: true });
    state.balance = newBalance;
  }
  await batch.commit();

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
    showToast(customerCallableMessage(error, "تأكيد الحجز"));
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
    await createOrder("parcel", `توصيل غرض إلى ${recipientName}`, `${from} ← ${to}`, price, { payment: "نقدًا", pickupLocation: { ...state.customerLocation } });
  } catch (error) {
    console.error(error);
    showToast("تعذر حفظ طلب التوصيل.");
  } finally {
    setButtonBusy(button, false);
  }
});


function restaurantSafeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
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
    return `<article class="restaurant-card open" data-restaurant-card="${restaurantSafeText(restaurant.firestoreId)}"><header class="restaurant-card-head"><h3>🍴 ${restaurantSafeText(restaurant.name)}</h3><div class="restaurant-card-meta"><span>📍 ${restaurantSafeText(restaurant.address || "العنوان غير محدد")}</span><span>• ${meals.length} وجبة متوفرة</span></div></header><div class="restaurant-card-contact"><span>📍 العنوان بالتفصيل: ${restaurantSafeText(restaurant.address || "غير محدد")}</span><span>☎️ رقم الهاتف: ${restaurantSafeText(restaurant.phone || "غير محدد")}</span></div><div class="restaurant-meals">${meals.map((meal, index) => { const normalized = normalizedClientItem(meal); return `<button type="button" class="restaurant-meal-card" data-restaurant-id="${restaurantSafeText(restaurant.firestoreId)}" data-meal-index="${index}"><span class="restaurant-meal-icon">🍽️</span><span><strong>${restaurantSafeText(normalized.name)}</strong><small>${restaurantSafeText(normalized.description || `اضغط لعرض تفاصيل الوجبة`)}</small></span><span class="restaurant-meal-price">${formatMoney(normalized.price)}<small>/${restaurantSafeText(otherItemUnitLabels[normalized.unit])}</small></span></button>`; }).join("") || '<small>لا توجد وجبات متاحة حاليًا</small>'}</div></article>`;
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
    byId("mealDetailPrice").textContent = formatMoney(normalizedMeal.price);
    const choice=byId("mealDeliveryChoice"), toggle=byId("mealDeliveryRequested"), hint=byId("mealDeliveryChoiceHint");
    if(choice) choice.hidden=!normalizedMeal.deliveryAvailable;
    if(toggle){toggle.disabled=!normalizedMeal.deliveryAvailable; toggle.checked=false;}
    if(hint) hint.textContent=normalizedMeal.deliveryAvailable ? `التوصيل متاح مقابل ${formatMoney(normalizedMeal.deliveryFee)}، أو يمكنك الاستلام من المطعم` : "هذه الوجبة للاستلام من المطعم فقط";
    byId("addDetailedMeal").disabled = false; byId("addDetailedMeal").textContent = "اختيار هذه الأكلة"; byId("mealDetailBackdrop").hidden = false;
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
byId("captureRestaurantGps")?.addEventListener("click", () => {
  if (!navigator.geolocation) { showToast("GPS غير مدعوم في هذا الجهاز"); return; }
  const button=byId("captureRestaurantGps"); button.disabled=true; button.textContent="جارٍ تحديد الموقع…";
  navigator.geolocation.getCurrentPosition(position => {
    state.restaurantGps={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy};
    byId("restaurantGpsStatus").textContent=`تم تحديد الموقع ✓ (${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)})`;
    button.disabled=false; button.textContent="📍 تحديث موقع GPS";
  }, () => { button.disabled=false; button.textContent="📍 تحديد موقعي الحالي"; showToast("تعذر الوصول إلى GPS. اسمح للموقع باستخدام الموقع الجغرافي."); }, {enableHighAccuracy:true,timeout:12000,maximumAge:30000});
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
byId("closeMealDetail")?.addEventListener("click",()=>byId("mealDetailBackdrop").hidden=true);
byId("mealDetailBackdrop")?.addEventListener("click",event=>{if(event.target===event.currentTarget) event.currentTarget.hidden=true;});
byId("addDetailedMeal")?.addEventListener("click",()=>{
  const meal=state.selectedMeal; if(!meal)return; const normalized=normalizedClientItem(meal); const wantsDelivery=Boolean(normalized.deliveryAvailable && byId("mealDeliveryRequested")?.checked); state.cart=[{name:meal.name,price:Number(meal.price),description:meal.description||"",unit:normalized.unit,deliveryAvailable:normalized.deliveryAvailable,deliveryFee:normalized.deliveryFee,mealIndex:meal.mealIndex,restaurantId:meal.restaurantId,restaurantName:meal.restaurantName,restaurantAddress:meal.restaurantAddress,restaurantPhone:meal.restaurantPhone,restaurantLocation:meal.restaurantLocation}]; if(byId("foodDeliveryRequested")) byId("foodDeliveryRequested").checked=wantsDelivery; renderCart(); byId("mealDetailBackdrop").hidden=true; showToast(wantsDelivery ? "تم اختيار الوجبة مع التوصيل" : "تم اختيار الوجبة للاستلام من المطعم");
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
const otherItemUnitLabels = { item: "قطعة / طلب", kg: "كيلوغرام", person: "نفر" };

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
  host.innerHTML = professions.map(name => `<button class="service-button" data-service="profession" data-profession="${restaurantSafeText(name)}"><span>🧰</span>${restaurantSafeText(name)}</button>`).join("");
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
    const icon = professionIcon(profile), category = professionLabel(profile);
    const items = Array.isArray(profile.items) ? profile.items.map(normalizedClientItem) : [];
    const locationAvailable = validServiceLocation(profile.location);
    return `<article class="other-service-card">
      <div class="other-service-icon">${icon}</div>
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
    byId("bookOtherService").disabled = true;
    if (deliveryNote) deliveryNote.innerHTML = "<b>اختيار التوصيل بعد الموافقة</b><small>اختر خدمة أولًا لمعرفة إمكانية التوصيل.</small>";
    return;
  }
  byId("selectedItemImage").textContent = professionIcon(profile) || "🧰";
  byId("selectedItemName").textContent = item.name;
  byId("selectedItemDescription").textContent = item.description || "لا توجد تفاصيل إضافية.";
  byId("selectedServicePrice").textContent = `${formatMoney(item.price)} لكل ${otherItemUnitLabels[item.unit]}`;
  byId("otherServiceQuantityLabel").textContent = item.unit === "kg" ? "الوزن المطلوب (كغم)" : item.unit === "person" ? "عدد النفرات" : "الكمية";
  quantityInput.min = item.unit === "kg" ? "0.25" : "1";
  quantityInput.step = item.unit === "kg" ? "0.25" : "1";
  if (!Number.isFinite(Number(quantityInput.value)) || Number(quantityInput.value) < Number(quantityInput.min)) quantityInput.value = "1";
  if (deliveryNote) deliveryNote.innerHTML = item.deliveryAvailable
    ? `<b>التوصيل متاح بعد موافقة النشاط</b><small>بعد الموافقة تختار التوصيل مقابل ${formatMoney(item.deliveryFee)} أو الاستلام من النشاط.</small>`
    : `<b>الاستلام من النشاط</b><small>هذه الخدمة لا تتضمن توصيلًا. بعد الموافقة تستلمها من النشاط.</small>`;
  const quantity = Math.max(Number(quantityInput.min), Number(quantityInput.value || 1));
  const subtotal = Math.round(item.price * quantity);
  byId("otherServiceTotalBreakdown").textContent = `${quantity.toLocaleString("ar-IQ")} ${otherItemUnitLabels[item.unit]} × ${formatMoney(item.price)}`;
  byId("otherServiceGrandTotal").textContent = formatMoney(subtotal);
  byId("bookOtherService").disabled = false;
}

function selectServiceProfile(profile, itemIndex = 0) {
  if (!profile) return;
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
    return `<article class="my-service-request-card" data-service-request-card="${restaurantSafeText(request.firestoreId)}">
      <div class="service-request-head"><div><small>${restaurantSafeText(request.itemName || "طلب خدمة")}</small><h3>${restaurantSafeText(request.providerName || "مزود خدمة")}</h3></div><span class="service-request-status ${statusClass}">${statusLabel}</span></div>
      <p>${restaurantSafeText(request.requestText || "")}</p>
      <div class="service-request-meta"><span>📍 ${restaurantSafeText(request.providerAddress || "العنوان غير محدد")}</span><span>${Number(request.quantity || 1).toLocaleString("ar-IQ")} ${restaurantSafeText(otherItemUnitLabels[request.itemUnit] || otherItemUnitLabels.item)}</span><span>سعر الوحدة ${formatMoney(request.unitPrice || request.itemPrice)}</span><span>قيمة الطلب ${formatMoney(displayedTotal)}</span>${date ? `<span>${date.toLocaleDateString("ar-IQ")}</span>` : ""}</div>
      <div class="service-provider-note">🚚 ${restaurantSafeText(deliveryLabel)}${deliveryStatus === "awaitingCaptain" ? ` • أجرة التوصيل ${formatMoney(request.deliveryFee)}` : ""}</div>
      ${request.providerNote ? `<div class="service-provider-note">ملاحظة المزود: ${restaurantSafeText(request.providerNote)}</div>` : ""}
      ${choiceBox}
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
  byId("selectedServiceBox").hidden = true;
});
byId("locateSelectedService")?.addEventListener("click", () => focusServiceLocation(state.selectedServiceProfile));
byId("bookOtherService")?.addEventListener("click", async event => {
  if (!requireUser()) return;
  const profile = state.selectedServiceProfile;
  if (!profile) return showToast("اختر مزود خدمة أولًا");
  const selectedValue = byId("otherServiceItem").value;
  if (selectedValue === "") return showToast("اختر الخدمة التي تحتاجها");
  const itemIndex = Number(selectedValue);
  const item = normalizedClientItem(profile.items?.[itemIndex]);
  const quantity = Number(byId("otherServiceQuantity").value || 0);
  const requestText = byId("otherServiceRequest").value.trim() || `طلب ${item.name}`;
  const step = item.unit === "kg" ? 0.25 : 1;
  if (!Number.isFinite(quantity) || quantity < step || quantity > 100 || (item.unit !== "kg" && !Number.isInteger(quantity))) return showToast("أدخل كمية صحيحة بين الحد الأدنى و100");
  const unitPrice = Math.max(0, Number(item.price || 0));
  const subtotal = Math.round(unitPrice * quantity);
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري إرسال الحاجة…");
  try {
    await addDoc(collection(db, "serviceRequests"), {
      customerId: state.user.uid,
      customerName: state.name,
      providerId: profile.firestoreId,
      providerName: profile.businessName,
      providerCategory: profile.category || "other",
      providerCity: profile.city || "",
      providerAddress: profile.address || profile.city || "غير محدد",
      providerLocation: validServiceLocation(profile.location) ? { ...profile.location } : null,
      itemIndex,
      itemName: item.name,
      itemUnit: item.unit,
      quantity,
      unitPrice,
      itemPrice: unitPrice,
      subtotal,
      itemDeliveryAvailable: item.deliveryAvailable === true,
      itemDeliveryFee: item.deliveryAvailable ? Math.max(0, Number(item.deliveryFee || 0)) : 0,
      deliveryRequested: false,
      deliveryFee: 0,
      totalPrice: subtotal,
      deliveryStatus: item.deliveryAvailable ? "pendingProvider" : "notAvailable",
      deliveryOrderId: "",
      requestText,
      customerAddress: "",
      customerLocation: null,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    byId("otherServiceRequest").value = "";
    showToast(`تم إرسال حاجتك إلى ${profile.businessName} بقيمة ${formatMoney(subtotal)}. بعد الموافقة تختار التوصيل إن كان متاحًا.`);
  } catch (error) {
    console.error(error);
    showToast("تعذر إرسال الطلب. تأكد من نشر قواعد Firestore الجديدة.");
  } finally {
    setButtonBusy(button, false);
  }
});

byId("myServiceRequests")?.addEventListener("click", async event => {
  const cancelButton = event.target.closest("[data-cancel-service-request]");
  const locateButton = event.target.closest("[data-service-delivery-locate]");
  const deliveryButton = event.target.closest("[data-service-delivery-confirm]");
  const pickupButton = event.target.closest("[data-service-pickup-confirm]");

  if (cancelButton) {
    if (!confirm("هل تريد إلغاء طلب الخدمة؟")) return;
    setButtonBusy(cancelButton, true, "جاري الإلغاء…");
    try {
      await updateDoc(doc(db, "serviceRequests", cancelButton.dataset.cancelServiceRequest), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showToast("تم إلغاء طلب الخدمة");
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
    if (!navigator.geolocation) return showToast("GPS غير مدعوم في هذا الجهاز");
    setButtonBusy(locateButton, true, "جاري تحديد الموقع…");
    navigator.geolocation.getCurrentPosition(position => {
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      state.serviceDeliveryLocations[requestId] = location;
      setCustomerLocation(location.latitude, location.longitude);
      const card = locateButton.closest("[data-service-request-card]");
      const status = card?.querySelector("[data-service-delivery-location-status]");
      if (status) { status.textContent = `تم تحديد موقعك GPS ✓ (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`; status.classList.add("ready"); }
      setButtonBusy(locateButton, false);
      showToast("تم تحديد موقع التوصيل");
    }, () => {
      setButtonBusy(locateButton, false);
      showToast("تعذر تحديد موقعك. اسمح للمتصفح باستخدام GPS.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
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
        providerId: request.providerId,
        serviceRequestId: requestId,
        type: "serviceDelivery",
        title: `توصيل ${request.itemName} من ${request.providerName}`,
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
        commissionRate: commissionRateFor("serviceDelivery", request.providerCategory || ""),
        commissionAmount: Math.round(deliveryFee * commissionRateFor("serviceDelivery", request.providerCategory || "")),
        driverEarnings: deliveryFee - Math.round(deliveryFee * commissionRateFor("serviceDelivery", request.providerCategory || "")),
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

document.querySelectorAll(".add-food-button").forEach(button => {
  button.addEventListener("click", () => {
    state.cart.push({ name: button.dataset.food, price: Number(button.dataset.price) });
    renderCart();
    showToast("تمت الإضافة إلى السلة");
  });
});

function renderCart() {
  const item=state.cart[0];
  const deliveryToggle=byId("foodDeliveryRequested");
  const wantsDelivery=Boolean(item && item.deliveryAvailable && deliveryToggle?.checked);
  const total=item ? Number(item.price)+(wantsDelivery ? Number(item.deliveryFee||0) : 0) : 0;
  byId("cartBar").classList.toggle("show", Boolean(item));
  byId("cartCount").textContent = item ? `${item.name} — ${item.restaurantName}` : "";
  byId("cartPrice").textContent = item ? `${formatMoney(total)} • ${wantsDelivery ? "مع التوصيل" : "استلام من المطعم"}` : "";
  if(item && deliveryToggle){ deliveryToggle.disabled=!item.deliveryAvailable; if(!item.deliveryAvailable) deliveryToggle.checked=false; }
  if(byId("foodDeliveryFeeLabel")) byId("foodDeliveryFeeLabel").textContent = item?.deliveryAvailable ? `أجرة التوصيل ${formatMoney(item.deliveryFee||0)} — ألغِ الاختيار للاستلام من المطعم` : "التوصيل غير متاح لهذه الأكلة — الاستلام من المطعم";
  if(byId("foodDeliveryDetails")) byId("foodDeliveryDetails").style.display=wantsDelivery?"contents":"none";
}


byId("foodDeliveryRequested")?.addEventListener("change", renderCart);
byId("useFoodCustomerLocation")?.addEventListener("click",()=>{
  if(!navigator.geolocation)return showToast("GPS غير مدعوم في هذا الجهاز"); const btn=byId("useFoodCustomerLocation"); setButtonBusy(btn,true,"جارٍ تحديد الموقع…");
  navigator.geolocation.getCurrentPosition(pos=>{setCustomerLocation(pos.coords.latitude,pos.coords.longitude);byId("foodLocationStatus").textContent=`تم تحديد موقع العميل ✓ (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)})`;setButtonBusy(btn,false);},()=>{setButtonBusy(btn,false);showToast("تعذر تحديد موقعك. اسمح للموقع باستخدام GPS.");},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
});

byId("orderFood").addEventListener("click", async event => {
  if (!requireUser() || !state.cart.length) return; const item=state.cart[0];
  const deliveryRequested=Boolean(byId("foodDeliveryRequested")?.checked && item.deliveryAvailable);
  const address=deliveryRequested ? byId("foodCustomerAddress").value.trim() : "استلام من المطعم"; if(deliveryRequested && address.length<3)return showToast("اكتب عنوان العميل بالتفصيل"); if(deliveryRequested && !validServiceLocation(state.customerLocation))return showToast("حدد موقع العميل GPS قبل إرسال طلب التوصيل");
  const restaurant=state.restaurants.find(r=>r.firestoreId===item.restaurantId); const profile=state.serviceProfiles.find(p=>p.firestoreId===item.restaurantId && p.category==="restaurant" && p.active===true && p.approvalStatus==="approved"); if(!restaurant||!profile)return showToast("المطعم لم يعد متاحًا أو غير معتمد");
  const normalized=normalizedClientItem(profile.items?.[item.mealIndex]); if(deliveryRequested && !normalized.deliveryAvailable)return showToast("التوصيل غير متاح لهذه الأكلة؛ اختر الاستلام من المطعم");
  const button=event.currentTarget; setButtonBusy(button,true,"جاري الإرسال للمطعم…");
  try {
    await addDoc(collection(db,"serviceRequests"),{customerId:state.user.uid,customerName:state.name,providerId:item.restaurantId,providerName:profile.businessName,providerCategory:"restaurant",providerCity:profile.city||"",providerAddress:profile.address,providerLocation:{...profile.location},itemIndex:item.mealIndex,itemName:normalized.name,itemUnit:normalized.unit,quantity:1,unitPrice:normalized.price,itemPrice:normalized.price,subtotal:normalized.price,deliveryRequested,deliveryFee:deliveryRequested ? normalized.deliveryFee : 0,totalPrice:normalized.price+(deliveryRequested ? normalized.deliveryFee : 0),deliveryStatus:deliveryRequested ? "pendingProvider" : "notRequested",deliveryOrderId:"",requestText:`طلب طعام: ${normalized.name}`,customerAddress:address,customerLocation:deliveryRequested ? {...state.customerLocation} : null,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    state.cart=[]; renderCart(); byId("foodCustomerAddress").value=""; byId("foodLocationStatus").textContent="يجب تحديد موقعك قبل إرسال الطلب للمطعم."; showToast(deliveryRequested ? "تم إرسال الطلب للمطعم. بعد موافقته سيصل إلى كابتن التوصيل." : "تم إرسال الطلب للمطعم للاستلام من المطعم دون توصيل.");
  } catch(error){console.error(error);showToast("تعذر إرسال الطلب. تأكد أن بيانات المطعم منشورة من بوابة الخدمات ومعتمدة.");} finally {setButtonBusy(button,false);}
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
  const stageHint=byId("tripStageHint"); if(stageHint)stageHint.textContent=order.type==="serviceDelivery"?(statusIndex===0?"بانتظار كابتن توصيل":statusIndex===1?"الكابتن في الطريق إلى المطعم":statusIndex===2?"الكابتن وصل إلى المطعم لاستلام الطلب":statusIndex===3?"الطلب في الطريق إليك — أعطِ رمز التسليم للكابتن فقط عند وصوله":"تم تسليم الطلب"):(statusIndex===0?"نبحث عن كابتن قريب":statusIndex===1?"الكابتن في الطريق إلى نقطة الانطلاق":statusIndex===2?"الكابتن وصل — تحقق من السيارة ثم أعطه رمز الرحلة":statusIndex===3?"الرحلة جارية نحو الوجهة":"وصلت بالسلامة");
  if(order.driverId && state.driverMarker) drawLiveRoute(true);
  byId("trackingStatus").textContent = order.type === "serviceDelivery"
    ? (["بانتظار كابتن", "الكابتن في الطريق إلى الاستلام", "وصل الكابتن إلى نقطة الاستلام", "الطلب في الطريق إليك", "تم التسليم"][statusIndex] || "قيد المتابعة")
    : (orderStatuses[statusIndex] || "قيد المتابعة");
  byId("tripOtpBox").classList.toggle("hidden", !(order.driverId && (order.type === "serviceDelivery" ? statusIndex < 4 : statusIndex < 3)));
  byId("tripOtp").textContent = order.tripOtp || "—";
  byId("paymentTripStatus").textContent = order.paymentStatus === "paid" ? "مكتمل" : "يُسوّى عند الإكمال";
  byId("progressBar").style.width = `${((statusIndex + 1) / orderStatuses.length) * 100}%`;
  const completed = statusIndex >= orderStatuses.length - 1;
  byId("advanceOrder").disabled = true;
  byId("advanceOrder").textContent = completed ? "تم إكمال الطلب" : "تحديث مباشر من الكابتن";
  byId("cancelOrder").style.display = completed ? "none" : "block";
}

byId("cancelOrder").addEventListener("click", async event => {
  if (!state.activeOrder?.firestoreId || !confirm("هل تريد إلغاء الطلب؟")) return;
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الإلغاء…");
  try {
    await updateDoc(doc(db, "orders", state.activeOrder.firestoreId), {
      cancelled: true,
      cancellationReason: prompt("سبب الإلغاء (اختياري):", "") || "",
      cancelledBy: "customer",
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast("تم إلغاء الطلب");
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
      const savedRating = state.ratings.find(item => item.orderId === order.firestoreId);
      if (savedRating) {
        review.innerHTML = `<span class="rating-result" aria-label="تقييم ${savedRating.score} من 5">${"★".repeat(savedRating.score)}${"☆".repeat(5 - savedRating.score)}</span><small>تم تقييم الكابتن</small>`;
      } else {
        const rateButton = document.createElement("button");
        rateButton.type = "button";
        rateButton.className = "rate-driver-button";
        rateButton.textContent = "★ قيّم الكابتن";
        rateButton.addEventListener("click", () => openRatingModal(order.firestoreId));
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

const ratingModal = byId("ratingModal");

function renderRatingPicker() {
  document.querySelectorAll("[data-rating-score]").forEach(button => {
    const active = Number(button.dataset.ratingScore) <= state.ratingScore;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  byId("ratingLabel").textContent = state.ratingScore
    ? ["", "ضعيف", "مقبول", "جيد", "جيد جدًا", "ممتاز"][state.ratingScore]
    : "اختر تقييمك";
}

function openRatingModal(orderId) {
  const order = state.orders.find(item => item.firestoreId === orderId);
  if (!order || order.cancelled || Number(order.statusIndex || 0) < 4 || !order.driverId) {
    showToast("يمكن التقييم بعد اكتمال الرحلة فقط");
    return;
  }
  state.ratingOrderId = orderId;
  state.ratingScore = 0;
  byId("ratingComment").value = "";
  byId("ratingDriverName").textContent = order.driverName || "كابتن كروة";
  byId("ratingOrderCode").textContent = order.id || "";
  renderRatingPicker();
  ratingModal.classList.add("show");
}

function closeRatingModal() {
  ratingModal.classList.remove("show");
  state.ratingOrderId = null;
  state.ratingScore = 0;
}

document.querySelectorAll("[data-rating-score]").forEach(button => {
  button.addEventListener("click", () => {
    state.ratingScore = Number(button.dataset.ratingScore);
    renderRatingPicker();
  });
});

byId("closeRating").addEventListener("click", closeRatingModal);
ratingModal.addEventListener("click", event => {
  if (event.target === ratingModal) closeRatingModal();
});

byId("ratingForm").addEventListener("submit", async event => {
  event.preventDefault();
  const order = state.orders.find(item => item.firestoreId === state.ratingOrderId);
  if (!order || !state.user) return;
  if (!state.ratingScore) {
    showToast("اختر عدد النجوم أولًا");
    return;
  }
  const button = byId("submitRating");
  setButtonBusy(button, true, "جاري الإرسال…");
  try {
    await setDoc(doc(db, "ratings", order.firestoreId), {
      orderId: order.firestoreId,
      orderCode: order.id || "",
      customerId: state.user.uid,
      driverId: order.driverId,
      driverName: order.driverName || "كابتن كروة",
      score: state.ratingScore,
      comment: byId("ratingComment").value.trim().slice(0, 300),
      createdAt: serverTimestamp()
    });
    closeRatingModal();
    showToast("شكرًا، تم إرسال تقييمك");
  } catch (error) {
    console.error(error);
    showToast("تعذر إرسال التقييم");
  } finally {
    setButtonBusy(button, false);
  }
});

function renderBalance() {
  byId("walletBalance").textContent = Number(state.balance || 0).toLocaleString("ar-IQ");
  renderCustomerSettingsInfo();
}

byId("topupForm")?.addEventListener("submit",async event=>{
  event.preventDefault(); if(!requireUser())return;
  const amount=Math.round(Number(byId("topupAmount")?.value||0));
  const transferReference=byId("topupReference")?.value.trim()||"";
  if(!Number.isFinite(amount)||amount<1000||amount>1000000)return showToast("أدخل مبلغًا بين 1,000 و1,000,000 د.ع");
  if(transferReference.length<3)return showToast("اكتب رقم/مرجع التحويل أو آخر أرقام العملية");
  const button=event.submitter||byId("submitTopup"); setButtonBusy(button,true,"جارٍ إرسال الطلب…");
  try{await addDoc(collection(db,"topupRequests"),{userId:state.user.uid,customerName:state.name,email:state.user.email||"",amount,transferReference:transferReference.slice(0,80),method:"mastercard_local",status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});event.currentTarget.reset();showToast("تم إرسال طلب الشحن. سيضاف نفس المبلغ بعد موافقة الإدارة.");}
  catch(error){console.error(error);showToast("تعذر إرسال طلب الشحن");}finally{setButtonBusy(button,false);}
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
  locateButton?.addEventListener("click", () => {
    if (!navigator.geolocation) return showToast("تحديد الموقع غير مدعوم في هذا المتصفح");
    locateButton.disabled = true;
    locateButton.textContent = "جاري تحديد موقعك…";
    navigator.geolocation.getCurrentPosition(position => {
      const latitude = position.coords.latitude, longitude = position.coords.longitude;
      setCustomerLocation(latitude, longitude);
      selectPlace({ lat: latitude, lon: longitude, name: "موقعي الحالي", display_name: `دقة الموقع نحو ${Math.round(position.coords.accuracy || 0)} متر`, namedetails: { "name:ar": "موقعي الحالي" } });
      locateButton.disabled = false;
      locateButton.textContent = "⌖ تحديد موقعي على الخريطة";
    }, error => {
      console.error(error);
      locateButton.disabled = false;
      locateButton.textContent = "⌖ تحديد موقعي على الخريطة";
      showToast(error.code === 1 ? "اسمح للموقع من إعدادات المتصفح" : "تعذر تحديد الموقع؛ تحقق من GPS");
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 });
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

  closeAuthModal();
  if (state.profileRetryTimer) clearTimeout(state.profileRetryTimer);
  state.profileRetryTimer = null;
  byId("connectionBadge").textContent = "متصل ومحفوظ سحابيًا";
  try {
    const roleSnap = await getDoc(doc(db, "users", user.uid));
    const accountRole = roleSnap.exists() ? roleSnap.data().role : null;
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
const createSafetyEventSecure=httpsCallable(functions,"createSafetyEvent");
const createTripShareSecure=httpsCallable(functions,"createTripShare");
byId("shareTrip")?.addEventListener("click",async()=>{if(!state.activeOrder?.firestoreId)return showToast("لا توجد رحلة نشطة");try{const r=await createTripShareSecure({orderId:state.activeOrder.firestoreId});const text=`كروة — مشاركة رحلة ${state.activeOrder.id}\nرمز مشاركة آمن: ${r.data.token}\nصالح لمدة 6 ساعات.`;if(navigator.share)await navigator.share({title:"مشاركة رحلة كروة",text});else await navigator.clipboard.writeText(text);showToast("تم تجهيز مشاركة الرحلة");}catch(e){console.error(e);showToast("تعذر إنشاء مشاركة آمنة");}});
byId("sosTrip")?.addEventListener("click",async()=>{if(!state.activeOrder?.firestoreId||!confirm("إرسال تنبيه سلامة عاجل للإدارة لهذه الرحلة؟"))return;const send=async pos=>{try{await createSafetyEventSecure({orderId:state.activeOrder.firestoreId,kind:"sos",latitude:pos?.coords?.latitude||null,longitude:pos?.coords?.longitude||null,note:"SOS من الراكب"});showToast("تم إرسال تنبيه السلامة للإدارة");}catch(e){console.error(e);showToast("تعذر إرسال التنبيه");}};navigator.geolocation?navigator.geolocation.getCurrentPosition(send,()=>send(null),{timeout:5000}):send(null);});

// Phase 19 — verified community traffic + shared landmarks
const customerCommunity={reports:new Map(),landmarks:new Map(),landmarkData:[],started:false};
const customerReportMeta={traffic:["🚦","ازدحام"],accident:["💥","حادث"],closure:["⛔","شارع مغلق"],roadwork:["🚧","حفريات / أعمال طريق"],hazard:["⚠️","عائق على الطريق"]};
function customerCommunityIcon(kind,type="report",confirmations=0){const meta=customerReportMeta[kind]||["📌","بلاغ"],badge=type==='report'&&confirmations?`<b class="confirm-badge">${confirmations}</b>`:"";return window.L.divIcon({className:"",html:`<div class="${type==='landmark'?'landmark-marker':'road-report-marker'}">${type==='landmark'?'📍':meta[0]}${badge}</div>`,iconSize:[38,38],iconAnchor:[19,19]});}
function customerReportLifetime(x){const c=Number(x.confirmations||0);if(x.type==='closure')return c>=2?6*3600000:2*3600000;if(c>=3)return 4*3600000;if(c>=1)return 2*3600000;return 60*60000;}
function customerReportLive(x){const ts=x.createdAt?.toMillis?.()||Date.parse(x.createdAtISO||0);return x.active!==false&&ts&&Date.now()-ts<customerReportLifetime(x);}
function startCustomerCommunityLayers(){if(customerCommunity.started||!state.map||!auth.currentUser)return;customerCommunity.started=true;
 onSnapshot(collection(db,"roadReports"),snap=>{const live=new Set();snap.forEach(d=>{const x=d.data();if(!customerReportLive(x))return;live.add(d.id);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;const c=Number(x.confirmations||0);let m=customerCommunity.reports.get(d.id);if(!m){m=window.L.marker(ll,{icon:customerCommunityIcon(x.type,"report",c)}).addTo(state.map);customerCommunity.reports.set(d.id,m)}else{m.setLatLng(ll);m.setIcon(customerCommunityIcon(x.type,"report",c));}const label=customerReportMeta[x.type]?.[1]||"بلاغ طريق";m.bindPopup(`<div dir="rtl"><b>${label}</b>${x.note?`<br>${x.note}`:""}<br><small>${c?`مؤكد من ${c} كابتن`:'بلاغ حديث من مجتمع كروة'}</small></div>`)});for(const [id,m] of customerCommunity.reports)if(!live.has(id)){state.map.removeLayer(m);customerCommunity.reports.delete(id)}});
 onSnapshot(collection(db,"landmarks"),snap=>{const live=new Set(),data=[];snap.forEach(d=>{const x=d.data();if(x.status==="hidden")return;data.push({...x,id:d.id});live.add(d.id);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;let m=customerCommunity.landmarks.get(d.id);if(!m){m=window.L.marker(ll,{icon:customerCommunityIcon(null,"landmark")}).addTo(state.map);customerCommunity.landmarks.set(d.id,m)}else m.setLatLng(ll);m.bindPopup(`<div dir="rtl"><b>${x.name||"معلم كروة"}</b><br><small>${x.category||"معلم محلي"} · أضيف بواسطة ${x.createdByRole==='driver'?'كابتن':'عميل'}</small></div>`)});customerCommunity.landmarkData=data;placeSearchCache.clear();for(const [id,m] of customerCommunity.landmarks)if(!live.has(id)){state.map.removeLayer(m);customerCommunity.landmarks.delete(id)}});
}
