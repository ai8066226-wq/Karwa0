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
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";
import { requireNativeRegistrationDevice, addDeviceRegistrationWrites, enforceDeviceSession } from "./device-binding.js?v=85";

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
const storage = getStorage(app);

const SERVICE_IMAGE_MAX_BYTES = 50 * 1024;
const SERVICE_IMAGE_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
let pendingCoverImageBlob = null;
let pendingCoverPreviewUrl = "";
let coverMarkedForRemoval = false;
let draftItemImageBlob = null;
let draftItemPreviewUrl = "";
const pendingItemImageBlobs = new Map();
const pendingItemPreviewUrls = new Map();
const mediaPathsPendingDelete = new Set();

function randomMediaId(prefix = "img") {
  const raw = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${String(raw).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 90);
}
function revokeObjectUrl(url) { if (url && String(url).startsWith("blob:")) try { URL.revokeObjectURL(url); } catch {} }
function imageSizeLabel(bytes) { return `${Math.max(1, Math.ceil(Number(bytes || 0) / 1024))} KB`; }
function currentCoverPreviewUrl() {
  if (coverMarkedForRemoval) return "";
  return pendingCoverPreviewUrl || String(currentProfile?.coverImageUrl || "");
}
function itemPreviewUrl(item = {}) { return pendingItemPreviewUrls.get(String(item.imageId || "")) || String(item.imageUrl || ""); }
function safeImageHtml(url, alt, className = "service-media-image") {
  const clean = String(url || "").trim();
  return clean ? `<img class="${className}" src="${escapeHtml(clean)}" alt="${escapeHtml(alt || "صورة")}" loading="lazy" decoding="async">` : "";
}

