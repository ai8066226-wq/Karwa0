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
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
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

const app = initializeApp(firebaseConfig, "karwa-services-portal-v4");
const auth = getAuth(app);
const db = getFirestore(app);

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة مزود الخدمة", error);
}

const byId = id => document.getElementById(id);
const views = ["loadingView", "authView", "applicationView", "providerView", "deniedView"];
const categories = {
  restaurant: "مطعم ومأكولات",
  grocery: "بقالة ومتجر غذائي",
  retail: "تسوق ومنتجات",
  maintenance: "صيانة وإصلاح",
  home: "خدمات منزلية",
  health: "صحة وعناية",
  other: "خدمة أخرى"
};

let currentUser = null;
let currentUserData = null;
let currentApplication = null;
let currentProfile = null;
let providerItems = [];
let providerLocation = null;
let authMode = new URLSearchParams(location.search).get("mode") === "register" ? "register" : "login";
let activeRole = "";
let roleUnsubscribe = null;
let contentUnsubscribe = null;

function showView(id) {
  views.forEach(view => byId(view)?.classList.toggle("hidden", view !== id));
}

function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.servicesToast);
  window.servicesToast = setTimeout(() => element.classList.remove("show"), 2800);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function money(value) {
  const amount = Number(value || 0);
  return amount > 0 ? amount.toLocaleString("ar-IQ") + " د.ع" : "حسب الاتفاق";
}

function setBusy(button, isBusy, busyLabel = "جاري التنفيذ…") {
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function validPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "هذا البريد مستخدم في حساب آخر.",
    "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة.",
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/missing-password": "أدخل كلمة المرور.",
    "auth/weak-password": "كلمة المرور يجب أن تكون ستة أحرف على الأقل.",
    "auth/too-many-requests": "محاولات كثيرة؛ حاول بعد قليل.",
    "auth/network-request-failed": "تعذر الاتصال بالإنترنت."
  };
  return messages[error?.code] || "تعذر إكمال العملية. حاول مرة أخرى.";
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  byId("loginMode").classList.toggle("active", !registering);
  byId("registerMode").classList.toggle("active", registering);
  byId("loginMode").setAttribute("aria-selected", String(!registering));
  byId("registerMode").setAttribute("aria-selected", String(registering));
  byId("authHeading").textContent = registering ? "أنشئ حساب خدمتك" : "مرحبًا بعودتك";
  byId("authLead").textContent = registering
    ? "عند إكمال التسجيل سيصل طلب اعتمادك إلى الإدارة تلقائيًا."
    : "سجّل الدخول لمتابعة طلبك أو إدارة خدمتك.";
  byId("authSubmit").textContent = registering ? "إنشاء الحساب وإرسال الطلب" : "تسجيل الدخول";
  byId("authPassword").autocomplete = registering ? "new-password" : "current-password";
  byId("authMessage").textContent = "";
  document.querySelectorAll(".registration-field").forEach(field => field.classList.toggle("hidden", !registering));
  ["registerName", "registerBusinessName", "registerCategory", "registerPhone", "registerCity", "registerAddress"].forEach(id => {
    byId(id).required = registering;
  });
}

byId("loginMode").addEventListener("click", () => setAuthMode("login"));
byId("registerMode").addEventListener("click", () => setAuthMode("register"));
byId("logoutBtn").addEventListener("click", () => signOut(auth));
byId("deniedLogout").addEventListener("click", () => signOut(auth));

function registrationData() {
  return {
    ownerName: byId("registerName").value.trim(),
    businessName: byId("registerBusinessName").value.trim(),
    category: byId("registerCategory").value,
    phone: byId("registerPhone").value.trim(),
    city: byId("registerCity").value,
    address: byId("registerAddress").value.trim(),
    description: byId("registerDescription").value.trim()
  };
}

function validateApplication(data) {
  if (data.ownerName.length < 2) return "اكتب اسم صاحب الخدمة بشكل صحيح.";
  if (data.businessName.length < 2) return "اكتب اسم النشاط بشكل صحيح.";
  if (!categories[data.category]) return "اختر تصنيف الخدمة.";
  if (!validPhone(data.phone)) return "اكتب رقم هاتف صحيحًا.";
  if (!data.city) return "اختر المدينة.";
  if (data.address.length < 3) return "اكتب عنوان النشاط بشكل أوضح.";
  return "";
}

