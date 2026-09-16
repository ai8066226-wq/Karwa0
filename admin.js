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
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
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

async function registerAdminNativePushToken(user){
  if(!user)return false;let token="";try{token=String(window.KarwaNative?.getPushToken?.()||window.KarwaNotify?.getNativePushToken?.()||"").trim()}catch{}if(!token)return false;
  const id=`android_${token.slice(-36).replace(/[^a-zA-Z0-9_-]/g,"_")}`;
  try{await setDoc(doc(db,"users",user.uid,"pushTokens",id),{token,platform:"android",app:"karwa",role:"admin",updatedAt:serverTimestamp()},{merge:true});return true}catch(error){console.warn("تعذر تسجيل رمز إشعارات الإدارة",error);return false}
}
window.addEventListener("karwa-native-push-token",()=>{if(auth.currentUser)registerAdminNativePushToken(auth.currentUser)});

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
  ratingsFilter: "all",
  orders: [],
  serviceRequests: [],
  topupRequests: [],
  pricingSettings: {},
  roleUnsubscribe: null,
  dashboardUnsubscribes: []
};

const money = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";

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
  byId("adminNotificationsLink").classList.toggle("hidden", name !== "dashboard");
}

function clearDashboardListeners() {
  state.dashboardUnsubscribes.forEach(unsubscribe => unsubscribe?.());
  state.dashboardUnsubscribes = [];
}

function adminNotificationCounts() {
  const captainApplications = state.applications.filter(item =>
    (item.status || "pending") === "pending" && normalizeCaptainServiceType(item) !== "other"
  ).length;
  const modernServiceIds = new Set(state.serviceApplications.map(item => item.firestoreId));
  const legacyServiceApplications = state.applications.filter(item =>
    normalizeCaptainServiceType(item) === "other" && !modernServiceIds.has(item.firestoreId)
  );
  const serviceApplications = [...state.serviceApplications, ...legacyServiceApplications]
    .filter(item => (item.status || "pending") === "pending").length;
  const topups = state.topupRequests.filter(item => (item.status || "pending") === "pending").length;
  const waitingOrders = state.orders.filter(order =>
    !order.cancelled && !order.driverId && Number(order.statusIndex || 0) === 0
  ).length;
  const driversAttention = state.drivers.filter(driver =>
    driver.blocked === true || Number(driver.warningCount || 0) > 0
  ).length;
  const completedTrips = state.orders.filter(order =>
    !order.cancelled && Number(order.statusIndex || 0) >= 4
  ).length;

  return {
    captainApplications,
    serviceApplications,
    topups,
    waitingOrders,
    driversAttention,
    completedTrips,
    ratings: state.ratings.length
  };
}

function setModuleNotification(id, count, alert = true) {
  const badge = byId(id);
  if (!badge) return;
  badge.textContent = String(count);
  badge.setAttribute("aria-label", `${count} إشعار`);
  badge.classList.toggle("has-items", alert && count > 0);
  badge.closest(".admin-module-card")?.classList.toggle("has-alerts", alert && count > 0);
}

function setPanelNotification(id, count, suffix) {
  const badge = byId(id);
  if (!badge) return;
  badge.textContent = `${count} ${suffix}`;
  badge.classList.toggle("no-items", count === 0);
}