async function canvasWebpBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("WEBP_UNSUPPORTED")), "image/webp", quality));
}
async function loadImageSource(file) {
  if (globalThis.createImageBitmap) {
    try { const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() }; } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
async function compressServiceImage(file, { maxWidth = 960, maxHeight = 720 } = {}) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("IMAGE_REQUIRED");
  if (Number(file.size || 0) > SERVICE_IMAGE_SOURCE_MAX_BYTES) throw new Error("SOURCE_TOO_LARGE");
  const loaded = await loadImageSource(file);
  try {
    let scale = Math.min(1, maxWidth / loaded.width, maxHeight / loaded.height);
    let width = Math.max(96, Math.round(loaded.width * scale));
    let height = Math.max(96, Math.round(loaded.height * scale));
    let best = null;
    for (let pass = 0; pass < 8; pass++) {
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(loaded.source, 0, 0, width, height);
      for (const quality of [0.82, 0.72, 0.62, 0.52, 0.44, 0.36, 0.30]) {
        const blob = await canvasWebpBlob(canvas, quality);
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= SERVICE_IMAGE_MAX_BYTES) return blob;
      }
      width = Math.max(96, Math.round(width * 0.82));
      height = Math.max(96, Math.round(height * 0.82));
    }
    if (best?.size <= SERVICE_IMAGE_MAX_BYTES) return best;
    throw new Error("CANNOT_REACH_50KB");
  } finally { loaded.close?.(); }
}
async function uploadServiceMedia(blob, kind, id) {
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!blob || blob.size > SERVICE_IMAGE_MAX_BYTES || blob.type !== "image/webp") throw new Error("INVALID_MEDIA");
  const safeKind = kind === "cover" ? "cover" : "items";
  const path = `service-media/${currentUser.uid}/${safeKind}/${id}.webp`;
  const target = storageRef(storage, path);
  await uploadBytes(target, blob, { contentType: "image/webp", cacheControl: "public,max-age=31536000,immutable", customMetadata: { ownerId: currentUser.uid, kind: safeKind } });
  return { imageUrl: await getDownloadURL(target), imagePath: path, imageBytes: blob.size };
}
async function deleteServiceMediaPath(path) {
  const clean = String(path || "");
  if (!currentUser || !clean.startsWith(`service-media/${currentUser.uid}/`)) return;
  try { await deleteObject(storageRef(storage, clean)); } catch (error) { if (error?.code !== "storage/object-not-found") console.warn("تعذر حذف صورة الخدمة", clean, error); }
}
async function deleteQueuedServiceMedia(paths) { await Promise.all([...new Set(paths)].filter(Boolean).map(deleteServiceMediaPath)); }

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
function providerOperationFee(requestOrCategory){
  const category=typeof requestOrCategory==="string"?requestOrCategory:String(requestOrCategory?.providerCategory||requestOrCategory?.category||currentProfile?.category||"");
  const legacy=fixedFee("providerOrderFee",250);
  return category==="restaurant"?fixedFee("providerRestaurantFee",legacy):fixedFee("providerServiceFee",legacy);
}
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
  if(byId("serviceFeeSummary")){
    const publish=fixedFee("publishFee",1000).toLocaleString("ar-IQ");
    const restaurant=providerOperationFee("restaurant").toLocaleString("ar-IQ");
    const service=providerOperationFee("other").toLocaleString("ar-IQ");
    byId("serviceFeeSummary").textContent=`نشر ${publish} د.ع • مطعم ${restaurant} د.ع • خدمات ${service} د.ع`;
  }
  renderServiceTopupRequests();
}
function serviceHasPendingTopup(){return serviceTopupRequests.some(x=>(x.status||"pending")==="pending");}
function updateServiceTopupFormState(){
  const pending=serviceHasPendingTopup();
  [byId("serviceTopupAmount"),byId("serviceTopupReference"),byId("serviceTopupSubmit")].forEach(el=>{if(el)el.disabled=pending;});
  const submit=byId("serviceTopupSubmit");if(submit)submit.textContent=pending?"طلب الشحن قيد المراجعة":"إرسال طلب الشحن";
}
function renderServiceTopupRequests(){
  const box=byId("serviceTopupRequestsList");if(!box)return;
  if(!currentUser){box.innerHTML='<p class="muted">سجّل الدخول لعرض طلبات الشحن.</p>';updateServiceTopupFormState();return;}
  if(!serviceTopupRequests.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';updateServiceTopupFormState();return;}
  const labels={pending:"بانتظار المراجعة",approved:"تم الاعتماد",rejected:"مرفوض",cancelled:"ملغي"};
  box.innerHTML=serviceTopupRequests.map(x=>`<div class="unified-topup-row"><div><strong>${Number(x.amount||0).toLocaleString("ar-IQ")} د.ع</strong><small>${escapeHtml(x.transferReference||"بدون مرجع")}</small></div><span class="unified-topup-status ${escapeHtml(x.status||"pending")}">${labels[x.status]||escapeHtml(x.status||"pending")}</span></div>`).join("");
  updateServiceTopupFormState();
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

function requestProviderCancellationReason() {
  const value = prompt("اكتب سبب إلغاء الطلب. السبب مطلوب وسيظهر للإدارة والعميل:", "");
  if (value === null) return null;
  const reason = String(value || "").trim();
  if (reason.length < 3) { toast("يجب كتابة سبب واضح للإلغاء (3 أحرف على الأقل)."); return null; }
  return reason.slice(0, 300);
}

function providerCancellationMeta(reason) {
  return {
    cancellationReason: reason,
    cancelledBy: "serviceProvider",
    cancelledByRole: "serviceProvider",
    cancelledByUserId: currentUser?.uid || "",
    cancelledByName: currentUserData?.name || currentUser?.displayName || currentProfile?.ownerName || "مزود خدمة",
    cancelledByEmail: currentUser?.email || currentUserData?.email || "",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
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
      const deviceInfo = requireNativeRegistrationDevice();
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
        deviceBound: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      addDeviceRegistrationWrites(batch,db,credential.user.uid,"serviceApplicant",deviceInfo);
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
      const deviceMessage = error?.message === "DEVICE_NATIVE_REQUIRED" || error?.code === "device/native-required"
        ? "إنشاء حساب خدمة جديد متاح من تطبيق كروة على Android فقط حتى يتم ربط الحساب بهذا الهاتف."
        : (String(error?.code||"").includes("permission-denied") ? "هذا الهاتف مرتبط بالفعل بحساب كروة آخر، أو لم تُنشر قواعد Phase 81 الجديدة." : "");
      byId("authMessage").textContent = deviceMessage || authErrorMessage(error);
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

const itemUnitLabels = { item: "قطعة / طلب", meal: "وجبة", person: "نفر", kg: "كيلوغرام", pack: "عبوة / باكيت", liter: "لتر", meter: "متر", hour: "ساعة", day: "يوم" };
function providerRequestItems(request={}){
  if(Array.isArray(request.items)&&request.items.length)return request.items;
  return request.itemName?[{itemName:request.itemName,itemUnit:request.itemUnit||"item",quantity:Number(request.quantity||1),unitPrice:Number(request.unitPrice||request.itemPrice||0),subtotal:Number(request.subtotal||0)}]:[];
}
function providerItemsTitle(request={}){const items=providerRequestItems(request);return items.length<=1?(items[0]?.itemName||"طلب خدمة"):`${items[0].itemName} + ${items.length-1} أصناف`;}
function providerItemsHtml(request={}){return providerRequestItems(request).map(i=>`<div class="request-meta"><span><b>${escapeHtml(i.itemName||"صنف")}</b></span><span>${Number(i.quantity||1).toLocaleString("ar-IQ")} ${escapeHtml(itemUnitLabels[i.itemUnit]||itemUnitLabels.item)}</span><span>${money(i.unitPrice||0)}</span><span>${money(i.subtotal||0)}</span></div>`).join("");}

function normalizedProviderItem(item = {}) {
  const unit = itemUnitLabels[item.unit] ? item.unit : "item";
  return {
    name: String(item.name || "").slice(0, 80),
    price: Math.max(0, Math.round(Number(item.price || 0))),
    description: String(item.description || "").slice(0, 300),
    unit,
    deliveryAvailable: item.deliveryAvailable === true,
    deliveryFee: item.deliveryAvailable === true ? Math.max(0, Math.round(Number(item.deliveryFee || 0))) : 0,
    imageId: String(item.imageId || "").slice(0, 100),
    imageUrl: String(item.imageUrl || "").slice(0, 2200),
    imagePath: String(item.imagePath || "").slice(0, 500),
    imageBytes: Math.max(0, Math.round(Number(item.imageBytes || 0)))
  };
}

function renderProviderItems() {
  byId("pItemCount").textContent = `${providerItems.length} عنصر`;
  byId("itemsMetric").textContent = providerItems.length;
  byId("pItemList").innerHTML = providerItems.length
    ? providerItems.map((item, index) => `
        <div class="catalog-item catalog-item-rich">
          <div class="catalog-item-media">${safeImageHtml(itemPreviewUrl(item), item.name, "catalog-item-thumb") || `<span class="catalog-item-placeholder">📷</span>`}</div>
          <div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "بدون وصف")}</small><div class="catalog-item-tags"><span>السعر لكل ${escapeHtml(itemUnitLabels[item.unit] || itemUnitLabels.item)}</span><span>${item.deliveryAvailable ? `توصيل ${money(item.deliveryFee)}` : "استلام فقط"}</span>${item.imageBytes ? `<span>${imageSizeLabel(item.imageBytes)}</span>` : ""}</div></div>
          <span class="price">${money(item.price)}</span>
          <button class="button danger" type="button" data-remove-item="${index}">حذف</button>
        </div>`).join("")
    : `<div class="empty">لم تضف خدمات أو منتجات بعد.</div>`;
  byId("pItemList").querySelectorAll("[data-remove-item]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeItem);
      const item = providerItems[index];
      if (!item || !confirm(`حذف ${item.name} من القائمة؟`)) return;
      if (item.imagePath) mediaPathsPendingDelete.add(item.imagePath);
      if (item.imageId) {
        pendingItemImageBlobs.delete(item.imageId);
        const previewUrl = pendingItemPreviewUrls.get(item.imageId); revokeObjectUrl(previewUrl); pendingItemPreviewUrls.delete(item.imageId);
      }
      providerItems.splice(index, 1);
      renderProviderItems();
      toast("تم حذف العنصر من المسودة. احفظ التغييرات للتأكيد.");
    });
  });
  renderPreview();
}

byId("pCoverImage").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const status = byId("pCoverImageStatus"); status.textContent = "جاري تجهيز الصورة…";
  try {
    const blob = await compressServiceImage(file, { maxWidth: 1280, maxHeight: 800 });
    revokeObjectUrl(pendingCoverPreviewUrl); pendingCoverImageBlob = blob; pendingCoverPreviewUrl = URL.createObjectURL(blob); coverMarkedForRemoval = false;
    status.textContent = `جاهزة للرفع • WebP • ${imageSizeLabel(blob.size)} من 50 KB`;
    byId("pCoverImagePreview").innerHTML = safeImageHtml(pendingCoverPreviewUrl, "معاينة واجهة الخدمة", "draft-item-image");
    byId("pRemoveCoverImage").hidden = false; renderPreview();
  } catch (error) {
    console.error(error); event.target.value = ""; status.textContent = "تعذر تجهيز الصورة";
    toast(error?.message === "SOURCE_TOO_LARGE" ? "اختر صورة أصلية أصغر من 12 MB." : "تعذر ضغط الصورة إلى WebP أقل من 50 KB. اختر صورة أبسط أو أصغر.");
  }
});
byId("pRemoveCoverImage").addEventListener("click", () => {
  pendingCoverImageBlob = null; revokeObjectUrl(pendingCoverPreviewUrl); pendingCoverPreviewUrl = ""; coverMarkedForRemoval = true; byId("pCoverImage").value = "";
  byId("pCoverImageStatus").textContent = "سيتم حذف صورة الواجهة عند حفظ التغييرات."; byId("pCoverImagePreview").innerHTML = "🏪"; byId("pRemoveCoverImage").hidden = true; renderPreview();
});
byId("pItemImage").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const status = byId("pItemImageStatus"); status.textContent = "جاري تجهيز صورة العنصر…";
  try {
    const blob = await compressServiceImage(file, { maxWidth: 720, maxHeight: 720 });
    revokeObjectUrl(draftItemPreviewUrl); draftItemImageBlob = blob; draftItemPreviewUrl = URL.createObjectURL(blob);
    byId("pItemImagePreview").innerHTML = safeImageHtml(draftItemPreviewUrl, "معاينة صورة المنتج", "draft-item-image");
    status.textContent = `جاهزة • WebP • ${imageSizeLabel(blob.size)} من 50 KB`;
  } catch (error) {
    console.error(error); event.target.value = ""; draftItemImageBlob = null; revokeObjectUrl(draftItemPreviewUrl); draftItemPreviewUrl = ""; byId("pItemImagePreview").innerHTML = "📷";
    status.textContent = "تعذر تجهيز الصورة"; toast("تعذر ضغط الصورة إلى WebP أقل من 50 KB. اختر صورة أبسط أو أصغر.");
  }
});

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
    const imageId = draftItemImageBlob ? randomMediaId("item") : "";
    if (imageId) { pendingItemImageBlobs.set(imageId, draftItemImageBlob); pendingItemPreviewUrls.set(imageId, draftItemPreviewUrl); }
    providerItems.push(normalizedProviderItem({ name, price, description, unit, deliveryAvailable, deliveryFee, imageId, imageBytes: draftItemImageBlob?.size || 0 }));
    draftItemImageBlob = null; draftItemPreviewUrl = "";
    byId("pItemName").value = "";
    byId("pItemPrice").value = "";
    byId("pItemDescription").value = "";
    byId("pItemUnit").value = "item";
    byId("pDeliveryAvailable").checked = false;
    byId("pDeliveryFee").value = "0";
    byId("pDeliveryFee").disabled = true;
    byId("pItemImage").value = ""; byId("pItemImagePreview").innerHTML = "📷"; byId("pItemImageStatus").textContent = "اختياري • تُحوّل تلقائيًا إلى WebP ≤ 50 KB";
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
  const theme = window.KarwaServiceThemes?.resolve?.({ category, serviceType:currentApplication?.serviceType || "", description:byId("pDescription")?.value || currentProfile?.description || "", items:providerItems }) || { image:"./theme-parcel.webp?v=73", accent:"#087b75", icon:"🧰", key:"parcel" };
  const cover = byId("previewThemeCover");
  const customCover = currentCoverPreviewUrl();
  if (cover) {
    const visual = customCover || theme.image;
    cover.style.backgroundImage = `linear-gradient(180deg,rgba(3,15,24,.02),rgba(3,15,24,.2)),url("${String(visual).replace(/["\\]/g, "\\$&")}")`;
    cover.style.setProperty("--preview-theme-accent", theme.accent); cover.dataset.theme = customCover ? "custom" : theme.key;
  }
  const themeIcon = byId("previewThemeIcon"); if (themeIcon) themeIcon.textContent = theme.icon;
  byId("previewCategory").textContent = categoryLabel(category);
  byId("previewName").textContent = byId("pBusinessName").value.trim() || "اسم النشاط";
  byId("previewDescription").textContent = byId("pDescription").value.trim() || "وصف النشاط";
  byId("previewAddress").textContent = `${byId("pCity").value.trim()} • ${byId("pAddress").value.trim()}`.replace(/^ • | • $/g, "") || "العنوان";
  byId("previewPhone").textContent = byId("pPhone").value.trim() || "الهاتف";
  byId("previewItems").innerHTML = providerItems.slice(0, 4).map(item => `
    <div class="catalog-item catalog-item-rich"><div class="catalog-item-media">${safeImageHtml(itemPreviewUrl(item), item.name, "catalog-item-thumb") || `<span class="catalog-item-placeholder">📷</span>`}</div><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "")}</small><div class="catalog-item-tags"><span>لكل ${escapeHtml(itemUnitLabels[item.unit] || itemUnitLabels.item)}</span><span>${item.deliveryAvailable ? `توصيل ${money(item.deliveryFee)}` : "استلام"}</span></div></div><span class="price">${money(item.price)}</span></div>
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
  pendingCoverImageBlob = null; revokeObjectUrl(pendingCoverPreviewUrl); pendingCoverPreviewUrl = ""; coverMarkedForRemoval = false; mediaPathsPendingDelete.clear();
  pendingItemPreviewUrls.forEach(revokeObjectUrl); pendingItemPreviewUrls.clear(); pendingItemImageBlobs.clear();
  providerItems = Array.isArray(data.items) ? data.items.map(normalizedProviderItem) : [];
  byId("pCoverImage").value = ""; byId("pRemoveCoverImage").hidden = !data.coverImageUrl; byId("pCoverImagePreview").innerHTML = safeImageHtml(data.coverImageUrl, data.businessName || "واجهة الخدمة", "draft-item-image") || "🏪";
  byId("pCoverImageStatus").textContent = data.coverImageUrl ? `صورة واجهة محفوظة${data.coverImageBytes ? ` • ${imageSizeLabel(data.coverImageBytes)}` : ""}` : "اختياري • تُحوّل تلقائيًا إلى WebP ≤ 50 KB";
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
  cancelled: "ملغي"
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
          : status === "accepted"
            ? `<div class="request-actions">${deliveryStatus !== "awaitingCustomerChoice" ? `<button class="button primary" type="button" data-request-action="completed" data-request-id="${request.firestoreId}">تم إكمال الخدمة</button>` : ""}<button class="button danger" type="button" data-request-action="cancelled" data-request-id="${request.firestoreId}">إلغاء الطلب</button></div>`
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
          <div class="request-card-head"><div><small>${escapeHtml(request.providerName || "نشاطك")}</small><h3>${escapeHtml(providerItemsTitle(request))}</h3></div><span class="status ${status === "completed" || status === "accepted" ? "ok" : status === "rejected" || status === "cancelled" ? "bad" : ""}">${escapeHtml(requestStatusLabels[status] || status)}</span></div>
          <p>${escapeHtml(request.requestText || "بدون تفاصيل إضافية")}</p>
          <div class="request-meta"><span>العميل: ${escapeHtml(request.customerName || "عميل كروة")}</span><span>${providerRequestItems(request).length} ${providerRequestItems(request).length===1?"صنف":"أصناف"}</span><span>قيمة الحاجة: ${money(request.subtotal || request.itemPrice)}</span></div>${providerItemsHtml(request)}
          ${request.customerEditedAt ? `<div class="notice" style="margin-top:10px"><strong>✏️ عدّل العميل الطلب ${Number(request.customerEditCount || 1).toLocaleString("ar-IQ")} مرة</strong><span>هذه هي أحدث كمية وملاحظات معتمدة. يبقى التعديل متاحًا للعميل حتى استلام مندوب التوصيل.</span></div>` : ""}
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
  const cancellationReason = nextStatus === "cancelled" ? requestProviderCancellationReason() : "";
  if (nextStatus === "rejected" && !providerNote) return;
  if (nextStatus === "cancelled" && !cancellationReason) return;
  setBusy(button, true);
  try {
    if (nextStatus === "accepted") {
      const providerFee=providerOperationFee(request);
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
            customerName: request.customerName || "عميل كروة",
            providerId: currentUser.uid,
            serviceRequestId: request.firestoreId,
            type: "serviceDelivery",
            title: `توصيل ${providerItemsTitle(request)} من ${request.providerName}`,
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
    } else if (nextStatus === "cancelled") {
      const batch = writeBatch(db);
      const requestRef = doc(db, "serviceRequests", request.firestoreId);
      const cancelMeta = providerCancellationMeta(cancellationReason);
      batch.update(requestRef, { status:"cancelled", providerNote:cancellationReason, statusUpdatedAt:serverTimestamp(), ...cancelMeta });
      if (request.deliveryOrderId) {
        const deliveryRef = doc(db, "orders", request.deliveryOrderId);
        const deliverySnap = await getDoc(deliveryRef);
        if (deliverySnap.exists()) {
          const delivery = deliverySnap.data();
          if (!delivery.cancelled && Number(delivery.statusIndex || 0) >= 4) throw new Error("DELIVERY_COMPLETED");
          if (!delivery.cancelled) {
            batch.update(deliveryRef, { cancelled:true, assignmentStatus:"cancelled", ...cancelMeta });
          }
        }
      }
      await batch.commit();
      toast("تم إلغاء الطلب وتسجيل السبب للإدارة");
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
    toast(error?.message === "DELIVERY_COMPLETED" ? "لا يمكن إلغاء الطلب بعد اكتمال التوصيل." : "تعذر تحديث حالة الطلب.");
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
    coverImageUrl: restaurant?.coverImageUrl || "",
    coverImagePath: restaurant?.coverImagePath || "",
    coverImageBytes: Number(restaurant?.coverImageBytes || 0),
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
  const uploadedPaths = [];
  let saveCommitted = false;
  try {
    let coverImageUrl = coverMarkedForRemoval ? "" : String(currentProfile?.coverImageUrl || "");
    let coverImagePath = coverMarkedForRemoval ? "" : String(currentProfile?.coverImagePath || "");
    let coverImageBytes = coverMarkedForRemoval ? 0 : Math.max(0, Number(currentProfile?.coverImageBytes || 0));
    if (pendingCoverImageBlob) {
      const uploaded = await uploadServiceMedia(pendingCoverImageBlob, "cover", randomMediaId("cover")); uploadedPaths.push(uploaded.imagePath);
      coverImageUrl = uploaded.imageUrl; coverImagePath = uploaded.imagePath; coverImageBytes = uploaded.imageBytes;
    }
    const itemsForSave = [];
    for (const item of providerItems) {
      const clean = normalizedProviderItem(item); const blob = clean.imageId ? pendingItemImageBlobs.get(clean.imageId) : null;
      if (blob) { const uploaded = await uploadServiceMedia(blob, "items", clean.imageId); uploadedPaths.push(uploaded.imagePath); Object.assign(clean, uploaded); }
      itemsForSave.push(clean);
    }
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
      items: itemsForSave.map(item => ({ ...item })),
      coverImageUrl,
      coverImagePath,
      coverImageBytes,
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
        meals: itemsForSave.map(item => ({ ...item })),
        coverImageUrl,
        coverImagePath,
        coverImageBytes,
        active,
        approvalStatus: "approved",
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    if(publishWalletPatch)batch.set(doc(db,"users",currentUser.uid),publishWalletPatch,{merge:true});
    await batch.commit(); saveCommitted = true;
    const oldCoverPath = String(currentProfile?.coverImagePath || "");
    const deletionPaths = new Set(mediaPathsPendingDelete);
    if (oldCoverPath && oldCoverPath !== coverImagePath) deletionPaths.add(oldCoverPath);
    await deleteQueuedServiceMedia(deletionPaths);
    mediaPathsPendingDelete.clear(); pendingItemImageBlobs.clear(); pendingItemPreviewUrls.forEach(revokeObjectUrl); pendingItemPreviewUrls.clear();
    pendingCoverImageBlob = null; revokeObjectUrl(pendingCoverPreviewUrl); pendingCoverPreviewUrl = ""; coverMarkedForRemoval = false;
    providerItems = itemsForSave; byId("pCoverImage").value = ""; byId("pRemoveCoverImage").hidden = !coverImageUrl; byId("pCoverImagePreview").innerHTML = safeImageHtml(coverImageUrl, businessName, "draft-item-image") || "🏪";
    byId("pCoverImageStatus").textContent = coverImageUrl ? `صورة واجهة محفوظة${coverImageBytes ? ` • ${imageSizeLabel(coverImageBytes)}` : ""}` : "اختياري • تُحوّل تلقائيًا إلى WebP ≤ 50 KB";
    if(publishWalletPatch){currentUserData={...(currentUserData||{}),balance:publishWalletPatch.balance,bonusBalance:publishWalletPatch.bonusBalance};renderServiceWallet();}
    currentProfile = { ...currentProfile, businessName, category, phone, city, address, description, location: providerLocation, items: providerItems, coverImageUrl, coverImagePath, coverImageBytes, active, publishFeePaid:currentProfile?.publishFeePaid===true||chargePublish, publishFeeAmount:currentProfile?.publishFeePaid===true?Number(currentProfile.publishFeeAmount||publishFee):(chargePublish?publishFee:Number(currentProfile?.publishFeeAmount||0)) };
    byId("providerHeroName").textContent = businessName;
    renderProviderItems();
    toast("تم حفظ ملف الخدمة بنجاح");
  } catch (error) {
    console.error(error);
    if (!saveCommitted) await deleteQueuedServiceMedia(uploadedPaths);
    toast(error?.code === "storage/unauthorized" ? "تعذر رفع الصور: انشر قواعد Storage الجديدة أولًا." : "تعذر حفظ التغييرات أو رفع الصور. تحقق من الاتصال والقواعد.");
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
  if(serviceHasPendingTopup())return toast("لديك طلب شحن قيد المراجعة. لا يمكن إرسال طلب آخر حتى تعتمد الإدارة الطلب أو ترفضه.");
  const button=event.submitter||byId("serviceTopupSubmit");setBusy(button,true,"جاري الإرسال…");
  try{const requestRef=doc(collection(db,"topupRequests"));const batch=writeBatch(db);batch.set(requestRef,{userId:currentUser.uid,customerName:currentUserData?.name||currentUser.displayName||"مزود خدمة",email:currentUser.email||"",amount,transferReference:transferReference.slice(0,80),method:"mastercard_local",accountType:"service",accountRole:currentUserData?.role||"serviceProvider",status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.set(doc(db,"topupLocks",currentUser.uid),{userId:currentUser.uid,requestId:requestRef.id,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await batch.commit();serviceTopupRequests=[{firestoreId:requestRef.id,userId:currentUser.uid,amount,transferReference,status:"pending",createdAt:null},...serviceTopupRequests.filter(x=>x.firestoreId!==requestRef.id)];renderServiceTopupRequests();event.currentTarget.reset();toast("تم إرسال طلب الشحن مرة واحدة. انتظر قرار الإدارة قبل طلب جديد.");}catch(error){console.error(error);toast(error?.code==="permission-denied"?"يوجد طلب شحن قيد المراجعة بالفعل أو لم تُنشر قواعد Phase 79 بعد.":"تعذر إرسال طلب الشحن");}finally{setBusy(button,false);updateServiceTopupFormState();}
});

window.KarwaServiceMedia = {
  async deleteAllKnownForCurrentProfile() {
    const paths = [currentProfile?.coverImagePath, ...(Array.isArray(currentProfile?.items) ? currentProfile.items.map(item => item?.imagePath) : [])].filter(Boolean);
    await deleteQueuedServiceMedia(paths);
  }
};

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
    const deviceCheck = await enforceDeviceSession(db,user,currentUserData);
    if (!deviceCheck.ok) {
      const message=deviceCheck.message;
      await signOut(auth);
      window.setTimeout(()=>{setAuthMode("login");showView("authView");byId("authMessage").textContent=message;},40);
      return;
    }
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
