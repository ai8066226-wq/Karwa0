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
  doc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
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

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الكابتن", error);
}

const byId = id => document.getElementById(id);
const statuses = ["تم استلام الطلب", "الكابتن في الطريق", "بدأت الرحلة", "تم الوصول"];
const icons = { ride: "🚕", parcel: "📦", food: "🍽️" };

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
  driverMarker: null,
  pickupMarker: null,
  routeLine: null
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
  state.map = window.L.map("driverMap").setView([33.3152, 44.3661], 12);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);
}

function setLocationStatus(text, mode = "pending") {
  byId("locationStatus").textContent = text;
  byId("locationStatus").className = `status-chip ${mode}`;
}

function drawPickupRoute() {
  if (!state.map) return;
  const activeOrder = state.orders.find(order =>
    order.driverId === state.user?.uid && !order.cancelled && Number(order.statusIndex || 0) < 3
  );
  const pickup = activeOrder?.pickupLocation;
  if (!pickup || !Number.isFinite(Number(pickup.latitude)) || !Number.isFinite(Number(pickup.longitude))) {
    if (state.pickupMarker) state.map.removeLayer(state.pickupMarker);
    if (state.routeLine) state.map.removeLayer(state.routeLine);
    state.pickupMarker = null;
    state.routeLine = null;
    return;
  }

  const pickupPoint = [Number(pickup.latitude), Number(pickup.longitude)];
  if (state.pickupMarker) state.pickupMarker.setLatLng(pickupPoint);
  else state.pickupMarker = window.L.marker(pickupPoint, { icon: mapIcon("pickup") })
    .addTo(state.map)
    .bindPopup("موقع العميل");

  if (!state.driverMarker) return;
  const points = [state.driverMarker.getLatLng(), state.pickupMarker.getLatLng()];
  if (state.routeLine) state.routeLine.setLatLngs(points);
  else state.routeLine = window.L.polyline(points, {
    color: "#ff6b35",
    weight: 5,
    opacity: .85,
    dashArray: "9 9"
  }).addTo(state.map);
  state.map.fitBounds(window.L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
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
  state.map.setView(point, 15);
  setLocationStatus("الموقع مباشر", "approved");
  byId("locationHint").textContent = `دقة الموقع نحو ${Math.round(position.coords.accuracy || 0)} متر.`;
  drawPickupRoute();
}

async function sharePosition(position, force = false) {
  if (!state.user || !state.driverData?.online || !position) return;
  const now = Date.now();
  if (!force && now - state.lastLocationWrite < 5000) return;
  const activeOrders = state.orders.filter(order =>
    order.driverId === state.user.uid && !order.cancelled && Number(order.statusIndex || 0) < 3
  );
  if (!activeOrders.length) return;
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
    "auth/network-request-failed": "تعذر الاتصال بالإنترنت."
  };
  return messages[error.code] || "تعذر تسجيل الدخول.";
}