byId("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = byId("authEmail").value.trim();
  const password = byId("authPassword").value;
  const submit = byId("authSubmit");
  byId("authMessage").textContent = "";

  if (authMode === "register") {
    const data = registrationData();
    const validationMessage = validateApplication(data);
    if (validationMessage) {
      byId("authMessage").textContent = validationMessage;
      return;
    }

    let credential = null;
    let profileSaved = false;
    setBusy(submit, true, "جاري إنشاء الحساب وإرسال الطلب…");
    try {
      credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: data.ownerName });
      const batch = writeBatch(db);
      batch.set(doc(db, "users", credential.user.uid), {
        name: data.ownerName,
        email,
        role: "serviceApplicant",
        balance: 0,
        notifications: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "serviceApplications", credential.user.uid), {
        userId: credential.user.uid,
        ownerName: data.ownerName,
        businessName: data.businessName,
        category: data.category,
        serviceType: "other",
        phone: data.phone,
        email,
        city: data.city,
        address: data.address,
        description: data.description,
        status: "pending",
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await batch.commit();
      profileSaved = true;
      toast("تم إنشاء الحساب وإرسال طلبك إلى الإدارة");
      history.replaceState(null, "", "./services.html");
    } catch (error) {
      console.error(error);
      if (credential?.user && !profileSaved) {
        try {
          await deleteUser(credential.user);
        } catch (rollbackError) {
          console.warn("تعذر التراجع عن الحساب غير المكتمل", rollbackError);
        }
      }
      byId("authMessage").textContent = authErrorMessage(error);
    } finally {
      setBusy(submit, false);
      setAuthMode(authMode);
    }
    return;
  }

  setBusy(submit, true, "جاري تسجيل الدخول…");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    history.replaceState(null, "", "./services.html");
  } catch (error) {
    console.error(error);
    byId("authMessage").textContent = authErrorMessage(error);
  } finally {
    setBusy(submit, false);
  }
});

function applicationSummary(data) {
  const values = [
    ["اسم النشاط", data.businessName || "—"],
    ["صاحب الخدمة", data.ownerName || currentUserData?.name || "—"],
    ["التصنيف", categories[data.category] || "خدمة أخرى"],
    ["الهاتف", data.phone || "—"],
    ["المدينة", data.city || "—"],
    ["العنوان", data.address || "—"]
  ];
  byId("applicationSummary").innerHTML = values.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join("");
}

function fillResubmitForm(data = {}) {
  byId("editOwnerName").value = data.ownerName || currentUserData?.name || currentUser?.displayName || "";
  byId("editBusinessName").value = data.businessName || "";
  byId("editCategory").value = categories[data.category] ? data.category : "restaurant";
  byId("editPhone").value = data.phone || "";
  byId("editCity").value = data.city || "الموصل";
  byId("editAddress").value = data.address || "";
  byId("editDescription").value = data.description || "";
}

function renderApplication(data) {
  currentApplication = data;
  const status = data?.status || "missing";
  const rejected = status === "rejected";
  const approved = status === "approved";
  const missing = status === "missing";

  byId("applicationStatus").className = "status";
  byId("applicationNotice").className = "notice";
  byId("resubmitForm").classList.toggle("hidden", !rejected && !missing);
  byId("stepReview").className = "timeline-step active";
  byId("stepReview").querySelector(".step-number").textContent = "2";
  byId("stepAccess").className = "timeline-step";

  if (rejected) {
    byId("applicationTitle").textContent = "طلبك يحتاج إلى تعديل";
    byId("applicationSubtitle").textContent = "راجع ملاحظة الإدارة، وعدّل البيانات، ثم أعد إرسال الطلب.";
    byId("applicationHeroStatus").textContent = "مطلوب تعديل";
    byId("applicationStatus").textContent = "يحتاج تعديلًا";
    byId("applicationStatus").classList.add("bad");
    byId("applicationNotice").textContent = data.reviewNote || "يرجى مراجعة البيانات وإعادة إرسال الطلب.";
    byId("applicationNotice").classList.add("bad");
    fillResubmitForm(data);
  } else if (approved) {
    byId("applicationTitle").textContent = "تمت الموافقة على طلبك";
    byId("applicationSubtitle").textContent = "جاري تجهيز لوحة مزود الخدمة وفتحها تلقائيًا.";
    byId("applicationHeroStatus").textContent = "تمت الموافقة ✓";
    byId("applicationStatus").textContent = "مقبول";
    byId("applicationStatus").classList.add("ok");
    byId("applicationNotice").textContent = "تم اعتماد الحساب. ستفتح لوحة الخدمة خلال لحظات.";
    byId("applicationNotice").classList.add("ok");
    byId("stepReview").className = "timeline-step done";
    byId("stepReview").querySelector(".step-number").textContent = "✓";
    byId("stepAccess").className = "timeline-step active";
  } else if (missing) {
    byId("applicationTitle").textContent = "أكمل طلب اعتماد خدمتك";
    byId("applicationSubtitle").textContent = "هذا حساب خدمة قديم؛ أكمل بيانات النشاط لإرسال الطلب إلى الإدارة.";
    byId("applicationHeroStatus").textContent = "طلب غير مكتمل";
    byId("applicationStatus").textContent = "غير مرسل";
    byId("applicationNotice").textContent = "أدخل بيانات النشاط أدناه، وسيصل الطلب إلى الإدارة فور الإرسال.";
    fillResubmitForm(data);
  } else {
    byId("applicationTitle").textContent = "طلبك قيد المراجعة";
    byId("applicationSubtitle").textContent = "وصل الطلب إلى الإدارة، وسنفتح لوحة الخدمة تلقائيًا بعد الموافقة.";
    byId("applicationHeroStatus").textContent = "قيد المراجعة";
    byId("applicationStatus").textContent = "قيد المراجعة";
    byId("applicationNotice").textContent = "تم استلام طلبك بنجاح. لا تحتاج إلى إعادة الإرسال؛ ستتحدث الحالة هنا تلقائيًا.";
  }
  applicationSummary(data || {});
}

