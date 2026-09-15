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

const app = initializeApp(firebaseConfig, "karwa-services-portal-v4");
const auth = getAuth(app);
const db = getFirestore(app);

async function registerServiceNativePushToken(user){
  if(!user)return false;let token="";try{token=String(window.KarwaNative?.getPushToken?.()||window.KarwaNotify?.getNativePushToken?.()||"").trim()}catch{}if(!token)return false;
  const id=`android_${token.slice(-36).replace(/[^a-zA-Z0-9_-]/g,"_")}`;
  try{await setDoc(doc(db,"users",user.uid,"pushTokens",id),{token,platform:"android",app:"karwa",role:"service",updatedAt:serverTimestamp()},{merge:true});return true}catch(error){console.warn("تعذر تسجيل رمز إشعارات الخدمات",error);return false}
}
window.addEventListener("karwa-native-push-token",()=>{if(auth.currentUser)registerServiceNativePushToken(auth.currentUser)});

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
const categoryAliases = Object.fromEntries(Object.entries(categories).flatMap(([key,label]) => [[key,key],[label,key]]));
function normalizeCategory(value) { const clean=String(value||"").trim().replace(/\s+/g," "); return categoryAliases[clean] || clean; }
function categoryLabel(value) { return categories[value] || String(value || "مهنة غير محددة"); }

let currentUser = null;
let currentUserData = null;
let currentApplication = null;
let currentProfile = null;
let providerItems = [];
let providerRequests = [];
let providerLocation = null;
let registrationLocation = null;
let editApplicationLocation = null;
let authMode = new URLSearchParams(location.search).get("mode") === "register" ? "register" : "login";
let activeRole = "";
let roleUnsubscribe = null;
let contentUnsubscribe = null;
let requestsUnsubscribe = null;
let topupUnsubscribe = null;
let serviceTopupRequests = [];
const pickupOtpBackfillIds = new Set();
let pricingSettings = {};

function fixedFee(key,fallback){const n=Number(pricingSettings?.[key]);return Math.max(0,Math.min(100000,Math.round(Number.isFinite(n)?n:fallback)));}
function timestampMillis(value){if(!value)return 0;if(typeof value.toMillis==="function")return value.toMillis();if(Number.isFinite(Number(value?.seconds)))return Number(value.seconds)*1000;const t=new Date(value).getTime();return Number.isFinite(t)?t:0;}
function activeBonusAmount(data={}){const amount=Math.max(0,Number(data.bonusBalance||0));return amount>0&&timestampMillis(data.bonusExpiresAt)>Date.now()?amount:0;}
function walletAvailable(data=currentUserData||{}){return Math.max(0,Number(data?.balance||0))+activeBonusAmount(data||{});}
function walletDebitPatch(data,amount){const fee=Math.max(0,Math.round(Number(amount||0)));const paid=Math.max(0,Number(data?.balance||0));const bonus=activeBonusAmount(data||{});if(paid+bonus<fee)return null;const useBonus=Math.min(bonus,fee);return {balance:paid-(fee-useBonus),bonusBalance:Math.max(0,Number(data?.bonusBalance||0)-useBonus),updatedAt:serverTimestamp()};}
function signupBonusFields(settings=pricingSettings||{}){const enabled=settings.signupBonusEnabled!==false;const amount=enabled?Math.max(0,Math.round(Number(settings.signupBonusAmount??1000))):0;const hours=Math.max(1,Math.min(168,Math.round(Number(settings.signupBonusHours??24))));return {bonusBalance:amount,bonusExpiresAt:amount?new Date(Date.now()+hours*3600000):null,welcomeBonusGranted:amount>0,welcomeBonusEvaluated:true};}
function renderServiceWallet(){
  const value=`${walletAvailable().toLocaleString("ar-IQ")} د.ع`;
  if(byId("serviceWalletBalance"))byId("serviceWalletBalance").textContent=value;
  if(byId("serviceWalletMetric"))byId("serviceWalletMetric").textContent=value;
  const bonus=activeBonusAmount(currentUserData||{}),bonusStatus=byId("serviceBonusStatus");
  if(bonusStatus)bonusStatus.textContent=bonus>0?`مجاني ${bonus.toLocaleString("ar-IQ")} د.ع حتى ${new Date(timestampMillis(currentUserData?.bonusExpiresAt)).toLocaleString("ar-IQ")}`:"الرصيد المشحون";
  if(byId("serviceTopupTransferLabel"))byId("serviceTopupTransferLabel").textContent=pricingSettings.topupTransferLabel||"Mastercard محلي";
  if(byId("serviceTopupTransferId"))byId("serviceTopupTransferId").textContent=pricingSettings.topupTransferId||"أضف معرف التحويل من الإدارة";
  if(byId("serviceTopupCardHolder"))byId("serviceTopupCardHolder").textContent=pricingSettings.topupCardHolder||"إدارة كروة";
  if(byId("serviceFeeSummary"))byId("serviceFeeSummary").textContent=`رسم النشر ${fixedFee("publishFee",1000).toLocaleString("ar-IQ")} د.ع • رسم الطلب ${fixedFee("providerOrderFee",250).toLocaleString("ar-IQ")} د.ع`;
  renderServiceTopupRequests();
}
function renderServiceTopupRequests(){
  const box=byId("serviceTopupRequestsList");if(!box)return;
  if(!currentUser){box.innerHTML='<p class="muted">سجّل الدخول لعرض طلبات الشحن.</p>';return;}
  if(!serviceTopupRequests.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';return;}
  const labels={pending:"بانتظار المراجعة",approved:"تم الاعتماد",rejected:"مرفوض"};
  box.innerHTML=serviceTopupRequests.map(x=>`<div class="unified-topup-row"><div><strong>${Number(x.amount||0).toLocaleString("ar-IQ")} د.ع</strong><small>${escapeHtml(x.transferReference||"بدون مرجع")}</small></div><span class="unified-topup-status ${escapeHtml(x.status||"pending")}">${labels[x.status]||escapeHtml(x.status||"pending")}</span></div>`).join("");
}
function subscribeServiceTopups(user){
  topupUnsubscribe?.();
  topupUnsubscribe=onSnapshot(query(collection(db,"topupRequests"),where("userId","==",user.uid)),snapshot=>{serviceTopupRequests=snapshot.docs.map(d=>({...d.data(),firestoreId:d.id})).sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));renderServiceTopupRequests();},error=>console.warn("تعذر تحميل طلبات شحن مزود الخدمة",error));
}
function serviceCommissionRate(){return 0;}

