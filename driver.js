import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
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
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyASl5jV5mLaDh8CoeeofV7ftVJ3gaog64E",
  authDomain: "karwa0.firebaseapp.com",
  projectId: "karwa0",
  storageBucket: "karwa0.firebasestorage.app",
  messagingSenderId: "485451054622",
  appId: "1:485451054622:web:ce9b0e2ff2280870a8780f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const byId = id => document.getElementById(id);
const statuses = ["تم استلام الطلب", "الكابتن في الطريق", "بدأت الرحلة", "تم الوصول"];
const icons = { ride: "🚕", parcel: "📦", food: "🍽️" };

const state = {
  user: null,
  userData: null,
  driverData: null,
  orders: [],
  userUnsubscribe: null,
  viewUnsubscribes: []
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
  byId("applicationView").classList.toggle("hidden", name !== "application");
  byId("driverView").classList.toggle("hidden", name !== "driver");
  byId("logoutButton").classList.toggle("hidden", name === "auth");
}

function clearViewListeners() {
  state.viewUnsubscribes.forEach(unsubscribe => unsubscribe?.());
  state.viewUnsubscribes = [];
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
        <div class="order-meta"><span>${escapeHtml(order.id)}</span><span>${escapeHtml(order.payment || "نقدًا")}</span></div>
        <span class="order-price">${money(order.price)}</span>
      </div>
      ${action ? `<div class="order-actions">${action}</div>` : ""}
    </article>`;
}

function renderOrders() {
  const available = state.orders.filter(order =>
    !order.cancelled && Number(order.statusIndex || 0) < 3 && !order.driverId
  );
  const mine = state.orders.filter(order =>
    order.driverId === state.user?.uid && !order.cancelled && Number(order.statusIndex || 0) < 3
  );
  const completed = state.orders.filter(order =>
    order.driverId === state.user?.uid && Number(order.statusIndex || 0) >= 3
  );

  byId("availableCount").textContent = available.length;
  byId("activeCount").textContent = mine.length;
  byId("completedCount").textContent = completed.length;
  byId("availableOrders").innerHTML = available.length
    ? available.map(order => orderCard(order, "available")).join("")
    : `<div class="empty"><span>✓</span>لا توجد طلبات متاحة الآن.</div>`;
  byId("myOrders").innerHTML = mine.length
    ? mine.map(order => orderCard(order, "mine")).join("")
    : `<div class="empty"><span>🚕</span>لا توجد رحلة نشطة لديك.</div>`;
}

function openDriverDashboard() {
  clearViewListeners();
  showView("driver");
  byId("captainName").textContent = state.userData?.name || state.user?.displayName || "كروة";

  const driverUnsubscribe = onSnapshot(doc(db, "drivers", state.user.uid), snapshot => {
    state.driverData = snapshot.exists() ? snapshot.data() : {
      name: state.userData?.name || "كابتن كروة",
      phone: "",
      vehicleType: "غير محدد",
      plate: "غير محدد",
      online: false
    };
    byId("onlineSwitch").classList.toggle("on", state.driverData.online === true);
    byId("onlineLabel").textContent = state.driverData.online ? "متصل" : "غير متصل";
    byId("vehicleSummary").textContent = `${state.driverData.vehicleType || "مركبة"} • ${state.driverData.plate || "بدون لوحة"}`;
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
  state.viewUnsubscribes.push(driverUnsubscribe, ordersUnsubscribe);
}

byId("onlineSwitch").addEventListener("click", async () => {
  if (!state.user || !state.driverData) return;
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
    if (state.userData.role === "driver" || state.userData.role === "admin") openDriverDashboard();
    else openApplication();
  }, error => {
    console.error(error);
    toast("تعذر قراءة صلاحية الحساب");
  });
});
