import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  increment,
  arrayUnion,
  where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyASl5jV5mLaDh8CoeeofV7ftVJ3gaog64E",
  authDomain: "karwa0.firebaseapp.com",
  projectId: "karwa0",
  storageBucket: "karwa0.firebasestorage.app",
  messagingSenderId: "485451054622",
  appId: "1:485451054622:web:ce9b0e2ff2280870a8780f"
};

const app = initializeApp(firebaseConfig, "karwa-driver-portal");
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const acceptOrderSecure = httpsCallable(functions, "acceptOrder");
const advanceTripSecure = httpsCallable(functions, "advanceTrip");

function callableErrorKey(error) {
  const code = String(error?.code || "").replace(/^functions\//, "").toLowerCase();
  const message = String(error?.message || "").toUpperCase();
  const details = typeof error?.details === "string" ? error.details.toUpperCase() : String(error?.details?.message || error?.details?.code || "").toUpperCase();
  const haystack = `${message} ${details}`;
  const known = ["ORDER_TAKEN","DRIVER_NOT_AVAILABLE","DRIVER_ONLY","NOT_IN_DISPATCH_ROUND","ORDER_NOT_FOUND","NOT_ASSIGNED","INVALID_TRANSITION","OTP_INVALID"];
  return { code, named: known.find(key => haystack.includes(key)), raw: haystack };
}

function driverCallableMessage(error, action = "تنفيذ العملية") {
  const e = callableErrorKey(error);
  if (e.named === "ORDER_TAKEN" || e.code === "already-exists") return "سبق أن قبل كابتن آخر هذا الطلب.";
  if (e.named === "NOT_IN_DISPATCH_ROUND") return "هذا الطلب مخصص مؤقتًا لكباتن أقرب. انتظر انتهاء جولة التوزيع ثم حاول مجددًا.";
  if (e.named === "DRIVER_NOT_AVAILABLE") return "الخادم يعتبر حسابك غير متاح. فعّل الاتصال وتأكد أن حساب الكابتن مفعل وغير محظور.";
  if (e.named === "DRIVER_ONLY" || e.code === "permission-denied" && !e.named) return "صلاحية الحساب ليست كابتن أو لا تسمح بهذه العملية. راجع تفعيل الحساب من الإدارة.";
  if (e.named === "ORDER_NOT_FOUND" || e.code === "not-found" && !e.raw.includes("404")) return "الطلب لم يعد موجودًا أو تم حذفه.";
  if (e.named === "NOT_ASSIGNED") return "هذه الرحلة غير مسندة إلى حساب الكابتن الحالي.";
  if (e.named === "INVALID_TRANSITION") return "لا يمكن نقل الرحلة إلى الحالة التالية من حالتها الحالية.";
  if (e.named === "OTP_INVALID") return "رمز بدء الرحلة غير صحيح.";
  if (e.code === "unauthenticated") return "انتهت جلسة تسجيل الدخول. سجّل الدخول من جديد.";
  if (e.code === "not-found" || e.raw.includes("NOT FOUND") || e.raw.includes("404")) return "خدمة الكابتن الخلفية غير منشورة. انشر Firebase Functions ثم أعد المحاولة.";
  if (e.code === "unavailable" || e.code === "deadline-exceeded" || e.raw.includes("NETWORK") || !navigator.onLine) return "تعذر الاتصال بخادم كروة. تحقق من الإنترنت ثم أعد المحاولة.";
  if (e.code === "internal" || e.code === "unknown") return `حدث خطأ في Cloud Functions أثناء ${action}. راجع سجل الوظائف في Firebase.`;
  return `تعذر ${action}. ${error?.message ? String(error.message).replace(/^FirebaseError:\s*/i, "") : "تحقق من إعدادات Firebase."}`;
}

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الكابتن", error);
}

const byId = id => document.getElementById(id);
const statuses = ["بانتظار كابتن", "الكابتن في الطريق", "وصلت إلى العميل", "بدأت الرحلة", "تم الوصول"];
const icons = { ride: "🚕", parcel: "📦", food: "🍽️", serviceDelivery: "🛵" };
const DELIVERY_ORDER_TYPES = new Set(["parcel", "food", "serviceDelivery"]);

function driverOrderMode(driver = state.driverData) {
  if (!driver) return "none";
  if (driver.serviceType === "taxi" && driver.vehicleType !== "دراجة") return "taxi";
  if (driver.serviceType === "delivery" && ["اقتصادي", "تكسي", "عائلي", "دراجة"].includes(driver.vehicleType)) return "delivery";
  return "none";
}

function canDriverHandleOrder(order, driver = state.driverData) {
  const mode = driverOrderMode(driver);
  if (mode === "taxi") return order?.type === "ride";
  if (mode === "delivery") return DELIVERY_ORDER_TYPES.has(order?.type);
  return false;
}
const DRIVER_MAP_STYLES = {
  day: "https://tiles.openfreemap.org/styles/positron",
  night: "https://tiles.openfreemap.org/styles/dark"
};

function readDriverPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}

function writeDriverPreference(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

const state = {
  user: null,
  userData: null,
  driverData: null,
  ratings: [],
  orders: [],
  userUnsubscribe: null,
  viewUnsubscribes: [],
  locationWatchId: null,
  lastLocationWrite: 0,
  lastPosition: null,
  map: null,
  baseLayer: null,
  mapTheme: readDriverPreference("karwa.driver.mapTheme", "day") === "night" ? "night" : "day",
  mapView: readDriverPreference("karwa.driver.mapView", "2d") === "3d" ? "3d" : "2d",
  autoFollow: readDriverPreference("karwa.driver.autoFollow", "true") !== "false",
  mapSearchMarker: null,
  mapSearchSelection: null,
  driverMarker: null,
  pickupMarker: null,
  destinationMarker: null,
  routeLine: null,
  lastRouteAt: 0,
  lastRoutePoint: null,
  restaurantGps: null,
  restaurantMeals: [],
  directRegistration: new URLSearchParams(window.location.search).get("mode") === "register"
};

const money = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[char]);

function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.driverToast);
  window.driverToast = setTimeout(() => element.classList.remove("show"), 2800);
}