onSnapshot(doc(db,"appSettings","pricing"),snapshot=>{pricingSettings=snapshot.exists()?snapshot.data():{};renderServiceWallet();},error=>console.warn("تعذر تحميل إعدادات التسعير والرسوم",error));

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

function locationLabel(value) {
  return value?.latitude != null && value?.longitude != null
    ? `${Number(value.latitude).toFixed(5)}, ${Number(value.longitude).toFixed(5)}`
    : "غير محدد";
}

async function getServicePrecisePosition(options = {}) {
  if (window.KarwaGeo?.getPrecisePosition) return window.KarwaGeo.getPrecisePosition({targetAccuracy:20,acceptableAccuracy:35,maxWait:18000,...options});
  if (!navigator.geolocation) throw Object.assign(new Error("GPS غير مدعوم"),{code:"UNSUPPORTED"});
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:18000,maximumAge:0}));
}

function handleServiceLocationError(error) {
  console.warn("service precise location",error);
  const code=String(error?.code||"");
  if(code==="PRECISE_PERMISSION_REQUIRED"||code==="PERMISSION_DENIED"||error?.code===1){toast("فعّل «الموقع الدقيق» لكروة");window.KarwaGeo?.promptPreciseSettings?.("موقع النشاط يحتاج دقة عالية حتى يصل العميل والكابتن للمكان الصحيح.");return;}
  if(code==="GPS_DISABLED"){toast("شغّل GPS ثم حاول مجددًا");try{window.KarwaNative?.openLocationSettings?.();}catch{}return;}
  if(code==="ACCURACY_TOO_LOW"){const a=Number(error?.bestAccuracy||0);toast(a?`دقة GPS الحالية ${Math.round(a)} م؛ انتقل لمكان مفتوح وحاول مجددًا`:"لم تصل إشارة GPS للدقة المطلوبة");return;}
  toast("تعذر تحديد الموقع بدقة. تحقق من GPS والصلاحيات.");
}