function showView(name) {
  byId("authView").classList.toggle("hidden", name !== "auth");
  byId("deniedView").classList.toggle("hidden", name !== "denied");
  byId("blockedView").classList.toggle("hidden", name !== "blocked");
  byId("applicationView").classList.toggle("hidden", name !== "application");
  byId("driverView").classList.toggle("hidden", name !== "driver");
  byId("logoutButton").classList.toggle("hidden", name === "auth");
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

byId("deniedLogout").addEventListener("click", async () => {
  await signOut(auth);
  toast("تم تسجيل الخروج");
});

byId("blockedLogout").addEventListener("click", async () => {
  await signOut(auth);
  toast("تم تسجيل الخروج");
});

function fillApplication(data = {}) {
  byId("driverName").value = data.name || state.userData?.name || state.user?.displayName || "";
  byId("driverPhone").value = data.phone || "";
  byId("vehicleType").value = data.vehicleType || "اقتصادي";
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
    notice.textContent = "وصل طلبك إلى الإدارة. سنفعّل حساب الكابتن بعد الموافقة.";
    button.disabled = true;
    button.textContent = "الطلب قيد المراجعة";
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
  if (!state.user) return;
  const phone = byId("driverPhone").value.replace(/\s/g, "");
  if (phone.replace(/\D/g, "").length < 8) {
    toast("أدخل رقم هاتف صحيحًا");
    return;
  }
  const button = byId("submitApplication");
  busy(button, true, "جاري الإرسال…");
  try {
    await setDoc(doc(db, "driverApplications", state.user.uid), {
      userId: state.user.uid,
      name: byId("driverName").value.trim(),
      email: state.user.email || "",
      phone,
      vehicleType: byId("vehicleType").value,
      plate: byId("plate").value.trim(),
      city: byId("driverCity").value,
      status: "pending",
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast("تم إرسال طلب الانضمام");
  } catch (error) {
    console.error(error);
    toast("تعذر إرسال الطلب. تأكد من نشر قواعد Firestore الجديدة.");
  } finally {
    busy(button, false);
  }
});

function distanceToOrder(order){if(!state.lastPosition||!order.pickupLocation)return Infinity;const a={latitude:state.lastPosition.coords.latitude,longitude:state.lastPosition.coords.longitude},b=order.pickupLocation;const R=6371,toRad=v=>v*Math.PI/180,dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function orderCard(order, mode) {
  const statusIndex = Number(order.statusIndex || 0);
  const statusClass = order.cancelled ? "cancelled" : statusIndex >= 3 ? "complete" : "active";
  const action = mode === "available"
    ? `<button class="primary" data-action="accept" data-id="${order.firestoreId}" ${state.driverData?.online ? "" : "disabled"}>قبول الطلب</button>`
    : statusIndex < 3 && !order.cancelled
      ? `<button class="primary" data-action="advance" data-id="${order.firestoreId}">${escapeHtml(statuses[statusIndex + 1])}</button>`
      : "";
  return `
    <article class="order-card">
      <div class="order-top">
        <h3>${icons[order.type] || "🧾"} ${escapeHtml(order.title)}</h3>
        <span class="status-chip ${statusClass}">${escapeHtml(order.cancelled ? "ملغي" : statuses[statusIndex])}</span>
      </div>
      <p class="order-route">${escapeHtml(order.route)}</p>
      <div class="order-bottom">
        <div class="order-meta"><span>${escapeHtml(order.id)}</span><span>${escapeHtml(order.payment || "نقدًا")}</span>${mode === "available" && Number.isFinite(distanceToOrder(order)) ? `<span>يبعد ${distanceToOrder(order).toFixed(1)} كم</span>` : ""}</div>
        ${order.distanceKm ? `<div class="order-meta"><span>المشوار ${Number(order.distanceKm).toFixed(1)} كم</span><span>≈ ${Math.round(Number(order.durationMin||0))} دقيقة</span><span>صافي الكابتن ${money(order.driverEarnings)}</span></div>` : ""}
        <span class="order-price">${money(order.price)}</span>
      </div>
      ${action ? `<div class="order-actions">${action}</div>` : ""}
    </article>`;
}

function renderOrders() {
  const available = state.orders.filter(order =>
    !order.cancelled && Number(order.statusIndex || 0) < 3 && !order.driverId
  ).sort((a,b) => distanceToOrder(a) - distanceToOrder(b));
  const mine = state.orders.filter(order =>
    order.driverId === state.user?.uid && !order.cancelled && Number(order.statusIndex || 0) < 3
  );
  const completed = state.orders.filter(order =>
    order.driverId === state.user?.uid && Number(order.statusIndex || 0) >= 3
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
}

function openDriverDashboard() {
  clearViewListeners();
  showView("driver");
  initializeDriverMap();
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
    if (state.driverData.online) startLocationSharing();
    else stopLocationSharing();
    renderOrders();
  });

  const ordersUnsubscribe = onSnapshot(query(collection(db, "orders")), snapshot => {
    state.orders = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }))
      .sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")));
    renderOrders();
  }, error => {
    console.error(error);
    toast("تعذر تحميل الطلبات. انشر قواعد Firestore الجديدة.");
  });
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
  state.viewUnsubscribes.push(driverUnsubscribe, ordersUnsubscribe, ratingsUnsubscribe);
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
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error("ORDER_NOT_FOUND");
        const order = snapshot.data();
        if (order.driverId || order.cancelled || Number(order.statusIndex || 0) >= 3) throw new Error("ORDER_TAKEN");
        transaction.update(orderRef, {
          driverId: state.user.uid,
          driverName: state.driverData.name || state.userData?.name || "كابتن كروة",
          driverPhone: state.driverData.phone || "",
          assignmentStatus: "accepted",
          updatedAt: serverTimestamp()
        });
      });
      if (state.lastPosition) await sharePosition(state.lastPosition, true);
      toast("تم قبول الطلب");
    } else if (button.dataset.action === "advance") {
      const order = state.orders.find(item => item.firestoreId === button.dataset.id);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      const next = Number(order.statusIndex || 0) + 1;
      await updateDoc(orderRef, {
        statusIndex: next,
        assignmentStatus: next >= 3 ? "completed" : "active",
        updatedAt: serverTimestamp()
      });
      toast(statuses[next]);
    }
  } catch (error) {
    console.error(error);
    toast(error.message === "ORDER_TAKEN" ? "سبق أن أخذ كابتن آخر هذا الطلب" : error.message === "OFFLINE" ? "فعّل حالة الاتصال أولًا" : "تعذر تنفيذ العملية");
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
    showView("auth");
    return;
  }

  state.userUnsubscribe = onSnapshot(doc(db, "users", user.uid), snapshot => {
    if (!snapshot.exists()) {
      byId("authError").textContent = "افتح تطبيق العميل مرة واحدة لإنشاء ملف الحساب.";
      showView("auth");
      return;
    }
    state.userData = snapshot.data();
    if (state.userData.role === "driver") {
      openDriverDashboard();
    } else if (state.userData.role === "customer") {
      openApplication();
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
