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
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
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
const serviceIcons = { ride: "🚕", parcel: "📦", food: "🍽️" };

const state = {
  user: null,
  role: "customer",
  authMode: "login",
  vehicle: "اقتصادي",
  ridePrice: 6500,
  payment: "نقدًا",
  cart: [],
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
  customerMarker: null,
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
  savedAddresses: []
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
function pointLabel(prefix,p){return `${prefix} (${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})`;}
function bookingIcon(type){if(!window.L)return null;return window.L.divIcon({className:"",html:`<div class="karwa-map-marker ${type}"><span>${type==="pickup"?"📍":"🏁"}</span></div>`,iconSize:[42,42],iconAnchor:[21,38]});}
function updateRouteSummary(){byId("routeSummary").children[0].textContent=`المسافة: ${state.routeDistanceKm?state.routeDistanceKm.toFixed(1)+" كم":"—"}`;byId("routeSummary").children[1].textContent=`الوقت: ${state.routeDurationMin?Math.round(state.routeDurationMin)+" دقيقة":"—"}`;byId("routeMode").textContent=state.routeSource==="roads"?"مسار طرق فعلي":state.routeSource==="fallback"?"تقدير احتياطي مباشر":"اختر نقطتين من الخريطة";}
async function calculateBookingRoute(){
  if(!state.pickupLocation||!state.destinationLocation)return;
  initializeCustomerMap(); const a=state.pickupLocation,b=state.destinationLocation;
  let coords=null;
  try{const url=`https://router.project-osrm.org/route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;const r=await fetch(url,{signal:AbortSignal.timeout(6500)});if(!r.ok)throw new Error("ROUTER");const data=await r.json();const route=data.routes?.[0];if(!route)throw new Error("NO_ROUTE");state.routeDistanceKm=route.distance/1000;state.routeDurationMin=route.duration/60;state.routeSource="roads";coords=route.geometry.coordinates.map(([lng,lat])=>[lat,lng]);}
  catch(e){const straight=haversineKm(a,b);state.routeDistanceKm=straight*1.28;state.routeDurationMin=(state.routeDistanceKm/28)*60;state.routeSource="fallback";coords=[[a.latitude,a.longitude],[b.latitude,b.longitude]];}
  if(state.bookingRouteLine)state.bookingRouteLine.setLatLngs(coords);else state.bookingRouteLine=window.L.polyline(coords,{color:"#ff6b35",weight:5,opacity:.9}).addTo(state.map);state.map.fitBounds(state.bookingRouteLine.getBounds(),{padding:[35,35]});calculateRidePrice();updateRouteSummary();
}
function setBookingPoint(type,lat,lng){const p={latitude:Number(lat),longitude:Number(lng)};if(type==="pickup"){state.pickupLocation=p;state.customerLocation=p;byId("rideFrom").value=pointLabel("نقطة الانطلاق",p);if(state.pickupMarker)state.pickupMarker.setLatLng([p.latitude,p.longitude]);else state.pickupMarker=window.L.marker([p.latitude,p.longitude],{icon:bookingIcon("pickup")}).addTo(state.map);state.mapPickMode="destination";}else{state.destinationLocation=p;byId("rideTo").value=pointLabel("الوجهة",p);if(state.destinationMarker)state.destinationMarker.setLatLng([p.latitude,p.longitude]);else state.destinationMarker=window.L.marker([p.latitude,p.longitude],{icon:bookingIcon("destination")}).addTo(state.map);}document.querySelectorAll(".map-pick-button").forEach(b=>b.classList.toggle("active",b.id===(state.mapPickMode==="pickup"?"pickRideFrom":"pickRideTo")));calculateBookingRoute();}


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
  state.map = window.L.map("customerMap", { zoomControl: true }).setView([33.3152, 44.3661], 12);
  state.map.on("click", e => setBookingPoint(state.mapPickMode, e.latlng.lat, e.latlng.lng));
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);
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
  state.map.setView(point, 15);
  drawLiveRoute();
}

function drawLiveRoute() {
  if (!state.map || !state.customerMarker || !state.driverMarker) return;
  const points = [state.customerMarker.getLatLng(), state.driverMarker.getLatLng()];
  if (state.routeLine) state.routeLine.setLatLngs(points);
  else state.routeLine = window.L.polyline(points, {
    color: "#ff6b35",
    weight: 5,
    opacity: .85,
    dashArray: "9 9"
  }).addTo(state.map);
  state.map.fitBounds(window.L.latLngBounds(points), { padding: [45, 45], maxZoom: 16 });
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
  if (state.driverMarker) state.driverMarker.setLatLng(point);
  else state.driverMarker = window.L.marker(point, { icon: mapIcon("driver") })
    .addTo(state.map)
    .bindPopup("موقع الكابتن");
  byId("mapInfoTitle").textContent = "الكابتن يتحرك نحوك";
  byId("mapInfoText").textContent = `آخر تحديث الآن${data.accuracy ? ` • دقة ${Math.round(data.accuracy)} متر` : ""}`;
  if (state.customerMarker) drawLiveRoute();
  else state.map.setView(point, 15);
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
  window.setTimeout(() => byId("authEmail").focus(), 120);
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
  if (snapshot.exists()) {
    const data = snapshot.data();
    state.role = data.role || "customer";
    state.name = data.name || user.displayName || user.email?.split("@")[0] || "مستخدم كروة";
    state.balance = Number(data.balance ?? 25000);
    state.notifications = data.notifications !== false;
    if (!data.role) await saveUserData({ role: "customer" });
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

byId("loginTab").addEventListener("click", () => setAuthMode("login"));
byId("registerTab").addEventListener("click", () => setAuthMode("register"));

byId("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = byId("authEmail").value.trim();
  const password = byId("authPassword").value;
  const name = byId("authName").value.trim();
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
        role: "customer",
        balance: 25000,
        notifications: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      state.name = name;
      state.role = "customer";
      state.balance = 25000;
      state.notifications = true;
      renderProfile();
      renderBalance();
      renderNotificationSwitch();
      showToast("تم إنشاء حسابك بنجاح");
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
    createdAtISO
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

document.querySelectorAll(".add-food-button").forEach(button => {
  button.addEventListener("click", () => {
    state.cart.push({ name: button.dataset.food, price: Number(button.dataset.price) });
    renderCart();
    showToast("تمت الإضافة إلى السلة");
  });
});

function renderCart() {
  const cartTotal = state.cart.reduce((total, item) => total + item.price, 0);
  byId("cartBar").classList.toggle("show", state.cart.length > 0);
  byId("cartCount").textContent = state.cart.length === 1 ? "عنصر واحد" : `${state.cart.length} عناصر`;
  byId("cartPrice").textContent = formatMoney(cartTotal + 2000) + " شامل التوصيل";
}

byId("orderFood").addEventListener("click", async event => {
  if (!requireUser() || !state.cart.length) return;
  const total = state.cart.reduce((sum, item) => sum + item.price, 0) + 2000;
  const title = state.cart.length === 1 ? state.cart[0].name : `طلب طعام (${state.cart.length} أصناف)`;
  const button = event.currentTarget;
  setButtonBusy(button, true, "جاري الطلب…");
  try {
    const saved = await createOrder("food", title, "المطعم ← موقعك الحالي", total, { payment: "نقدًا" });
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
  card.classList.toggle("show", Boolean(state.activeOrder));
  if (!state.activeOrder) return;
  const order = state.activeOrder;
  const statusIndex = Number(order.statusIndex || 0);
  byId("trackingTitle").textContent = order.title;
  byId("trackingRoute").textContent = order.route;
  byId("trackingCode").textContent = "رقم الطلب: " + order.id;
  byId("trackingDriver").textContent = order.driverName
    ? ` • الكابتن: ${order.driverName}${order.driverPhone ? ` — ${order.driverPhone}` : ""}`
    : " • بانتظار قبول كابتن";
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
    const statusIndex = Number(order.statusIndex || 0);
    status.textContent = order.cancelled ? "ملغي" : orderStatuses[statusIndex];
    if (order.cancelled) status.style.color = "var(--danger)";
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

    article.append(icon, details, price);
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


function printInvoice(order){const w=window.open("","_blank","width=520,height=700");if(!w)return showToast("اسمح بالنوافذ المنبثقة لعرض الفاتورة");w.document.write(`<html dir="rtl"><head><title>فاتورة ${order.id}</title><style>body{font-family:Arial;padding:30px}h1{color:#102044}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:10px 0}</style></head><body><h1>كروة — فاتورة رحلة</h1><div class="row"><b>رقم الرحلة</b><span>${order.id}</span></div><div class="row"><b>المسار</b><span>${order.route}</span></div><div class="row"><b>الكابتن</b><span>${order.driverName||"—"}</span></div><div class="row"><b>المبلغ</b><span>${formatMoney(order.price)}</span></div><div class="row"><b>الدفع</b><span>${order.payment||"—"}</span></div><div class="row"><b>التاريخ</b><span>${new Date(order.createdAtISO||Date.now()).toLocaleString("ar-IQ")}</span></div><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();}
let geoTimer; function setupPlaceSearch(inputId,resultsId,type){const input=byId(inputId),box=byId(resultsId);input.addEventListener("input",()=>{clearTimeout(geoTimer);const q=input.value.trim();if(q.length<3){box.innerHTML="";return}geoTimer=setTimeout(async()=>{try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ar&q=${encodeURIComponent(q)}`,{headers:{"Accept":"application/json"}});const data=await r.json();box.innerHTML="";data.forEach(x=>{const b=document.createElement("button");b.type="button";b.className="place-result";b.textContent=x.display_name;b.onclick=()=>{input.value=x.display_name;box.innerHTML="";setBookingPoint(type,Number(x.lat),Number(x.lon));};box.appendChild(b)});}catch(e){box.innerHTML="";}},450)});}
setupPlaceSearch("rideFrom","rideFromResults","pickup");setupPlaceSearch("rideTo","rideToResults","destination");

setAuthMode("login");
initializeCustomerMap();
renderProfile();
renderNotificationSwitch();
renderTracking();
renderOrders();
renderCart();
renderBalance();

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الدخول", error);
}

onAuthStateChanged(auth, async user => {
  state.user = user;
  if (!user) {
    if (state.unsubscribeOrders) {
      state.unsubscribeOrders();
      state.unsubscribeOrders = null;
    }
    if (state.unsubscribeRatings) {
      state.unsubscribeRatings();
      state.unsubscribeRatings = null;
    }
    state.name = "ضيف";
    state.role = "customer";
    state.balance = 0;
    state.orders = [];
    state.ratings = [];
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
    openAuthModal();
    return;
  }

  closeAuthModal();
  byId("connectionBadge").textContent = "متصل ومحفوظ سحابيًا";
  try {
    await loadUserProfile(user);
    if (state.role !== "customer") {
      const roleName = state.role === "driver" ? "كابتن" : "مدير";
      const destination = state.role === "driver" ? "بوابة الكابتن" : "لوحة الإدارة";
      await signOut(auth);
      openAuthModal();
      byId("authMessage").textContent = `هذا حساب ${roleName} ومخصص لـ${destination} فقط. استخدم حساب عميل مستقلًا.`;
      return;
    }
    subscribeToOrders(user);
    subscribeToRatings(user);
  } catch (error) {
    console.error(error);
    showToast("تم الدخول، لكن تعذر تحميل بيانات الحساب. تحقق من Firestore.");
    state.name = user.displayName || user.email?.split("@")[0] || "مستخدم كروة";
    renderProfile();
  }
});

// Phase 11 — passenger safety center
const createSafetyEventSecure=httpsCallable(functions,"createSafetyEvent");
const createTripShareSecure=httpsCallable(functions,"createTripShare");
byId("shareTrip")?.addEventListener("click",async()=>{if(!state.activeOrder?.firestoreId)return showToast("لا توجد رحلة نشطة");try{const r=await createTripShareSecure({orderId:state.activeOrder.firestoreId});const text=`كروة — مشاركة رحلة ${state.activeOrder.id}\nرمز مشاركة آمن: ${r.data.token}\nصالح لمدة 6 ساعات.`;if(navigator.share)await navigator.share({title:"مشاركة رحلة كروة",text});else await navigator.clipboard.writeText(text);showToast("تم تجهيز مشاركة الرحلة");}catch(e){console.error(e);showToast("تعذر إنشاء مشاركة آمنة");}});
byId("sosTrip")?.addEventListener("click",async()=>{if(!state.activeOrder?.firestoreId||!confirm("إرسال تنبيه سلامة عاجل للإدارة لهذه الرحلة؟"))return;const send=async pos=>{try{await createSafetyEventSecure({orderId:state.activeOrder.firestoreId,kind:"sos",latitude:pos?.coords?.latitude||null,longitude:pos?.coords?.longitude||null,note:"SOS من الراكب"});showToast("تم إرسال تنبيه السلامة للإدارة");}catch(e){console.error(e);showToast("تعذر إرسال التنبيه");}};navigator.geolocation?navigator.geolocation.getCurrentPosition(send,()=>send(null),{timeout:5000}):send(null);});