async function openApplicant() {
  showView("applicationView");
  const applicationRef = doc(db, "serviceApplications", currentUser.uid);
  const snapshot = await getDoc(applicationRef);
  renderApplication(snapshot.exists() ? snapshot.data() : null);
  contentUnsubscribe?.();
  contentUnsubscribe = onSnapshot(applicationRef, applicationSnapshot => {
    renderApplication(applicationSnapshot.exists() ? applicationSnapshot.data() : null);
  }, error => {
    console.error(error);
    toast("تعذر تحديث حالة الطلب");
  });
}

byId("resubmitForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = {
    ownerName: byId("editOwnerName").value.trim(),
    businessName: byId("editBusinessName").value.trim(),
    category: byId("editCategory").value,
    phone: byId("editPhone").value.trim(),
    city: byId("editCity").value,
    address: byId("editAddress").value.trim(),
    description: byId("editDescription").value.trim()
  };
  const validationMessage = validateApplication(data);
  if (validationMessage) return toast(validationMessage);
  const button = byId("resubmitButton");
  setBusy(button, true, "جاري إرسال الطلب…");
  try {
    const payload = {
      userId: currentUser.uid,
      ...data,
      email: currentUser.email || currentUserData?.email || "",
      serviceType: "other",
      status: "pending",
      reviewNote: "",
      updatedAt: serverTimestamp()
    };
    if (currentApplication) payload.resubmittedAt = serverTimestamp();
    else payload.submittedAt = serverTimestamp();
    await setDoc(doc(db, "serviceApplications", currentUser.uid), payload, { merge: Boolean(currentApplication) });
    toast("تم إرسال الطلب إلى الإدارة");
  } catch (error) {
    console.error(error);
    toast("تعذر إرسال الطلب. تحقق من الاتصال وقواعد Firestore.");
  } finally {
    setBusy(button, false);
  }
});

function renderProviderItems() {
  byId("pItemCount").textContent = `${providerItems.length} عنصر`;
  byId("itemsMetric").textContent = providerItems.length;
  byId("pItemList").innerHTML = providerItems.length
    ? providerItems.map((item, index) => `
        <div class="catalog-item">
          <div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "بدون وصف")}</small></div>
          <span class="price">${money(item.price)}</span>
          <button class="button danger" type="button" data-remove-item="${index}">حذف</button>
        </div>`).join("")
    : `<div class="empty">لم تضف خدمات أو منتجات بعد.</div>`;
  byId("pItemList").querySelectorAll("[data-remove-item]").forEach(button => {
    button.addEventListener("click", () => {
      providerItems.splice(Number(button.dataset.removeItem), 1);
      renderProviderItems();
    });
  });
  renderPreview();
}

byId("pAddItem").addEventListener("click", () => {
  const name = byId("pItemName").value.trim();
  const price = Number(byId("pItemPrice").value || 0);
  const description = byId("pItemDescription").value.trim();
  if (name.length < 2 || !Number.isFinite(price) || price < 0) return toast("أدخل اسمًا وسعرًا صحيحين.");
  if (providerItems.length >= 50) return toast("الحد الأقصى 50 عنصرًا.");
  providerItems.push({ name, price: Math.round(price), description });
  byId("pItemName").value = "";
  byId("pItemPrice").value = "";
  byId("pItemDescription").value = "";
  renderProviderItems();
});