function mapIcon(type) {
  if (!window.L) return null;
  return window.L.divIcon({
    className: "",
    html: `<div class="portal-map-marker ${type}"><span>${type === "pickup" ? "●" : "🚗"}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 36]
  });
}

function initializeDriverMap() {
  if (!window.L || state.map) return;
  state.map = window.L.map("driverMap", { attributionControl: false }).setView([33.3152, 44.3661], 12);
  state.baseLayer = window.L.maplibreGL({ style: DRIVER_MAP_STYLES[state.mapTheme] }).addTo(state.map);
  const maplibreMap = state.baseLayer.getMaplibreMap?.();
  maplibreMap?.on("style.load", () => window.setTimeout(applyDriverNightLabels, 0));
  applyDriverMapPreferences();
  window.setTimeout(applyDriverNightLabels, 500);
}

function applyDriverNightLabels() {
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

function updateDriverSettingsInfo() {
  const data = state.driverData || {};
  const name = data.name || state.userData?.name || state.user?.displayName || "كابتن كروة";
  const ratingCount = state.ratings.length;
  const rating = ratingCount
    ? state.ratings.reduce((total, item) => total + Number(item.score || 0), 0) / ratingCount
    : 0;
  const firstLetter = Array.from(String(name).trim())[0] || "ك";
  if (byId("driverSettingsAvatar")) byId("driverSettingsAvatar").textContent = firstLetter;
  if (byId("driverSettingsName")) byId("driverSettingsName").textContent = name;
  if (byId("driverSettingsEmail")) byId("driverSettingsEmail").textContent = state.user?.email || "—";
  if (byId("driverSettingsPhone")) byId("driverSettingsPhone").textContent = data.phone || state.userData?.phone || "غير مضاف";
  if (byId("driverSettingsStatus")) byId("driverSettingsStatus").textContent = data.online ? "متصل وجاهز" : "غير متصل";
  if (byId("driverSettingsVehicle")) byId("driverSettingsVehicle").textContent = data.vehicleType || "غير محدد";
  if (byId("driverSettingsPlate")) byId("driverSettingsPlate").textContent = data.plate || "غير محدد";
  if (byId("driverSettingsRating")) byId("driverSettingsRating").textContent = ratingCount ? `${rating.toFixed(1)} ★` : "جديد";
  if (byId("driverSettingsWarnings")) byId("driverSettingsWarnings").textContent = String(Number(data.warningCount || 0));
}

function applyDriverMapPreferences() {
  const view = byId("driverView");
  if (!view) return;
  view.classList.toggle("map-theme-night", state.mapTheme === "night");
  view.classList.toggle("map-view-3d", state.mapView === "3d");
  view.querySelectorAll("[data-map-theme]").forEach(button => {
    const active = button.dataset.mapTheme === state.mapTheme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  view.querySelectorAll("[data-map-view]").forEach(button => {
    const active = button.dataset.mapView === state.mapView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (byId("driverThemeValue")) byId("driverThemeValue").textContent = state.mapTheme === "night" ? "ليلي" : "نهاري";
  if (byId("driverViewValue")) byId("driverViewValue").textContent = state.mapView.toUpperCase();
  const follow = byId("driverAutoFollowSetting");
  if (follow) {
    follow.classList.toggle("on", state.autoFollow);
    follow.setAttribute("aria-checked", String(state.autoFollow));
  }
  window.setTimeout(() => state.map?.invalidateSize(), 390);
}

function setDriverMapTheme(theme) {
  state.mapTheme = theme === "night" ? "night" : "day";
  writeDriverPreference("karwa.driver.mapTheme", state.mapTheme);
  const maplibreMap = state.baseLayer?.getMaplibreMap?.();
  if (maplibreMap) maplibreMap.setStyle(DRIVER_MAP_STYLES[state.mapTheme]);
  applyDriverMapPreferences();
  if (state.mapTheme === "night") window.setTimeout(applyDriverNightLabels, 450);
  toast(state.mapTheme === "night" ? "تم تفعيل الخريطة الليلية" : "تم تفعيل الخريطة النهارية");
}

function setDriverMapView(mode) {
  state.mapView = mode === "3d" ? "3d" : "2d";
  writeDriverPreference("karwa.driver.mapView", state.mapView);
  applyDriverMapPreferences();
  toast(state.mapView === "3d" ? "تم تفعيل منظور 3D" : "تم تفعيل عرض 2D");
}

function setLocationStatus(text, mode = "pending") {
  byId("locationStatus").textContent = text;
  byId("locationStatus").className = `status-chip ${mode}`;
}

function decodeValhallaShape(encoded){let index=0,lat=0,lng=0,out=[];while(index<encoded.length){let b,shift=0,result=0;do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);lat+=(result&1)?~(result>>1):(result>>1);shift=0;result=0;do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);lng+=(result&1)?~(result>>1):(result>>1);out.push([lat/1e6,lng/1e6]);}return out;}
function turnIcon(m){const t=String(m?.type??"");if([9,10,11,12,13].includes(Number(t)))return "↪️";if([14,15,16,17,18].includes(Number(t)))return "↩️";if([26,27].includes(Number(t)))return "🔄";if([4,5,6].includes(Number(t)))return "➡️";if([7,8].includes(Number(t)))return "⬅️";return "⬆️";}
async function valhallaNavigate(a,b){const body={locations:[{lat:a.latitude,lon:a.longitude},{lat:Number(b.latitude),lon:Number(b.longitude)}],costing:"auto",units:"kilometers",language:"ar-IQ",directions_options:{units:"kilometers",language:"ar-IQ"},alternates:1};const r=await fetch("https://valhalla1.openstreetmap.de/route",{method:"POST",headers:{"Content-Type":"application/json","X-Client-Id":"karwa0.app"},body:JSON.stringify(body),signal:AbortSignal.timeout(5500)});if(!r.ok)throw new Error("VALHALLA");const x=await r.json(),leg=x.trip?.legs?.[0],sum=x.trip?.summary;if(!leg||!sum)throw 0;return{coords:decodeValhallaShape(leg.shape),km:Number(sum.length||0),mins:Number(sum.time||0)/60,maneuvers:leg.maneuvers||[]};}
function haversine(a,b){const R=6371,r=v=>v*Math.PI/180,dl=r(b.latitude-a.latitude),dn=r(b.longitude-a.longitude);const x=Math.sin(dl/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
async function drawPickupRoute(force=false) {
  if (!state.map) return;
  const activeOrder=state.orders.find(order=>order.driverId===state.user?.uid&&!order.cancelled&&Number(order.statusIndex||0)<4);
  const st=Number(activeOrder?.statusIndex||0),target=st>=3?activeOrder?.destinationLocation:activeOrder?.pickupLocation;if(!target)return;
  const targetPoint=[Number(target.latitude),Number(target.longitude)];if(state.pickupMarker)state.pickupMarker.setLatLng(targetPoint);else state.pickupMarker=window.L.marker(targetPoint,{icon:mapIcon("pickup")}).addTo(state.map);state.pickupMarker.bindPopup(st>=3?"عنوان العميل":(activeOrder?.type==="serviceDelivery"?"عنوان المطعم":"موقع العميل"));
  if(!state.driverMarker)return;const pos=state.driverMarker.getLatLng(),now=Date.now(),current={latitude:pos.lat,longitude:pos.lng};const moved=state.lastRoutePoint?haversine(current,state.lastRoutePoint):Infinity;if(!force&&now-state.lastRouteAt<9000&&moved<.08)return;state.lastRouteAt=now;state.lastRoutePoint=current;
  let coords=[[pos.lat,pos.lng],targetPoint],km=haversine(current,target)*1.28,mins=km/28*60,provider="تقدير",maneuvers=[];
  try{const vr=await valhallaNavigate(current,target);coords=vr.coords;km=vr.km;mins=vr.mins;maneuvers=vr.maneuvers;provider="Valhalla";}catch(e){try{const u=`https://router.project-osrm.org/route/v1/driving/${pos.lng},${pos.lat};${target.longitude},${target.latitude}?overview=full&geometries=geojson`;const r=await fetch(u,{signal:AbortSignal.timeout(4500)}),x=await r.json(),route=x.routes?.[0];if(!route)throw 0;coords=route.geometry.coordinates.map(([lng,lat])=>[lat,lng]);km=route.distance/1000;mins=route.duration/60;provider="OSRM";}catch(_){}}
  if(state.routeLine)state.routeLine.setLatLngs(coords);else state.routeLine=window.L.polyline(coords,{color:"#087b75",weight:8,opacity:.95,lineCap:"round"}).addTo(state.map);
  byId("driverEta").textContent=`${Math.max(1,Math.round(mins))} دقيقة`;byId("driverRemaining").textContent=km<1?`${Math.max(1,Math.round(km*1000))} م`:`${km.toFixed(1)} كم`;byId("driverNavTarget").textContent=st>=3?"إلى الوجهة":"إلى الراكب";byId("driverRouteProvider").textContent=provider;
  const m=maneuvers.find(x=>Number(x.length||0)>.02)||maneuvers[0];byId("nextTurnText").textContent=m?.instruction||m?.verbal_transition_alert_instruction||"استمر على المسار المحدد";byId("nextTurnIcon").textContent=turnIcon(m);
  byId("offRouteAlert").classList.add("hidden");if(force)state.map.fitBounds(state.routeLine.getBounds(),{padding:[40,40],maxZoom:17});
}

function showOwnPosition(position) {
  initializeDriverMap();
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const point = [latitude, longitude];
  if (state.driverMarker) state.driverMarker.setLatLng(point);
  else state.driverMarker = window.L.marker(point, { icon: mapIcon("driver") })
    .addTo(state.map)
    .bindPopup("موقعك الحالي");
  if (state.autoFollow) state.map.setView(point, 15);
  const acc=Math.round(position.coords.accuracy||0);
  setLocationStatus(acc>100?"GPS ضعيف":"الموقع مباشر", acc>100?"pending":"approved");
  byId("locationHint").textContent = acc>100?`دقة الموقع منخفضة (${acc} م). انتقل لمكان مفتوح لتحسين التتبع.`:`دقة الموقع نحو ${acc} متر.`;
  if(Number.isFinite(position.coords.heading)){const el=state.driverMarker?.getElement()?.querySelector(".portal-map-marker");if(el)el.style.transform=`rotate(${position.coords.heading}deg)`;}
  drawPickupRoute();
}

async function sharePosition(position, force = false) {
  if (!state.user || !state.driverData?.online || !position) return;
  const now = Date.now();
  if (!force && now - state.lastLocationWrite < 5000) return;
  const activeOrders = state.orders.filter(order =>
    order.driverId === state.user.uid && !order.cancelled && Number(order.statusIndex || 0) < 4
  );
  state.lastLocationWrite = now;
  const location = {
    driverId: state.user.uid,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number(position.coords.accuracy || 0),
    heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
    speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
    updatedAt: serverTimestamp()
  };
  await updateDoc(doc(db, "drivers", state.user.uid), { latitude: location.latitude, longitude: location.longitude, locationAccuracy: location.accuracy, locationUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(()=>{});
  const results = await Promise.allSettled(activeOrders.map(order =>
    setDoc(doc(db, "orders", order.firestoreId, "tracking", "current"), location, { merge: true })
  ));
  if (results.some(result => result.status === "rejected")) {
    console.error("تعذر إرسال بعض تحديثات الموقع", results);
    byId("locationHint").textContent = "تعذر إرسال الموقع؛ تحقق من قواعد Firestore.";
  }
}

function startLocationSharing() {
  if (state.locationWatchId !== null) return;
  initializeDriverMap();
  if (!navigator.geolocation) {
    setLocationStatus("غير مدعوم", "rejected");
    byId("locationHint").textContent = "هذا المتصفح لا يدعم تحديد الموقع.";
    return;
  }
  setLocationStatus("جاري التحديد", "pending");
  state.locationWatchId = navigator.geolocation.watchPosition(position => {
    state.lastPosition = position;
    showOwnPosition(position);
    renderOrders(); // يعيد ترتيب الطلبات فور تغير موقع الكابتن
    sharePosition(position).catch(error => console.error(error));
  }, error => {
    console.error(error);
    setLocationStatus("تعذر الموقع", "rejected");
    byId("locationHint").textContent = error.code === 1
      ? "اسمح للموقع من إعدادات المتصفح ثم فعّل الاتصال مجددًا."
      : "تعذر قراءة الموقع. تأكد من GPS والإنترنت.";
    if (error.code === 1 && state.user) {
      updateDoc(doc(db, "drivers", state.user.uid), { online: false, updatedAt: serverTimestamp() })
        .catch(() => {});
    }
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
}

function stopLocationSharing() {
  if (state.locationWatchId !== null) navigator.geolocation.clearWatch(state.locationWatchId);
  state.locationWatchId = null;
  state.lastLocationWrite = 0;
  setLocationStatus("متوقف", "pending");
  byId("locationHint").textContent = "فعّل حالة الاتصال لمشاركة موقعك أثناء الرحلات.";
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
    "auth/network-request-failed": "تعذر الاتصال بالإنترنت.",
    "auth/email-already-in-use": "هذا البريد مستخدم بالفعل. سجّل الدخول بدل إنشاء حساب جديد.",
    "auth/weak-password": "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل."
  };
  return messages[error.code] || "تعذر تنفيذ العملية. تحقق من البيانات وحاول مرة أخرى.";
}

function configureDirectRegistrationUI() {
  const active = state.directRegistration && !state.user;
  const fields = byId("driverAccountFields");
  if (fields) fields.hidden = !active;
  ["driverRegisterEmail", "driverRegisterPassword", "driverRegisterPasswordConfirm"].forEach(id => {
    const input = byId(id);
    if (input) input.required = active;
  });
  if (active) {
    byId("applicationHeroTitle").textContent = "إنشاء حساب كابتن";
    byId("applicationHeroText").textContent = "أكمل التسجيل مرة واحدة. بعد الإرسال يصل طلبك مباشرةً إلى الإدارة للموافقة.";
    byId("applicationHeroBadge").textContent = "تسجيل مباشر";
    byId("applicationStatus").textContent = "تسجيل جديد";
    byId("applicationNotice").className = "notice";
    byId("applicationNotice").textContent = "الحساب سيُنشأ بعد اكتمال جميع البيانات، ثم يبقى غير مفعل حتى موافقة الإدارة.";
    byId("submitApplication").disabled = false;
    byId("submitApplication").textContent = "إنشاء الحساب وإرسال طلب الموافقة";
  } else {
    byId("applicationHeroTitle").textContent = "انضم إلى كباتن كروة";
    byId("applicationHeroText").textContent = "أكمل بياناتك، ثم يُرسل طلبك إلى الإدارة للموافقة.";
    byId("applicationHeroBadge").textContent = "طلب انضمام";
  }
}

function showView(name) {
  document.body.classList.toggle("driver-map-mode", name === "driver");
  if (name !== "driver") byId("driverView")?.classList.remove("driver-options-open", "driver-settings-open");
  byId("authView").classList.toggle("hidden", name !== "auth");
  byId("deniedView").classList.toggle("hidden", name !== "denied");
  byId("blockedView").classList.toggle("hidden", name !== "blocked");
  byId("applicationView").classList.toggle("hidden", name !== "application");
  byId("driverView").classList.toggle("hidden", name !== "driver");
  byId("logoutButton").classList.toggle("hidden", name === "auth" || (name === "application" && state.directRegistration && !state.user));
  if (name === "application") configureDirectRegistrationUI();
}

function clearViewListeners() {
  state.viewUnsubscribes.forEach(unsubscribe => unsubscribe?.());
  state.viewUnsubscribes = [];
  stopLocationSharing();
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

byId("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  toast("تم تسجيل الخروج");
});

function setDriverSettingsOpen(open) {
  const view = byId("driverView");
  const panel = byId("driverSettingsPanel");
  const toggle = byId("driverSettingsToggle");
  if (!view || !panel || !toggle) return;
  if (open) {
    view.querySelector(".driver-options-close")?.click();
    updateDriverSettingsInfo();
    applyDriverMapPreferences();
  }
  view.classList.toggle("driver-settings-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  panel.setAttribute("aria-hidden", String(!open));
  panel.inert = !open;
  if (open) window.setTimeout(() => byId("driverSettingsClose")?.focus({ preventScroll: true }), 80);
  else toggle.focus({ preventScroll: true });
}

byId("driverSettingsPanel").inert = true;
byId("driverSettingsToggle").addEventListener("click", () => setDriverSettingsOpen(true));
byId("driverSettingsClose").addEventListener("click", () => setDriverSettingsOpen(false));
byId("driverSettingsScrim").addEventListener("click", () => setDriverSettingsOpen(false));
byId("driverSettingsPanel").querySelectorAll("[data-map-theme]").forEach(button => {
  button.addEventListener("click", () => setDriverMapTheme(button.dataset.mapTheme));
});
byId("driverSettingsPanel").querySelectorAll("[data-map-view]").forEach(button => {
  button.addEventListener("click", () => setDriverMapView(button.dataset.mapView));
});
byId("driverAutoFollowSetting").addEventListener("click", () => {
  state.autoFollow = !state.autoFollow;
  writeDriverPreference("karwa.driver.autoFollow", String(state.autoFollow));
  applyDriverMapPreferences();
  if (state.autoFollow && state.lastPosition) showOwnPosition(state.lastPosition);
  toast(state.autoFollow ? "تم تفعيل متابعة موقعك" : "يمكنك الآن تحريك الخريطة بحرية");
});
byId("driverSettingsOperations").addEventListener("click", () => {
  setDriverSettingsOpen(false);
  window.setTimeout(() => byId("driverOptionsToggle")?.click(), 120);
});
byId("driverSettingsLogout").addEventListener("click", () => byId("logoutButton").click());
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && byId("driverView")?.classList.contains("driver-settings-open")) {
    setDriverSettingsOpen(false);
  }
});

byId("deniedLogout").addEventListener("click", async () => {
  await signOut(auth);
  toast("تم تسجيل الخروج");
});

byId("blockedLogout").addEventListener("click", async () => {
  await signOut(auth);
  toast("تم تسجيل الخروج");
});

function renderCaptainRestaurantMeals() {
  const host = byId("captainMealList"); if (!host) return;
  byId("captainMealCount").textContent = `${state.restaurantMeals.length} وجبة`;
  host.innerHTML = state.restaurantMeals.map((meal,index)=>`<div class="captain-meal-item"><span><strong>${String(meal.name).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}</strong><small>${String(meal.description||"بدون تفاصيل").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}</small></span><b>${Number(meal.price).toLocaleString("ar-IQ")} د.ع</b><button type="button" data-remove-captain-meal="${index}">حذف</button></div>`).join("");
  host.querySelectorAll("[data-remove-captain-meal]").forEach(btn=>btn.addEventListener("click",()=>{state.restaurantMeals.splice(Number(btn.dataset.removeCaptainMeal),1);renderCaptainRestaurantMeals();}));
}
function updateVehicleApplicationFields() {
  const serviceType = byId("serviceType")?.value || "taxi";
  const other = serviceType === "other";
  const vehicleSelect = byId("vehicleType");
  const bikeOption = vehicleSelect?.querySelector('option[value="دراجة"]');
  if (bikeOption) bikeOption.disabled = serviceType === "taxi";
  if (serviceType === "taxi" && vehicleSelect?.value === "دراجة") vehicleSelect.value = "اقتصادي";
  const isBike = vehicleSelect?.value === "دراجة";
  document.querySelectorAll(".vehicle-service-field").forEach(el => el.classList.toggle("hidden", other));
  document.querySelectorAll(".car-only-field").forEach(el => el.classList.toggle("hidden", other || isBike));
  byId("restaurantApplicationFields")?.classList.toggle("hidden", !other);
  ["vehicleMake", "vehicleModel", "vehicleCondition"].forEach(id => { const el=byId(id); if(el) el.required=!other&&!isBike; });
  ["vehicleType","plate"].forEach(id=>{const el=byId(id);if(el)el.required=!other;});
}
byId("vehicleType")?.addEventListener("change", updateVehicleApplicationFields);
byId("serviceType")?.addEventListener("change", updateVehicleApplicationFields);
byId("captainRestaurantGps")?.addEventListener("click",()=>{
  if(!navigator.geolocation){toast("GPS غير مدعوم في هذا الجهاز");return;}
  const btn=byId("captainRestaurantGps"); busy(btn,true,"جارٍ تحديد الموقع…");
  navigator.geolocation.getCurrentPosition(pos=>{state.restaurantGps={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy};byId("captainRestaurantGpsStatus").textContent=`تم تحديد الموقع ✓ (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)})`;busy(btn,false);btn.textContent="📍 تحديث موقع المطعم";},()=>{busy(btn,false);toast("تعذر الوصول إلى GPS. اسمح للموقع باستخدام موقعك الجغرافي.");},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
});
byId("captainAddMeal")?.addEventListener("click",()=>{
  const name=byId("captainMealName").value.trim(), description=byId("captainMealDescription").value.trim(), price=Number(byId("captainMealPrice").value);
  if(!name||!Number.isFinite(price)||price<=0){toast("أدخل اسم الوجبة وسعرًا صحيحًا");return;}
  if(state.restaurantMeals.length>=30){toast("الحد الأقصى 30 وجبة");return;}
  state.restaurantMeals.push({name,description,price:Math.round(price)});["captainMealName","captainMealDescription","captainMealPrice"].forEach(id=>byId(id).value="");renderCaptainRestaurantMeals();
});

function fillApplication(data = {}) {
  byId("driverName").value = data.name || state.userData?.name || state.user?.displayName || "";
  byId("driverPhone").value = data.phone || "";
  byId("serviceType").value = data.serviceType || "taxi";
  byId("vehicleType").value = data.vehicleType || "اقتصادي";
  byId("vehicleMake").value = data.vehicleMake || "";
  byId("vehicleModel").value = data.vehicleModel || "";
  byId("vehicleCondition").value = data.vehicleCondition || "شغالة";
  updateVehicleApplicationFields();
  byId("plate").value = data.plate || "";
  byId("driverCity").value = data.city || "بغداد";
}

function showApplicationStatus(data) {
  const chip = byId("applicationStatus");
  const notice = byId("applicationNotice");
  const button = byId("submitApplication");
  chip.className = "status-chip pending";
  notice.className = "notice hidden";
  button.disabled = false;
  button.textContent = "إرسال طلب الانضمام";

  if (!data) return;
  fillApplication(data);
  if (data.status === "pending") {
    chip.textContent = "قيد المراجعة";
    notice.className = "notice";
    notice.textContent = data.profileComplete === false
      ? "تم إنشاء طلب الكابتن وإرساله إلى الإدارة. أكمل بيانات الكابتن أدناه ليصبح الطلب جاهزًا للموافقة. لوحة الكابتن لن تُفتح قبل اعتماد الإدارة."
      : "وصل طلبك الكامل إلى الإدارة وهو قيد المراجعة. لوحة الكابتن لن تصبح متاحة إلا بعد موافقة الإدارة.";
    button.disabled = data.profileComplete !== false;
    button.textContent = data.profileComplete === false ? "إكمال وإرسال بيانات الطلب" : "الطلب قيد المراجعة";
  } else if (data.status === "rejected") {
    chip.className = "status-chip rejected";
    chip.textContent = "يحتاج تعديلًا";
    notice.className = "notice danger";
    notice.textContent = data.reviewNote || "تعذر قبول الطلب. صحّح البيانات ثم أعد الإرسال.";
    button.textContent = "إعادة إرسال الطلب";
  } else if (data.status === "approved") {
    chip.className = "status-chip approved";
    chip.textContent = "مقبول";
    notice.className = "notice success";
    notice.textContent = "تمت الموافقة. انتظر لحظات حتى تُفتح لوحة الكابتن.";
    button.disabled = true;
  }
}

function openApplication() {
  clearViewListeners();
  showView("application");
  fillApplication();
  const unsubscribe = onSnapshot(doc(db, "driverApplications", state.user.uid), snapshot => {
    showApplicationStatus(snapshot.exists() ? snapshot.data() : null);
  }, error => {
    console.error(error);
    toast("تعذر تحميل طلب الانضمام");
  });
  state.viewUnsubscribes.push(unsubscribe);
}

byId("applicationForm").addEventListener("submit", async event => {
  event.preventDefault();
  const directSignup = !state.user && state.directRegistration;
  const phone = byId("driverPhone").value.replace(/\s/g, "");
  const name = byId("driverName").value.trim();
  if (name.length < 2) { toast("أدخل الاسم الكامل"); return; }
  if (phone.replace(/\D/g, "").length < 8) { toast("أدخل رقم هاتف صحيحًا"); return; }

  let registerEmail = "", registerPassword = "";
  if (directSignup) {
    registerEmail = byId("driverRegisterEmail").value.trim();
    registerPassword = byId("driverRegisterPassword").value;
    const confirmPassword = byId("driverRegisterPasswordConfirm").value;
    if (!registerEmail || !registerEmail.includes("@")) { toast("أدخل بريدًا إلكترونيًا صحيحًا"); return; }
    if (registerPassword.length < 6) { toast("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); return; }
    if (registerPassword !== confirmPassword) { toast("كلمتا المرور غير متطابقتين"); return; }
  } else if (!state.user) {
    showView("auth");
    return;
  }

  const selectedServiceType = byId("serviceType").value;
  const isRestaurant = selectedServiceType === "other";
  const isBike = byId("vehicleType").value === "دراجة";
  if (selectedServiceType === "taxi" && isBike) { toast("الدراجة مخصصة لخدمة التوصيل فقط. اختر «توصيل» أو اختر سيارة للتكسي."); return; }
  if (!isRestaurant && !["taxi", "delivery"].includes(selectedServiceType)) { toast("اختر نوع خدمة صحيحًا"); return; }
  if (!isRestaurant && !isBike && (!byId("vehicleMake").value.trim() || !byId("vehicleModel").value.trim())) { toast("أدخل نوع/ماركة السيارة وموديلها"); return; }
  if (isRestaurant) {
    const rName=byId("captainRestaurantName").value.trim(), rPhone=byId("captainRestaurantPhone").value.trim(), rAddress=byId("captainRestaurantAddress").value.trim();
    if(rName.length<2||rAddress.length<3||rPhone.replace(/\D/g,"").length<8){toast("أكمل اسم المطعم والعنوان ورقم الهاتف");return;}
    if(!state.restaurantGps){toast("حدد موقع المطعم GPS");return;}
    if(!state.restaurantMeals.length){toast("أضف وجبة واحدة على الأقل");return;}
  }

  const button = byId("submitApplication");
  busy(button, true, directSignup ? "جاري إنشاء الحساب…" : "جاري الإرسال…");
  try {
    let accountUser = state.user;
    if (directSignup) {
      const credential = await createUserWithEmailAndPassword(auth, registerEmail, registerPassword);
      accountUser = credential.user;
      await updateProfile(accountUser, { displayName: name });
      await setDoc(doc(db, "users", accountUser.uid), {
        name, email: registerEmail, role: "driverApplicant", balance: 0, notifications: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    }

    const applicationPayload = {
      userId: accountUser.uid,
      name,
      email: accountUser.email || registerEmail || "",
      phone,
      serviceType: selectedServiceType,
      vehicleType: isRestaurant ? "" : byId("vehicleType").value,
      vehicleMake: (isRestaurant || byId("vehicleType").value === "دراجة") ? "" : byId("vehicleMake").value.trim(),
      vehicleModel: (isRestaurant || byId("vehicleType").value === "دراجة") ? "" : byId("vehicleModel").value.trim(),
      vehicleCondition: (isRestaurant || byId("vehicleType").value === "دراجة") ? "" : byId("vehicleCondition").value,
      plate: isRestaurant ? "" : byId("plate").value.trim(),
      city: byId("driverCity").value,
      status: "pending",
      profileComplete: true,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "driverApplications", accountUser.uid), applicationPayload, { merge: true });

    if (isRestaurant) {
      await setDoc(doc(db,"restaurants",accountUser.uid), {
        ownerId: accountUser.uid, name: byId("captainRestaurantName").value.trim(),
        address: byId("captainRestaurantAddress").value.trim(), phone: byId("captainRestaurantPhone").value.trim(),
        location: {...state.restaurantGps}, meals: state.restaurantMeals.map(meal=>({...meal})),
        active: false, approvalStatus: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      }, {merge:true});
    }

    if (directSignup) {
      state.directRegistration = false;
      history.replaceState(null, "", "./driver.html");
      toast("تم إنشاء حساب الكابتن وإرسال طلبك الكامل إلى الإدارة. الحساب ينتظر الموافقة قبل التشغيل.");
    } else {
      toast(isRestaurant ? "تم إرسال طلب الخدمة إلى الإدارة للموافقة. لن يظهر المطعم للعملاء قبل الاعتماد." : "تم إرسال طلب الكابتن إلى الإدارة للموافقة");
    }
  } catch (error) {
    console.error(error);
    toast(authMessage(error));
  } finally {
    busy(button, false);
  }
});

function formatOrderCreatedAt(order) {
  let date = null;
  if (order?.createdAt?.toDate) date = order.createdAt.toDate();
  else if (order?.createdAt?.seconds) date = new Date(Number(order.createdAt.seconds) * 1000);
  else if (order?.createdAtISO) date = new Date(order.createdAtISO);
  if (!date || Number.isNaN(date.getTime())) return "—";
  const datePart = new Intl.DateTimeFormat("ar-IQ", { year:"numeric", month:"2-digit", day:"2-digit" }).format(date);
  const timePart = new Intl.DateTimeFormat("ar-IQ", { hour:"2-digit", minute:"2-digit", hour12:true }).format(date);
  return `${datePart} • ${timePart}`;
}

function distanceToOrder(order){if(!state.lastPosition||!order.pickupLocation)return Infinity;const a={latitude:state.lastPosition.coords.latitude,longitude:state.lastPosition.coords.longitude},b=order.pickupLocation;const R=6371,toRad=v=>v*Math.PI/180,dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function orderCard(order, mode) {
  const statusIndex = Number(order.statusIndex || 0);
  const statusClass = order.cancelled ? "cancelled" : statusIndex >= 4 ? "complete" : "active";
  const action = mode === "available"
    ? `<button class="primary" data-action="accept" data-id="${order.firestoreId}" ${state.driverData?.online ? "" : "disabled"}>قبول الطلب</button>`
    : statusIndex < 4 && !order.cancelled
      ? `<button class="primary" data-action="advance" data-id="${order.firestoreId}">${escapeHtml(statuses[statusIndex + 1])}</button>`
      : "";
  return `
    <article class="order-card">
      <div class="order-top">
        <h3>${icons[order.type] || "🧾"} ${escapeHtml(order.title)}</h3>
        <span class="status-chip ${statusClass}">${escapeHtml(order.cancelled ? "ملغي" : statuses[statusIndex])}</span>
      </div>
      <p class="order-route">${escapeHtml(order.route)}</p>
      ${order.type === "serviceDelivery" ? `<div class="order-meta delivery-addresses"><span>🏪 عنوان المطعم: ${escapeHtml(String(order.route||"").split(" ← ")[0]||"غير محدد")}</span><span>🏠 عنوان العميل: ${escapeHtml(String(order.route||"").split(" ← ")[1]||"غير محدد")}</span></div>` : ""}
      <div class="order-bottom">
        <div class="order-meta"><span>${escapeHtml(order.id)}</span><span>${escapeHtml(order.payment || "نقدًا")}</span>${mode === "available" ? `<span>🗓️ ${escapeHtml(formatOrderCreatedAt(order))}</span>` : ""}${mode === "available" && Number.isFinite(distanceToOrder(order)) ? `<span>يبعد ${distanceToOrder(order).toFixed(1)} كم</span>` : ""}</div>
        ${order.distanceKm ? `<div class="order-meta"><span>المشوار ${Number(order.distanceKm).toFixed(1)} كم</span><span>≈ ${Math.round(Number(order.durationMin||0))} دقيقة</span><span>صافي الكابتن ${money(order.driverEarnings)}</span></div>` : ""}
        <span class="order-price">${money(order.price)}</span>
      </div>
      ${action ? `<div class="order-actions">${action}</div>` : ""}
    </article>`;
}

function renderOrders() {
  const now=Date.now();
  const available = state.orders.filter(order => {
    if(order.cancelled || Number(order.statusIndex || 0) >= 4 || order.driverId) return false;
    // فصل صارم: التكسي يرى الركوب فقط، والتوصيل يرى طلبات التوصيل فقط.
    if (!canDriverHandleOrder(order)) return false;
    if(order.type === "serviceDelivery" && order.serviceCity && String(order.serviceCity).trim() !== String(state.driverData?.city || "").trim()) return false;
    const exp=order.dispatchExpiresAt?.seconds ? order.dispatchExpiresAt.seconds*1000 : new Date(order.dispatchExpiresAt||0).getTime();
    return !exp || exp<=now || !Array.isArray(order.dispatchCandidateIds) || !order.dispatchCandidateIds.length || order.dispatchCandidateIds.includes(state.user?.uid);
  }).sort((a,b) => distanceToOrder(a) - distanceToOrder(b));
  const mine = state.orders.filter(order =>
    order.driverId === state.user?.uid && !order.cancelled && Number(order.statusIndex || 0) < 4
  );
  const completed = state.orders.filter(order =>
    order.driverId === state.user?.uid && Number(order.statusIndex || 0) >= 4
  );

  byId("availableCount").textContent = available.length;
  byId("activeCount").textContent = mine.length;
  byId("completedCount").textContent = completed.length;
  byId("driverEarnings").textContent = money(completed.filter(o=>!o.cancelled).reduce((sum,o)=>sum+Number(o.driverEarnings||0),0));
  byId("availableOrders").innerHTML = available.length
    ? available.map(order => orderCard(order, "available")).join("")
    : `<div class="empty"><span>✓</span>لا توجد طلبات متاحة الآن.</div>`;
  byId("myOrders").innerHTML = mine.length
    ? mine.map(order => orderCard(order, "mine")).join("")
    : `<div class="empty"><span>🚕</span>لا توجد رحلة نشطة لديك.</div>`;
  drawPickupRoute();
}

function renderReputation() {
  const count = state.ratings.length;
  const average = count
    ? state.ratings.reduce((total, item) => total + Number(item.score || 0), 0) / count
    : 0;
  const warnings = Number(state.driverData?.warningCount || 0);
  byId("driverRating").textContent = count ? average.toFixed(1) : "جديد";
  byId("driverRatingCount").textContent = count ? `${count} تقييم` : "لا توجد تقييمات بعد";
  byId("driverWarningCount").textContent = String(warnings);
  const notice = byId("driverWarningNotice");
  if (warnings > 0 && state.driverData?.warningMessage) {
    notice.className = "notice danger driver-alert";
    notice.innerHTML = `<strong>تنبيه من الإدارة</strong><span>${escapeHtml(state.driverData.warningMessage)}</span>`;
  } else {
    notice.className = "notice hidden";
    notice.textContent = "";
  }
  updateDriverSettingsInfo();
}

function openDriverDashboard() {
  clearViewListeners();
  showView("driver");
  initializeDriverMap();
  startDriverCommunityLayers();
  window.setTimeout(() => state.map?.invalidateSize(), 120);
  byId("captainName").textContent = state.userData?.name || state.user?.displayName || "كروة";

  const driverUnsubscribe = onSnapshot(doc(db, "drivers", state.user.uid), snapshot => {
    state.driverData = snapshot.exists() ? snapshot.data() : {
      name: state.userData?.name || "كابتن كروة",
      phone: "",
      vehicleType: "غير محدد",
      plate: "غير محدد",
      online: false
    };
    renderReputation();
    if (state.driverData.blocked === true) {
      stopLocationSharing();
      byId("blockedReason").textContent = state.driverData.blockReason || "راجع الإدارة لمعرفة سبب إيقاف الحساب.";
      showView("blocked");
      return;
    }
    showView("driver");
    byId("onlineSwitch").disabled = false;
    byId("onlineSwitch").classList.toggle("on", state.driverData.online === true);
    byId("onlineLabel").textContent = state.driverData.online ? "متصل" : "غير متصل";
    byId("vehicleSummary").textContent = `${state.driverData.vehicleType || "مركبة"} • ${state.driverData.plate || "بدون لوحة"}`;
    updateDriverSettingsInfo();
    if (state.driverData.online) startLocationSharing();
    else stopLocationSharing();
    subscribeToAllowedOrders();
    renderOrders();
  });

  let knownOrderIds = new Set();
  let ordersUnsubscribe = null;
  let subscribedOrderMode = "";
  const subscribeToAllowedOrders = () => {
    const mode = driverOrderMode(state.driverData);
    if (mode === subscribedOrderMode) return;
    if (ordersUnsubscribe) ordersUnsubscribe();
    ordersUnsubscribe = null;
    subscribedOrderMode = mode;
    knownOrderIds = new Set();
    state.orders = [];
    renderOrders();
    if (mode === "none") return;
    const ordersQuery = mode === "taxi"
      ? query(collection(db, "orders"), where("type", "==", "ride"))
      : query(collection(db, "orders"), where("type", "in", ["parcel", "food", "serviceDelivery"]));
    ordersUnsubscribe = onSnapshot(ordersQuery, snapshot => {
      const incoming = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
      if (knownOrderIds.size && state.driverData?.online) {
        const fresh = incoming.find(o => !knownOrderIds.has(o.firestoreId) && !o.driverId && !o.cancelled && Number(o.statusIndex||0) < 4 && canDriverHandleOrder(o));
        if (fresh) {
          toast(fresh.type === "ride" ? "طلب تكسي جديد متاح" : "طلب توصيل جديد متاح");
          if ("Notification" in window && Notification.permission === "granted") new Notification("كروة — طلب جديد", { body: fresh.title || "لديك طلب متاح", icon: "./karwa-icon.svg" });
        }
      }
      knownOrderIds = new Set(incoming.map(o=>o.firestoreId));
      state.orders = incoming.filter(o => canDriverHandleOrder(o) || o.driverId === state.user?.uid).sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")));
      renderOrders();
    }, error => {
      console.error(error);
      toast("تعذر تحميل الطلبات المسموح بها لهذا الحساب. انشر قواعد Firestore الجديدة.");
    });
  };
  const ratingsUnsubscribe = onSnapshot(
    query(collection(db, "ratings"), where("driverId", "==", state.user.uid)),
    snapshot => {
      state.ratings = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
      renderReputation();
    },
    error => {
      console.error(error);
      toast("تعذر تحميل التقييمات");
    }
  );
  state.viewUnsubscribes.push(driverUnsubscribe, () => { if (ordersUnsubscribe) ordersUnsubscribe(); }, ratingsUnsubscribe);
}

byId("onlineSwitch").addEventListener("click", async () => {
  if (!state.user || !state.driverData) return;
  if (state.driverData.blocked === true) {
    toast("الحساب محظور ولا يمكن تفعيل الاتصال");
    return;
  }
  const next = !state.driverData.online;
  try {
    await updateDoc(doc(db, "drivers", state.user.uid), { online: next, updatedAt: serverTimestamp() });
    toast(next ? "أنت متصل وجاهز للطلبات" : "تم إيقاف استقبال الطلبات");
  } catch (error) {
    console.error(error);
    toast("تعذر تحديث حالة الاتصال");
  }
});

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.user) return;
  if (state.driverData?.blocked === true) {
    toast("الحساب محظور من تنفيذ الطلبات");
    return;
  }
  const orderRef = doc(db, "orders", button.dataset.id);
  busy(button, true);
  try {
    if (button.dataset.action === "accept") {
      if (!state.driverData?.online) throw new Error("OFFLINE");
      await runTransaction(db, async transaction => {
        const driverRef = doc(db, "drivers", state.user.uid);
        // Firestore rules require accepting the order and marking the captain busy
        // in the SAME atomic transaction.
        const [snap, driverSnap] = await Promise.all([
          transaction.get(orderRef),
          transaction.get(driverRef)
        ]);
        if (!snap.exists()) throw new Error("ORDER_NOT_FOUND");
        if (!driverSnap.exists()) throw new Error("DRIVER_PROFILE_MISSING");
        const order = snap.data();
        const driver = driverSnap.data();
        if (driver.blocked === true) throw new Error("DRIVER_BLOCKED");
        if (driver.online !== true) throw new Error("OFFLINE");
        if (driver.activeOrderId) throw new Error("DRIVER_BUSY");
        if (order.cancelled || Number(order.statusIndex || 0) >= 4) throw new Error("ORDER_NOT_AVAILABLE");
        if (order.driverId && order.driverId !== state.user.uid) throw new Error("ORDER_TAKEN");
        if (!canDriverHandleOrder(order, driver)) throw new Error(order.type === "ride" ? "TAXI_DRIVER_ONLY" : "DELIVERY_DRIVER_ONLY");
        if (order.type === "serviceDelivery" && order.serviceCity && String(order.serviceCity).trim() !== String(driver.city || "").trim()) throw new Error("OUTSIDE_DRIVER_AREA");
        transaction.update(orderRef, {
          driverId: state.user.uid,
          driverName: driver.name || state.userData?.name || state.user.email || "كابتن كروة",
          driverPhone: driver.phone || "",
          assignmentStatus: "accepted",
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        transaction.update(driverRef, {
          activeOrderId: button.dataset.id,
          activeOrderCode: String(order.orderCode || order.code || button.dataset.id),
          busySince: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      if (state.lastPosition) await sharePosition(state.lastPosition, true);
      setTimeout(()=>drawPickupRoute(true),400); toast("تم قبول الطلب بنجاح");
    } else if (button.dataset.action === "advance") {
      const order = state.orders.find(item => item.firestoreId === button.dataset.id);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      const next = Number(order.statusIndex || 0) + 1;
      let otp = "";
      const otpStep = DELIVERY_ORDER_TYPES.has(order.type) ? 4 : 3;
      if (next === otpStep) {
        otp = prompt(DELIVERY_ORDER_TYPES.has(order.type) ? "أدخل رمز التسليم المكوّن من 4 أرقام الذي يعطيك إياه العميل عند الوصول:" : "أدخل رمز بدء الرحلة المكوّن من 4 أرقام:", "") || "";
        if (!otp) throw new Error("OTP_REQUIRED");
      }
      if (next === otpStep && String(otp).trim() !== String(order.tripOtp || "").trim()) throw new Error("OTP_INVALID");
      const fields = { statusIndex: next, updatedAt: serverTimestamp() };
      if (next === 2) fields.arrivedAt = serverTimestamp();
      if (next === 3) fields.startedAt = serverTimestamp();
      if (next === 4) { fields.completedAt = serverTimestamp(); fields.paymentStatus = "paid"; }
      if (next === 4) {
        await runTransaction(db, async transaction => {
          const driverRef = doc(db, "drivers", state.user.uid);
          const freshOrder = await transaction.get(orderRef);
          if (!freshOrder.exists() || freshOrder.data().driverId !== state.user.uid) throw new Error("ORDER_NOT_FOUND");
          transaction.update(orderRef, fields);
          transaction.update(driverRef, { activeOrderId: "", activeOrderCode: "", busySince: null, updatedAt: serverTimestamp() });
        });
      } else {
        await updateDoc(orderRef, fields);
      }
      setTimeout(()=>drawPickupRoute(true),400); toast(statuses[next]);
    }
  } catch (error) {
    console.error(error);
    toast(error.message === "OFFLINE" ? "فعّل حالة الاتصال أولًا" : error.message === "OTP_REQUIRED" ? "يجب إدخال الرمز" : error.message === "OTP_INVALID" ? "الرمز غير صحيح" : error.message === "ORDER_TAKEN" ? "سبق أن قبل كابتن آخر هذا الطلب" : error.message === "ORDER_NOT_FOUND" ? "الطلب غير موجود" : error.message === "ORDER_NOT_AVAILABLE" ? "الطلب لم يعد متاحًا" : error.message === "DRIVER_BUSY" ? "لديك رحلة نشطة بالفعل، أكملها أولًا" : error.message === "DRIVER_PROFILE_MISSING" ? "ملف الكابتن غير موجود. أعد تفعيل الحساب من الإدارة" : error.message === "DRIVER_BLOCKED" ? "الحساب موقوف من الإدارة" : error.message === "DELIVERY_DRIVER_ONLY" ? "هذا الطلب مخصص لكابتن مسجل في خدمة التوصيل" : error.message === "TAXI_DRIVER_ONLY" ? "هذا الطلب مخصص لكابتن تكسي مسجل لخدمة الركوب" : error.message === "OUTSIDE_DRIVER_AREA" ? "هذا الطلب خارج نطاق المدينة المسجلة لحسابك" : driverCallableMessage(error, button.dataset.action === "accept" ? "قبول الطلب" : "تحديث حالة الرحلة"));
  } finally {
    busy(button, false);
  }
});

onAuthStateChanged(auth, user => {
  state.user = user;
  if (state.userUnsubscribe) state.userUnsubscribe();
  clearViewListeners();
  if (!user) {
    state.userData = null;
    state.driverData = null;
    if (state.directRegistration) {
      fillApplication();
      showView("application");
    } else {
      showView("auth");
    }
    return;
  }

  state.userUnsubscribe = onSnapshot(doc(db, "users", user.uid), snapshot => {
    if (!snapshot.exists()) {
      if (state.directRegistration) {
        showView("application");
        return;
      }
      byId("authError").textContent = "ملف الحساب غير موجود. أعد تسجيل الدخول أو أنشئ حساب كابتن جديدًا.";
      showView("auth");
      return;
    }
    state.userData = snapshot.data();
    if (state.userData.role === "driver") {
      openDriverDashboard();
    } else if (state.userData.role === "driverApplicant" || state.userData.role === "serviceApplicant" || state.userData.role === "serviceProvider") {
      openApplication();
      if (state.userData.role === "serviceApplicant" || state.userData.role === "serviceProvider") {
        const service = byId("serviceType");
        if (service) { service.value = "other"; service.disabled = true; updateVehicleApplicationFields(); }
      }
    } else if (state.userData.role === "customer") {
      byId("deniedMessage").textContent = "هذا حساب عميل ولا يمكن استخدامه في بوابة الكابتن. أنشئ حساب كابتن مستقلًا من شاشة التسجيل الرئيسية.";
      showView("denied");
    } else {
      byId("deniedMessage").textContent = "هذا حساب مدير ومخصص للوحة الإدارة فقط. استخدم حساب كابتن مستقلًا.";
      showView("denied");
    }
  }, error => {
    console.error(error);
    toast("تعذر قراءة صلاحية الحساب");
  });
});

window.addEventListener("beforeunload", () => {
  if (state.locationWatchId !== null) navigator.geolocation.clearWatch(state.locationWatchId);
});

// Phase 11 — mutual reputation and safety
const driverRateCustomerSecure=httpsCallable(functions,"driverRateCustomer");
const createDriverSafetyEvent=httpsCallable(functions,"createSafetyEvent");
window.karwaRateCustomer=async(orderId)=>{const score=Number(prompt("قيّم الراكب من 1 إلى 5:","5"));if(!score||score<1||score>5)return;try{await driverRateCustomerSecure({orderId,score});toast("تم تقييم الراكب");}catch(e){console.error(e);toast("تعذر حفظ التقييم أو تم تقييم الرحلة سابقًا");}};
window.karwaDriverSOS=async(orderId)=>{if(!confirm("إرسال تنبيه سلامة عاجل للإدارة؟"))return;try{await createDriverSafetyEvent({orderId,kind:"driver_sos",latitude:state.lastPosition?.latitude||null,longitude:state.lastPosition?.longitude||null,note:"SOS من الكابتن"});toast("تم إرسال تنبيه السلامة");}catch(e){console.error(e);toast("تعذر إرسال التنبيه");}};

// Phase 19 — verified community traffic + landmarks for customer and driver
const communityLayers={reports:new Map(),landmarks:new Map(),landmarkData:[],started:false,nearbyAlerted:new Set()};
const reportMeta={traffic:["🚦","ازدحام"],accident:["💥","حادث"],closure:["⛔","شارع مغلق"],roadwork:["🚧","حفريات / أعمال طريق"],hazard:["⚠️","عائق على الطريق"]};
function communityIcon(kind,type="report",confirmations=0){const meta=reportMeta[kind]||["📌","بلاغ"],badge=type==='report'&&confirmations?`<b class="confirm-badge">${confirmations}</b>`:"";return window.L.divIcon({className:"",html:`<div class="${type==='landmark'?'landmark-marker':'road-report-marker'}">${type==='landmark'?'📍':meta[0]}${badge}</div>`,iconSize:[38,38],iconAnchor:[19,19]});}
function reportLifetimeMs(x){const c=Number(x.confirmations||0);if(x.type==='closure')return c>=2?6*3600000:2*3600000;if(c>=3)return 4*3600000;if(c>=1)return 2*3600000;return 60*60000;}
function reportIsLive(x){const ts=x.createdAt?.toMillis?.()||Date.parse(x.createdAtISO||0);return x.active!==false&&ts&&Date.now()-ts<reportLifetimeMs(x);}
window.karwaConfirmRoadReport=async(id)=>{if(!state.user)return toast("سجّل الدخول أولًا");try{await runTransaction(db,async tx=>{const ref=doc(db,"roadReports",id),snap=await tx.get(ref);if(!snap.exists())throw new Error("missing");const x=snap.data(),arr=Array.isArray(x.confirmedBy)?x.confirmedBy:[];if(arr.includes(state.user.uid))return;tx.update(ref,{confirmedBy:[...arr,state.user.uid],confirmations:Number(x.confirmations||0)+1,lastConfirmedAt:serverTimestamp()});});toast("تم تأكيد البلاغ — شكرًا لك");}catch(e){console.error(e);toast("تعذر تأكيد البلاغ");}};
function startDriverCommunityLayers(){if(communityLayers.started||!state.map||!state.user)return;communityLayers.started=true;
  onSnapshot(collection(db,"roadReports"),snap=>{const live=new Set();snap.forEach(d=>{const x=d.data();if(!reportIsLive(x))return;live.add(d.id);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;const label=reportMeta[x.type]?.[1]||"بلاغ طريق",c=Number(x.confirmations||0),mine=(x.confirmedBy||[]).includes(state.user.uid)||x.reportedBy===state.user.uid;let m=communityLayers.reports.get(d.id);if(!m){m=window.L.marker(ll,{icon:communityIcon(x.type,"report",c)}).addTo(state.map);communityLayers.reports.set(d.id,m)}else{m.setLatLng(ll);m.setIcon(communityIcon(x.type,"report",c));}m.bindPopup(`<div dir="rtl"><b>${label}</b>${x.note?`<br>${x.note}`:""}<br><small>${c?`أكده ${c} من الكباتن`:'بانتظار تأكيد كابتن آخر'}</small>${mine?'':`<br><button class="report-confirm" onclick="karwaConfirmRoadReport('${d.id}')">✓ ما زال موجودًا</button>`}</div>`);
    const p=state.lastPosition?.coords;if(p){const dist=haversine({latitude:p.latitude,longitude:p.longitude},{latitude:ll[0],longitude:ll[1]});if(dist<0.7&&!communityLayers.nearbyAlerted.has(d.id)&&x.reportedBy!==state.user.uid){communityLayers.nearbyAlerted.add(d.id);toast(`تنبيه أمامك: ${label} على بعد ${Math.max(50,Math.round(dist*1000))} م`);}}
  });for(const [id,m] of communityLayers.reports)if(!live.has(id)){state.map.removeLayer(m);communityLayers.reports.delete(id)}});
  onSnapshot(collection(db,"landmarks"),snap=>{const live=new Set(),data=[];snap.forEach(d=>{const x=d.data();if(x.status==="hidden")return;data.push({...x,id:d.id});live.add(d.id);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;let m=communityLayers.landmarks.get(d.id);if(!m){m=window.L.marker(ll,{icon:communityIcon(null,"landmark")}).addTo(state.map);communityLayers.landmarks.set(d.id,m)}else m.setLatLng(ll);m.bindPopup(`<div dir="rtl"><b>${x.name||"معلم كروة"}</b><br><small>${x.category||"معلم محلي"} · أضيف بواسطة ${x.createdByRole==='driver'?'كابتن':'عميل'}</small></div>`)});communityLayers.landmarkData=data;driverMapSearchCache.clear();for(const [id,m] of communityLayers.landmarks)if(!live.has(id)){state.map.removeLayer(m);communityLayers.landmarks.delete(id)}});
}
async function submitRoadReport(type){if(!state.user)return toast("سجّل الدخول أولًا");const p=state.lastPosition?.coords;if(!p||!Number.isFinite(Number(p.latitude)))return toast("فعّل GPS وانتظر تحديد موقعك");const meta=reportMeta[type];if(!meta)return;try{await addDoc(collection(db,"roadReports"),{type,note:byId("roadReportNote")?.value.trim()||"",latitude:Number(p.latitude),longitude:Number(p.longitude),reportedBy:state.user.uid,reporterName:state.driverData?.name||"كابتن كروة",confirmedBy:[state.user.uid],confirmations:1,active:true,createdAt:serverTimestamp(),createdAtISO:new Date().toISOString()});if(byId("roadReportNote"))byId("roadReportNote").value="";toast(`تم إرسال بلاغ: ${meta[1]}`)}catch(e){console.error(e);toast("تعذر حفظ البلاغ — انشر قواعد Firestore الجديدة")}}
document.querySelectorAll("[data-road-report]").forEach(b=>b.addEventListener("click",()=>submitRoadReport(b.dataset.roadReport)));
const driverMapSearchCache = new Map();
function normalizeDriverPlaceSearch(value) { return String(value || "").trim().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[\u064B-\u065F]/g, "").replace(/\s+/g, " ").toLowerCase(); }
function driverPlaceName(place) { const names=place?.namedetails||{},address=place?.address||{};return names["name:ar"]||names.name||place?.name||address.amenity||address.shop||address.tourism||address.road||String(place?.display_name||"مكان محدد").split(",")[0]; }
function driverPlaceDetail(place) { const address=place?.address||{};return place?.display_name||[address.road,address.suburb,address.city||address.town,address.state].filter(Boolean).join("، ")||"موقع على الخريطة"; }
const DRIVER_PLACE_CATEGORY_TERMS={restaurant:"مطعم",medical:"مستشفى",shop:"سوق",education:"مدرسة",fuel:"محطة وقود",hotel:"فندق"};
function driverLocalPlaceMatchesCategory(item,category){if(!category)return true;const value=String(item?.category||"").toLowerCase();if(category==="education")return ["education","school","university","college"].includes(value);if(category==="hotel")return ["hotel","tourism","other"].includes(value);return value===category;}
function driverPlaceDistance(place){const center=state.map?.getCenter?.();if(!center)return null;return haversine({latitude:center.lat,longitude:center.lng},{latitude:Number(place.lat),longitude:Number(place.lon)});}
function driverPlaceRank(place,queryText,center){const text=normalizeDriverPlaceSearch([driverPlaceName(place),driverPlaceDetail(place),Object.values(place.namedetails||{}).join(" ")].join(" ")),needle=normalizeDriverPlaceSearch(queryText);let score=Number(place.importance||0)*18;if(text===needle)score+=100;else if(text.startsWith(needle))score+=55;else if(text.includes(needle))score+=30;if(center){const distance=haversine({latitude:center.lat,longitude:center.lng},{latitude:Number(place.lat),longitude:Number(place.lon)});score+=Math.max(0,22-Math.min(22,distance/3));}return score;}
async function searchDriverMapPlaces(queryText,options={}) {
  initializeDriverMap();
  const category=options.category||"",scope=options.scope==="iraq"?"iraq":"nearby",center=state.map?.getCenter?.();
  const locationKey=scope==="nearby"&&center?`${center.lat.toFixed(2)},${center.lng.toFixed(2)}`:"iq";
  const key=[normalizeDriverPlaceSearch(queryText),category,scope,locationKey].join("|");
  if (driverMapSearchCache.has(key)) return driverMapSearchCache.get(key);
  const bounds = state.map?.getBounds?.();
  const view = scope==="nearby"&&bounds ? `&viewbox=${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}` : "";
  const categoryTerm=DRIVER_PLACE_CATEGORY_TERMS[category]||"",base=[queryText,categoryTerm].filter(Boolean).join(" ");
  let remote = [];
  for (const term of [base, `${base} العراق`, ...(category?[queryText]:[])]) {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&dedupe=1&limit=16&countrycodes=iq&accept-language=ar,ku,en${view}&bounded=${scope==="nearby"?1:0}&q=${encodeURIComponent(term)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
      if (response.ok) remote.push(...await response.json());
    } catch (_) {}
    if (remote.length >= 10) break;
  }
  const needle=normalizeDriverPlaceSearch(queryText);
  const local = communityLayers.landmarkData
    .filter(item => normalizeDriverPlaceSearch(item.name).includes(needle)&&driverLocalPlaceMatchesCategory(item,category))
    .map(item => ({ lat:item.latitude, lon:item.longitude, name:item.name, display_name:`${item.name} — معلم مضاف في كروة`, namedetails:{"name:ar":item.name}, category:item.category||"place", osm_type:"karwa", osm_id:item.id, importance:1.4 }));
  const seen = new Set();
  const places = [...local, ...remote].filter(place => {
    const id = place.osm_type && place.osm_id ? `${place.osm_type}:${place.osm_id}` : `${Number(place.lat).toFixed(5)},${Number(place.lon).toFixed(5)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon));
  }).sort((a,b)=>driverPlaceRank(b,queryText,center)-driverPlaceRank(a,queryText,center)).slice(0,10);
  driverMapSearchCache.set(key, places);
  if (driverMapSearchCache.size > 50) driverMapSearchCache.delete(driverMapSearchCache.keys().next().value);
  return places;
}
function driverMapSearchIcon() { return window.L.divIcon({ className:"", html:'<div class="map-search-marker"><span>⌖</span></div>', iconSize:[42,42], iconAnchor:[21,38] }); }
function setupDriverMapPlaceTool() {
  const input=byId("driverMapPlaceSearch"),button=byId("driverMapPlaceSearchButton"),locateButton=byId("driverMapPlaceLocate"),category=byId("driverMapPlaceCategory"),scope=byId("driverMapPlaceScope"),results=byId("driverMapPlaceResults"),selection=byId("driverMapPlaceSelection");
  if(!input||!button||!results||!selection)return;
  let sequence=0;
  const selectPlace=place=>{
    const latitude=Number(place.lat),longitude=Number(place.lon),name=driverPlaceName(place),point=[latitude,longitude];
    state.mapSearchSelection={latitude,longitude,name};input.value=name;byId("driverMapLandmarkName").value ||= name;selection.textContent=`تم تحديد: ${name}`;results.innerHTML="";initializeDriverMap();
    if(state.mapSearchMarker)state.mapSearchMarker.setLatLng(point);else state.mapSearchMarker=window.L.marker(point,{icon:driverMapSearchIcon()}).addTo(state.map);
    state.mapSearchMarker.bindPopup(escapeHtml(name)).openPopup();state.map.setView(point,16);toast("تم تحديد المكان على الخريطة");
  };
  const run=async()=>{
    const queryText=input.value.trim(),requestId=++sequence;
    if(queryText.length<2){results.innerHTML='<div class="map-place-state">اكتب حرفين على الأقل للبحث.</div>';return;}
    button.disabled=true;results.innerHTML='<div class="map-place-state">جاري البحث عن المكان…</div>';
    try{
      const places=await searchDriverMapPlaces(queryText,{category:category?.value||"",scope:scope?.value||"nearby"});if(requestId!==sequence)return;results.innerHTML="";
      if(!places.length){results.innerHTML='<div class="map-place-state">لم نجد نتيجة. جرّب اسم الحي أو شارعًا قريبًا.</div>';return;}
      places.forEach(place=>{const item=document.createElement("button");item.type="button";item.className="map-place-result";const pin=document.createElement("span");pin.textContent="⌖";const copy=document.createElement("span"),title=document.createElement("strong"),detail=document.createElement("small"),distance=document.createElement("span");title.textContent=driverPlaceName(place);detail.textContent=driverPlaceDetail(place);const km=driverPlaceDistance(place);distance.className="map-place-distance";distance.textContent=km==null?"":`يبعد ${km<1?Math.max(1,Math.round(km*1000))+" م":km.toFixed(1)+" كم"} عن مركز الخريطة`;copy.append(title,detail,distance);item.append(pin,copy);item.addEventListener("click",()=>selectPlace(place));results.appendChild(item);});
    }catch(error){console.error(error);results.innerHTML='<div class="map-place-state">تعذر البحث الآن. تحقق من الإنترنت وحاول مجددًا.</div>';}finally{button.disabled=false;}
  };
  button.addEventListener("click",run);input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();run();}});
  [category,scope].forEach(control=>control?.addEventListener("change",()=>{if(input.value.trim().length>=2)run();}));
  locateButton?.addEventListener("click",()=>{
    const usePosition=position=>{state.lastPosition=position;showOwnPosition(position);selectPlace({lat:position.coords.latitude,lon:position.coords.longitude,name:"موقعي الحالي",display_name:`دقة الموقع نحو ${Math.round(position.coords.accuracy||0)} متر`,namedetails:{"name:ar":"موقعي الحالي"}});locateButton.disabled=false;locateButton.textContent="⌖ تحديد موقعي على الخريطة";};
    if(state.lastPosition)return usePosition(state.lastPosition);
    if(!navigator.geolocation)return toast("تحديد الموقع غير مدعوم في هذا المتصفح");
    locateButton.disabled=true;locateButton.textContent="جاري تحديد موقعك…";
    navigator.geolocation.getCurrentPosition(usePosition,error=>{console.error(error);locateButton.disabled=false;locateButton.textContent="⌖ تحديد موقعي على الخريطة";toast(error.code===1?"اسمح للموقع من إعدادات المتصفح":"تعذر تحديد الموقع؛ تحقق من GPS");},{enableHighAccuracy:true,maximumAge:5000,timeout:12000});
  });
  byId("driverSaveMapLandmark")?.addEventListener("click",async()=>{
    if(!state.user)return toast("سجّل الدخول أولًا");const name=byId("driverMapLandmarkName")?.value.trim();if(!name||name.length<3)return toast("اكتب اسم المعلم بوضوح");initializeDriverMap();const center=state.map.getCenter(),point=state.mapSearchSelection||{latitude:center.lat,longitude:center.lng};
    try{await addDoc(collection(db,"landmarks"),{name,category:byId("driverMapLandmarkCategory")?.value||"place",latitude:Number(point.latitude),longitude:Number(point.longitude),createdBy:state.user.uid,createdByName:state.driverData?.name||"كابتن كروة",createdByRole:"driver",status:"active",createdAt:serverTimestamp(),createdAtISO:new Date().toISOString()});byId("driverMapLandmarkName").value="";driverMapSearchCache.clear();selection.textContent=`تمت إضافة المعلم: ${name}`;toast("تمت إضافة المعلم إلى خريطة كروة");}catch(error){console.error(error);toast("تعذر إضافة المعلم — تحقق من الاتصال والصلاحيات");}
  });
}
setupDriverMapPlaceTool();
