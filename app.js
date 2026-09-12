import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
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

const byId = id => document.getElementById(id);
const orderStatuses = [
  "تم استلام الطلب",
  "الكابتن في الطريق",
  "بدأت الرحلة",
  "تم الوصول"
];
const serviceIcons = { ride: "🚕", parcel: "📦", food: "🍽️" };
const vehicleRates = {
  "اقتصادي": { base: 2200, perKm: 850, perMinute: 35, minimum: 5000 },
  "تكسي": { base: 2800, perKm: 1050, perMinute: 45, minimum: 6500 },
  "عائلي": { base: 3400, perKm: 1300, perMinute: 55, minimum: 8000 }
};
const commissionRate = 0.15;

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
  bookingRouteLine: null,
  destinationMarker: null,
  customerLocation: null,
  destinationLocation: null,
  mapSelectionMode: null,
  routeDistanceKm: 0,
  routeDurationMin: 0,
  routeSource: "",
  routeRequestId: 0
};

const formatMoney = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";

function showToast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.karwaToastTimer);
  window.karwaToastTimer = setTimeout(() => element.classList.remove("show"), 2800);
}

function mapIcon(type) {
  if (!window.L) return null;
  const emoji = type === "driver" ? "🚗" : type === "destination" ? "◆" : "●";
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
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);
  state.map.on("click", event => {
    if (!state.mapSelectionMode) return;
    const { lat, lng } = event.latlng;
    if (state.mapSelectionMode === "pickup") {
      setCustomerLocation(lat, lng);
      byId("rideFrom").value = `نقطة محددة (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      showToast("تم تحديد نقطة الانطلاق");
    } else {
      setDestinationLocation(lat, lng);
      byId("rideTo").value = `وجهة محددة (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      showToast("تم تحديد الوجهة");
    }
    state.mapSelectionMode = null;
    byId("customerMap").classList.remove("selecting-point");
    byId("mapSelectionHint").textContent = "يمكنك تعديل أي نقطة بالضغط على زرها ثم اختيار مكان جديد.";
  });
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
  if (state.destinationLocation) calculateRouteEstimate();
}

function setDestinationLocation(latitude, longitude) {
  initializeCustomerMap();
  if (!state.map) return;
  state.destinationLocation = { latitude, longitude };
  const point = [latitude, longitude];
  if (state.destinationMarker) state.destinationMarker.setLatLng(point);
  else state.destinationMarker = window.L.marker(point, { icon: mapIcon("destination") })
    .addTo(state.map)
    .bindPopup("وجهة الرحلة");
  if (state.customerLocation) calculateRouteEstimate();
  else state.map.setView(point, 15);
}

function haversineKm(first, second) {
  const toRadians = value => value * Math.PI / 180;
  const earthRadius = 6371;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(first.latitude)) * Math.cos(toRadians(second.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fareForVehicle(vehicle) {
  const rate = vehicleRates[vehicle] || vehicleRates["اقتصادي"];
  if (!state.routeDistanceKm || !state.routeDurationMin) return rate.minimum;
  const calculated = rate.base
    + state.routeDistanceKm * rate.perKm
    + state.routeDurationMin * rate.perMinute;
  return Math.ceil(Math.max(rate.minimum, calculated) / 250) * 250;
}

function updateRideFare() {
  state.ridePrice = fareForVehicle(state.vehicle);
  byId("ridePrice").textContent = formatMoney(state.ridePrice);
  document.querySelectorAll(".vehicle-button").forEach(button => {
    const price = fareForVehicle(button.dataset.vehicle);
    button.querySelector("small").textContent = formatMoney(price);
  });
  const commission = Math.round(state.ridePrice * commissionRate);
  byId("estimateCommission").textContent = formatMoney(commission);
}

function drawBookingRoute(points) {
  if (!state.map || !points.length) return;
  if (state.bookingRouteLine) state.bookingRouteLine.setLatLngs(points);
  else state.bookingRouteLine = window.L.polyline(points, {
    color: "#17366f",
    weight: 6,
    opacity: .82
  }).addTo(state.map);
  const boundsPoints = [...points];
  if (state.customerMarker) boundsPoints.push(state.customerMarker.getLatLng());
  if (state.destinationMarker) boundsPoints.push(state.destinationMarker.getLatLng());
  state.map.fitBounds(window.L.latLngBounds(boundsPoints), { padding: [45, 45], maxZoom: 16 });
}

async function calculateRouteEstimate() {
  if (!state.customerLocation || !state.destinationLocation) return;
  const requestId = ++state.routeRequestId;
  byId("routeEstimate").hidden = false;
  byId("routeEstimateStatus").textContent = "جاري حساب أسرع مسار…";
  const from = state.customerLocation;
  const to = state.destinationLocation;
  let distanceKm;
  let durationMin;
  let points;
  let source = "مسار تقريبي";
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { signal: controller.signal }
    );
    if (!response.ok) throw new Error("ROUTE_HTTP_ERROR");
    const data = await response.json();
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) throw new Error("ROUTE_NOT_FOUND");
    distanceKm = route.distance / 1000;
    durationMin = route.duration / 60;
    points = route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
    source = "أسرع مسار عبر الطرق";
  } catch (error) {
    console.warn("تعذر جلب مسار الطرق؛ تم استخدام التقدير الاحتياطي", error);
    const directDistance = haversineKm(from, to);
    distanceKm = directDistance * 1.28;
    durationMin = distanceKm / 30 * 60;
    points = [[from.latitude, from.longitude], [to.latitude, to.longitude]];
  } finally {
    window.clearTimeout(timeoutId);
  }
  if (requestId !== state.routeRequestId) return;
  state.routeDistanceKm = Math.max(.1, distanceKm);
  state.routeDurationMin = Math.max(1, durationMin);
  state.routeSource = source;
  byId("estimateDistance").textContent = `${state.routeDistanceKm.toFixed(1)} كم`;
  byId("estimateDuration").textContent = `${Math.ceil(state.routeDurationMin)} دقيقة`;
  byId("routeEstimateStatus").textContent = source;
  drawBookingRoute(points);
  updateRideFare();
}