async function captureLocation(buttonId, statusId, target) {
  const button = byId(buttonId);
  setBusy(button, true, "جاري تثبيت GPS…");
  try {
    const position = await getServicePrecisePosition();
    const value = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
    if (target === "register") registrationLocation = value;
    else if (target === "edit") editApplicationLocation = value;
    else providerLocation = value;
    byId(statusId).textContent = `تم التحديد ✓ دقة ${Math.round(value.accuracy||0)} م • ${locationLabel(value)}`;
    toast("تم حفظ موقع النشاط بدقة عالية");
  } catch(error) {
    handleServiceLocationError(error);
  } finally {
    setBusy(button, false);
  }
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
byId("registerGpsButton").addEventListener("click", () => captureLocation("registerGpsButton", "registerGpsStatus", "register"));
byId("editGpsButton").addEventListener("click", () => captureLocation("editGpsButton", "editGpsStatus", "edit"));

function registrationData() {
  return {
    ownerName: byId("registerName").value.trim(),
    businessName: byId("registerBusinessName").value.trim(),
    category: normalizeCategory(byId("registerCategory").value),
    phone: byId("registerPhone").value.trim(),
    city: byId("registerCity").value,
    address: byId("registerAddress").value.trim(),
    description: byId("registerDescription").value.trim(),
    location: registrationLocation
  };
}

function validateApplication(data) {
  if (data.ownerName.length < 2) return "اكتب اسم صاحب الخدمة بشكل صحيح.";
  if (data.businessName.length < 2) return "اكتب اسم النشاط بشكل صحيح.";
  if (String(data.category || "").trim().length < 2) return "اكتب تصنيف المهنة بشكل واضح.";
  if (!validPhone(data.phone)) return "اكتب رقم هاتف صحيحًا.";
  if (!data.city) return "اختر المدينة.";
  if (data.address.length < 3) return "اكتب عنوان النشاط بشكل أوضح.";
  if (data.location?.latitude == null || data.location?.longitude == null) return "حدد موقع النشاط الجغرافي قبل إرسال الطلب.";
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
      const settingsSnapshot = await getDoc(doc(db, "appSettings", "pricing"));
      pricingSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
      credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: data.ownerName });
      const batch = writeBatch(db);
      const welcomeBonus=signupBonusFields();
      batch.set(doc(db, "users", credential.user.uid), {
        name: data.ownerName,
        email,
        role: "serviceApplicant",
        balance: 0,
        ...welcomeBonus,
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
        location: data.location,
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
    ["التصنيف", categoryLabel(data.category)],
    ["الهاتف", data.phone || "—"],
    ["المدينة", data.city || "—"],
    ["العنوان", data.address || "—"],
    ["موقع GPS", locationLabel(data.location)]
  ];
  byId("applicationSummary").innerHTML = values.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join("");
}

function fillResubmitForm(data = {}) {
  byId("editOwnerName").value = data.ownerName || currentUserData?.name || currentUser?.displayName || "";
  byId("editBusinessName").value = data.businessName || "";
  byId("editCategory").value = categoryLabel(data.category);
  byId("editPhone").value = data.phone || "";
  byId("editCity").value = data.city || "الموصل";
  byId("editAddress").value = data.address || "";
  byId("editDescription").value = data.description || "";
  editApplicationLocation = data.location || null;
  byId("editGpsStatus").textContent = editApplicationLocation
    ? `محفوظ ✓ ${locationLabel(editApplicationLocation)}`
    : "لم يتم تحديد الموقع بعد";
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
    category: normalizeCategory(byId("editCategory").value),
    phone: byId("editPhone").value.trim(),
    city: byId("editCity").value,
    address: byId("editAddress").value.trim(),
    description: byId("editDescription").value.trim(),
    location: editApplicationLocation
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

const itemUnitLabels = { item: "قطعة / طلب", kg: "كيلوغرام", person: "نفر" };

function normalizedProviderItem(item = {}) {
  const unit = itemUnitLabels[item.unit] ? item.unit : "item";
  return {
    name: String(item.name || "").slice(0, 80),
    price: Math.max(0, Math.round(Number(item.price || 0))),
    description: String(item.description || "").slice(0, 300),
    unit,
    deliveryAvailable: item.deliveryAvailable === true,
    deliveryFee: item.deliveryAvailable === true ? Math.max(0, Math.round(Number(item.deliveryFee || 0))) : 0
  };
}

function renderProviderItems() {
  byId("pItemCount").textContent = `${providerItems.length} عنصر`;
  byId("itemsMetric").textContent = providerItems.length;
  byId("pItemList").innerHTML = providerItems.length
    ? providerItems.map((item, index) => `
        <div class="catalog-item catalog-item-rich">
          <div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "بدون وصف")}</small><div class="catalog-item-tags"><span>السعر لكل ${escapeHtml(itemUnitLabels[item.unit] || itemUnitLabels.item)}</span><span>${item.deliveryAvailable ? `توصيل ${money(item.deliveryFee)}` : "استلام فقط"}</span></div></div>
          <span class="price">${money(item.price)}</span>
          <button class="button danger" type="button" data-remove-item="${index}">حذف</button>
        </div>`).join("")
    : `<div class="empty">لم تضف خدمات أو منتجات بعد.</div>`;
  byId("pItemList").querySelectorAll("[data-remove-item]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeItem);
      const item = providerItems[index];
      if (!item || !confirm(`حذف ${item.name} من القائمة؟`)) return;
      providerItems.splice(index, 1);
      renderProviderItems();
      toast("تم حذف العنصر من المسودة. احفظ التغييرات للتأكيد.");
    });
  });
  renderPreview();
}

