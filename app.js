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
const serviceIcons = { ride: "🚕", parcel: "📦", food: "🍽️", service: "🧰" };
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
  ridePrice: 6500,
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
  unsubscribeServiceProfiles: null,
  unsubscribeServiceRequests: null,
  serviceRatings: [],
  unsubscribeServiceRatings: null,
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
  profileRetryTimer: null
};

const formatMoney = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";
const COMMISSION_RATE = 0.15;
const vehiclePricing = {
  "اقتصادي": { base: 2000, perKm: 700, perMin: 80, minimum: 3500 },
  "تكسي": { base: 2500, perKm: 850, perMin: 95, minimum: 4500 },
  "عائلي": { base: 3200, perKm: 1050, perMin: 110, minimum: 5500 }
};
function haversineKm(a,b){const R=6371,toRad=v=>v*Math.PI/180;const dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function calculateRidePrice(){const cfg=vehiclePricing[state.vehicle]||vehiclePricing["اقتصادي"];const raw=cfg.base+state.routeDistanceKm*cfg.perKm+state.routeDurationMin*cfg.perMin;state.ridePrice=Math.max(cfg.minimum,Math.ceil(raw/250)*250);byId("ridePrice").textContent=formatMoney(state.ridePrice);}
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
  initializeCustomerMap(); const a=state.pickupLocation,b=state.destinationLocation; let coords=null;
  try{const route=await valhallaRoute(a,b);state.routeDistanceKm=route.km;state.routeDurationMin=route.mins;state.routeSource="valhalla";coords=route.coords;}
  catch(primary){try{const url=`https://router.project-osrm.org/route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;const r=await fetch(url,{signal:AbortSignal.timeout(5500)});if(!r.ok)throw 0;const data=await r.json(),route=data.routes?.[0];if(!route)throw 0;state.routeDistanceKm=route.distance/1000;state.routeDurationMin=route.duration/60;state.routeSource="osrm";coords=route.geometry.coordinates.map(([lng,lat])=>[lat,lng]);}
  catch(e){const straight=haversineKm(a,b);state.routeDistanceKm=straight*1.28;state.routeDurationMin=(state.routeDistanceKm/28)*60;state.routeSource="fallback";coords=[[a.latitude,a.longitude],[b.latitude,b.longitude]];}}
  if(state.bookingRouteLine)state.bookingRouteLine.setLatLngs(coords);else state.bookingRouteLine=window.L.polyline(coords,{color:"#087b75",weight:7,opacity:.94,lineCap:"round"}).addTo(state.map);state.map.fitBounds(state.bookingRouteLine.getBounds(),{padding:[35,35]});calculateRidePrice();updateRouteSummary();
}
async function setBookingPoint(type,lat,lng,label=""){
  initializeCustomerMap(); const p={latitude:Number(lat),longitude:Number(lng),label:label||""};
  const input=byId(type==="pickup"?"rideFrom":"rideTo"); input.value=label||"جارٍ تحديد اسم المكان…";
  if(type==="pickup"){state.pickupLocation=p;state.customerLocation=p;if(state.pickupMarker)state.pickupMarker.setLatLng([p.latitude,p.longitude]);else state.pickupMarker=window.L.marker([p.latitude,p.longitude],{icon:bookingIcon("pickup"),draggable:true}).addTo(state.map);state.pickupMarker.off("dragend").on("dragend",e=>{const q=e.target.getLatLng();setBookingPoint("pickup",q.lat,q.lng)});state.mapPickMode="destination";}
  else{state.destinationLocation=p;if(state.destinationMarker)state.destinationMarker.setLatLng([p.latitude,p.longitude]);else state.destinationMarker=window.L.marker([p.latitude,p.longitude],{icon:bookingIcon("destination"),draggable:true}).addTo(state.map);state.destinationMarker.off("dragend").on("dragend",e=>{const q=e.target.getLatLng();setBookingPoint("destination",q.lat,q.lng)});}
  if(!label){const found=await reverseGeocode(p.latitude,p.longitude);p.label=found||pointLabel(type==="pickup"?"نقطة الانطلاق":"الوجهة",p);input.value=p.label;}else input.value=label;
  document.querySelectorAll(".map-pick-button").forEach(b=>b.classList.toggle("active",b.id===(state.mapPickMode==="pickup"?"pickRideFrom":"pickRideTo")));calculateBookingRoute();
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
  state.map = window.L.map("customerMap", { zoomControl: false, attributionControl: false }).setView([36.34, 43.13], 13);
  window.L.control.zoom({position:"bottomleft"}).addTo(state.map);
  state.map.on("click", e => { if(!state.centerPickActive) setBookingPoint(state.mapPickMode, e.latlng.lat, e.latlng.lng); });
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
    const storedBalance = Number(data.balance ?? 25000);
    state.role = typeof data.role === "string" && data.role ? data.role : "customer";
    state.name = storedName || user.displayName || user.email?.split("@")[0] || "مستخدم كروة";
    state.balance = Number.isFinite(storedBalance) ? storedBalance : 25000;
    state.notifications = data.notifications !== false;
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
    state.balance = 25000;
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
  renderProfile();
  renderNotificationSwitch();
  renderBalance();
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
      await setDoc(doc(db, "users", credential.user.uid), {
        name,
        email,
        role: selectedRole,
        balance: selectedRole === "customer" ? 25000 : 0,
        notifications: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      state.name = name;
      state.role = selectedRole;
      state.balance = selectedRole === "customer" ? 25000 : 0;
      state.notifications = true;
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

document.querySelectorAll("[data-service]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-service]").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".service-panel").forEach(panel => panel.classList.remove("active"));
    button.classList.add("active");
    byId(button.dataset.service + "Panel").classList.add("active");
  });
});

document.querySelectorAll(".vehicle-button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".vehicle-button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    state.vehicle = button.dataset.vehicle;
    if (state.routeDistanceKm) calculateRidePrice(); else { state.ridePrice = Number(button.dataset.price); byId("ridePrice").textContent = formatMoney(state.ridePrice); }
  });
});

document.querySelectorAll(".payment-button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".payment-button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    state.payment = button.dataset.payment;
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
async function confirmCenterPick(){if(!state.centerPickActive)return;const c=state.map.getCenter();const label=await reverseGeocode(c.lat,c.lng);await setBookingPoint(state.mapPickMode,c.lat,c.lng,label||"");setCenterPick(false);}
function distanceFromMapCenter(x){const c=state.map?.getCenter();if(!c)return null;return haversineKm({latitude:c.lat,longitude:c.lng},{latitude:Number(x.lat),longitude:Number(x.lon)});}

function locateUser(targetInput) {
  if (!navigator.geolocation) {
    targetInput.value = "موقعي الحالي — بغداد";
    showToast("تم اختيار موقع تقريبي");
    return;
  }
  showToast("جاري تحديد موقعك…");
  navigator.geolocation.getCurrentPosition(position => {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    targetInput.value = `موقعي الحالي (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;
    setCustomerLocation(latitude, longitude);
    if (targetInput.id === "rideFrom") setBookingPoint("pickup", latitude, longitude);
    byId("cityLabel").textContent = "الموقع محدد";
    renderCustomerSettingsInfo();
    showToast("تم تحديد موقعك");
  }, () => {
    targetInput.value = "موقعي الحالي — بغداد";
    showToast("تعذر تحديد الموقع؛ تم اختيار بغداد");
  }, { enableHighAccuracy: true, timeout: 7000 });
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
    commissionRate: COMMISSION_RATE,
    commissionAmount: Math.round(Number(price) * COMMISSION_RATE),
    driverEarnings: Math.round(Number(price) * (1 - COMMISSION_RATE)),
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

byId("applyCoupon")?.addEventListener("click", () => {
  if (!requireUser() || !state.routeDistanceKm) return showToast("حدد المسار أولًا");
  const code = byId("couponCode").value.trim();
  byId("couponStatus").textContent = code ? "الكوبونات المتقدمة تحتاج الخادم؛ تم اعتماد السعر المحلي للمشوار." : "أدخل رمز الكوبون";
  calculateRidePrice();
});

byId("bookRide").addEventListener("click", async event => {
  if (!requireUser()) return;
  const from = byId("rideFrom").value.trim();
  const to = byId("rideTo").value.trim();
  if (!from || !to || !state.pickupLocation || !state.destinationLocation) {
    showToast("أدخل نقطة الانطلاق والوجهة");
    return;
  }
  if (state.payment === "المحفظة" && state.balance < state.ridePrice) {
    showToast("رصيد المحفظة غير كافٍ");
    return;
  }
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الحجز…");
  try {
    await createOrder("ride", `مشوار ${state.vehicle}`, `${from} ← ${to}`, state.ridePrice, {
      payment: state.payment,
      walletCharge: state.payment === "المحفظة" ? state.ridePrice : 0,
      pickupLocation: state.pickupLocation, destinationLocation: state.destinationLocation,
      distanceKm: state.routeDistanceKm, durationMin: state.routeDurationMin, routeSource: state.routeSource,
      scheduledAt: byId("scheduleRideAt")?.value || null
    });
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
  if (recipientPhone.replace(/\D/g, "").length < 8) {
    showToast("أدخل رقم هاتف صحيحًا");
    return;
  }
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الطلب…");
  try {
    await createOrder("parcel", `توصيل غرض إلى ${recipientName}`, `${from} ← ${to}`, price, { payment: "نقدًا" });
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
  if (!state.restaurants.length) { host.innerHTML = '<div class="restaurant-empty">لا توجد مطاعم مسجلة حاليًا.</div>'; return; }
  host.innerHTML = state.restaurants.map(restaurant => {
    const meals = Array.isArray(restaurant.meals) ? restaurant.meals : [];
    const gps = restaurant.location && Number.isFinite(Number(restaurant.location.latitude)) ? `${Number(restaurant.location.latitude).toFixed(5)}, ${Number(restaurant.location.longitude).toFixed(5)}` : "غير محدد";
    return `<article class="restaurant-card"><header class="restaurant-card-head"><h3>🍴 ${restaurantSafeText(restaurant.name)}</h3><div class="restaurant-card-meta"><span>📍 ${restaurantSafeText(restaurant.address)}</span><span>• ${meals.length} وجبة</span></div></header><div class="restaurant-card-contact"><span>☎️ ${restaurantSafeText(restaurant.phone)}</span><span>GPS: ${restaurantSafeText(gps)}</span></div><div class="restaurant-meals">${meals.map((meal, index) => `<button type="button" class="restaurant-meal-card" data-restaurant-id="${restaurantSafeText(restaurant.firestoreId)}" data-meal-index="${index}"><span class="restaurant-meal-icon">🍽️</span><span><strong>${restaurantSafeText(meal.name)}</strong><small>${restaurantSafeText(meal.description || "اضغط لعرض تفاصيل الوجبة")}</small><small>${restaurantSafeText(meal.unit || "")}</small></span><span class="restaurant-meal-price">${formatMoney(meal.price)}</span></button>`).join("") || '<small>لا توجد وجبات متاحة حاليًا</small>'}</div></article>`;
  }).join("");
  host.querySelectorAll(".restaurant-meal-card").forEach(button => button.addEventListener("click", () => {
    const restaurant = state.restaurants.find(item => item.firestoreId === button.dataset.restaurantId);
    const meal = restaurant?.meals?.[Number(button.dataset.mealIndex)]; if (!restaurant || !meal) return;
    state.selectedMeal = { ...meal, restaurantId: restaurant.firestoreId, restaurantName: restaurant.name, restaurantAddress: restaurant.address, restaurantPhone: restaurant.phone, restaurantLocation: restaurant.location || null };
    byId("mealDetailRestaurant").textContent = restaurant.name;
    byId("mealDetailTitle").textContent = meal.name;
    byId("mealDetailDescription").textContent = meal.description || "لا توجد تفاصيل إضافية لهذه الوجبة.";
    byId("mealDetailUnit").textContent = meal.unit ? `الكمية/الحجم: ${meal.unit}` : "";
    const deliveryFee = Number(meal.deliveryFee || 0);
    byId("mealDeliveryFee").textContent = deliveryFee > 0 ? `(+ ${formatMoney(deliveryFee)})` : "(بدون رسوم إضافية)";
    byId("mealWithDelivery").checked = false;
    byId("mealDetailPrice").textContent = formatMoney(meal.price);
    byId("mealDetailBackdrop").hidden = false;
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
  const meal=state.selectedMeal; if(!meal)return; if(state.cart.length && state.cart[0].restaurantId && state.cart[0].restaurantId !== meal.restaurantId){showToast("أكمل طلب المطعم الحالي أولًا؛ كل طلب توصيل مرتبط بمطعم واحد.");return;} const withDelivery=byId("mealWithDelivery").checked; state.cart.push({name:meal.name,price:Number(meal.price),unit:meal.unit||"",withDelivery,deliveryFee:withDelivery?Number(meal.deliveryFee||0):0,restaurantId:meal.restaurantId,restaurantName:meal.restaurantName,restaurantAddress:meal.restaurantAddress,restaurantPhone:meal.restaurantPhone,restaurantLocation:meal.restaurantLocation}); renderCart(); byId("mealDetailBackdrop").hidden=true; showToast(withDelivery?"تمت إضافة الوجبة مع التوصيل":"تمت إضافة الوجبة بدون توصيل");
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

function serviceRatingStats(providerId) {
  const rows = state.serviceRatings.filter(r => r.providerId === providerId);
  if (!rows.length) return {avg:0,count:0};
  return { avg: rows.reduce((a,r)=>a+Number(r.score||0),0)/rows.length, count: rows.length };
}

function renderOtherServices() {
  const host = byId("otherServicesMarketplace");
  if (!host) return;
  if (!state.user) {
    host.innerHTML = '<div class="restaurant-empty">سجّل الدخول لعرض مزودي الخدمات المعتمدين.</div>';
    return;
  }
  if (!state.serviceProfiles.length) {
    host.innerHTML = '<div class="restaurant-empty">لا توجد خدمات معتمدة ومتاحة حاليًا.</div>';
    return;
  }
  host.innerHTML = state.serviceProfiles.map(profile => {
    const [icon, category] = otherServiceCategories[profile.category] || otherServiceCategories.other;
    const items = Array.isArray(profile.items) ? profile.items : [];
    const locationAvailable = validServiceLocation(profile.location);
    return `<article class="other-service-card">
      <div class="other-service-icon">${icon}</div>
      <div class="other-service-copy">
        <small>${restaurantSafeText(category)} • مزود معتمد</small>
        <h3>${restaurantSafeText(profile.businessName || "نشاط كروة")}</h3>
        <p>${restaurantSafeText(profile.description || "خدمة موثقة ومتاحة للطلب عبر كروة.")}</p>
        ${(()=>{const r=serviceRatingStats(profile.firestoreId); return r.count ? `<div class="rating-result">★ ${r.avg.toFixed(1)} <small>(${r.count} تقييم)</small></div>` : `<small>لا توجد تقييمات بعد</small>`})()}
        <div class="other-service-location"><span>📍 ${restaurantSafeText(profile.address || profile.city || "العنوان غير محدد")}</span><span>GPS: ${restaurantSafeText(serviceLocationText(profile.location))}</span></div>
        <div class="other-service-actions">
          <button class="primary-button" type="button" data-select-service="${restaurantSafeText(profile.firestoreId)}">اختيار وطلب الخدمة</button>
          <button class="secondary-button" type="button" data-show-service-location="${restaurantSafeText(profile.firestoreId)}" ${locationAvailable ? "" : "disabled"}>عرض الموقع</button>
          <span>${items.length ? `${items.length} خدمة/منتج` : "طلبات مخصصة"}</span>
        </div>
      </div>
    </article>`;
  }).join("");
}

function updateSelectedServicePrice() {
  const select = byId("otherServiceItem");
  const profile = state.selectedServiceProfile;
  if (!select || !profile) return;
  const item = Array.isArray(profile.items) ? profile.items[Number(select.value)] : null;
  byId("selectedServicePrice").textContent = item ? formatMoney(item.price) : "السعر حسب الاتفاق";
}

function selectServiceProfile(profile) {
  if (!profile) return;
  state.selectedServiceProfile = profile;
  const [, category] = otherServiceCategories[profile.category] || otherServiceCategories.other;
  byId("selectedServiceCategory").textContent = category;
  byId("selectedServiceName").textContent = profile.businessName || "نشاط كروة";
  byId("selectedServiceAddress").textContent = profile.address || profile.city || "العنوان غير محدد";
  byId("selectedServiceGps").textContent = serviceLocationText(profile.location);
  byId("locateSelectedService").disabled = !validServiceLocation(profile.location);
  const items = Array.isArray(profile.items) ? profile.items : [];
  byId("otherServiceItem").innerHTML = items.map((item, index) =>
    `<option value="${index}">${restaurantSafeText(item.name || "خدمة")} — ${restaurantSafeText(Number(item.price || 0) > 0 ? formatMoney(item.price) : "حسب الاتفاق")}</option>`
  ).join("") + '<option value="custom">طلب مخصص — السعر حسب الاتفاق</option>';
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
      state.serviceProfiles = snapshot.docs.map(item => ({ firestoreId: item.id, ...item.data() })).filter(item => item.blocked !== true)
        .sort((a, b) => String(a.businessName || "").localeCompare(String(b.businessName || ""), "ar"));
      renderOtherServices();
      if (state.selectedServiceProfile) {
        const freshProfile = state.serviceProfiles.find(item => item.firestoreId === state.selectedServiceProfile.firestoreId);
        if (freshProfile) selectServiceProfile(freshProfile);
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

function subscribeServiceRatings() {
  state.unsubscribeServiceRatings?.();
  state.unsubscribeServiceRatings = onSnapshot(collection(db, "serviceRatings"), snap => {
    state.serviceRatings = snap.docs.map(d=>({firestoreId:d.id,...d.data()})); renderOtherServices(); renderMyServiceRequests();
  }, e => console.warn("service ratings", e));
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
    return `<article class="my-service-request-card">
      <div class="service-request-head"><div><small>${restaurantSafeText(request.itemName || "طلب خدمة")}</small><h3>${restaurantSafeText(request.providerName || "مزود خدمة")}</h3></div><span class="service-request-status ${statusClass}">${statusLabel}</span></div>
      <p>${restaurantSafeText(request.requestText || "")}</p>
      <div class="service-request-meta"><span>📍 ${restaurantSafeText(request.providerAddress || "العنوان غير محدد")}</span><span>التوصيل إلى: ${restaurantSafeText(request.customerAddress || "غير محدد")}</span><span>${Number(request.itemPrice || 0) > 0 ? formatMoney(request.itemPrice) : "السعر حسب الاتفاق"}</span>${date ? `<span>${date.toLocaleDateString("ar-IQ")}</span>` : ""}</div>
      ${request.providerNote ? `<div class="service-provider-note">ملاحظة المزود: ${restaurantSafeText(request.providerNote)}</div>` : ""}
      ${request.status === "pending" ? `<button class="secondary-button danger-button" type="button" data-cancel-service-request="${restaurantSafeText(request.firestoreId)}">إلغاء الطلب</button>` : ""}
      ${request.status === "completed" ? (state.serviceRatings.some(r=>r.requestId===request.firestoreId) ? `<span class="rating-result">تم التقييم ★ ${state.serviceRatings.find(r=>r.requestId===request.firestoreId)?.score}</span>` : `<div class="service-rating-actions"><small>قيّم الخدمة/المنتج:</small>${[1,2,3,4,5].map(n=>`<button type="button" class="text-button" data-rate-service="${restaurantSafeText(request.firestoreId)}" data-score="${n}">${n}★</button>`).join("")}</div>`) : ""}
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
  if (selectButton) selectServiceProfile(profile);
  if (locationButton) focusServiceLocation(profile);
});
byId("otherServiceItem")?.addEventListener("change", updateSelectedServicePrice);
byId("closeSelectedService")?.addEventListener("click", () => {
  state.selectedServiceProfile = null;
  byId("selectedServiceBox").hidden = true;
});
byId("locateSelectedService")?.addEventListener("click", () => focusServiceLocation(state.selectedServiceProfile));
byId("useOtherCustomerLocation")?.addEventListener("click", () => locateUser(byId("otherCustomerAddress")));
byId("bookOtherService")?.addEventListener("click", async event => {
  if (!requireUser()) return;
  const profile = state.selectedServiceProfile;
  if (!profile) return showToast("اختر مزود خدمة أولًا");
  const selectedValue = byId("otherServiceItem").value;
  const item = selectedValue === "custom" ? null : profile.items?.[Number(selectedValue)];
  const itemName = item?.name || "طلب مخصص";
  const requestText = byId("otherServiceRequest").value.trim();
  const customerAddress = byId("otherCustomerAddress").value.trim();
  if (requestText.length < 3) return showToast("اكتب تفاصيل الطلب بوضوح");
  if (customerAddress.length < 3) return showToast("حدد عنوان العميل أو استخدم موقعك الحالي");
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري إرسال الطلب…");
  try {
    const freshUserSnap = await getDoc(doc(db, "users", state.user.uid));
    const freshUser = freshUserSnap.exists() ? freshUserSnap.data() : {};
    const customerName = String(freshUser.name || state.name || state.user.displayName || "عميل كروة").trim();
    const customerPhone = String(freshUser.phone || state.user.phoneNumber || "غير متوفر").trim();
    const requestRef = await addDoc(collection(db, "serviceRequests"), {
      customerId: state.user.uid,
      customerName,
      customerPhone,
      providerId: profile.firestoreId,
      providerName: profile.businessName,
      providerCategory: profile.category || "other",
      providerAddress: profile.address || profile.city || "غير محدد",
      providerLocation: validServiceLocation(profile.location) ? { ...profile.location } : null,
      itemName,
      itemPrice: Number(item?.price || 0),
      requestText,
      customerAddress,
      customerLocation: state.customerLocation ? { ...state.customerLocation } : null,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    byId("otherServiceRequest").value = "";
    console.info("Service request created", requestRef.id, "for provider", profile.firestoreId);
    showToast(`تم إرسال الطلب إلى ${profile.businessName} بنجاح`);
  } catch (error) {
    console.error(error);
    const code = String(error?.code || "");
    showToast(code.includes("permission-denied") ? "تعذر إرسال الطلب بسبب صلاحيات Firestore. انشر قواعد Phase 41." : "تعذر إرسال الطلب. تحقق من الاتصال وحاول مرة أخرى.");
  } finally {
    setButtonBusy(button, false);
  }
});
byId("myServiceRequests")?.addEventListener("click", async event => {
  const rateButton = event.target.closest("[data-rate-service]");
  if (rateButton) {
    const request = state.serviceRequests.find(r=>r.firestoreId===rateButton.dataset.rateService); if(!request || request.status!=="completed") return;
    const score=Number(rateButton.dataset.score); rateButton.disabled=true;
    try { await setDoc(doc(db,"serviceRatings",request.firestoreId), { requestId:request.firestoreId, customerId:state.user.uid, providerId:request.providerId, providerName:request.providerName, itemName:request.itemName, score, createdAt:serverTimestamp() }); showToast("شكرًا، تم حفظ تقييمك"); }
    catch(e){console.error(e); showToast("تعذر حفظ التقييم"); rateButton.disabled=false;} return;
  }
  const button = event.target.closest("[data-cancel-service-request]");
  if (!button || !confirm("هل تريد إلغاء طلب الخدمة؟")) return;
  setButtonBusy(button, true, "جاري الإلغاء…");
  try {
    await updateDoc(doc(db, "serviceRequests", button.dataset.cancelServiceRequest), {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast("تم إلغاء طلب الخدمة");
  } catch (error) {
    console.error(error);
    showToast("تعذر إلغاء الطلب");
  } finally {
    setButtonBusy(button, false);
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
  const cartTotal = state.cart.reduce((total, item) => total + Number(item.price||0) + Number(item.deliveryFee||0), 0);
  const hasDelivery = state.cart.some(item => item.withDelivery);
  byId("cartBar").classList.toggle("show", state.cart.length > 0);
  byId("cartCount").textContent = state.cart.length === 1 ? "عنصر واحد" : `${state.cart.length} عناصر`;
  byId("cartPrice").textContent = formatMoney(cartTotal) + (hasDelivery ? " حسب خيارات التوصيل" : " بدون توصيل");
}

byId("orderFood").addEventListener("click", async event => {
  if (!requireUser() || !state.cart.length) return;
  const total = state.cart.reduce((sum, item) => sum + Number(item.price||0) + Number(item.deliveryFee||0), 0);
  const deliveryRequested = state.cart.some(item => item.withDelivery);
  const title = state.cart.length === 1 ? state.cart[0].name : `طلب طعام (${state.cart.length} أصناف)`;
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الطلب…");
  try {
    const restaurantNames = [...new Set(state.cart.map(item => item.restaurantName).filter(Boolean))];
    const firstRestaurant = state.cart.find(item => item.restaurantName);
    const saved = await createOrder("food", title, deliveryRequested ? (restaurantNames.length === 1 ? `${restaurantNames[0]} ← موقعك الحالي` : "المطعم ← موقعك الحالي") : "استلام من المطعم بدون توصيل", total, { payment: "نقدًا", pickupLocation: deliveryRequested ? (firstRestaurant?.restaurantLocation || null) : null, destinationLocation: deliveryRequested ? (state.customerLocation ? {...state.customerLocation} : null) : null, foodDetails: { deliveryRequested, deliveryRadiusKm: 10, items: state.cart.map(item => ({ name:item.name, price:item.price, unit:item.unit||"", withDelivery:Boolean(item.withDelivery), deliveryFee:Number(item.deliveryFee||0), restaurantId:item.restaurantId || null, restaurantName:item.restaurantName || "" })), restaurantName:firstRestaurant?.restaurantName || "", restaurantAddress:firstRestaurant?.restaurantAddress || "", restaurantPhone:firstRestaurant?.restaurantPhone || "", restaurantLocation:firstRestaurant?.restaurantLocation || null } });
    if (saved) {
      state.cart = [];
      renderCart();
    }
  } catch (error) {
    console.error(error);
    showToast("تعذر حفظ طلب الطعام.");
  } finally {
    setButtonBusy(button, false);
  }
});

byId("foodFilter").addEventListener("click", () => showToast("المطاعم مرتبة حسب وقت التوصيل"));

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
  const stageHint=byId("tripStageHint"); if(stageHint)stageHint.textContent=statusIndex===0?"نبحث عن كابتن قريب":statusIndex===1?"الكابتن في الطريق إلى نقطة الانطلاق":statusIndex===2?"الكابتن وصل — تحقق من السيارة ثم أعطه رمز الرحلة":statusIndex===3?"الرحلة جارية نحو الوجهة":"وصلت بالسلامة";
  if(order.driverId && state.driverMarker) drawLiveRoute(true);
  byId("trackingStatus").textContent = orderStatuses[statusIndex] || "قيد المتابعة";
  byId("tripOtpBox").classList.toggle("hidden", !(order.driverId && statusIndex < 3));
  byId("tripOtp").textContent = order.tripOtp || "—";
  byId("paymentTripStatus").textContent = order.paymentStatus === "paid" ? "مدفوع" : "الدفع عند الإكمال";
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

byId("addBalance").addEventListener("click", async event => {
  if (!requireUser()) return;
  const button = event.currentTarget;
  setButtonBusy(button, true);
  try {
    state.balance += 10000;
    await saveUserData({ balance: state.balance });
    renderBalance();
    showToast("تمت إضافة 10,000 د.ع كرصيد تجريبي");
  } catch (error) {
    state.balance -= 10000;
    console.error(error);
    showToast("تعذر تحديث الرصيد");
  } finally {
    setButtonBusy(button, false);
  }
});

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
  subscribeRestaurants();
  subscribeServiceProfiles();
  subscribeServiceRequests(user);
  subscribeServiceRatings();
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
    if (state.unsubscribeServiceRatings) { state.unsubscribeServiceRatings(); state.unsubscribeServiceRatings = null; state.serviceRatings = []; }
    if (state.unsubscribeServiceRequests) {
      state.unsubscribeServiceRequests();
      state.unsubscribeServiceRequests = null;
    }
    state.name = "ضيف";
    state.role = "customer";
    state.balance = 0;
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
