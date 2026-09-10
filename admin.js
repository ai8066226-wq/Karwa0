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
  serverTimestamp,
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

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الإدارة", error);
}

const byId = id => document.getElementById(id);
const statuses = ["تم استلام الطلب", "الكابتن في الطريق", "بدأت الرحلة", "تم الوصول"];
const icons = { ride: "🚕", parcel: "📦", food: "🍽️" };

const state = {
  user: null,
  users: [],
  applications: [],
  drivers: [],
  ratings: [],
  orders: [],
  roleUnsubscribe: null,
  dashboardUnsubscribes: []
};

const money = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";
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

function renderMetrics() {
  byId("usersCount").textContent = state.users.filter(user => !user.role || user.role === "customer").length;
  byId("driversCount").textContent = state.drivers.length;
  byId("blockedCount").textContent = state.drivers.filter(driver => driver.blocked === true).length;
  byId("pendingCount").textContent = state.applications.filter(item => item.status === "pending").length;
  byId("ordersCount").textContent = state.orders.length;
}

function ratingSummary(driverId) {
  const ratings = state.ratings.filter(item => item.driverId === driverId);
  const average = ratings.length
    ? ratings.reduce((total, item) => total + Number(item.score || 0), 0) / ratings.length
    : 0;
  return { count: ratings.length, average };
}

function driverCard(driver) {
  const rating = ratingSummary(driver.firestoreId);
  const blocked = driver.blocked === true;
  const status = blocked ? "محظور" : driver.online ? "متصل" : "غير متصل";
  const statusClass = blocked ? "rejected" : driver.online ? "approved" : "pending";
  const warningCount = Number(driver.warningCount || 0);
  const blockAction = blocked
    ? `<button class="secondary" data-action="unblock-driver" data-id="${driver.firestoreId}">إعادة التفعيل</button>`
    : `<button class="danger" data-action="block-driver" data-id="${driver.firestoreId}">حظر الكابتن</button>`;
  return `
    <article class="order-card driver-management-card">
      <div class="order-top">
        <h3>🚕 ${escapeHtml(driver.name || "كابتن كروة")}</h3>
        <span class="status-chip ${statusClass}">${status}</span>
      </div>
      <p class="order-route">${escapeHtml(driver.city || "-")} • ${escapeHtml(driver.vehicleType || "-")} • ${escapeHtml(driver.plate || "-")}</p>
      <div class="order-meta"><span>${escapeHtml(driver.phone || "بدون هاتف")}</span><span>${escapeHtml(driver.email || "")}</span></div>
      <div class="reputation-row">
        <span class="stars">★ ${rating.count ? rating.average.toFixed(1) : "جديد"}</span>
        <span>${rating.count} تقييم</span>
        <span class="warning-count">⚠ ${warningCount} تنبيه</span>
      </div>
      ${driver.warningMessage ? `<p class="admin-note">آخر تنبيه: ${escapeHtml(driver.warningMessage)}</p>` : ""}
      ${blocked && driver.blockReason ? `<p class="admin-note danger-note">سبب الحظر: ${escapeHtml(driver.blockReason)}</p>` : ""}
      <div class="order-actions">
        <button class="secondary" data-action="warn-driver" data-id="${driver.firestoreId}">إرسال تنبيه</button>
        ${blockAction}
      </div>
    </article>`;
}

function renderDrivers() {
  const sorted = [...state.drivers].sort((a, b) => {
    if (a.blocked === true && b.blocked !== true) return -1;
    if (b.blocked === true && a.blocked !== true) return 1;
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
  const actions = status === "pending" ? `
    <div class="order-actions">
      <button class="primary" data-action="approve" data-id="${application.firestoreId}">قبول وتفعيل</button>
      <button class="danger" data-action="reject" data-id="${application.firestoreId}">رفض</button>
    </div>` : "";
  return `
    <article class="order-card">
      <div class="order-top">
        <h3>🚘 ${escapeHtml(application.name)}</h3>
        <span class="status-chip ${status}">${labels[status] || escapeHtml(status)}</span>
      </div>
      <p class="order-route">${escapeHtml(application.city)} • ${escapeHtml(application.vehicleType)} • ${escapeHtml(application.plate)}</p>
      <div class="order-meta"><span>${escapeHtml(application.phone)}</span><span>${escapeHtml(application.email)}</span></div>
      ${actions}
    </article>`;
}

function renderApplications() {
  const sorted = [...state.applications].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return String(b.submittedAt?.seconds || "").localeCompare(String(a.submittedAt?.seconds || ""));
  });
  byId("applicationsList").innerHTML = sorted.length
    ? sorted.map(applicationCard).join("")
    : `<div class="empty"><span>🚘</span>لا توجد طلبات انضمام بعد.</div>`;
}

function orderCard(order) {
  const statusIndex = Number(order.statusIndex || 0);
  const status = order.cancelled ? "ملغي" : statuses[statusIndex] || "غير معروف";
  const statusClass = order.cancelled ? "cancelled" : statusIndex >= 3 ? "complete" : "active";
  const cancel = !order.cancelled && statusIndex < 3
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
      </div>
      ${cancel}
    </article>`;
}

function renderOrders() {
  const sorted = [...state.orders].sort((a, b) =>
    String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || ""))
  );
  byId("ordersList").innerHTML = sorted.length
    ? sorted.map(orderCard).join("")
    : `<div class="empty"><span>🧾</span>لا توجد طلبات حتى الآن.</div>`;
}

function openDashboard() {
  clearDashboardListeners();
  showView("dashboard");
  const usersUnsubscribe = onSnapshot(collection(db, "users"), snapshot => {
    state.users = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderMetrics();
  });
  const applicationsUnsubscribe = onSnapshot(collection(db, "driverApplications"), snapshot => {
    state.applications = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderApplications();
    renderMetrics();
  });
  const ordersUnsubscribe = onSnapshot(collection(db, "orders"), snapshot => {
    state.orders = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderOrders();
    renderMetrics();
  });
  const driversUnsubscribe = onSnapshot(collection(db, "drivers"), snapshot => {
    state.drivers = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderDrivers();
    renderMetrics();
  });
  const ratingsUnsubscribe = onSnapshot(collection(db, "ratings"), snapshot => {
    state.ratings = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderDrivers();
    renderRatings();
  });
  state.dashboardUnsubscribes.push(
    usersUnsubscribe,
    applicationsUnsubscribe,
    ordersUnsubscribe,
    driversUnsubscribe,
    ratingsUnsubscribe
  );
}

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.user) return;
  const id = button.dataset.id;
  busy(button, true);
  try {
    if (button.dataset.action === "approve") {
      const application = state.applications.find(item => item.firestoreId === id);
      if (!application) throw new Error("NOT_FOUND");
      const batch = writeBatch(db);
      batch.update(doc(db, "driverApplications", id), {
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
        userId: id,
        name: application.name,
        email: application.email,
        phone: application.phone,
        vehicleType: application.vehicleType,
        plate: application.plate,
        city: application.city,
        online: false,
        blocked: false,
        warningCount: 0,
        warningMessage: "",
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      toast("تم قبول الكابتن وتفعيل حسابه");
    } else if (button.dataset.action === "reject") {
      const note = prompt("سبب الرفض أو المطلوب تعديله:", "يرجى مراجعة بيانات المركبة")?.trim();
      if (!note) return;
      await updateDoc(doc(db, "driverApplications", id), {
        status: "rejected",
        reviewNote: note,
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
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