byId("pDeliveryAvailable").addEventListener("change", event => {
  byId("pDeliveryFee").disabled = !event.target.checked;
  if (!event.target.checked) byId("pDeliveryFee").value = "0";
});

byId("pAddItem").addEventListener("click", event => {
  const name = byId("pItemName").value.trim();
  const price = Number(byId("pItemPrice").value || 0);
  const description = byId("pItemDescription").value.trim();
  const unit = byId("pItemUnit").value;
  const deliveryAvailable = byId("pDeliveryAvailable").checked;
  const deliveryFee = deliveryAvailable ? Number(byId("pDeliveryFee").value || 0) : 0;
  if (name.length < 2 || !Number.isFinite(price) || price <= 0) return toast("أدخل اسمًا وسعر وحدة أكبر من صفر.");
  if (!itemUnitLabels[unit]) return toast("اختر وحدة تسعير صحيحة.");
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) return toast("أدخل أجرة توصيل صحيحة.");
  if (providerItems.length >= 50) return toast("الحد الأقصى 50 عنصرًا.");

  const button = event.currentTarget;
  setBusy(button, true, "جارٍ الإضافة…");
  try {
    providerItems.push(normalizedProviderItem({ name, price, description, unit, deliveryAvailable, deliveryFee }));
    byId("pItemName").value = "";
    byId("pItemPrice").value = "";
    byId("pItemDescription").value = "";
    byId("pItemUnit").value = "item";
    byId("pDeliveryAvailable").checked = false;
    byId("pDeliveryFee").value = "0";
    byId("pDeliveryFee").disabled = true;
    renderProviderItems();
    toast("تمت إضافة العنصر. احفظ التغييرات لنشره للعملاء.");
  } catch (error) {
    console.error(error);
    toast("تعذر إضافة العنصر.");
  } finally {
    setBusy(button, false);
  }
});

function renderPreview() {
  const category = currentProfile?.category || currentApplication?.category || "other";
  byId("previewCategory").textContent = categoryLabel(category);
  byId("previewName").textContent = byId("pBusinessName").value.trim() || "اسم النشاط";
  byId("previewDescription").textContent = byId("pDescription").value.trim() || "وصف النشاط";
  byId("previewAddress").textContent = `${byId("pCity").value.trim()} • ${byId("pAddress").value.trim()}`.replace(/^ • | • $/g, "") || "العنوان";
  byId("previewPhone").textContent = byId("pPhone").value.trim() || "الهاتف";
  byId("previewItems").innerHTML = providerItems.slice(0, 4).map(item => `
    <div class="catalog-item catalog-item-rich"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "")}</small><div class="catalog-item-tags"><span>لكل ${escapeHtml(itemUnitLabels[item.unit] || itemUnitLabels.item)}</span><span>${item.deliveryAvailable ? `توصيل ${money(item.deliveryFee)}` : "استلام"}</span></div></div><span class="price">${money(item.price)}</span></div>
  `).join("") || `<div class="empty">ستظهر عناصر خدمتك هنا.</div>`;
  byId("activeMetric").textContent = byId("pActive").checked ? "نشط" : "متوقف مؤقتًا";
}