function activateMapSelection(mode) {
  initializeCustomerMap();
  state.mapSelectionMode = mode;
  byId("customerMap").classList.add("selecting-point");
  byId("mapSelectionHint").textContent = mode === "pickup"
    ? "اضغط على الخريطة لتحديد نقطة الانطلاق."
    : "اضغط على الخريطة لتحديد وجهة الرحلة.";
  byId("mapInfoTitle").textContent = mode === "pickup" ? "حدد نقطة الانطلاق" : "حدد الوجهة";
  byId("mapInfoText").textContent = "حرّك الخريطة واضغط على الموقع المطلوب.";
  byId("customerMap").scrollIntoView({ behavior: "smooth", block: "center" });
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
    if (state.activeOrder?.pickupLocation && !state.customerLocation) {
      const pickup = state.activeOrder.pickupLocation;
      if (Number.isFinite(Number(pickup.latitude)) && Number.isFinite(Number(pickup.longitude))) {
        setCustomerLocation(Number(pickup.latitude), Number(pickup.longitude));
      }
    }
    if (state.activeOrder?.destinationLocation && !state.destinationLocation) {
      const destination = state.activeOrder.destinationLocation;
      if (Number.isFinite(Number(destination.latitude)) && Number.isFinite(Number(destination.longitude))) {
        setDestinationLocation(Number(destination.latitude), Number(destination.longitude));
      }
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
    updateRideFare();
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
    setCustomerLocation(33.3152, 44.3661);
    showToast("تم اختيار موقع تقريبي");
    return;
  }
  showToast("جاري تحديد موقعك…");
  navigator.geolocation.getCurrentPosition(position => {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    targetInput.value = `موقعي الحالي (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;
    setCustomerLocation(latitude, longitude);
    byId("cityLabel").textContent = "الموقع محدد";
    showToast("تم تحديد موقعك");
  }, () => {
    targetInput.value = "موقعي الحالي — بغداد";
    setCustomerLocation(33.3152, 44.3661);
    showToast("تعذر تحديد الموقع؛ تم اختيار بغداد");
  }, { enableHighAccuracy: true, timeout: 7000 });
}

byId("useRideLocation").addEventListener("click", () => locateUser(byId("rideFrom")));
byId("useParcelLocation").addEventListener("click", () => locateUser(byId("parcelFrom")));
byId("headerLocation").addEventListener("click", () => locateUser(byId("rideFrom")));
byId("selectPickupMap").addEventListener("click", () => activateMapSelection("pickup"));
byId("selectDestinationMap").addEventListener("click", () => activateMapSelection("destination"));

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
  const finalPrice = Number(price);
  const commissionAmount = Math.round(finalPrice * commissionRate);
  const order = {
    id: "KW-" + String(Date.now()).slice(-6),
    userId: state.user.uid,
    type,
    title,
    route,
    price: finalPrice,
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
    pricingMode: options.pricingMode || "fixed",
    commissionRate,
    commissionAmount,
    driverEarning: finalPrice - commissionAmount,
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

byId("bookRide").addEventListener("click", async event => {
  if (!requireUser()) return;
  const from = byId("rideFrom").value.trim();
  const to = byId("rideTo").value.trim();
  if (!from || !to) {
    showToast("أدخل نقطة الانطلاق والوجهة");
    return;
  }
  if (!state.customerLocation || !state.destinationLocation || !state.routeDistanceKm) {
    showToast("حدد نقطة الانطلاق والوجهة من الخريطة أولًا");
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
      pickupLocation: { ...state.customerLocation },
      destinationLocation: { ...state.destinationLocation },
      distanceKm: state.routeDistanceKm,
      durationMin: state.routeDurationMin,
      routeSource: state.routeSource,
      pricingMode: "distance"
    });
  } catch (error) {
    console.error(error);
    showToast("تعذر حفظ الطلب. تحقق من الاتصال وقواعد Firestore.");
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
  byId("trackingStatus").textContent = orderStatuses[statusIndex];
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
    details.append(title, route);
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
  if (!order || order.cancelled || Number(order.statusIndex || 0) < 3 || !order.driverId) {
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

byId("savedAddresses").addEventListener("click", () => {
  showToast("إدارة العناوين ستكون في المرحلة التالية");
});

const supportModal = byId("supportModal");
document.querySelectorAll("[data-open-support]").forEach(button => {
  button.addEventListener("click", () => supportModal.classList.add("show"));
});
byId("closeSupport").addEventListener("click", () => supportModal.classList.remove("show"));
byId("startSupportChat").addEventListener("click", () => {
  supportModal.classList.remove("show");
  showToast("تم بدء محادثة دعم تجريبية");
});
supportModal.addEventListener("click", event => {
  if (event.target === supportModal) supportModal.classList.remove("show");
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") supportModal.classList.remove("show");
  if (event.key === "Escape") closeRatingModal();
});

setAuthMode("login");
initializeCustomerMap();
updateRideFare();
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