function renderPreview() {
  const category = currentProfile?.category || currentApplication?.category || "other";
  byId("previewCategory").textContent = categories[category] || categories.other;
  byId("previewName").textContent = byId("pBusinessName").value.trim() || "اسم النشاط";
  byId("previewDescription").textContent = byId("pDescription").value.trim() || "وصف النشاط";
  byId("previewAddress").textContent = `${byId("pCity").value.trim()} • ${byId("pAddress").value.trim()}`.replace(/^ • | • $/g, "") || "العنوان";
  byId("previewPhone").textContent = byId("pPhone").value.trim() || "الهاتف";
  byId("previewItems").innerHTML = providerItems.slice(0, 4).map(item => `
    <div class="catalog-item"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "")}</small></div><span class="price">${money(item.price)}</span></div>
  `).join("") || `<div class="empty">ستظهر عناصر خدمتك هنا.</div>`;
  byId("activeMetric").textContent = byId("pActive").checked ? "نشط" : "متوقف مؤقتًا";
}

function fillProviderForm(data) {
  const category = data.category || currentApplication?.category || "other";
  byId("providerHeroName").textContent = data.businessName || currentApplication?.businessName || currentUserData?.name || "شريك كروة";
  byId("pBusinessName").value = data.businessName || currentApplication?.businessName || "";
  byId("pCategory").value = categories[category] || categories.other;
  byId("pPhone").value = data.phone || currentApplication?.phone || "";
  byId("pCity").value = data.city || currentApplication?.city || "";
  byId("pAddress").value = data.address || currentApplication?.address || "";
  byId("pDescription").value = data.description || currentApplication?.description || "";
  byId("pActive").checked = data.active !== false;
  byId("categoryMetric").textContent = categories[category] || categories.other;
  providerLocation = data.location || null;
  providerItems = Array.isArray(data.items) ? data.items.map(item => ({ ...item })) : [];
  byId("pGpsStatus").textContent = providerLocation?.latitude != null && providerLocation?.longitude != null
    ? `محفوظ ✓ ${Number(providerLocation.latitude).toFixed(5)}, ${Number(providerLocation.longitude).toFixed(5)}`
    : "لم يتم تحديد الموقع";
  renderProviderItems();
}

async function openProvider() {
  showView("providerView");
  const [profileSnapshot, applicationSnapshot, restaurantSnapshot] = await Promise.all([
    getDoc(doc(db, "serviceProfiles", currentUser.uid)),
    getDoc(doc(db, "serviceApplications", currentUser.uid)),
    getDoc(doc(db, "restaurants", currentUser.uid))
  ]);
  currentApplication = applicationSnapshot.exists() ? applicationSnapshot.data() : null;
  const restaurant = restaurantSnapshot.exists() ? restaurantSnapshot.data() : null;
  currentProfile = profileSnapshot.exists() ? profileSnapshot.data() : {
    businessName: restaurant?.name || currentApplication?.businessName || "",
    category: currentApplication?.category || (restaurant ? "restaurant" : "other"),
    phone: restaurant?.phone || currentApplication?.phone || "",
    city: currentApplication?.city || "",
    address: restaurant?.address || currentApplication?.address || "",
    description: currentApplication?.description || "",
    location: restaurant?.location || null,
    items: restaurant?.meals || [],
    active: restaurant?.active !== false
  };
  fillProviderForm(currentProfile);

  contentUnsubscribe?.();
  contentUnsubscribe = onSnapshot(doc(db, "serviceProfiles", currentUser.uid), snapshot => {
    if (!snapshot.exists()) return;
    currentProfile = snapshot.data();
    byId("activeMetric").textContent = currentProfile.active === false ? "متوقف مؤقتًا" : "نشط";
  }, error => console.error(error));
}

byId("pGpsBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("تحديد الموقع غير مدعوم في هذا الجهاز.");
  const button = byId("pGpsBtn");
  setBusy(button, true, "جاري تحديد الموقع…");
  navigator.geolocation.getCurrentPosition(position => {
    providerLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    };
    byId("pGpsStatus").textContent = `تم التحديد ✓ ${providerLocation.latitude.toFixed(5)}, ${providerLocation.longitude.toFixed(5)}`;
    setBusy(button, false);
    toast("تم تحديث الموقع الجغرافي");
  }, error => {
    console.error(error);
    setBusy(button, false);
    toast("تعذر الوصول إلى الموقع. اسمح للمتصفح باستخدام GPS.");
  }, { enableHighAccuracy: true, timeout: 12000 });
});