function fillProviderForm(data) {
  const category = data.category || currentApplication?.category || "other";
  byId("providerHeroName").textContent = data.businessName || currentApplication?.businessName || currentUserData?.name || "شريك كروة";
  byId("pBusinessName").value = data.businessName || currentApplication?.businessName || "";
  byId("pCategory").value = categoryLabel(category);
  byId("pPhone").value = data.phone || currentApplication?.phone || "";
  byId("pCity").value = data.city || currentApplication?.city || "";
  byId("pAddress").value = data.address || currentApplication?.address || "";
  byId("pDescription").value = data.description || currentApplication?.description || "";
  byId("pActive").checked = data.active !== false;
  byId("categoryMetric").textContent = categoryLabel(category);
  providerLocation = data.location || null;
  providerItems = Array.isArray(data.items) ? data.items.map(normalizedProviderItem) : [];
  byId("pGpsStatus").textContent = providerLocation?.latitude != null && providerLocation?.longitude != null
    ? `محفوظ ✓ ${Number(providerLocation.latitude).toFixed(5)}, ${Number(providerLocation.longitude).toFixed(5)}`
    : "لم يتم تحديد الموقع";
  renderProviderItems();
}

const requestStatusLabels = {
  pending: "طلب جديد",
  accepted: "تم القبول",
  completed: "مكتمل",
  rejected: "مرفوض",
  cancelled: "ألغاه العميل"
};

function renderProviderRequests(requests) {
  const pending = requests.filter(request => request.status === "pending").length;
  byId("requestsMetric").textContent = requests.length;
  const metricCard = byId("requestsMetricCard");
  const alertCount = byId("requestAlertCount");
  if (metricCard) metricCard.classList.toggle("has-alert", pending > 0);
  if (alertCount) {
    alertCount.textContent = pending > 99 ? "99+" : String(pending);
    alertCount.hidden = pending === 0;
  }
  byId("requestsStatus").textContent = pending ? `${pending} جديد` : "مباشر";
  byId("requestsStatus").className = pending ? "status" : "status ok";
  byId("providerRequestsList").innerHTML = requests.length
    ? requests.map(request => {
        const status = request.status || "pending";
        const deliveryAvailable = request.itemDeliveryAvailable === true || request.deliveryRequested === true || Number(request.itemDeliveryFee || request.deliveryFee || 0) > 0;
        const deliveryStatus = request.deliveryStatus || (request.deliveryRequested ? "awaitingCaptain" : "notRequested");
        const actions = status === "pending"
          ? `<div class="request-actions"><button class="button primary" type="button" data-request-action="accepted" data-request-id="${request.firestoreId}">موافقة على الحاجة</button><button class="button danger" type="button" data-request-action="rejected" data-request-id="${request.firestoreId}">رفض</button></div>`
          : status === "accepted" && deliveryStatus !== "awaitingCustomerChoice"
            ? `<div class="request-actions"><button class="button primary" type="button" data-request-action="completed" data-request-id="${request.firestoreId}">تم إكمال الخدمة</button></div>`
            : "";
        let deliveryText = "🏪 استلام من النشاط";
        if (status === "pending") deliveryText = request.providerCategory === "restaurant"
          ? (request.deliveryRequested ? `🚚 العميل اختار التوصيل • ${money(request.deliveryFee || 0)}` : "🏪 العميل اختار الاستلام من المطعم")
          : (deliveryAvailable ? `🚚 التوصيل متاح (${money(request.itemDeliveryFee || request.deliveryFee || 0)}) — بعد موافقتك يختار العميل التوصيل أو الاستلام` : "🏪 هذه الخدمة للاستلام من النشاط");
        else if (deliveryStatus === "awaitingCustomerChoice") deliveryText = "⏳ بانتظار اختيار العميل: توصيل أو استلام";
        else if (deliveryStatus === "awaitingCaptain") deliveryText = `🚚 تم إرسال التوصيل إلى كباتن التوصيل المطابقين ضمن 10 كم • ${money(request.deliveryFee)}`;
        else if (deliveryStatus === "notRequested") deliveryText = "🏪 اختار العميل الاستلام من النشاط";
        else if (deliveryStatus === "notAvailable") deliveryText = "🏪 التوصيل غير متاح لهذه الخدمة";
        const requestVisualStatus = ["accepted", "completed", "rejected", "cancelled"].includes(status) ? status : "pending";
        return `<article class="request-card request-${requestVisualStatus}">
          <div class="request-card-head"><div><small>${escapeHtml(request.providerName || "نشاطك")}</small><h3>${escapeHtml(request.itemName || "طلب خدمة")}</h3></div><span class="status ${status === "completed" || status === "accepted" ? "ok" : status === "rejected" || status === "cancelled" ? "bad" : ""}">${escapeHtml(requestStatusLabels[status] || status)}</span></div>
          <p>${escapeHtml(request.requestText || "بدون تفاصيل إضافية")}</p>
          <div class="request-meta"><span>العميل: ${escapeHtml(request.customerName || "عميل كروة")}</span><span>الكمية: ${Number(request.quantity || 1).toLocaleString("ar-IQ")} ${escapeHtml(itemUnitLabels[request.itemUnit] || itemUnitLabels.item)}</span><span>سعر الوحدة: ${money(request.unitPrice || request.itemPrice)}</span><span>قيمة الحاجة: ${money(request.subtotal || request.itemPrice)}</span></div>
          <div class="request-meta"><span>${deliveryText}</span></div>
          ${request.pickupOtp && request.deliveryRequested ? `<div class="notice" style="margin-top:10px"><strong>🔐 رمز استلام الكابتن: ${escapeHtml(request.pickupOtp)}</strong><span>أعطِ هذا الرمز للكابتن فقط بعد وصوله فعليًا واستلامه الطلب منك. لا يبدأ التوصيل للعميل بدونه.</span></div>` : ""}
          ${request.providerNote ? `<p class="notice bad" style="margin-top:10px">${escapeHtml(request.providerNote)}</p>` : ""}
          ${actions}
        </article>`;
      }).join("")
    : `<div class="empty">لا توجد طلبات عملاء حتى الآن.</div>`;
}