function renderAdminNotifications() {
  const counts = adminNotificationCounts();
  setModuleNotification("navTopupsCount", counts.topups);
  setModuleNotification("navServicesCount", counts.serviceApplications);
  setModuleNotification("navCaptainsCount", counts.captainApplications);
  setModuleNotification("navDriversCount", counts.driversAttention);
  setModuleNotification("navOrdersCount", counts.waitingOrders);
  setModuleNotification("navFinanceCount", counts.completedTrips, false);
  setModuleNotification("navRatingsCount", counts.ratings, false);

  setPanelNotification("pendingTopupsBadge", counts.topups, "بانتظار المراجعة");
  setPanelNotification("serviceApplicationsBadge", counts.serviceApplications, "بانتظار المراجعة");
  setPanelNotification("captainApplicationsBadge", counts.captainApplications, "بانتظار المراجعة");
  setPanelNotification("driversAttentionBadge", counts.driversAttention, "يحتاج متابعة");
  setPanelNotification("waitingOrdersBadge", counts.waitingOrders, "بانتظار كابتن");
  setPanelNotification("financialReportBadge", counts.completedTrips, "رحلة مكتملة");
  setPanelNotification("ratingsBadge", counts.ratings, "تقييم");

  const actionable = counts.topups + counts.serviceApplications + counts.captainApplications + counts.driversAttention + counts.waitingOrders;
  const globalBadge = byId("globalNotificationsBadge");
  const notificationsLink = byId("adminNotificationsLink");
  const heroCount = byId("heroActionCount");
  if (globalBadge) {
    globalBadge.textContent = String(actionable);
    globalBadge.setAttribute("aria-label", `${actionable} إجراء يحتاج متابعة`);
  }
  notificationsLink?.classList.toggle("no-alerts", actionable === 0);
  if (heroCount) {
    heroCount.textContent = actionable ? `${actionable} إجراء يحتاج متابعة` : "لا توجد إجراءات معلّقة";
    heroCount.classList.toggle("has-items", actionable > 0);
  }
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

function renderMetrics() {
  const notifications = adminNotificationCounts();
  byId("usersCount").textContent = state.users.filter(user => !user.role || user.role === "customer").length;
  byId("driversCount").textContent = state.drivers.length;
  byId("serviceProvidersCount").textContent = state.users.filter(user => user.role === "serviceProvider").length;
  byId("blockedCount").textContent = state.drivers.filter(driver => driver.blocked === true).length;
  byId("pendingCount").textContent = notifications.captainApplications + notifications.serviceApplications + notifications.topups;
  byId("ordersCount").textContent = state.orders.length;
  byId("liveTripsCount").textContent = state.orders.filter(o => !o.cancelled && Number(o.statusIndex||0) > 0 && Number(o.statusIndex||0) < 4).length;
  byId("cancelledTripsCount").textContent = state.orders.filter(o => o.cancelled).length;
  byId("onlineDriversCount").textContent = state.drivers.filter(d => d.online === true && d.blocked !== true).length;
  const completed=state.orders.filter(o=>!o.cancelled&&Number(o.statusIndex||0)>=4);
  const gross=completed.reduce((n,o)=>n+Number(o.price||0),0);
  const orderFees=state.orders.reduce((n,o)=>n+Number(o.customerPlatformFee||0)+Number(o.captainPlatformFee||0),0);
  const serviceFees=state.serviceRequests.reduce((n,r)=>n+Number(r.customerPlatformFee||0)+Number(r.providerPlatformFee||0),0);
  const publishFees=state.serviceProfiles.reduce((n,p)=>n+(p.publishFeePaid===true?Number(p.publishFeeAmount||0):0),0);
  const platformFees=orderFees+serviceFees+publishFees;
  const payout=completed.reduce((n,o)=>n+Number(o.driverEarnings||0),0);
  byId("grossRevenue").textContent=money(gross);byId("commissionRevenue").textContent=money(platformFees);byId("driversPayout").textContent=money(payout);
  const byDriver={};completed.forEach(o=>{const k=o.driverName||"غير معيّن";byDriver[k]=(byDriver[k]||0)+Number(o.driverEarnings||0)});
  byId("financialReport").innerHTML=completed.length?`<div class="order-meta"><span>رحلات مكتملة: ${completed.length}</span><span>متوسط الطلب: ${money(gross/completed.length)}</span></div>${Object.entries(byDriver).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,value])=>`<div class="order-meta"><strong>${escapeHtml(name)}</strong><span>${money(value)}</span></div>`).join("")}`:`<p class="muted">لا توجد رحلات مكتملة بعد.</p>`;
  renderAdminNotifications();
}

function ratingSummary(driverId) {
  const ratings = state.ratings.filter(item => item.driverId === driverId || (item.targetType === "driver" && item.targetId === driverId));
  const average = ratings.length
    ? ratings.reduce((total, item) => total + Number(item.score || 0), 0) / ratings.length
    : 0;
  return { count: ratings.length, average };
}

function providerRatingSummary(providerId) {
  const ratings = state.ratings.filter(item => item.providerId === providerId || (item.targetType === "provider" && item.targetId === providerId));
  const average = ratings.length
    ? ratings.reduce((total, item) => total + Number(item.score || 0), 0) / ratings.length
    : 0;
  return { count: ratings.length, average };
}

function normalizedRatingType(rating = {}) {
  if (rating.ratingType === "service" || rating.targetType === "provider" || rating.providerId) return "service";
  if (rating.ratingType === "delivery") return "delivery";
  if (rating.ratingType === "taxi") return "taxi";
  return "taxi";
}

function ratingTypeLabel(type) {
  return ({ taxi: "تكسي", delivery: "توصيل", service: "خدمات أخرى" })[type] || "تقييم";
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
      ${completed ? `<div class="order-meta trip-money"><span>رسوم كروة: ${money(Number(order.customerPlatformFee||0)+Number(order.captainPlatformFee||0))}</span><span>أجرة الكابتن: <b>${money(order.driverEarnings)}</b></span></div>` : ""}
      ${order.cancelled ? `<p class="admin-note danger-note">سبب الإلغاء: ${escapeHtml(order.cancellationReason || "غير مسجل")}</p><div class="order-meta"><span>ألغى بواسطة: ${escapeHtml(order.cancelledByName || cancellationRoleLabel(order.cancelledByRole || order.cancelledBy))}</span><span>${escapeHtml(order.cancelledByEmail || "البريد غير مسجل")}</span></div>` : ""}
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
  const all = [...state.ratings];
  const typed = type => all.filter(item => normalizedRatingType(item) === type);
  const avg = list => list.length ? list.reduce((sum, item) => sum + Number(item.score || 0), 0) / list.length : 0;
  const totalAverage = avg(all);
  const taxi = typed("taxi"), delivery = typed("delivery"), service = typed("service");
  if (byId("ratingsAverage")) byId("ratingsAverage").textContent = all.length ? totalAverage.toFixed(1) : "—";
  if (byId("ratingsTaxiCount")) byId("ratingsTaxiCount").textContent = String(taxi.length);
  if (byId("ratingsDeliveryCount")) byId("ratingsDeliveryCount").textContent = String(delivery.length);
  if (byId("ratingsServiceCount")) byId("ratingsServiceCount").textContent = String(service.length);

  const selected = state.ratingsFilter || "all";
  const filtered = all.filter(item => selected === "all" || normalizedRatingType(item) === selected);
  const sorted = filtered.sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
  byId("ratingsList").innerHTML = sorted.length
    ? sorted.map(rating => {
      const type = normalizedRatingType(rating);
      const score = Math.max(0, Math.min(5, Number(rating.score || 0)));
      const targetName = rating.targetName || rating.providerName || rating.driverName || "خدمة كروة";
      const reference = rating.referenceCode || rating.orderCode || rating.itemName || "";
      const tags = Array.isArray(rating.tags) ? rating.tags.slice(0, 4) : [];
      const created = rating.createdAt?.seconds ? new Date(rating.createdAt.seconds * 1000).toLocaleString("ar-IQ") : "";
      return `<article class="review-card review-card-pro">
        <div class="review-card-head"><div><strong>${escapeHtml(targetName)}</strong><small>${escapeHtml(reference)}</small></div><span class="rating-type-chip ${type}">${ratingTypeLabel(type)}</span></div>
        <div class="review-stars-row"><span class="stars" aria-label="${score} من 5">${"★".repeat(score)}${"☆".repeat(5 - score)}</span><b>${score.toFixed(1)}</b></div>
        ${tags.length ? `<div class="review-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        ${rating.comment ? `<p>${escapeHtml(rating.comment)}</p>` : `<p class="muted">بدون تعليق مكتوب.</p>`}
        <div class="review-meta"><span>العميل: ${escapeHtml(rating.customerName || "عميل كروة")}</span>${created ? `<span>${escapeHtml(created)}</span>` : ""}</div>
      </article>`;
    }).join("")
    : `<div class="empty"><span>★</span>لا توجد تقييمات في هذا القسم بعد.</div>`;
  renderAdminNotifications();
}

byId("ratingsTypeFilter")?.addEventListener("change", event => {
  state.ratingsFilter = event.target.value || "all";
  renderRatings();
});

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
  const providerRating = providerRatingSummary(application.firestoreId || application.userId);
  const actions = status === "pending" ? `<div class="order-actions"><button class="primary" data-action="approve-service" data-source="${source}" data-id="${application.firestoreId}" ${hasLocation ? "" : 'disabled title="يجب أن يحدد المزود موقع GPS أولًا"'}>${hasLocation ? "قبول وتفعيل" : "GPS مطلوب قبل القبول"}</button><button class="danger" data-action="reject-service" data-source="${source}" data-id="${application.firestoreId}">رفض مع ملاحظة</button></div>` : "";
  return `<article class="order-card service-application-card">
    <div class="order-top"><h3>🧰 ${escapeHtml(businessName)}</h3><span class="status-chip ${status}">${labels[status] || escapeHtml(status)}</span></div>
    <p class="order-route">${escapeHtml(serviceCategoryLabels[category] || serviceCategoryLabels.other)} • ${escapeHtml(application.city || profile?.city || "—")}</p>
    <div class="order-meta"><span>صاحب الخدمة: ${escapeHtml(ownerName)}</span><span>الهاتف: ${escapeHtml(application.phone || profile?.phone || restaurant?.phone || "—")}</span></div>
    <div class="order-meta"><span>البريد: ${escapeHtml(application.email || "—")}</span><span>العنوان: ${escapeHtml(address)}</span><span>GPS: ${escapeHtml(gps)}</span></div>
    ${application.description ? `<p class="admin-note">${escapeHtml(application.description)}</p>` : ""}
    <div class="order-meta"><span>العناصر المضافة: ${Array.isArray(items) ? items.length : 0}</span><span>★ ${providerRating.count ? providerRating.average.toFixed(1) : "جديد"} • ${providerRating.count} تقييم</span>${application.legacy ? `<span>طلب قديم — مدعوم تلقائيًا</span>` : ""}</div>
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
        ${Number(order.surgeMultiplier||1)>1?`<div class="order-meta"><span>طلب مرتفع ×${Number(order.surgeMultiplier).toFixed(2)}</span></div>`:""}
        ${Number(order.discountAmount||0)>0?`<div class="order-meta"><span>خصم ${money(order.discountAmount)}</span><span>${escapeHtml(order.couponCode||"")}</span></div>`:""}
        ${Array.isArray(order.dispatchCandidateIds)?`<div class="order-meta"><span>مرشحو التوزيع: ${order.dispatchCandidateIds.length}</span><span>الجولة ${Number(order.dispatchRound||1)}</span></div>`:""}
        ${Number(order.statusIndex||0)>=4&&!order.cancelled?`<div class="order-meta"><span>رسوم كروة: ${money(Number(order.customerPlatformFee||0)+Number(order.captainPlatformFee||0))}</span><span>أجرة الكابتن: ${money(order.driverEarnings)}</span></div>`:""}
        ${order.autoCompletedByGPS===true?`<div class="order-meta"><span>📍 إكمال تلقائي عبر GPS</span><span>العميل والكابتن وصلا ضمن ${Number(order.autoArrivalRadiusM||120)} م من الوجهة</span></div>`:""}
      </div>
      ${order.cancelled ? `<p class="admin-note danger-note">سبب الإلغاء: ${escapeHtml(order.cancellationReason || "غير مسجل")}</p><div class="order-meta"><span>ألغى بواسطة: ${escapeHtml(order.cancelledByName || cancellationRoleLabel(order.cancelledByRole || order.cancelledBy))}</span><span>${escapeHtml(order.cancelledByEmail || "البريد غير مسجل")}</span></div>` : ""}
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
function cancellationRoleLabel(role) {
  return ({ customer:"عميل", driver:"كابتن", serviceProvider:"خدمات أخرى", admin:"الإدارة" })[role] || "مستخدم";
}

function cancellationOperationLabel(item, source) {
  if (source === "service") return item.providerCategory === "restaurant" ? "طلب مطعم" : "طلب خدمة";
  return ({ ride:"تكسي", parcel:"توصيل أغراض", food:"توصيل طعام", serviceDelivery:"توصيل خدمة" })[item.type] || "طلب كروة";
}

function cancellationTimestamp(item) {
  const value = item.cancelledAt || item.statusUpdatedAt || item.updatedAt || item.createdAt;
  if (value?.seconds) return Number(value.seconds) * 1000;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const n = new Date(value || 0).getTime();
  return Number.isFinite(n) ? n : 0;
}

function cancellationActor(item, source) {
  const explicitRole = String(item.cancelledByRole || item.cancelledBy || (source === "service" ? "customer" : "")).trim();
  const role = ["customer","driver","serviceProvider","admin"].includes(explicitRole) ? explicitRole : "customer";
  const fallbackId = item.cancelledByUserId || (role === "driver" ? item.driverId : role === "serviceProvider" ? item.providerId : source === "service" ? item.customerId : item.userId) || "";
  const user = state.users.find(entry => entry.firestoreId === fallbackId) || {};
  let fallbackName = user.name || "";
  if (!fallbackName && role === "driver") fallbackName = item.driverName || "كابتن كروة";
  if (!fallbackName && role === "serviceProvider") fallbackName = item.providerName || "مزود خدمة";
  if (!fallbackName && role === "customer") fallbackName = item.customerName || "عميل كروة";
  if (!fallbackName && role === "admin") fallbackName = "إدارة كروة";
  return {
    role,
    id: fallbackId,
    name: item.cancelledByName || fallbackName || "غير معروف",
    email: item.cancelledByEmail || user.email || (role === "admin" && state.user?.uid === fallbackId ? state.user?.email || "" : "") || ""
  };
}

function cancellationRecords() {
  const orderRows = state.orders.filter(item => item.cancelled === true).map(item => ({ source:"order", item }));
  const serviceRows = state.serviceRequests.filter(item => item.status === "cancelled").map(item => ({ source:"service", item }));
  return [...orderRows, ...serviceRows].sort((a,b) => cancellationTimestamp(b.item) - cancellationTimestamp(a.item));
}

function renderCancellations() {
  const list = byId("cancellationsList");
  if (!list) return;
  const rows = cancellationRecords();
  const filter = byId("cancellationRoleFilter")?.value || "all";
  const filtered = rows.filter(row => filter === "all" || cancellationActor(row.item, row.source).role === filter);
  if (byId("cancellationsBadge")) byId("cancellationsBadge").textContent = `${rows.length} إلغاء`;
  if (byId("navCancellationsCount")) byId("navCancellationsCount").textContent = String(rows.length);
  list.innerHTML = filtered.length ? filtered.map(({source,item}) => {
    const actor = cancellationActor(item, source);
    const dateMs = cancellationTimestamp(item);
    const code = source === "service" ? (item.firestoreId || "—") : (item.id || item.orderCode || item.firestoreId || "—");
    const title = source === "service" ? (item.itemName || item.providerName || "طلب خدمة") : (item.title || "طلب كروة");
    const reason = String(item.cancellationReason || item.providerNote || "لم يُسجل سبب في النسخ القديمة").trim();
    return `<article class="cancellation-card">
      <div class="cancellation-head"><div><small>${escapeHtml(cancellationOperationLabel(item, source))}</small><strong>${escapeHtml(title)}</strong></div><span class="cancellation-chip">${escapeHtml(cancellationRoleLabel(actor.role))}</span></div>
      <div class="cancellation-reason">سبب الإلغاء: ${escapeHtml(reason)}</div>
      <div class="cancellation-user"><b>${escapeHtml(actor.name)}</b><small>${escapeHtml(actor.email || "البريد غير مسجل")} • UID: ${escapeHtml(actor.id || "غير متوفر")}</small></div>
      <div class="cancellation-meta"><span>رقم العملية: ${escapeHtml(code)}</span><span>${dateMs ? new Date(dateMs).toLocaleString("ar-IQ") : "وقت الإلغاء غير متوفر"}</span>${source === "service" ? `<span>النشاط: ${escapeHtml(item.providerName || "—")}</span>` : item.driverName ? `<span>الكابتن: ${escapeHtml(item.driverName)}</span>` : ""}</div>
    </article>`;
  }).join("") : `<div class="empty"><span>✓</span>لا توجد إلغاءات مطابقة للفلتر.</div>`;
}

byId("cancellationRoleFilter")?.addEventListener("change", renderCancellations);

function repairLegacyCaptainService(collectionName, record) {
  const normalized = normalizeCaptainServiceType(record);
  if (!["taxi", "delivery"].includes(normalized) || record.serviceType === normalized) return;
  // تصحيح آمن للسجلات القديمة: الدراجة/قيم التوصيل الوصفية تصبح delivery بدل أن تبقى محسوبة كتكسي.
  updateDoc(doc(db, collectionName, record.firestoreId), {
    serviceType: normalized,
    updatedAt: serverTimestamp()
  }).catch(error => console.warn("تعذر تصحيح نوع خدمة الكابتن القديم", record.firestoreId, error));
}

function settingNumber(value,fallback,min=0,max=100000){const n=Number(value);return Math.max(min,Math.min(max,Number.isFinite(n)?n:fallback));}
function renderPricingSettings(){
  const c=state.pricingSettings||{};
  const values={
    ridePerKmEconomy:c.ridePerKmEconomy??650,ridePerKmTaxi:c.ridePerKmTaxi??800,ridePerKmFamily:c.ridePerKmFamily??980,
    publishFee:c.publishFee??1000,
    customerTaxiFee:c.customerTaxiFee??c.customerOrderFee??250,
    customerDeliveryFee:c.customerDeliveryFee??c.customerOrderFee??250,
    customerServiceFee:c.customerServiceFee??c.customerOrderFee??250,
    captainTaxiFee:c.captainTaxiFee??c.captainOrderFee??250,
    captainDeliveryFee:c.captainDeliveryFee??c.captainOrderFee??250,
    providerRestaurantFee:c.providerRestaurantFee??c.providerOrderFee??250,
    providerServiceFee:c.providerServiceFee??c.providerOrderFee??250,
    signupBonusAmount:c.signupBonusAmount??1000,signupBonusHours:c.signupBonusHours??24,
    referralDiscountPercent:c.referralDiscountPercent??10,referralMaxDiscount:c.referralMaxDiscount??3000
  };
  Object.entries(values).forEach(([id,value])=>{const el=byId(id);if(el&&document.activeElement!==el)el.value=String(Number(value));});
  const bonusToggle=byId("signupBonusEnabled");if(bonusToggle&&document.activeElement!==bonusToggle)bonusToggle.checked=c.signupBonusEnabled!==false;
  ["topupTransferLabel","topupTransferId","topupCardHolder"].forEach(id=>{const el=byId(id);if(el&&document.activeElement!==el)el.value=String(c[id]||"");});
}
function renderTopupRequests(){
  const box=byId("topupRequestsAdmin"); if(!box)return;
  const rows=[...state.topupRequests].sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));
  renderAdminNotifications();
  if(!rows.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';return;}
  const labels={pending:"قيد المراجعة",approved:"معتمد",rejected:"مرفوض"};
  const accountLabels={customer:"عميل",captain:"كابتن",service:"خدمات أخرى",driver:"كابتن",other:"خدمات أخرى"};
  box.innerHTML=rows.map(x=>{const status=x.status||"pending";const date=x.createdAt?.seconds?new Date(x.createdAt.seconds*1000).toLocaleString("ar-IQ"):"—";const accountType=accountLabels[x.accountType]||accountLabels[x.accountRole]||"عميل";return `<article class="topup-admin-row ${escapeHtml(status)}"><div class="topup-admin-head"><div><strong>${escapeHtml(x.customerName||"مشترك")}</strong><small> • ${escapeHtml(x.email||"")} • <b>${escapeHtml(accountType)}</b></small></div><span class="status-chip ${status==='approved'?'approved':status==='rejected'?'cancelled':'pending'}">${labels[status]||escapeHtml(status)}</span></div><div class="order-meta"><span>نوع التسجيل: <b>${escapeHtml(accountType)}</b></span><span>المبلغ: <b>${money(x.amount)}</b></span><span>المرجع: <b>${escapeHtml(x.transferReference||"—")}</b></span><span>${date}</span></div>${status==='pending'?`<div class="topup-admin-actions"><button class="primary" data-action="approve-topup" data-id="${x.firestoreId}">اعتماد وإضافة الرصيد</button><button class="danger" data-action="reject-topup" data-id="${x.firestoreId}">رفض</button></div>`:`${x.reviewNote?`<p class="admin-note">${escapeHtml(x.reviewNote)}</p>`:""}`}</article>`;}).join("");
}

byId("pricingSettingsForm")?.addEventListener("submit",async event=>{
  event.preventDefault(); if(!state.user)return;
  const button=byId("savePricingSettings"); busy(button,true,"جارٍ الحفظ…");
  try{
    const payload={updatedAt:serverTimestamp(),updatedBy:state.user.uid};
    payload.ridePerKmEconomy=settingNumber(byId("ridePerKmEconomy")?.value,650,0,10000);
    payload.ridePerKmTaxi=settingNumber(byId("ridePerKmTaxi")?.value,800,0,10000);
    payload.ridePerKmFamily=settingNumber(byId("ridePerKmFamily")?.value,980,0,10000);
    payload.publishFee=Math.round(settingNumber(byId("publishFee")?.value,1000));
    payload.customerTaxiFee=Math.round(settingNumber(byId("customerTaxiFee")?.value,250));
    payload.customerDeliveryFee=Math.round(settingNumber(byId("customerDeliveryFee")?.value,250));
    payload.customerServiceFee=Math.round(settingNumber(byId("customerServiceFee")?.value,250));
    payload.captainTaxiFee=Math.round(settingNumber(byId("captainTaxiFee")?.value,250));
    payload.captainDeliveryFee=Math.round(settingNumber(byId("captainDeliveryFee")?.value,250));
    payload.providerRestaurantFee=Math.round(settingNumber(byId("providerRestaurantFee")?.value,250));
    payload.providerServiceFee=Math.round(settingNumber(byId("providerServiceFee")?.value,250));
    // حقول توافق للإصدارات القديمة، بينما Phase 74 يستخدم الرسوم التفصيلية أعلاه.
    payload.customerOrderFee=payload.customerTaxiFee;
    payload.captainOrderFee=payload.captainDeliveryFee;
    payload.providerOrderFee=payload.providerServiceFee;
    payload.signupBonusEnabled=byId("signupBonusEnabled")?.checked!==false;
    payload.signupBonusAmount=Math.round(settingNumber(byId("signupBonusAmount")?.value,1000,0,100000));
    payload.signupBonusHours=Math.round(settingNumber(byId("signupBonusHours")?.value,24,1,168));
    payload.topupTransferLabel=(byId("topupTransferLabel")?.value||"Mastercard محلي").trim().slice(0,60);
    payload.topupTransferId=(byId("topupTransferId")?.value||"").trim().slice(0,80);
    payload.topupCardHolder=(byId("topupCardHolder")?.value||"").trim().slice(0,80);
    payload.referralDiscountPercent=Math.max(0,Math.min(100,Number(byId("referralDiscountPercent")?.value||10)));
    payload.referralMaxDiscount=Math.max(0,Math.min(100000,Math.round(Number(byId("referralMaxDiscount")?.value||3000))));
    await setDoc(doc(db,"appSettings","pricing"),payload,{merge:true}); toast("تم حفظ التسعيرة والرسوم الثابتة وإعدادات الرصيد");
  }catch(error){console.error(error);toast("تعذر حفظ الإعدادات");}finally{busy(button,false);}
});

function openDashboard() {
  clearDashboardListeners();
  showView("dashboard");
  const usersUnsubscribe = onSnapshot(collection(db, "users"), snapshot => {
    state.users = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderMetrics();
    renderCancellations();
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
    renderCancellations();
  });
  const serviceRequestsUnsubscribe = onSnapshot(collection(db, "serviceRequests"), snapshot => {
    state.serviceRequests = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderMetrics();
    renderCancellations();
  });
  const driversUnsubscribe = onSnapshot(collection(db, "drivers"), snapshot => {
    state.drivers = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    state.drivers.forEach(item => repairLegacyCaptainService("drivers", item));
    renderDrivers();
    renderMetrics();
  });
  const ratingsUnsubscribe = onSnapshot(collection(db, "ratings"), snapshot => {
    state.ratings = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderDrivers();
    renderServiceApplications();
    renderRatings();
  });
  const topupsUnsubscribe = onSnapshot(collection(db,"topupRequests"), snapshot => {
    state.topupRequests = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderTopupRequests();
  });
  const pricingUnsubscribe = onSnapshot(doc(db,"appSettings","pricing"), snapshot => {
    state.pricingSettings = snapshot.exists()?snapshot.data():{};
    renderPricingSettings();
  });
  state.dashboardUnsubscribes.push(
    usersUnsubscribe,
    applicationsUnsubscribe,
    serviceApplicationsUnsubscribe,
    serviceProfilesUnsubscribe,
    restaurantsUnsubscribe,
    ordersUnsubscribe,
    serviceRequestsUnsubscribe,
    driversUnsubscribe,
    ratingsUnsubscribe,
    topupsUnsubscribe,
    pricingUnsubscribe
  );
}

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.user) return;
  const id = button.dataset.id;
  busy(button, true);
  try {
    if (button.dataset.action === "approve-topup") {
      await runTransaction(db, async transaction => {
        const requestRef=doc(db,"topupRequests",id);
        const requestSnap=await transaction.get(requestRef);
        if(!requestSnap.exists())throw new Error("TOPUP_NOT_FOUND");
        const request=requestSnap.data();
        if((request.status||"pending")!=="pending")throw new Error("TOPUP_ALREADY_REVIEWED");
        const amount=Math.round(Number(request.amount||0));
        if(!Number.isFinite(amount)||amount<=0)throw new Error("BAD_AMOUNT");
        const userRef=doc(db,"users",request.userId);
        const userSnap=await transaction.get(userRef);
        if(!userSnap.exists())throw new Error("USER_NOT_FOUND");
        const currentBalance=Number(userSnap.data().balance||0);
        transaction.update(userRef,{balance:currentBalance+amount,updatedAt:serverTimestamp()});
        transaction.update(requestRef,{status:"approved",creditedAmount:amount,reviewedBy:state.user.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      });
      toast("تم اعتماد الشحن وإضافة نفس المبلغ إلى الرصيد المشحون");
    } else if (button.dataset.action === "reject-topup") {
      const note=prompt("سبب الرفض:","تعذر مطابقة التحويل")?.trim(); if(!note)return;
      await updateDoc(doc(db,"topupRequests",id),{status:"rejected",reviewNote:note.slice(0,200),reviewedBy:state.user.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      toast("تم رفض طلب الشحن");
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
        active: false,
        publishFeePaid: Boolean(existingProfile?.publishFeePaid),
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
          active: false,
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
      const reason = prompt("اكتب سبب الإلغاء الإداري. السبب مطلوب وسيظهر في سجل الإلغاءات:", "")?.trim();
      if (!reason || reason.length < 3) { toast("يجب كتابة سبب واضح للإلغاء."); return; }
      const adminProfile = state.users.find(item => item.firestoreId === state.user?.uid) || {};
      await updateDoc(doc(db, "orders", id), {
        cancelled: true,
        cancellationReason: reason.slice(0,300),
        cancelledBy: "admin",
        cancelledByRole: "admin",
        cancelledByUserId: state.user?.uid || "",
        cancelledByName: adminProfile.name || state.user?.displayName || "إدارة كروة",
        cancelledByEmail: state.user?.email || adminProfile.email || "",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تم إلغاء الطلب وتسجيل السبب وهوية المدير");
    }
  } catch (error) {
    console.error(error);
    toast("تعذر تنفيذ العملية. تحقق من قواعد Firestore.");
  } finally {
    busy(button, false);
  }
});

onAuthStateChanged(auth, user => {
  if(user){registerAdminNativePushToken(user);window.setTimeout(()=>registerAdminNativePushToken(user),5000);}
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