["pBusinessName", "pPhone", "pCity", "pAddress", "pDescription", "pActive"].forEach(id => {
  byId(id).addEventListener("input", renderPreview);
});

byId("providerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const category = currentProfile?.category || currentApplication?.category || "other";
  const businessName = byId("pBusinessName").value.trim();
  const phone = byId("pPhone").value.trim();
  const city = byId("pCity").value.trim();
  const address = byId("pAddress").value.trim();
  const description = byId("pDescription").value.trim();
  const active = byId("pActive").checked;
  if (businessName.length < 2 || !validPhone(phone) || city.length < 2 || address.length < 3) return toast("أكمل بيانات النشاط بشكل صحيح.");
  if (category === "restaurant" && !providerLocation) return toast("حدد موقع المطعم قبل نشره للعملاء.");
  if (category === "restaurant" && !providerItems.length) return toast("أضف وجبة واحدة على الأقل للمطعم.");

  const button = byId("saveProviderButton");
  setBusy(button, true, "جاري حفظ التغييرات…");
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "serviceProfiles", currentUser.uid), {
      ownerId: currentUser.uid,
      businessName,
      category,
      phone,
      city,
      address,
      description,
      location: providerLocation,
      items: providerItems.map(item => ({ ...item })),
      active,
      approvalStatus: "approved",
      updatedAt: serverTimestamp()
    }, { merge: true });
    if (category === "restaurant") {
      batch.set(doc(db, "restaurants", currentUser.uid), {
        ownerId: currentUser.uid,
        name: businessName,
        phone,
        address,
        location: providerLocation,
        meals: providerItems.map(item => ({ ...item })),
        active,
        approvalStatus: "approved",
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    currentProfile = { ...currentProfile, businessName, category, phone, city, address, description, location: providerLocation, items: providerItems, active };
    byId("providerHeroName").textContent = businessName;
    renderPreview();
    toast("تم حفظ ملف الخدمة بنجاح");
  } catch (error) {
    console.error(error);
    toast("تعذر حفظ التغييرات. تحقق من الاتصال وقواعد Firestore.");
  } finally {
    setBusy(button, false);
  }
});

function clearRoleContent() {
  contentUnsubscribe?.();
  contentUnsubscribe = null;
}

onAuthStateChanged(auth, user => {
  currentUser = user;
  activeRole = "";
  roleUnsubscribe?.();
  roleUnsubscribe = null;
  clearRoleContent();
  byId("logoutBtn").classList.toggle("hidden", !user);

  if (!user) {
    currentUserData = null;
    byId("accountName").textContent = "";
    setAuthMode(authMode);
    showView("authView");
    return;
  }

  showView("loadingView");
  roleUnsubscribe = onSnapshot(doc(db, "users", user.uid), async snapshot => {
    if (!snapshot.exists()) {
      byId("deniedText").textContent = "ملف الحساب غير مكتمل. سجّل الخروج ثم أنشئ حساب خدمة جديدًا.";
      showView("deniedView");
      return;
    }
    currentUserData = snapshot.data();
    byId("accountName").textContent = currentUserData.name || user.displayName || user.email || "";
    const role = currentUserData.role;
    if (role === activeRole) return;
    activeRole = role;
    clearRoleContent();

    try {
      if (role === "serviceApplicant") await openApplicant();
      else if (role === "serviceProvider") await openProvider();
      else {
        byId("deniedText").textContent = role === "customer"
          ? "هذا حساب عميل. أنشئ حساب مزود خدمة مستقلًا للتقديم."
          : String(role || "").startsWith("driver")
            ? "هذا حساب كابتن. استخدم بوابة الكابتن لإدارة عملك."
            : "نوع الحساب الحالي لا يملك صلاحية فتح بوابة الخدمات.";
        showView("deniedView");
      }
    } catch (error) {
      console.error(error);
      toast("تعذر تحميل بيانات حساب الخدمة.");
      byId("deniedText").textContent = "تعذر قراءة ملف الخدمة. تحقق من نشر قواعد Firestore المرفقة.";
      showView("deniedView");
    }
  }, error => {
    console.error(error);
    byId("deniedText").textContent = "تعذر التحقق من صلاحية الحساب. تحقق من الاتصال وقواعد Firestore.";
    showView("deniedView");
  });
});