byId("providerRequestsList").addEventListener("click", async event => {
  const button = event.target.closest("[data-request-action]");
  if (!button || !currentUser) return;
  const nextStatus = button.dataset.requestAction;
  const request = providerRequests.find(item => item.firestoreId === button.dataset.requestId);
  if (!request) return toast("تعذر العثور على الطلب.");
  const providerNote = nextStatus === "rejected"
    ? prompt("اكتب سبب رفض الطلب للعميل:", "الخدمة غير متاحة حاليًا")?.trim()
    : "";
  if (nextStatus === "rejected" && !providerNote) return;
  setBusy(button, true);
  try {
    if (nextStatus === "accepted") {
      const providerFee=fixedFee("providerOrderFee",250);
      const walletPatch=walletDebitPatch(currentUserData||{},providerFee);
      if(providerFee>0&&!walletPatch){toast(`رصيدك غير كافٍ لقبول الطلب. يلزم ${providerFee.toLocaleString("ar-IQ")} د.ع رسم كروة. اشحن المحفظة أولًا.`);return;}
      if (request.providerCategory === "restaurant") {
        const batch = writeBatch(db);
        const requestRef = doc(db, "serviceRequests", request.firestoreId);
        const requestUpdate = {
          status: "accepted",
          providerNote: "",
          providerPlatformFee: providerFee,
          providerFeeCharged: true,
          deliveryStatus: request.deliveryRequested ? "awaitingCaptain" : "notRequested",
          deliveryOrderId: "",
          pickupOtp: request.deliveryRequested ? String(Math.floor(1000 + Math.random() * 9000)) : "",
          statusUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        if (request.deliveryRequested) {
          if (!request.providerLocation || !request.customerLocation) return toast("موقع المطعم والعميل مطلوبان لإرسال طلب التوصيل.");
          const orderRef = doc(collection(db, "orders"));
          requestUpdate.deliveryOrderId = orderRef.id;
          const deliveryFee = Math.max(0, Number(request.deliveryFee || 0));
          batch.set(orderRef, {
            id: "KW-D" + String(Date.now()).slice(-6),
            userId: request.customerId,
            providerId: currentUser.uid,
            serviceRequestId: request.firestoreId,
            type: "serviceDelivery",
            title: `توصيل ${request.itemName} من ${request.providerName}`,
            route: `${request.providerAddress} ← ${request.customerAddress}`,
            price: deliveryFee,
            serviceTotal: Number(request.totalPrice || 0),
            payment: "نقدًا",
            driverId: null, driverName: "", driverPhone: "", assignmentStatus: "available",
            pickupLocation: request.providerLocation, destinationLocation: request.customerLocation,
            serviceCity: request.providerCity || currentProfile?.city || "", requiredDriverService: "delivery",
            distanceKm: 0, durationMin: 0, routeSource: "serviceDelivery",
            commissionRate: 0, commissionAmount: 0, driverEarnings: deliveryFee,
            customerPlatformFee: 0, customerFeeCharged: true, captainPlatformFee: 0, captainFeeCharged: false,
            tripOtp: String(Math.floor(1000 + Math.random() * 9000)), paymentStatus: "pending",
            acceptedAt: null, arrivedAt: null, startedAt: null, completedAt: null, cancellationReason: "",
            statusIndex: 0, cancelled: false, createdAt: serverTimestamp(), createdAtISO: new Date().toISOString(), updatedAt: serverTimestamp()
          });
        }
        batch.update(requestRef, requestUpdate);
        if(walletPatch)batch.set(doc(db,"users",currentUser.uid),walletPatch,{merge:true});
        await batch.commit();
        if(walletPatch){currentUserData={...(currentUserData||{}),balance:walletPatch.balance,bonusBalance:walletPatch.bonusBalance};renderServiceWallet();}
        toast(request.deliveryRequested ? "تمت الموافقة وإرسال التوصيل لكباتن التوصيل المطابقين" : "تم قبول طلب الطعام للاستلام من المطعم");
      } else {
        const deliveryAvailable = request.itemDeliveryAvailable === true;
        const batch=writeBatch(db);
        batch.update(doc(db, "serviceRequests", request.firestoreId), {
          status: "accepted",
          providerNote: "",
          providerPlatformFee: providerFee,
          providerFeeCharged: true,
          deliveryStatus: deliveryAvailable ? "awaitingCustomerChoice" : "notRequested",
          deliveryOrderId: "",
          statusUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if(walletPatch)batch.set(doc(db,"users",currentUser.uid),walletPatch,{merge:true});
        await batch.commit();
        if(walletPatch){currentUserData={...(currentUserData||{}),balance:walletPatch.balance,bonusBalance:walletPatch.bonusBalance};renderServiceWallet();}
        toast(deliveryAvailable ? "تمت الموافقة. ينتظر النظام الآن اختيار العميل للتوصيل أو الاستلام." : "تم قبول الطلب للاستلام من النشاط");
      }
    } else {
      await updateDoc(doc(db, "serviceRequests", request.firestoreId), {
        status: nextStatus,
        providerNote: providerNote?.slice(0, 300) || "",
        statusUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast(nextStatus === "completed" ? "تم إكمال الطلب" : "تم رفض الطلب مع توضيح السبب");
    }
  } catch (error) {
    console.error(error);
    toast("تعذر تحديث حالة الطلب.");
  } finally {
    setBusy(button, false);
  }
});

async function openProvider() {
  showView("providerView");
  subscribeServiceTopups(currentUser);
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
    location: restaurant?.location || currentApplication?.location || null,
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

  requestsUnsubscribe?.();
  requestsUnsubscribe = onSnapshot(
    query(collection(db, "serviceRequests"), where("providerId", "==", currentUser.uid)),
    snapshot => {
      providerRequests = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }))
        .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
      renderProviderRequests(providerRequests);
      providerRequests.filter(request => request.status === "accepted" && request.deliveryStatus === "awaitingCaptain" && !request.pickupOtp && !pickupOtpBackfillIds.has(request.firestoreId)).forEach(request => {
        pickupOtpBackfillIds.add(request.firestoreId);
        updateDoc(doc(db, "serviceRequests", request.firestoreId), {
          pickupOtp: String(Math.floor(1000 + Math.random() * 9000)),
          updatedAt: serverTimestamp()
        }).catch(error => {
          console.error("pickup OTP backfill failed", error);
          pickupOtpBackfillIds.delete(request.firestoreId);
        });
      });
    },
    error => {
      console.error(error);
      byId("providerRequestsList").innerHTML = `<div class="empty">تعذر تحميل طلبات العملاء.</div>`;
    }
  );
}

byId("pGpsBtn").addEventListener("click", async () => {
  const button = byId("pGpsBtn");
  setBusy(button, true, "جاري تثبيت GPS…");
  try {
    const position=await getServicePrecisePosition();
    providerLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
    byId("pGpsStatus").textContent = `تم التحديد ✓ دقة ${Math.round(providerLocation.accuracy||0)} م • ${providerLocation.latitude.toFixed(5)}, ${providerLocation.longitude.toFixed(5)}`;
    toast("تم تحديث الموقع الجغرافي بدقة عالية");
  } catch(error) { handleServiceLocationError(error); }
  finally { setBusy(button, false); }
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
  if (!providerLocation) return toast("حدد موقع النشاط قبل نشره للعملاء.");
  if (category === "restaurant" && !providerItems.length) return toast("أضف وجبة واحدة على الأقل للمطعم.");

  const publishFee=fixedFee("publishFee",1000);
  const chargePublish=active&&currentProfile?.publishFeePaid!==true;
  const publishWalletPatch=chargePublish?walletDebitPatch(currentUserData||{},publishFee):null;
  if(chargePublish&&publishFee>0&&!publishWalletPatch)return toast(`يلزم ${publishFee.toLocaleString("ar-IQ")} د.ع لنشر النشاط لأول مرة. اشحن المحفظة ثم أعد المحاولة.`);
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
      publishFeePaid: currentProfile?.publishFeePaid===true || chargePublish,
      publishFeeAmount: currentProfile?.publishFeePaid===true ? Number(currentProfile.publishFeeAmount||publishFee) : (chargePublish?publishFee:Number(currentProfile?.publishFeeAmount||0)),
      ...(chargePublish?{publishFeePaidAt:serverTimestamp()}:{}),
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
    if(publishWalletPatch)batch.set(doc(db,"users",currentUser.uid),publishWalletPatch,{merge:true});
    await batch.commit();
    if(publishWalletPatch){currentUserData={...(currentUserData||{}),balance:publishWalletPatch.balance,bonusBalance:publishWalletPatch.bonusBalance};renderServiceWallet();}
    currentProfile = { ...currentProfile, businessName, category, phone, city, address, description, location: providerLocation, items: providerItems, active, publishFeePaid:currentProfile?.publishFeePaid===true||chargePublish, publishFeeAmount:currentProfile?.publishFeePaid===true?Number(currentProfile.publishFeeAmount||publishFee):(chargePublish?publishFee:Number(currentProfile?.publishFeeAmount||0)) };
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

byId("serviceTopupForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!currentUser)return;
  const amount=Math.round(Number(byId("serviceTopupAmount")?.value||0));
  const transferReference=byId("serviceTopupReference")?.value.trim()||"";
  if(!Number.isFinite(amount)||amount<1000||amount>1000000)return toast("أدخل مبلغًا بين 1,000 و1,000,000 د.ع");
  if(transferReference.length<3)return toast("اكتب مرجع التحويل");
  const button=event.submitter||byId("serviceTopupSubmit");setBusy(button,true,"جاري الإرسال…");
  try{const ref=doc(collection(db,"topupRequests"));await setDoc(ref,{userId:currentUser.uid,customerName:currentUserData?.name||currentUser.displayName||"مزود خدمة",email:currentUser.email||"",amount,transferReference:transferReference.slice(0,80),method:"mastercard_local",accountType:"service",accountRole:currentUserData?.role||"serviceProvider",status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});event.currentTarget.reset();toast("تم إرسال طلب الشحن إلى الإدارة");}catch(error){console.error(error);toast("تعذر إرسال طلب الشحن");}finally{setBusy(button,false);}
});

function clearRoleContent() {
  contentUnsubscribe?.();
  contentUnsubscribe = null;
  requestsUnsubscribe?.();
  requestsUnsubscribe = null;
  topupUnsubscribe?.();
  topupUnsubscribe = null;
  serviceTopupRequests = [];
  providerRequests = [];
}

onAuthStateChanged(auth, user => {
  if(user){registerServiceNativePushToken(user);window.setTimeout(()=>registerServiceNativePushToken(user),5000);}
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
    renderServiceWallet();
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

const karwaBonusExpiryRefresh=setInterval(()=>{if(currentUser)renderServiceWallet();},60000);
