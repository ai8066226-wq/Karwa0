import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  increment,
  arrayUnion,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { requireNativeRegistrationDevice, addDeviceRegistrationWrites, enforceDeviceSession } from "./device-binding.js?v=85";

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

async function registerDriverPushToken(user){
  if(!user)return false;let token="";try{token=String(window.KarwaNative?.getPushToken?.()||"").trim()}catch{}if(!token)return false;
  const id=`android_${token.slice(-36).replace(/[^a-zA-Z0-9_-]/g,"_")}`;
  try{await setDoc(doc(db,"users",user.uid,"pushTokens",id),{token,platform:"android",app:"karwa",role:"driver",updatedAt:serverTimestamp()},{merge:true});return true}catch(error){console.warn("تعذر تسجيل رمز إشعارات الكابتن",error);return false}
}
window.addEventListener("karwa-native-push-token",()=>{if(auth.currentUser)registerDriverPushToken(auth.currentUser)});
function driverNativePermissionGranted(){try{if(window.KarwaNative?.notificationPermissionGranted)return !!window.KarwaNative.notificationPermissionGranted()}catch{}return "Notification" in window&&Notification.permission==="granted"}
async function requestDriverDevicePermission(){try{if(window.KarwaNative?.requestNotificationPermission){window.KarwaNative.requestNotificationPermission();await new Promise(r=>setTimeout(r,650));return driverNativePermissionGranted()}}catch{}if("Notification" in window){try{return (await Notification.requestPermission())==="granted"}catch{}}return false}
window.addEventListener("karwa-native-push-received",event=>{const x=event.detail||{};addDriverNotification({id:`native:${x.tag||Date.now()}:${x.title||"karwa"}`,type:x.type==="wallet"?"wallet":x.type==="driver"||x.type==="order"?"order":"system",title:x.title||"كروة",message:x.body||"لديك تحديث جديد",target:x.route?.includes("driver")?"available":"",device:false})});


function firestoreErrorKey(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toUpperCase();
  const details = typeof error?.details === "string" ? error.details.toUpperCase() : String(error?.details?.message || error?.details?.code || "").toUpperCase();
  const haystack = `${message} ${details}`;
  const known = ["ORDER_TAKEN","DRIVER_NOT_AVAILABLE","DRIVER_ONLY","NOT_IN_DISPATCH_ROUND","ORDER_NOT_FOUND","NOT_ASSIGNED","INVALID_TRANSITION","OTP_INVALID"];
  return { code, named: known.find(key => haystack.includes(key)), raw: haystack };
}

function driverFirestoreMessage(error, action = "تنفيذ العملية") {
  const e = firestoreErrorKey(error);
  if (e.named === "ORDER_TAKEN" || e.code === "already-exists") return "سبق أن قبل كابتن آخر هذا الطلب.";
  if (e.named === "NOT_IN_DISPATCH_ROUND") return "هذا الطلب مخصص مؤقتًا لكباتن أقرب. انتظر انتهاء جولة التوزيع ثم حاول مجددًا.";
  if (e.named === "DRIVER_NOT_AVAILABLE") return "الخادم يعتبر حسابك غير متاح. فعّل الاتصال وتأكد أن حساب الكابتن مفعل وغير محظور.";
  if (e.named === "DRIVER_ONLY" || e.code === "permission-denied" && !e.named) return "صلاحية الحساب ليست كابتن أو لا تسمح بهذه العملية. راجع تفعيل الحساب من الإدارة.";
  if (e.named === "ORDER_NOT_FOUND" || e.code === "not-found" && !e.raw.includes("404")) return "الطلب لم يعد موجودًا أو تم حذفه.";
  if (e.named === "NOT_ASSIGNED") return "هذه الرحلة غير مسندة إلى حساب الكابتن الحالي.";
  if (e.named === "INVALID_TRANSITION") return "لا يمكن نقل الرحلة إلى الحالة التالية من حالتها الحالية.";
  if (e.named === "OTP_INVALID") return "رمز التحقق غير صحيح.";
  if (e.code === "unauthenticated") return "انتهت جلسة تسجيل الدخول. سجّل الدخول من جديد.";
  if (e.code === "not-found") return "تعذر العثور على بيانات الطلب أو حساب الكابتن.";
  if (e.code === "unavailable" || e.code === "deadline-exceeded" || e.raw.includes("NETWORK") || !navigator.onLine) return "تعذر الاتصال بخادم كروة. تحقق من الإنترنت ثم أعد المحاولة.";
  if (e.code === "internal" || e.code === "unknown") return `حدث خطأ أثناء ${action}. حاول مجددًا وتحقق من اتصال Firebase.`;
  return `تعذر ${action}. ${error?.message ? String(error.message).replace(/^FirebaseError:\s*/i, "") : "تحقق من إعدادات Firebase."}`;
}

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الكابتن", error);
}

const byId = id => document.getElementById(id);
const statuses = ["بانتظار كابتن", "الكابتن في الطريق", "وصلت إلى العميل", "بدأت الرحلة", "تم الوصول"];
function driverStatusLabel(order, index) {
  if (order?.type === "serviceDelivery") return ["بانتظار كابتن", "في الطريق إلى الاستلام", "وصلت إلى نقطة الاستلام", "في الطريق إلى العميل", "تم التسليم"][index] || statuses[index] || "قيد المتابعة";
  if (DELIVERY_ORDER_TYPES.has(order?.type)) return ["بانتظار كابتن", "في الطريق إلى الاستلام", "وصلت إلى نقطة الاستلام", "في الطريق إلى العميل", "تم التسليم"][index] || statuses[index] || "قيد المتابعة";
  return statuses[index] || "قيد المتابعة";
}
const icons = { ride: "🚕", parcel: "📦", food: "🍽️", serviceDelivery: "🛵" };
const DELIVERY_ORDER_TYPES = new Set(["parcel", "food", "serviceDelivery"]);
const DRIVER_REQUEST_RADIUS_KM = 10;

const scannedOtpCache=new Map();
let barcodeScannerStream=null, barcodeScannerFrame=0, barcodeScannerResolver=null, barcodeScannerBusy=false;
function normalizeScannedOtp(raw){const value=String(raw||"").trim();if(/^\d{4}$/.test(value))return value;const match=value.match(/(?:KARWA[:|\- ]*)?(\d{4})$/i);return match?match[1]:"";}
function stopBarcodeCamera(){if(barcodeScannerFrame){cancelAnimationFrame(barcodeScannerFrame);barcodeScannerFrame=0;}if(barcodeScannerStream){for(const track of barcodeScannerStream.getTracks())try{track.stop()}catch{}barcodeScannerStream=null;}const video=byId("barcodeScannerVideo");if(video)video.srcObject=null;barcodeScannerBusy=false;}
function finishBarcodeScan(value=null){stopBarcodeCamera();const modal=byId("barcodeScannerModal");if(modal){modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");}const resolve=barcodeScannerResolver;barcodeScannerResolver=null;if(resolve)resolve(value);}
async function detectBarcodeLoop(detector,video,status){if(!barcodeScannerResolver||barcodeScannerBusy)return;barcodeScannerBusy=true;try{if(video.readyState>=2){const found=await detector.detect(video);for(const item of found){const otp=normalizeScannedOtp(item.rawValue);if(otp){finishBarcodeScan(otp);return;}}}}catch(error){console.warn("تعذر تحليل الباركود",error)}finally{barcodeScannerBusy=false}if(barcodeScannerResolver)barcodeScannerFrame=requestAnimationFrame(()=>detectBarcodeLoop(detector,video,status));}
async function openCustomerBarcodeScanner(){
  const modal=byId("barcodeScannerModal"),video=byId("barcodeScannerVideo"),status=byId("barcodeScannerStatus"),manual=byId("barcodeManualInput");
  if(!modal||!video)return null; if(barcodeScannerResolver)finishBarcodeScan(null);
  modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");if(manual){manual.value="";}if(status)status.textContent="وجّه الكاميرا نحو الباركود الموجود تحت رمز العميل.";
  const result=new Promise(resolve=>{barcodeScannerResolver=resolve});
  if(!navigator.mediaDevices?.getUserMedia){if(status)status.textContent="الكاميرا غير متاحة هنا. يمكنك إدخال الرمز يدويًا.";return result;}
  try{barcodeScannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=barcodeScannerStream;await video.play();}
  catch(error){console.warn("تعذر فتح كاميرا الباركود",error);if(status)status.textContent="تعذر فتح الكاميرا. اسمح بصلاحية الكاميرا أو أدخل الرمز يدويًا.";return result;}
  if(!("BarcodeDetector" in window)){if(status)status.textContent="الكاميرا مفتوحة لكن ماسح الباركود غير مدعوم في هذا الإصدار. أدخل الرمز يدويًا.";return result;}
  try{let formats=["code_128","qr_code"];if(BarcodeDetector.getSupportedFormats){const supported=await BarcodeDetector.getSupportedFormats();formats=formats.filter(x=>supported.includes(x));}if(!formats.length)throw new Error("FORMAT_UNSUPPORTED");const detector=new BarcodeDetector({formats});if(status)status.textContent="ثبّت الباركود داخل الإطار وسيتم التقاطه تلقائيًا.";barcodeScannerFrame=requestAnimationFrame(()=>detectBarcodeLoop(detector,video,status));}
  catch(error){console.warn("ماسح الباركود غير متاح",error);if(status)status.textContent="تعذر تشغيل ماسح الباركود. يمكنك إدخال الرمز يدويًا.";}
  return result;
}
byId("barcodeScannerClose")?.addEventListener("click",()=>finishBarcodeScan(null));
byId("barcodeManualSubmit")?.addEventListener("click",()=>{const value=normalizeScannedOtp(byId("barcodeManualInput")?.value);if(!value)return toast("أدخل رمزًا صحيحًا من 4 أرقام");finishBarcodeScan(value)});
byId("barcodeManualInput")?.addEventListener("keydown",event=>{if(event.key==="Enter")byId("barcodeManualSubmit")?.click()});
window.addEventListener("pagehide",()=>finishBarcodeScan(null));
function orderNeedsCustomerBarcode(order,statusIndex=Number(order?.statusIndex||0)){if(order?.cancelled)return false;return order?.type==="ride"?statusIndex===2:DELIVERY_ORDER_TYPES.has(order?.type)&&statusIndex===3;}

function validDispatchPoint(point) {
  const lat = Number(point?.latitude);
  const lng = Number(point?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function currentDriverPoint() {
  if (!state.lastPosition) return null;
  const point = { latitude: Number(state.lastPosition.coords.latitude), longitude: Number(state.lastPosition.coords.longitude) };
  return validDispatchPoint(point) ? point : null;
}

function distanceKmBetween(a, b) {
  if (!validDispatchPoint(a) || !validDispatchPoint(b)) return Infinity;
  const R = 6371;
  const toRad = value => Number(value) * Math.PI / 180;
  const dLat = toRad(Number(b.latitude) - Number(a.latitude));
  const dLng = toRad(Number(b.longitude) - Number(a.longitude));
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(Number(a.latitude))) * Math.cos(toRad(Number(b.latitude))) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function orderWithinRequestRadius(order, point = currentDriverPoint()) {
  return distanceKmBetween(point, order?.pickupLocation) <= DRIVER_REQUEST_RADIUS_KM;
}

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

function orderMeetsDriverDispatchConditions(order, now = Date.now()) {
  if (!order || order.cancelled || Number(order.statusIndex || 0) >= 4 || order.driverId) return false;
  if (!canDriverHandleOrder(order)) return false;
  if (!orderWithinRequestRadius(order)) return false;
  if (order.type === "serviceDelivery" && order.serviceCity && String(order.serviceCity).trim() !== String(state.driverData?.city || "").trim()) return false;
  const expiresAt = order.dispatchExpiresAt?.seconds ? order.dispatchExpiresAt.seconds * 1000 : new Date(order.dispatchExpiresAt || 0).getTime();
  return !expiresAt || expiresAt <= now || !Array.isArray(order.dispatchCandidateIds) || !order.dispatchCandidateIds.length || order.dispatchCandidateIds.includes(state.user?.uid);
}
const DRIVER_MAP_STYLES = {
  day: "https://tiles.openfreemap.org/styles/bright",
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
  topupRequests: [],
  topupUnsubscribe: null,
  topupSnapshotReady: false,
  notifications: [],
  notificationsLoadedFor: null,
  deviceNotificationsEnabled: false,
  userUnsubscribe: null,
  viewUnsubscribes: [],
  locationWatchId: null,
  lastLocationWrite: 0,
  lastPosition: null,
  customerTrackingUnsubscribe: null,
  customerTrackingOrderId: null,
  customerTripPosition: null,
  driverAutoArrivalSince: 0,
  autoArrivalCompleting: false,
  map: null,
  baseLayer: null,
  mapTheme: readDriverPreference("karwa.driver.mapTheme", "day") === "night" ? "night" : "day",
  mapView: readDriverPreference("karwa.driver.mapView", "2d") === "3d" ? "3d" : "2d",
  autoFollow: readDriverPreference("karwa.driver.autoFollow", "true") !== "false",
  markerStyle: ["arrow","car","bike"].includes(readDriverPreference("karwa.driver.markerStyle", "car")) ? readDriverPreference("karwa.driver.markerStyle", "car") : "car",
  driverHeading: null,
  previousHeadingPoint: null,
  mapSearchMarker: null,
  mapSearchSelection: null,
  driverMarker: null,
  pickupMarker: null,
  destinationMarker: null,
  routeLine: null,
  routeCasingLine: null,
  lastRouteAt: 0,
  lastRoutePoint: null,
  routeNavigation: null,
  routeProgressIndex: 0,
  routeRequestToken: 0,
  routeRecalcQueued: false,
  offRouteHits: 0,
  routeRecalcInFlight: false,
  lastOffRouteRerouteAt: 0,
  navigationOrderId: null,
  navigationLegKey: "",
  navigationCompletedOrderId: null,
  navigationArrivalAnnouncedFor: null,
  announcedTurnKeys: new Set(),
  mapDrivingActive: false,
  restaurantGps: null,
  restaurantMeals: [],
  directRegistration: new URLSearchParams(window.location.search).get("mode") === "register"
};

let driverPricingSettings = {};
function driverFixedFee(key,fallback){const n=Number(driverPricingSettings?.[key]);return Math.max(0,Math.min(100000,Math.round(Number.isFinite(n)?n:fallback)));}
function driverOperationFee(orderOrType){
  const type=typeof orderOrType==="string"?orderOrType:String(orderOrType?.type||"");
  const legacy=driverFixedFee("captainOrderFee",250);
  return type==="ride"?driverFixedFee("captainTaxiFee",legacy):driverFixedFee("captainDeliveryFee",legacy);
}
function driverFeeSummary(){
  const serviceType=String(state.driverData?.serviceType||"");
  if(serviceType==="taxi")return `${driverOperationFee("ride").toLocaleString("ar-IQ")} د.ع (تكسي)`;
  if(serviceType==="delivery")return `${driverOperationFee("parcel").toLocaleString("ar-IQ")} د.ع (توصيل)`;
  return `تكسي ${driverOperationFee("ride").toLocaleString("ar-IQ")} • توصيل ${driverOperationFee("parcel").toLocaleString("ar-IQ")} د.ع`;
}
function driverTimestampMillis(value){if(!value)return 0;if(typeof value.toMillis==="function")return value.toMillis();if(Number.isFinite(Number(value?.seconds)))return Number(value.seconds)*1000;const t=new Date(value).getTime();return Number.isFinite(t)?t:0;}
function driverActiveBonus(data={}){const amount=Math.max(0,Number(data.bonusBalance||0));return amount>0&&driverTimestampMillis(data.bonusExpiresAt)>Date.now()?amount:0;}
function driverWalletAvailable(data=state.userData||{}){return Math.max(0,Number(data?.balance||0))+driverActiveBonus(data||{});}
function driverWalletDebitPatch(data,amount){const fee=Math.max(0,Math.round(Number(amount||0)));const paid=Math.max(0,Number(data?.balance||0));const bonus=driverActiveBonus(data||{});if(paid+bonus<fee)return null;const useBonus=Math.min(bonus,fee);return {balance:paid-(fee-useBonus),bonusBalance:Math.max(0,Number(data?.bonusBalance||0)-useBonus),updatedAt:serverTimestamp()};}
function driverSignupBonusFields(settings=driverPricingSettings||{}){const enabled=settings.signupBonusEnabled!==false;const amount=enabled?Math.max(0,Math.round(Number(settings.signupBonusAmount??1000))):0;const hours=Math.max(1,Math.min(168,Math.round(Number(settings.signupBonusHours??24))));return {bonusBalance:amount,bonusExpiresAt:amount?new Date(Date.now()+hours*3600000):null,welcomeBonusGranted:amount>0,welcomeBonusEvaluated:true};}
function renderDriverWallet(){
  if(byId("driverWalletBalance"))byId("driverWalletBalance").textContent=`${driverWalletAvailable().toLocaleString("ar-IQ")} د.ع`;
  const bonus=driverActiveBonus(state.userData||{});if(byId("driverBonusStatus"))byId("driverBonusStatus").textContent=bonus>0?`مجاني ${bonus.toLocaleString("ar-IQ")} د.ع حتى ${new Date(driverTimestampMillis(state.userData?.bonusExpiresAt)).toLocaleString("ar-IQ")}`:"الرصيد المشحون";
  if(byId("driverOrderFeeLabel"))byId("driverOrderFeeLabel").textContent=driverFeeSummary();
  if(byId("driverTopupTransferLabel"))byId("driverTopupTransferLabel").textContent=driverPricingSettings.topupTransferLabel||"Mastercard محلي";
  if(byId("driverTopupTransferId"))byId("driverTopupTransferId").textContent=driverPricingSettings.topupTransferId||"أضف معرف التحويل من الإدارة";
  if(byId("driverTopupCardHolder"))byId("driverTopupCardHolder").textContent=driverPricingSettings.topupCardHolder||"إدارة كروة";
  renderDriverTopupRequests();
}
function driverHasPendingTopup(){return state.topupRequests.some(x=>(x.status||"pending")==="pending");}
function updateDriverTopupFormState(){
  const pending=driverHasPendingTopup();
  [byId("driverTopupAmount"),byId("driverTopupReference"),byId("driverTopupSubmit")].forEach(el=>{if(el)el.disabled=pending;});
  const submit=byId("driverTopupSubmit");if(submit)submit.textContent=pending?"طلب الشحن قيد المراجعة":"إرسال طلب الشحن";
}
function renderDriverTopupRequests(){
  const box=byId("driverTopupRequestsList");if(!box)return;
  if(!state.user){box.innerHTML='<p class="muted">سجّل الدخول لعرض طلبات الشحن.</p>';updateDriverTopupFormState();return;}
  if(!state.topupRequests.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';updateDriverTopupFormState();return;}
  const labels={pending:"بانتظار المراجعة",approved:"تم الاعتماد",rejected:"مرفوض",cancelled:"ملغي"};
  box.innerHTML=state.topupRequests.map(x=>`<div class="unified-topup-row"><div><strong>${money(x.amount)}</strong><small>${escapeHtml(x.transferReference||"بدون مرجع")}</small></div><span class="unified-topup-status ${escapeHtml(x.status||"pending")}">${labels[x.status]||escapeHtml(x.status||"pending")}</span></div>`).join("");
  updateDriverTopupFormState();
}
function subscribeDriverTopups(user){
  state.topupUnsubscribe?.();
  state.topupSnapshotReady=false;
  state.topupUnsubscribe=onSnapshot(query(collection(db,"topupRequests"),where("userId","==",user.uid)),snapshot=>{
    const previous=new Map(state.topupRequests.map(item=>[item.firestoreId,item]));
    const incoming=snapshot.docs.map(d=>({...d.data(),firestoreId:d.id})).sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));
    if(state.topupSnapshotReady)incoming.forEach(item=>{
      const old=previous.get(item.firestoreId);
      if(!old||old.status===item.status||!["approved","rejected"].includes(item.status))return;
      const approved=item.status==="approved";
      addDriverNotification({id:`topup:${item.firestoreId}:${item.status}`,type:"wallet",title:approved?"تم اعتماد شحن الرصيد":"تم رفض طلب الشحن",message:approved?`أضيف ${money(item.amount)} إلى رصيدك.`:`طلب شحن بقيمة ${money(item.amount)} يحتاج إلى مراجعة التفاصيل.`,target:"wallet"});
    });
    state.topupRequests=incoming;
    state.topupSnapshotReady=true;
    renderDriverTopupRequests();
  },error=>console.warn("تعذر تحميل طلبات شحن الكابتن",error));
}
onSnapshot(doc(db,"appSettings","pricing"),snapshot=>{driverPricingSettings=snapshot.exists()?snapshot.data():{};renderDriverWallet();},error=>console.warn("تعذر تحميل إعدادات الرسوم",error));

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

function requestDriverCancellationReason() {
  const value = prompt("اكتب سبب إلغاء الطلب. السبب مطلوب وسيظهر للإدارة:", "");
  if (value === null) return null;
  const reason = String(value || "").trim();
  if (reason.length < 3) { toast("يجب كتابة سبب واضح للإلغاء (3 أحرف على الأقل)."); return null; }
  return reason.slice(0, 300);
}

function driverCancellationMeta(reason) {
  return {
    cancelled: true,
    cancellationReason: reason,
    cancelledBy: "driver",
    cancelledByRole: "driver",
    cancelledByUserId: state.user?.uid || "",
    cancelledByName: state.userData?.name || state.user?.displayName || state.driverData?.name || "كابتن كروة",
    cancelledByEmail: state.user?.email || "",
    cancelledAt: serverTimestamp(),
    assignmentStatus: "cancelled",
    updatedAt: serverTimestamp()
  };
}

const DRIVER_NOTIFICATION_TYPES = new Set(["order", "trip", "warning", "wallet", "system"]);
function driverNotificationStorageKey(){return `karwa.driver.notifications.${state.user?.uid||"guest"}`;}
function loadDriverNotifications(){
  const uid=state.user?.uid;if(!uid||state.notificationsLoadedFor===uid)return;
  state.notificationsLoadedFor=uid;
  try{
    const saved=JSON.parse(localStorage.getItem(driverNotificationStorageKey())||"[]");
    state.notifications=Array.isArray(saved)?saved.filter(item=>item&&item.id&&item.title).slice(0,50).map(item=>({id:String(item.id),type:DRIVER_NOTIFICATION_TYPES.has(item.type)?item.type:"system",title:String(item.title).slice(0,120),message:String(item.message||"").slice(0,320),target:String(item.target||""),createdAt:Number.isFinite(Number(item.createdAt))?Number(item.createdAt):Date.now(),read:item.read===true})):[];
  }catch(_){state.notifications=[];}
  renderDriverNotifications();
}
function saveDriverNotifications(){
  if(!state.user)return;
  try{localStorage.setItem(driverNotificationStorageKey(),JSON.stringify(state.notifications.slice(0,50)));}catch(_){}
}
function driverNotificationTime(value){
  const date=new Date(Number(value)||Date.now());
  return new Intl.DateTimeFormat("ar-IQ",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(date);
}
function renderDriverNotifications(){
  const list=byId("driverNotificationsList");if(!list)return;
  const unread=state.notifications.filter(item=>!item.read).length;
  const badge=byId("driverNotificationsBadge");
  const toggle=byId("driverNotificationsToggle");
  const summary=byId("driverNotificationsSummary");
  const markAll=byId("driverNotificationsMarkAll");
  if(badge){badge.textContent=unread>99?"99+":String(unread);badge.hidden=unread===0;}
  toggle?.classList.toggle("has-unread",unread>0);
  if(toggle)toggle.setAttribute("aria-label",unread?`إشعارات الكابتن، ${unread} غير مقروء`:"إشعارات الكابتن");
  if(summary)summary.textContent=unread?`${unread} إشعار غير مقروء`:state.notifications.length?`${state.notifications.length} إشعار محفوظ`:"لا توجد إشعارات جديدة";
  if(markAll)markAll.disabled=unread===0;
  if(!state.notifications.length){
    list.innerHTML='<div class="driver-notification-empty"><span aria-hidden="true">🔔</span><strong>لا توجد إشعارات</strong><small>ستظهر الطلبات الجديدة وتحديثات الرحلات وتنبيهات الإدارة هنا.</small></div>';
    return;
  }
  const icons={order:"🚕",trip:"↗",warning:"!",wallet:"💳",system:"✓"};
  list.innerHTML=state.notifications.map(item=>`<article class="driver-notification-item ${escapeHtml(item.type)} ${item.read?"":"unread"}" data-driver-notification-id="${escapeHtml(item.id)}" tabindex="0" role="button"><span class="driver-notification-icon" aria-hidden="true">${icons[item.type]||icons.system}</span><span class="driver-notification-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span><time datetime="${new Date(item.createdAt).toISOString()}">${escapeHtml(driverNotificationTime(item.createdAt))}</time></span><button type="button" class="driver-notification-delete" data-driver-notification-delete="${escapeHtml(item.id)}" aria-label="حذف الإشعار">🗑</button><i class="driver-notification-dot" aria-hidden="true"></i></article>`).join("");
}
function showDriverDeviceNotification(title,message){
  if(!state.deviceNotificationsEnabled)return;
  try{if(window.KarwaNative?.notify){window.KarwaNative.notify(String(title||"كروة"),String(message||"لديك تحديث جديد"),"driver","./driver.html");return}}catch(_){}
  if(!("Notification" in window)||Notification.permission!=="granted")return;
  try{const notification=new Notification(title,{body:message,icon:"./karwa-icon-192.png",badge:"./karwa-icon-192.png",tag:`karwa-driver-${Date.now()}`});notification.onclick=()=>{window.focus();notification.close();};}catch(_){}
  try{navigator.vibrate?.([220,100,220]);}catch(_){}
}
function addDriverNotification({id,type="system",title,message="",target="",device=true}){
  if(!state.user||!id||state.notifications.some(item=>item.id===String(id)))return false;
  state.notifications.unshift({id:String(id),type:DRIVER_NOTIFICATION_TYPES.has(type)?type:"system",title:String(title||"إشعار كروة").slice(0,120),message:String(message||"").slice(0,320),target:String(target||""),createdAt:Date.now(),read:false});
  state.notifications=state.notifications.slice(0,50);
  saveDriverNotifications();renderDriverNotifications();
  if(device)showDriverDeviceNotification(String(title||"كروة"),String(message||"لديك تحديث جديد"));
  return true;
}
function markDriverNotificationRead(id){
  const item=state.notifications.find(notification=>notification.id===id);if(!item||item.read)return item;
  item.read=true;saveDriverNotifications();renderDriverNotifications();return item;
}
function deleteDriverNotification(id){
  const before=state.notifications.length;state.notifications=state.notifications.filter(item=>item.id!==id);
  if(state.notifications.length!==before){saveDriverNotifications();renderDriverNotifications();return true;}return false;
}
function clearDriverNotifications(){state.notifications=[];saveDriverNotifications();renderDriverNotifications();try{window.KarwaNative?.clearNotifications?.()}catch{}}
function updateDriverNotificationSetting(){
  const control=byId("driverNotificationSetting");
  const message=byId("driverNotificationPermission");
  if(control){control.classList.toggle("on",state.deviceNotificationsEnabled);control.setAttribute("aria-checked",String(state.deviceNotificationsEnabled));}
  if(!message)return;
  message.className="driver-notification-permission";
  const native=!!window.KarwaNative;
  const granted=driverNativePermissionGranted();
  if(granted&&state.deviceNotificationsEnabled){message.textContent=native?"إشعارات Android مفعلة مع الصوت والاهتزاز.":"إشعارات الجهاز مفعلة أثناء فتح بوابة الكابتن.";message.classList.add("allowed");return;}
  if(!native&&"Notification" in window&&Notification.permission==="denied"){message.textContent="حظر المتصفح إشعارات الجهاز. يمكنك السماح بها من إعدادات الموقع، وسيبقى مركز اللوحة فعالًا.";message.classList.add("denied");return;}
  message.textContent="فعّل الإشعارات لتصلك الطلبات في النافذة المنسدلة مع الصوت والاهتزاز.";
}
function setDriverNotificationsOpen(open,restoreFocus=true){
  const view=byId("driverView"),panel=byId("driverNotificationsPanel"),toggle=byId("driverNotificationsToggle");if(!view||!panel||!toggle)return;
  if(open){setDriverSettingsOpen(false,false);view.querySelector(".driver-options-close")?.click();renderDriverNotifications();}
  view.classList.toggle("driver-notifications-open",open);toggle.setAttribute("aria-expanded",String(open));panel.setAttribute("aria-hidden",String(!open));panel.inert=!open;
  if(open)window.setTimeout(()=>byId("driverNotificationsClose")?.focus({preventScroll:true}),80);else if(restoreFocus)toggle.focus({preventScroll:true});
}

function normalizeHeading(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}
function circularHeadingLerp(from, to, amount = .28) {
  if (!Number.isFinite(from)) return normalizeHeading(to);
  const target = normalizeHeading(to); if (target === null) return normalizeHeading(from);
  const diff = ((target - from + 540) % 360) - 180;
  return normalizeHeading(from + diff * amount);
}
function bearingBetween(a,b){
  if(!a||!b)return null;
  const r=v=>v*Math.PI/180, y=Math.sin(r(b.longitude-a.longitude))*Math.cos(r(b.latitude));
  const x=Math.cos(r(a.latitude))*Math.sin(r(b.latitude))-Math.sin(r(a.latitude))*Math.cos(r(b.latitude))*Math.cos(r(b.longitude-a.longitude));
  return normalizeHeading(Math.atan2(y,x)*180/Math.PI);
}
function driverMarkerSvg(style="car") {
  // All shapes face north (top of SVG) at heading 0°, then rotate with GPS/bearing.
  if(style==="arrow") return `<svg viewBox="0 0 48 48" aria-hidden="true"><path class="marker-shadow" d="M24 3 39 40 24 33 9 40Z"/><path class="marker-fill" d="M24 5 36 36 24 30 12 36Z"/><path class="marker-accent" d="M24 9v20"/></svg>`;
  if(style==="bike") return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="marker-wheel" cx="24" cy="10" r="6"/><circle class="marker-wheel" cx="24" cy="38" r="6"/><path class="marker-stroke" d="M24 16v7m0 5v4M17 17h14M19 17l5 8 5-8M18 32h12M21 25h6"/><circle class="marker-accent-dot" cx="24" cy="25" r="4"/></svg>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path class="marker-shadow" d="M24 3c7 0 12 5 13 13l2 18c.5 6-3 10-9 10H18c-6 0-9.5-4-9-10l2-18C12 8 17 3 24 3Z"/><path class="marker-fill" d="M24 6c5.2 0 8.7 3.7 9.5 10l1.8 17.5c.3 3.9-1.6 6.5-5.8 6.5h-11c-4.2 0-6.1-2.6-5.8-6.5L14.5 16C15.3 9.7 18.8 6 24 6Z"/><path class="marker-stroke" d="M17 20h14M18 29h12"/><circle class="marker-light" cx="19" cy="11.5" r="2.2"/><circle class="marker-light" cx="29" cy="11.5" r="2.2"/><path class="marker-accent" d="M24 4v8"/></svg>`;
}
function liveDriverMarkerHtml(style=state.markerStyle){
  const safe=["arrow","car","bike"].includes(style)?style:"car";
  return `<div class="karwa-live-vehicle marker-${safe}" data-marker-style="${safe}">${driverMarkerSvg(safe)}</div>`;
}
function mapIcon(type, style = state.markerStyle) {
  if (!window.L) return null;
  if(type === "driver") return window.L.divIcon({className:"",html:liveDriverMarkerHtml(style),iconSize:[48,48],iconAnchor:[24,24]});
  return window.L.divIcon({
    className: "",
    html: `<div class="portal-map-marker ${type}"><span>${type === "pickup" ? "●" : "●"}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 36]
  });
}
function activeDrivingOrder(){return state.orders.find(order=>order.driverId===state.user?.uid&&!order.cancelled&&Number(order.statusIndex||0)<4)||null;}
function navigationLegForOrder(order){
  const status=Number(order?.statusIndex||0),toDestination=status>=3;
  return {status,toDestination,target:toDestination?order?.destinationLocation:order?.pickupLocation,legKey:`${order?.firestoreId||""}:${toDestination?"destination":"pickup"}`};
}
function clearDriverNavigationLine(){
  if(state.routeCasingLine&&state.map){try{state.map.removeLayer(state.routeCasingLine)}catch(_) {}}
  if(state.routeLine&&state.map){try{state.map.removeLayer(state.routeLine)}catch(_){}}
  state.routeCasingLine=null;
  state.routeLine=null;
}
function resetDriverNavigationUi(){
  byId("driverView")?.classList.remove("navigation-arrived");
  const alert=byId("offRouteAlert");if(alert)alert.classList.add("hidden");
  if(byId("driverNavTarget"))byId("driverNavTarget").textContent="—";
  if(byId("driverEta"))byId("driverEta").textContent="—";
  if(byId("driverRemaining"))byId("driverRemaining").textContent="—";
  if(byId("nextTurnIcon"))byId("nextTurnIcon").textContent="⬆️";
  if(byId("nextTurnText"))byId("nextTurnText").textContent="ابدأ القيادة وسيظهر التوجيه هنا";
}
function setDriverNavigationText(id,value){const element=byId(id);if(element)element.textContent=value;}
function showDriverNavigationArrival(order){
  const nav=state.routeNavigation;if(!nav||nav.orderId!==order?.firestoreId)return false;
  state.navigationCompletedOrderId=String(order.firestoreId);
  byId("driverView")?.classList.add("navigation-arrived");
  if(byId("driverNavTarget"))byId("driverNavTarget").textContent="تم الوصول";
  if(byId("driverEta"))byId("driverEta").textContent="وصلت";
  if(byId("driverRemaining"))byId("driverRemaining").textContent="0 م";
  if(byId("nextTurnIcon"))byId("nextTurnIcon").textContent="🏁";
  if(byId("nextTurnText"))byId("nextTurnText").textContent="لقد وصلت إلى الوجهة";
  const alert=byId("offRouteAlert");if(alert)alert.classList.add("hidden");
  if(state.navigationArrivalAnnouncedFor!==String(order.firestoreId)){
    state.navigationArrivalAnnouncedFor=String(order.firestoreId);
    speakDriverNavigation("لقد وصلت إلى الوجهة. تم إنهاء الرحلة.",0);
  }
  return true;
}
function resolveDriverHeading(position){
  const current={latitude:Number(position?.coords?.latitude),longitude:Number(position?.coords?.longitude)};
  let candidate=normalizeHeading(position?.coords?.heading);
  if(candidate===null&&state.previousHeadingPoint&&haversine(current,state.previousHeadingPoint)>.004) candidate=bearingBetween(state.previousHeadingPoint,current);
  if(candidate!==null) state.driverHeading=circularHeadingLerp(state.driverHeading,candidate,Number(position?.coords?.speed||0)>4?.4:.25);
  if(!state.previousHeadingPoint||haversine(current,state.previousHeadingPoint)>.003) state.previousHeadingPoint=current;
  return state.driverHeading;
}
function compassLabel(heading){
  if(!Number.isFinite(heading))return "—";
  const labels=["شمال","شمال شرق","شرق","جنوب شرق","جنوب","جنوب غرب","غرب","شمال غرب"];
  return labels[Math.round(normalizeHeading(heading)/45)%8];
}
function setDriverMarkerVisual(marker, heading, style=state.markerStyle){
  if(!marker)return;
  const safe=["arrow","car","bike"].includes(style)?style:"car";
  const el=marker.getElement()?.querySelector(".karwa-live-vehicle");
  if(!el)return;
  if(!el.classList.contains(`marker-${safe}`)){marker.setIcon(mapIcon("driver",safe));window.setTimeout(()=>setDriverMarkerVisual(marker,heading,safe),0);return;}
  const h=normalizeHeading(heading); if(h!==null)el.style.setProperty("--vehicle-heading",`${h}deg`);
}
function setDriverMarkerStyle(style){
  const safe=["arrow","car","bike"].includes(style)?style:"car";
  state.markerStyle=safe;writeDriverPreference("karwa.driver.markerStyle",safe);
  if(state.user) updateDoc(doc(db,"drivers",state.user.uid),{markerStyle:safe,updatedAt:serverTimestamp()}).catch(error=>console.warn("تعذر حفظ شكل مؤشر الكابتن",error));
  if(state.driverMarker){state.driverMarker.setIcon(mapIcon("driver",safe));setDriverMarkerVisual(state.driverMarker,state.driverHeading,safe);}
  applyDriverMapPreferences();sharePosition(state.lastPosition,true).catch(()=>{});
  toast(safe==="arrow"?"تم اختيار السهم لمؤشر القيادة":safe==="bike"?"تم اختيار الدراجة لمؤشر القيادة":"تم اختيار السيارة لمؤشر القيادة");
}
function applyDriverCamera(point, heading){
  if(!state.map)return;
  const driving=Boolean(activeDrivingOrder());
  const view=byId("driverView"),mapEl=byId("driverMap");
  if(state.mapDrivingActive!==driving){
    state.mapDrivingActive=driving;
    view?.classList.toggle("driving-navigation-active",driving);
    window.requestAnimationFrame(()=>{try{state.map?.invalidateSize({pan:false})}catch{}});
  }else view?.classList.toggle("driving-navigation-active",driving);
  const normalized=normalizeHeading(heading);
  if(mapEl)mapEl.style.setProperty("--driver-map-bearing",driving&&normalized!==null?`${-normalized}deg`:"0deg");
  if(!state.autoFollow)return;
  const zoom=driving?16.5:15;
  if(driving&&Number.isFinite(heading)){
    try{
      const p=state.map.project(window.L.latLng(point),zoom),size=state.map.getSize();
      const lead=Math.max(72,Math.min(138,size.y*.105)),rad=normalized*Math.PI/180;
      const ahead=window.L.point(p.x+Math.sin(rad)*lead,p.y-Math.cos(rad)*lead);
      state.map.setView(state.map.unproject(ahead,zoom),zoom,{animate:true,duration:.42,easeLinearity:.22});
    }catch(_){state.map.setView(point,zoom,{animate:true,duration:.4});}
  }else state.map.setView(point,zoom,{animate:true,duration:.4});
}
function updateDriverHeadingHud(heading,speed){
  const s=byId("driverSpeedText");
  if(s)s.textContent=Number.isFinite(Number(speed))?String(Math.max(0,Math.round(Number(speed)*3.6))):"0";
  const bubble=byId("driverSpeedBubble");
  if(bubble){const kmh=Number.isFinite(Number(speed))?Math.max(0,Math.round(Number(speed)*3.6)):0;bubble.setAttribute("aria-label",`سرعة الكابتن ${kmh} كيلومتر في الساعة`);}
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
  view.querySelectorAll("[data-driver-marker-style]").forEach(button => {
    const active = button.dataset.driverMarkerStyle === state.markerStyle;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (byId("driverMarkerStyleValue")) byId("driverMarkerStyleValue").textContent = state.markerStyle === "arrow" ? "سهم" : state.markerStyle === "bike" ? "دراجة" : "سيارة";
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
function turnIcon(m){const t=Number(m?.type??0);if([9,10,11,12,18,20,23].includes(t))return "↪️";if([13,14,15,16,19,21,24].includes(t))return "↩️";if([26,27].includes(t))return "🔄";if([7,8,17,22,25].includes(t))return "⬆️";return "⬆️";}
function isGuidanceManeuver(m){const t=Number(m?.type??0);return [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27].includes(t);}
function maneuverArabicPhrase(m){
  const t=Number(m?.type??0),street=String(m?.street_names?.[0]||m?.streetName||"").trim();
  let phrase="استمر إلى الأمام";
  if(t===9)phrase="اتجه قليلًا إلى اليمين";else if(t===10)phrase="انعطف يمينًا";else if(t===11)phrase="انعطف يمينًا بشكل حاد";
  else if(t===12)phrase="قم بدوران للخلف جهة اليمين";else if(t===13)phrase="قم بدوران للخلف جهة اليسار";
  else if(t===14)phrase="انعطف يسارًا بشكل حاد";else if(t===15)phrase="انعطف يسارًا";else if(t===16)phrase="اتجه قليلًا إلى اليسار";
  else if(t===17)phrase="استمر مباشرة على المسار";else if([18,20].includes(t))phrase="خذ المخرج جهة اليمين";else if([19,21].includes(t))phrase="خذ المخرج جهة اليسار";
  else if(t===22)phrase="ابقَ على المسار مباشرة";else if(t===23)phrase="ابقَ جهة اليمين";else if(t===24)phrase="ابقَ جهة اليسار";else if(t===25)phrase="اندمج مع الطريق";
  else if(t===26)phrase="ادخل الدوار";else if(t===27)phrase="اخرج من الدوار";
  return street&&![12,13,25,26,27].includes(t)?`${phrase} نحو ${street}`:phrase;
}
function maneuverPan(type){const t=Number(type||0);if([9,10,11,12,18,20,23].includes(t))return .78;if([13,14,15,16,19,21,24].includes(t))return -.78;return 0;}
function playDriverTurnCue(type){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    const ctx=playDriverTurnCue.ctx||(playDriverTurnCue.ctx=new AC());if(ctx.state==="suspended")ctx.resume().catch(()=>{});
    const pan=maneuverPan(type),panner=ctx.createStereoPanner?ctx.createStereoPanner():null;if(panner)panner.pan.value=pan;
    const gain=ctx.createGain();gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.025);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.32);
    const osc=ctx.createOscillator();osc.type="sine";osc.frequency.setValueAtTime(pan>0?880:pan<0?620:760,ctx.currentTime);osc.frequency.linearRampToValueAtTime(pan>0?1060:pan<0?520:900,ctx.currentTime+.28);
    if(panner){osc.connect(gain);gain.connect(panner);panner.connect(ctx.destination);}else{osc.connect(gain);gain.connect(ctx.destination);}osc.start();osc.stop(ctx.currentTime+.34);
  }catch(_){}
}
function speakDriverNavigation(text,type){
  if(!text)return;playDriverTurnCue(type);
  try{if(window.KarwaNative?.speakNavigation){const nativeSpoken=window.KarwaNative.speakNavigation(text);if(nativeSpoken!==false)return;}}catch(_){}
  try{if("speechSynthesis" in window){const u=new SpeechSynthesisUtterance(text);u.lang="ar-IQ";u.rate=1.03;u.pitch=1;u.volume=1;window.speechSynthesis.cancel();window.setTimeout(()=>window.speechSynthesis.speak(u),160);}}catch(_){}
}
function nearestRouteIndex(coords,point,from=0){
  if(!Array.isArray(coords)||!coords.length||!point)return 0;let best=Math.max(0,Math.min(coords.length-1,Number(from)||0)),bestKm=Infinity;
  const start=Math.max(0,best-10),end=Math.min(coords.length-1,best+180);for(let i=start;i<=end;i++){const c={latitude:Number(coords[i][0]),longitude:Number(coords[i][1])},d=haversine(point,c);if(d<bestKm){bestKm=d;best=i;}}
  if(bestKm>.18){for(let i=0;i<coords.length;i+=3){const c={latitude:Number(coords[i][0]),longitude:Number(coords[i][1])},d=haversine(point,c);if(d<bestKm){bestKm=d;best=i;}}}
  return best;
}
function pointSegmentDistanceMeters(point,a,b){
  const lat0=Number(point.latitude)*Math.PI/180,latScale=111320,lonScale=111320*Math.max(.2,Math.cos(lat0));
  const px=0,py=0;
  const ax=(Number(a[1])-Number(point.longitude))*lonScale,ay=(Number(a[0])-Number(point.latitude))*latScale;
  const bx=(Number(b[1])-Number(point.longitude))*lonScale,by=(Number(b[0])-Number(point.latitude))*latScale;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den>0?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;
  const x=ax+t*dx,y=ay+t*dy;return Math.hypot(x,y);
}
function routeDeviationInfo(coords,current,fromIndex=0){
  if(!Array.isArray(coords)||coords.length<2||!current)return {meters:Infinity,index:0};
  let best=Infinity,bestIndex=Math.max(0,Math.min(coords.length-2,Number(fromIndex)||0));
  const scan=(start,end)=>{for(let i=Math.max(0,start);i<Math.min(coords.length-1,end);i++){const d=pointSegmentDistanceMeters(current,coords[i],coords[i+1]);if(d<best){best=d;bestIndex=i;}}};
  scan(bestIndex-18,bestIndex+260);
  if(best>150)scan(0,coords.length-1);
  return {meters:best,index:bestIndex};
}
function evaluateRouteDeviation(current,accuracy=25){
  const active=activeDrivingOrder(),nav=state.routeNavigation;if(!active||!nav||nav.orderId!==active.firestoreId||!nav.coords?.length)return;
  const deviation=routeDeviationInfo(nav.coords,current,state.routeProgressIndex);
  const threshold=Math.max(55,Math.min(90,Number(accuracy||25)*1.7));
  if(deviation.meters<=threshold){state.offRouteHits=0;return;}
  state.offRouteHits+=1;
  const alert=byId("offRouteAlert");if(alert){alert.textContent=`خرجت عن المسار بنحو ${Math.round(deviation.meters)} م — جاري تجهيز طريق جديد من موقعك الحالي…`;alert.classList.remove("hidden");}
  if(state.offRouteHits<2||state.routeRecalcInFlight||Date.now()-state.lastOffRouteRerouteAt<3500)return;
  state.offRouteHits=0;state.lastOffRouteRerouteAt=Date.now();
  speakDriverNavigation("تم اكتشاف خروج عن المسار. جاري حساب طريق جديد من موقعك الحالي.",22);
  drawPickupRoute(true,"offroute").catch(error=>console.warn("تعذر إعادة حساب المسار بعد الانحراف",error));
}

function routeDistanceMeters(coords,fromIndex,toIndex,current){
  if(!coords?.length)return Infinity;const from=Math.max(0,Math.min(coords.length-1,fromIndex)),to=Math.max(from,Math.min(coords.length-1,toIndex));let km=0;
  if(current)km+=haversine(current,{latitude:Number(coords[from][0]),longitude:Number(coords[from][1])});
  for(let i=from;i<to;i++)km+=haversine({latitude:Number(coords[i][0]),longitude:Number(coords[i][1])},{latitude:Number(coords[i+1][0]),longitude:Number(coords[i+1][1])});
  return km*1000;
}
function maneuverKey(orderId,m,coords){const i=Math.max(0,Math.min((coords?.length||1)-1,Number(m?.begin_shape_index||0))),c=coords?.[i]||[0,0],instruction=String(m?.instruction||m?.street_names?.[0]||"").replace(/\s+/g," ").trim().slice(0,80);return `${orderId}|${Number(m?.type||0)}|${Number(c[0]).toFixed(4)},${Number(c[1]).toFixed(4)}|${instruction}`;}
function nextGuidanceManeuver(current){
  const nav=state.routeNavigation;if(!nav?.coords?.length||!nav?.maneuvers?.length)return null;
  const index=nearestRouteIndex(nav.coords,current,state.routeProgressIndex);state.routeProgressIndex=Math.max(state.routeProgressIndex,index);
  const maneuver=nav.maneuvers.find(m=>isGuidanceManeuver(m)&&Number(m.begin_shape_index||0)>state.routeProgressIndex);if(!maneuver)return null;
  const meters=routeDistanceMeters(nav.coords,state.routeProgressIndex,Number(maneuver.begin_shape_index||0),current);return {maneuver,meters};
}
function evaluateTurnAnnouncement(current){
  const active=activeDrivingOrder(),nav=state.routeNavigation;if(!active||!nav||nav.orderId!==active.firestoreId)return;
  const next=nextGuidanceManeuver(current);if(!next)return;
  const {maneuver,meters}=next,rounded=Math.max(10,Math.round(meters/10)*10);byId("nextTurnText")&&(byId("nextTurnText").textContent=`${rounded} م • ${maneuver.instruction||maneuverArabicPhrase(maneuver)}`);byId("nextTurnIcon")&&(byId("nextTurnIcon").textContent=turnIcon(maneuver));
  if(meters>112||meters<12)return;const key=maneuverKey(active.firestoreId,maneuver,nav.coords);if(state.announcedTurnKeys.has(key))return;
  state.announcedTurnKeys.add(key);if(state.announcedTurnKeys.size>80){const first=state.announcedTurnKeys.values().next().value;state.announcedTurnKeys.delete(first);}speakDriverNavigation(`بعد مئة متر، ${maneuverArabicPhrase(maneuver)}`,maneuver.type);
}
function osrmManeuverType(step){const mod=String(step?.maneuver?.modifier||"").toLowerCase(),type=String(step?.maneuver?.type||"").toLowerCase();if(type==="roundabout"||type==="rotary")return 26;if(type==="exit roundabout"||type==="exit rotary")return 27;if(type==="merge")return 25;if(mod==="sharp right")return 11;if(mod==="right")return 10;if(mod==="slight right")return 9;if(mod==="uturn")return 12;if(mod==="sharp left")return 14;if(mod==="left")return 15;if(mod==="slight left")return 16;if(mod==="straight")return 22;return 8;}
function osrmManeuvers(route,coords){const out=[];for(const leg of route?.legs||[])for(const step of leg.steps||[]){const loc=step?.maneuver?.location;if(!Array.isArray(loc)||loc.length<2)continue;const point={latitude:Number(loc[1]),longitude:Number(loc[0])};const idx=nearestRouteIndex(coords,point,0);const type=osrmManeuverType(step);out.push({type,begin_shape_index:idx,end_shape_index:idx,street_names:step.name?[String(step.name)]:[],instruction:maneuverArabicPhrase({type,street_names:step.name?[String(step.name)]:[]})});}return out;}

async function valhallaNavigate(a,b){const body={locations:[{lat:a.latitude,lon:a.longitude},{lat:Number(b.latitude),lon:Number(b.longitude)}],costing:"auto",units:"kilometers",language:"ar-IQ",directions_options:{units:"kilometers",language:"ar-IQ"},alternates:1};const r=await fetch("https://valhalla1.openstreetmap.de/route",{method:"POST",headers:{"Content-Type":"application/json","X-Client-Id":"karwa0.app"},body:JSON.stringify(body),signal:AbortSignal.timeout(5500)});if(!r.ok)throw new Error("VALHALLA");const x=await r.json(),leg=x.trip?.legs?.[0],sum=x.trip?.summary;if(!leg||!sum)throw 0;return{coords:decodeValhallaShape(leg.shape),km:Number(sum.length||0),mins:Number(sum.time||0)/60,maneuvers:leg.maneuvers||[]};}
function haversine(a,b){const R=6371,r=v=>v*Math.PI/180,dl=r(b.latitude-a.latitude),dn=r(b.longitude-a.longitude);const x=Math.sin(dl/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));}

const AUTO_ARRIVAL_RADIUS_M = 120;
const AUTO_ARRIVAL_PAIR_M = 180;
const AUTO_ARRIVAL_DWELL_MS = 8000;
const AUTO_ARRIVAL_MAX_ACCURACY_M = 45;

function activeDriverAutoArrivalRide(){
  return state.orders.find(order=>order.type==="ride"&&order.driverId===state.user?.uid&&!order.cancelled&&Number(order.statusIndex||0)===2&&order.destinationLocation)||null;
}
function autoArrivalDriverGeometryOk(order,customerPoint,driverPoint){
  if(!order?.destinationLocation||!customerPoint||!driverPoint)return false;
  const ca=Number(customerPoint.accuracy||9999),da=Number(driverPoint.accuracy||9999);
  if(ca>AUTO_ARRIVAL_MAX_ACCURACY_M||da>AUTO_ARRIVAL_MAX_ACCURACY_M)return false;
  const d={latitude:Number(driverPoint.latitude),longitude:Number(driverPoint.longitude)};
  const c={latitude:Number(customerPoint.latitude),longitude:Number(customerPoint.longitude)};
  return haversine(c,order.destinationLocation)*1000<=AUTO_ARRIVAL_RADIUS_M
    && haversine(d,order.destinationLocation)*1000<=AUTO_ARRIVAL_RADIUS_M
    && haversine(c,d)*1000<=AUTO_ARRIVAL_PAIR_M;
}
function stopDriverCustomerTracking(){
  try{state.customerTrackingUnsubscribe?.();}catch{}
  state.customerTrackingUnsubscribe=null;
  state.customerTrackingOrderId=null;
  state.customerTripPosition=null;
  state.driverAutoArrivalSince=0;
}
function syncDriverCustomerTracking(){
  const order=activeDriverAutoArrivalRide();
  const nextId=order?.firestoreId||null;
  if(state.customerTrackingOrderId===nextId)return;
  stopDriverCustomerTracking();
  if(!nextId)return;
  state.customerTrackingOrderId=nextId;
  state.customerTrackingUnsubscribe=onSnapshot(doc(db,"orders",nextId,"customerTracking","current"),snapshot=>{
    state.customerTripPosition=snapshot.exists()?snapshot.data():null;
    evaluateDriverAutoArrival();
  },error=>console.warn("تعذر قراءة موقع العميل للتحقق من الوصول",error));
}
async function autoCompleteTaxiFromDriver(order){
  if(state.autoArrivalCompleting||!state.user||!order?.firestoreId)return;
  state.autoArrivalCompleting=true;
  try{
    const orderRef=doc(db,"orders",order.firestoreId);
    const driverRef=doc(db,"drivers",state.user.uid);
    await runTransaction(db,async transaction=>{
      const driverTrackRef=doc(db,"orders",order.firestoreId,"tracking","current");
      const customerTrackRef=doc(db,"orders",order.firestoreId,"customerTracking","current");
      const [freshSnap,driverTrackSnap,customerTrackSnap,driverSnap]=await Promise.all([transaction.get(orderRef),transaction.get(driverTrackRef),transaction.get(customerTrackRef),transaction.get(driverRef)]);
      if(!freshSnap.exists()||!driverTrackSnap.exists()||!customerTrackSnap.exists())throw new Error("TRACKING_MISSING");
      const fresh=freshSnap.data(),status=Number(fresh.statusIndex||0);
      if(fresh.driverId!==state.user.uid||fresh.type!=="ride"||fresh.cancelled||status!==2)throw new Error("NOT_ELIGIBLE");
      if(fresh.customerFeeCharged!==true||fresh.captainFeeCharged!==true)throw new Error("FEES_PENDING");
      const dp=driverTrackSnap.data(),cp=customerTrackSnap.data(),now=Date.now();
      const dt=driverTimestampMillis(dp.updatedAt),ct=driverTimestampMillis(cp.updatedAt);
      if(!dt||!ct||now-dt>75000||now-ct>75000)throw new Error("TRACKING_STALE");
      if(!autoArrivalDriverGeometryOk(fresh,cp,dp))throw new Error("NOT_AT_DESTINATION");
      transaction.update(orderRef,{
        statusIndex:4,
        startedAt:fresh.startedAt||fresh.arrivedAt||serverTimestamp(),
        completedAt:serverTimestamp(),
        paymentStatus:"paid",
        autoCompletedByGPS:true,
        autoCompletionReason:"both_near_destination_without_otp",
        autoCompletedAt:serverTimestamp(),
        autoCompletionActor:state.user.uid,
        autoArrivalRadiusM:AUTO_ARRIVAL_RADIUS_M,
        otpBypassed:true,
        updatedAt:serverTimestamp()
      });
      if(driverSnap.exists()&&driverSnap.data().activeOrderId===order.firestoreId){
        transaction.update(driverRef,{activeOrderId:"",activeOrderCode:"",busySince:null,updatedAt:serverTimestamp()});
      }
    });
    state.navigationCompletedOrderId=String(order.firestoreId);
    window.setTimeout(()=>drawPickupRoute(true,"arrived"),0);
    toast("تم تأكيد وصولك أنت والعميل إلى الوجهة عبر GPS وإكمال الرحلة تلقائيًا.");
    addDriverNotification({id:`auto-arrival:${order.firestoreId}`,type:"trip",title:"تم إكمال الرحلة تلقائيًا",message:"تم تأكيد وصول الطرفين إلى الوجهة عبر GPS. رسوم كروة محتسبة مرة واحدة فقط.",target:""});
    state.driverAutoArrivalSince=0;
  }catch(error){
    const quiet=["TRACKING_MISSING","TRACKING_STALE","NOT_AT_DESTINATION","NOT_ELIGIBLE"].includes(error?.message);
    if(!quiet)console.warn("تعذر الإكمال التلقائي للرحلة",error);
  }finally{state.autoArrivalCompleting=false;}
}
function evaluateDriverAutoArrival(){
  const order=activeDriverAutoArrivalRide();
  const p=state.lastPosition?.coords?{latitude:Number(state.lastPosition.coords.latitude),longitude:Number(state.lastPosition.coords.longitude),accuracy:Number(state.lastPosition.coords.accuracy||9999)}:null;
  const customer=state.customerTripPosition;
  if(!order||!autoArrivalDriverGeometryOk(order,customer,p)){state.driverAutoArrivalSince=0;return;}
  if(!state.driverAutoArrivalSince){state.driverAutoArrivalSince=Date.now();return;}
  if(Date.now()-state.driverAutoArrivalSince>=AUTO_ARRIVAL_DWELL_MS)autoCompleteTaxiFromDriver(order);
}
async function releaseDriverLockForCompletedOrder(){
  const activeId=String(state.driverData?.activeOrderId||"");
  if(!activeId||!state.user)return;
  const terminal=state.orders.find(order=>order.firestoreId===activeId&&(order.cancelled===true||Number(order.statusIndex||0)>=4));
  if(!terminal)return;
  await updateDoc(doc(db,"drivers",state.user.uid),{activeOrderId:"",activeOrderCode:"",busySince:null,updatedAt:serverTimestamp()}).catch(error=>console.warn("تعذر تحرير حالة الكابتن بعد انتهاء الطلب",error));
}

async function drawPickupRoute(force=false, reason="") {
  if (!state.map) return;
  const activeOrder=state.orders.find(order=>order.driverId===state.user?.uid&&!order.cancelled&&Number(order.statusIndex||0)<4);
  if(!activeOrder){
    const retainedId=String(state.navigationCompletedOrderId||state.navigationOrderId||"");
    const retainedOrder=retainedId?state.orders.find(order=>String(order.firestoreId)===retainedId&&order.driverId===state.user?.uid&&!order.cancelled&&Number(order.statusIndex||0)>=4):null;
    if(retainedOrder&&state.routeLine&&(!state.routeNavigation||state.routeNavigation.orderId===retainedId)){
      if(!state.routeNavigation)state.routeNavigation={orderId:retainedId,legKey:`${retainedId}:destination`,coords:[],maneuvers:[],updatedAt:Date.now(),target:retainedOrder.destinationLocation||null};
      showDriverNavigationArrival(retainedOrder);return;
    }
    state.routeRequestToken++;
    state.routeRecalcQueued=false;
    state.routeNavigation=null;
    state.navigationOrderId=null;
    state.navigationLegKey="";
    state.navigationCompletedOrderId=null;
    state.navigationArrivalAnnouncedFor=null;
    state.routeProgressIndex=0;
    state.offRouteHits=0;
    state.lastRoutePoint=null;
    resetDriverNavigationUi();
    clearDriverNavigationLine();
    return;
  }
  const leg=navigationLegForOrder(activeOrder),st=leg.status,target=leg.target;
  const targetLat=Number(target?.latitude),targetLng=Number(target?.longitude);
  if(!Number.isFinite(targetLat)||!Number.isFinite(targetLng))return;
  const orderId=String(activeOrder.firestoreId),orderChanged=state.navigationOrderId!==orderId,legChanged=state.navigationLegKey!==leg.legKey;
  if(orderChanged||legChanged){
    state.navigationOrderId=orderId;
    state.navigationLegKey=leg.legKey;
    state.navigationCompletedOrderId=null;
    state.navigationArrivalAnnouncedFor=null;
    state.announcedTurnKeys.clear();
    state.routeProgressIndex=0;
    state.routeNavigation=null;
    state.offRouteHits=0;
    state.routeRequestToken++;
    byId("driverView")?.classList.remove("navigation-arrived");
  }
  const targetPoint=[targetLat,targetLng];
  if(state.pickupMarker)state.pickupMarker.setLatLng(targetPoint);else state.pickupMarker=window.L.marker(targetPoint,{icon:mapIcon("pickup")}).addTo(state.map);
  state.pickupMarker.bindPopup(st>=3?"عنوان العميل":(activeOrder?.type==="serviceDelivery"?"عنوان النشاط / الاستلام":"موقع العميل"));
  if(!state.driverMarker)return;
  if(state.routeRecalcInFlight){if(force||legChanged||reason)state.routeRecalcQueued=true;return;}
  const pos=state.driverMarker.getLatLng(),now=Date.now(),current={latitude:pos.lat,longitude:pos.lng};
  const moved=state.lastRoutePoint?haversine(current,state.lastRoutePoint):Infinity;
  if(!force&&!legChanged&&now-state.lastRouteAt<5000&&moved<.03){evaluateTurnAnnouncement(current);return;}
  state.routeRecalcInFlight=true;
  state.routeRecalcQueued=false;
  const requestToken=++state.routeRequestToken;
  state.lastRouteAt=now;
  state.lastRoutePoint=current;
  if(reason==="offroute")state.announcedTurnKeys.clear();
  let coords=[[pos.lat,pos.lng],targetPoint],km=haversine(current,{latitude:targetLat,longitude:targetLng})*1.28,mins=km/28*60,provider="تقدير",maneuvers=[];
  try{
    try{const vr=await valhallaNavigate(current,{latitude:targetLat,longitude:targetLng});coords=vr.coords;km=vr.km;mins=vr.mins;maneuvers=vr.maneuvers;provider="Valhalla";}catch(e){try{const u=`https://router.project-osrm.org/route/v1/driving/${pos.lng},${pos.lat};${targetLng},${targetLat}?overview=full&steps=true&geometries=geojson`;const r=await fetch(u,{signal:AbortSignal.timeout(4500)}),x=await r.json(),route=x.routes?.[0];if(!route)throw 0;coords=route.geometry.coordinates.map(([lng,lat])=>[lat,lng]);km=route.distance/1000;mins=route.duration/60;maneuvers=osrmManeuvers(route,coords);provider="OSRM";}catch(_){} }
    const latest=activeDrivingOrder(),latestLeg=navigationLegForOrder(latest);
    if(requestToken!==state.routeRequestToken||!latest||String(latest.firestoreId)!==orderId||latestLeg.legKey!==leg.legKey)return;
    state.routeNavigation={orderId,legKey:leg.legKey,coords,maneuvers,updatedAt:Date.now(),target:{latitude:targetLat,longitude:targetLng}};
    state.routeProgressIndex=0;
    state.offRouteHits=0;
    if(state.routeCasingLine)state.routeCasingLine.setLatLngs(coords);else state.routeCasingLine=window.L.polyline(coords,{color:"#ffffff",weight:14,opacity:.9,lineCap:"round",interactive:false}).addTo(state.map);
    if(state.routeLine)state.routeLine.setLatLngs(coords);else state.routeLine=window.L.polyline(coords,{color:"#2f80ed",weight:7,opacity:.98,lineCap:"round",interactive:false}).addTo(state.map);
    setDriverNavigationText("driverEta",`${Math.max(1,Math.round(mins))} دقيقة`);
    setDriverNavigationText("driverRemaining",km<1?`${Math.max(1,Math.round(km*1000))} م`:`${km.toFixed(1)} كم`);
    setDriverNavigationText("driverNavTarget",st>=3?"إلى الوجهة":"إلى الراكب");
    setDriverNavigationText("driverRouteProvider",provider);
    const m=maneuvers.find(x=>isGuidanceManeuver(x))||maneuvers[0];
    byId("nextTurnText").textContent=m?.instruction||m?.verbal_transition_alert_instruction||"استمر على المسار المحدد";
    byId("nextTurnIcon").textContent=turnIcon(m);
    const alert=byId("offRouteAlert");
    if(alert){if(reason==="offroute"){alert.textContent="تم رسم مسار جديد من موقعك الحالي إلى نقطة الوصول.";window.setTimeout(()=>alert.classList.add("hidden"),1800);}else alert.classList.add("hidden");}
    evaluateTurnAnnouncement(current);
    if(reason==="offroute")speakDriverNavigation("تم تحديث المسار. اتبع الطريق الجديد إلى نقطة الوصول.",22);
    else if(legChanged&&leg.toDestination)speakDriverNavigation("بدأت الرحلة. اتبع المسار إلى الوجهة.",22);
    if(force)state.map.setView([pos.lat,pos.lng],16,{animate:true,duration:.38});
  }finally{
    state.routeRecalcInFlight=false;
    if(state.routeRecalcQueued){state.routeRecalcQueued=false;window.setTimeout(()=>drawPickupRoute(true,"queued"),0);}
  }
}

async function getDriverPrecisePosition(options = {}) {
  if (window.KarwaGeo?.getPrecisePosition) {
    return window.KarwaGeo.getPrecisePosition({ targetAccuracy: 20, acceptableAccuracy: 35, maxWait: 18000, ...options });
  }
  if (!navigator.geolocation) throw Object.assign(new Error("GPS غير مدعوم"), { code: "UNSUPPORTED" });
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:18000,maximumAge:0}));
}

function handleDriverLocationError(error) {
  console.warn("driver precise location", error);
  const code=String(error?.code||"");
  if(code==="PRECISE_PERMISSION_REQUIRED"||code==="PERMISSION_DENIED"||error?.code===1){
    toast("فعّل «الموقع الدقيق» لكروة حتى يظهر موقعك الحقيقي");
    window.KarwaGeo?.promptPreciseSettings?.("الكابتن يحتاج الموقع الدقيق للملاحة والطلبات وبلاغات الطريق. فعّل «استخدام الموقع الدقيق» ثم عد إلى كروة.");
    return;
  }
  if(code==="GPS_DISABLED"){toast("شغّل GPS للحصول على موقع دقيق");try{window.KarwaNative?.openLocationSettings?.();}catch{}return;}
  if(code==="ACCURACY_TOO_LOW"){const a=Number(error?.bestAccuracy||0);toast(a?`GPS غير دقيق حاليًا (${Math.round(a)} م). انتقل لمكان مفتوح.`:"بانتظار إشارة GPS أدق");return;}
  toast("تعذر تحديد الموقع بدقة؛ تحقق من GPS والصلاحيات");
}

function showOwnPosition(position) {
  initializeDriverMap();
  const latitude = Number(position.coords.latitude);
  const longitude = Number(position.coords.longitude);
  const point = [latitude, longitude];
  const heading = resolveDriverHeading(position);
  if (state.driverMarker) state.driverMarker.setLatLng(point);
  else state.driverMarker = window.L.marker(point, { icon: mapIcon("driver", state.markerStyle), zIndexOffset: 900 })
    .addTo(state.map)
    .bindPopup("موقعك الحالي");
  setDriverMarkerVisual(state.driverMarker, heading, state.markerStyle);
  applyDriverCamera(point, heading);
  updateDriverHeadingHud(heading, position.coords.speed);
  evaluateTurnAnnouncement({latitude,longitude});
  evaluateRouteDeviation({latitude,longitude},Number(position.coords.accuracy||25));
  const acc=Math.round(position.coords.accuracy||0);
  const excellent=acc>0&&acc<=15, precise=acc>0&&acc<=30;
  setLocationStatus(excellent?"GPS ممتاز":(precise?"GPS دقيق":"GPS مقبول"), "approved");
  byId("locationHint").textContent = excellent?`دقة ممتازة • ${acc} م`:precise?`دقة عالية • ${acc} م`:`دقة الموقع ${acc} م — سيواصل كروة تحسينها تلقائيًا.`;
  drawPickupRoute();
  checkRoadReportProximity(position);
  evaluateDriverAutoArrival();
}

async function sharePosition(position, force = false) {
  if (!state.user || !state.driverData?.online || !position) return;
  const locationAccuracy=Number(position.coords?.accuracy||9999);
  if (!Number.isFinite(locationAccuracy) || locationAccuracy > 45) {
    byId("locationHint").textContent=`جاري تحسين GPS… الدقة الحالية ${Math.round(locationAccuracy)} م`;
    return;
  }
  const now = Date.now();
  const hasActiveOrder = state.orders.some(order => order.driverId === state.user.uid && !order.cancelled && Number(order.statusIndex || 0) < 4);
  const shareInterval = hasActiveOrder ? 2000 : 5500;
  if (!force && now - state.lastLocationWrite < shareInterval) return;
  const activeOrders = state.orders.filter(order =>
    order.driverId === state.user.uid && !order.cancelled && Number(order.statusIndex || 0) < 4
  );
  state.lastLocationWrite = now;
  const location = {
    driverId: state.user.uid,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number(position.coords.accuracy || 0),
    heading: Number.isFinite(state.driverHeading) ? state.driverHeading : (Number.isFinite(position.coords.heading) ? normalizeHeading(position.coords.heading) : null),
    speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
    markerStyle: state.markerStyle,
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
  setLocationStatus("جاري تثبيت GPS", "pending");
  const onPosition = position => {
    state.lastPosition = position;
    showOwnPosition(position);
    sharePosition(position).then(() => renderOrders()).catch(error => { console.error(error); renderOrders(); });
  };
  const onError = error => {
    console.error(error);
    setLocationStatus("تعذر الموقع", "rejected");
    handleDriverLocationError(error);
    const code=String(error?.code||"");
    byId("locationHint").textContent = (code==="PRECISE_PERMISSION_REQUIRED"||code==="PERMISSION_DENIED"||error?.code===1)
      ? "فعّل الموقع الدقيق من إعدادات كروة ثم فعّل الاتصال مجددًا."
      : (code==="GPS_DISABLED"?"GPS متوقف — شغّل الموقع في الهاتف.":"تعذر قراءة GPS بدقة كافية.");
    if ((code==="PRECISE_PERMISSION_REQUIRED"||code==="PERMISSION_DENIED"||error?.code===1) && state.user) {
      updateDoc(doc(db, "drivers", state.user.uid), { online: false, updatedAt: serverTimestamp() }).catch(() => {});
    }
  };
  if (window.KarwaGeo?.watchPosition) {
    state.locationWatchId = window.KarwaGeo.watchPosition(onPosition, onError, {
      maxAccuracy:45,
      onQuality:({accuracy,acceptable})=>{
        if(!acceptable){setLocationStatus("تحسين GPS", "pending");byId("locationHint").textContent=`جاري تثبيت موقع أدق… ${Math.round(accuracy)} م`; }
      }
    });
  } else if (navigator.geolocation) {
    state.locationWatchId = navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  } else {
    onError(Object.assign(new Error("unsupported"),{code:"UNSUPPORTED"}));
  }
}

function stopLocationSharing() {
  if (state.locationWatchId !== null) {
    if(window.KarwaGeo?.clearWatch) window.KarwaGeo.clearWatch(state.locationWatchId);
    else navigator.geolocation?.clearWatch?.(state.locationWatchId);
  }
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
  if (name !== "driver") byId("driverView")?.classList.remove("driver-options-open", "driver-settings-open", "driver-notifications-open");
  byId("authView").classList.toggle("hidden", name !== "auth");
  byId("deniedView").classList.toggle("hidden", name !== "denied");
  byId("blockedView").classList.toggle("hidden", name !== "blocked");
  byId("applicationView").classList.toggle("hidden", name !== "application");
  byId("driverView").classList.toggle("hidden", name !== "driver");
  byId("logoutButton").classList.toggle("hidden", name === "auth" || (name === "application" && state.directRegistration && !state.user));
  if (name === "application") configureDirectRegistrationUI();
}

function clearViewListeners() {
  stopDriverCustomerTracking();
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

function setDriverSettingsOpen(open, restoreFocus = true) {
  const view = byId("driverView");
  const panel = byId("driverSettingsPanel");
  const toggle = byId("driverSettingsToggle");
  if (!view || !panel || !toggle) return;
  if (open) {
    setDriverNotificationsOpen(false, false);
    view.querySelector(".driver-options-close")?.click();
    updateDriverSettingsInfo();
    applyDriverMapPreferences();
  }
  view.classList.toggle("driver-settings-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  panel.setAttribute("aria-hidden", String(!open));
  panel.inert = !open;
  if (open) window.setTimeout(() => byId("driverSettingsClose")?.focus({ preventScroll: true }), 80);
  else if (restoreFocus) toggle.focus({ preventScroll: true });
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
byId("driverSettingsPanel").querySelectorAll("[data-driver-marker-style]").forEach(button => {
  button.addEventListener("click", () => setDriverMarkerStyle(button.dataset.driverMarkerStyle));
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
byId("driverNotificationsPanel").inert = true;
byId("driverNotificationsToggle").addEventListener("click", () => setDriverNotificationsOpen(true));
byId("driverNotificationsClose").addEventListener("click", () => setDriverNotificationsOpen(false));
byId("driverNotificationsScrim").addEventListener("click", () => setDriverNotificationsOpen(false));
byId("driverNotificationsMarkAll").addEventListener("click", () => {
  state.notifications.forEach(item => { item.read = true; });
  saveDriverNotifications();renderDriverNotifications();toast("تم تحديد جميع الإشعارات كمقروءة");
});
byId("driverNotificationsClear").addEventListener("click", () => {
  if(!state.notifications.length)return toast("لا توجد إشعارات لحذفها");
  if(confirm("حذف جميع إشعارات الكابتن المحفوظة؟")){clearDriverNotifications();toast("تم حذف جميع الإشعارات");}
});
byId("driverNotificationsList").addEventListener("click", event => {
  const deleteButton=event.target.closest("[data-driver-notification-delete]");
  if(deleteButton){event.stopPropagation();if(deleteDriverNotification(deleteButton.dataset.driverNotificationDelete))toast("تم حذف الإشعار");return;}
  const button=event.target.closest("[data-driver-notification-id]");if(!button)return;
  const item=markDriverNotificationRead(button.dataset.driverNotificationId);if(!item)return;
  setDriverNotificationsOpen(false,false);
  if(item.target==="wallet"){
    setDriverSettingsOpen(true,false);
    window.setTimeout(()=>byId("driverSettingsWallet")?.scrollIntoView({behavior:"smooth",block:"start"}),260);
    return;
  }
  if(["available","active","warning"].includes(item.target)){
    window.setTimeout(()=>{
      byId("driverOptionsToggle")?.click();
      window.setTimeout(()=>byId(item.target==="available"?"availableOrders":item.target==="active"?"myOrders":"driverWarningNotice")?.scrollIntoView({behavior:"smooth",block:"start"}),280);
    },100);
  }
});
byId("driverNotificationSetting").addEventListener("click",async()=>{
  let next=!state.deviceNotificationsEnabled;let activationFailed=false;
  if(next){next=await requestDriverDevicePermission();if(!next){activationFailed=true;toast("لم يتم السماح بإشعارات الجهاز، وسيبقى مركز إشعارات اللوحة فعالًا");}}
  state.deviceNotificationsEnabled=next;updateDriverNotificationSetting();
  if(state.user){try{await setDoc(doc(db,"users",state.user.uid),{notifications:next,updatedAt:serverTimestamp()},{merge:true});if(!activationFailed)toast(next?"تم تفعيل إشعارات Android بالصوت والاهتزاز":"تم إيقاف إشعارات الجهاز");}catch(error){console.error(error);toast("تعذر حفظ إعداد الإشعارات");}}
});
document.addEventListener("click",event=>{if(event.target.closest(".driver-options-toggle"))setDriverNotificationsOpen(false,false);},true);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && byId("driverView")?.classList.contains("driver-settings-open")) {
    setDriverSettingsOpen(false);
  }
  if (event.key === "Escape" && byId("driverView")?.classList.contains("driver-notifications-open")) {
    setDriverNotificationsOpen(false);
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
  const serviceSelect = byId("serviceType");
  const vehicleSelect = byId("vehicleType");
  // الدراجة في كروة مخصصة للتوصيل فقط. إذا اختارها المستخدم نثبت نوع الخدمة على توصيل تلقائيًا.
  if (vehicleSelect?.value === "دراجة" && serviceSelect && serviceSelect.value !== "other") serviceSelect.value = "delivery";
  const serviceType = serviceSelect?.value || "taxi";
  const other = serviceType === "other";
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
byId("captainRestaurantGps")?.addEventListener("click",async()=>{
  const btn=byId("captainRestaurantGps"); busy(btn,true,"جارٍ تثبيت GPS…");
  try{const pos=await getDriverPrecisePosition();state.restaurantGps={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy};byId("captainRestaurantGpsStatus").textContent=`تم تحديد الموقع ✓ دقة ${Math.round(pos.coords.accuracy||0)} م`;btn.textContent="📍 تحديث موقع المطعم";}
  catch(error){handleDriverLocationError(error);}
  finally{busy(btn,false);}
});
byId("captainAddMeal")?.addEventListener("click",()=>{
  const name=byId("captainMealName").value.trim(), description=byId("captainMealDescription").value.trim(), price=Number(byId("captainMealPrice").value);
  if(!name||!Number.isFinite(price)||price<=0){toast("أدخل اسم الوجبة وسعرًا صحيحًا");return;}
  if(state.restaurantMeals.length>=30){toast("الحد الأقصى 30 وجبة");return;}
  state.restaurantMeals.push({name,description,price:Math.round(price)});["captainMealName","captainMealDescription","captainMealPrice"].forEach(id=>byId(id).value="");renderCaptainRestaurantMeals();
});

function normalizedApplicationServiceType(data = {}) {
  const raw = String(data.serviceType || "").trim();
  const lower = raw.toLowerCase();
  const isBike = String(data.vehicleType || "").includes("دراجة");
  if (lower === "other") return "other";
  if (isBike || ["delivery", "parcel", "food", "servicedelivery"].includes(lower) || raw.includes("توصيل")) return "delivery";
  if (["taxi", "ride"].includes(lower) || raw.includes("تكسي")) return "taxi";
  return "taxi";
}

function fillApplication(data = {}) {
  byId("driverName").value = data.name || state.userData?.name || state.user?.displayName || "";
  byId("driverPhone").value = data.phone || "";
  byId("serviceType").value = normalizedApplicationServiceType(data);
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

  const rawServiceType = byId("serviceType").value;
  const isBike = byId("vehicleType").value === "دراجة";
  const selectedServiceType = isBike && rawServiceType !== "other" ? "delivery" : rawServiceType;
  const isRestaurant = selectedServiceType === "other";
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
  let createdCredential = null;
  try {
    let accountUser = state.user;
    let deviceInfo = null;
    let welcomeBonus = null;
    if (directSignup) {
      const settingsSnapshot = await getDoc(doc(db, "appSettings", "pricing"));
      driverPricingSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
      deviceInfo = requireNativeRegistrationDevice();
      createdCredential = await createUserWithEmailAndPassword(auth, registerEmail, registerPassword);
      accountUser = createdCredential.user;
      await updateProfile(accountUser, { displayName: name });
      welcomeBonus=driverSignupBonusFields();
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

    const restaurantPayload = isRestaurant ? {
      ownerId: accountUser.uid, name: byId("captainRestaurantName").value.trim(),
      address: byId("captainRestaurantAddress").value.trim(), phone: byId("captainRestaurantPhone").value.trim(),
      location: {...state.restaurantGps}, meals: state.restaurantMeals.map(meal=>({...meal})),
      active: false, approvalStatus: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    } : null;

    if (directSignup) {
      const registrationBatch=writeBatch(db);
      registrationBatch.set(doc(db, "users", accountUser.uid), {
        name, email: registerEmail, role: "driverApplicant", balance: 0, ...welcomeBonus, notifications: true, deviceBound: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      addDeviceRegistrationWrites(registrationBatch,db,accountUser.uid,"driverApplicant",deviceInfo);
      registrationBatch.set(doc(db, "driverApplications", accountUser.uid), applicationPayload);
      if (restaurantPayload) registrationBatch.set(doc(db,"restaurants",accountUser.uid),restaurantPayload,{merge:true});
      await registrationBatch.commit();
    } else {
      await setDoc(doc(db, "driverApplications", accountUser.uid), applicationPayload, { merge: true });
      if (restaurantPayload) await setDoc(doc(db,"restaurants",accountUser.uid),restaurantPayload,{merge:true});
    }

    if (directSignup) {
      state.directRegistration = false;
      history.replaceState(null, "", "./driver.html");
      toast("تم إنشاء حساب الكابتن وربطه بهذا الهاتف وإرسال الطلب إلى الإدارة.");
    } else {
      toast(isRestaurant ? "تم إرسال طلب الخدمة إلى الإدارة للموافقة. لن يظهر المطعم للعملاء قبل الاعتماد." : "تم إرسال طلب الكابتن إلى الإدارة للموافقة");
    }
  } catch (error) {
    console.error(error);
    if (directSignup && createdCredential?.user) {
      try { await deleteUser(createdCredential.user); } catch (rollbackError) { console.warn("تعذر حذف حساب التسجيل غير المكتمل", rollbackError); }
    }
    const deviceMessage = error?.message === "DEVICE_NATIVE_REQUIRED" || error?.code === "device/native-required"
      ? "إنشاء حساب كابتن جديد متاح من تطبيق كروة على Android فقط حتى يتم ربط الحساب بهذا الهاتف."
      : (directSignup && String(error?.code||"").includes("permission-denied") ? "هذا الهاتف مرتبط بالفعل بحساب كروة آخر، أو لم تُنشر قواعد Phase 81 الجديدة." : "");
    toast(deviceMessage || authMessage(error));
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

function distanceToOrder(order){ return distanceKmBetween(currentDriverPoint(), order?.pickupLocation); }
function orderCard(order, mode) {
  const statusIndex = Number(order.statusIndex || 0);
  const statusClass = order.cancelled ? "cancelled" : statusIndex >= 4 ? "complete" : "active";
  const action = mode === "available"
    ? `<button class="primary" data-action="accept" data-id="${order.firestoreId}" ${state.driverData?.online ? "" : "disabled"}>قبول الطلب</button>`
    : statusIndex < 4 && !order.cancelled
      ? `<button class="primary" data-action="advance" data-id="${order.firestoreId}">${escapeHtml(driverStatusLabel(order, statusIndex + 1))}</button><button class="danger" data-action="cancel" data-id="${order.firestoreId}">إلغاء الطلب</button>`
      : "";
  const scanAction = mode !== "available" && orderNeedsCustomerBarcode(order,statusIndex)
    ? `<button class="secondary" data-action="scan-otp" data-id="${order.firestoreId}">📷 مسح باركود العميل</button>` : "";
  return `
    <article class="order-card">
      <div class="order-top">
        <h3>${icons[order.type] || "🧾"} ${escapeHtml(order.title)}</h3>
        <span class="status-chip ${statusClass}">${escapeHtml(order.cancelled ? "ملغي" : driverStatusLabel(order, statusIndex))}</span>
      </div>
      <p class="order-route">${escapeHtml(order.route)}</p>
      ${order.type === "serviceDelivery" ? `<div class="order-meta delivery-addresses"><span>🏪 عنوان النشاط / الاستلام: ${escapeHtml(String(order.route||"").split(" ← ")[0]||"غير محدد")}</span><span>🏠 عنوان العميل: ${escapeHtml(String(order.route||"").split(" ← ")[1]||"غير محدد")}</span></div>` : ""}
      ${order.type === "parcel" && order.parcelDetails ? `<div class="order-meta delivery-addresses"><span>👤 المستلم: ${escapeHtml(order.parcelDetails.recipientName || "غير محدد")}</span><span>☎️ ${escapeHtml(order.parcelDetails.recipientPhone || "غير محدد")}</span>${order.parcelDetails.notes ? `<span>📝 ${escapeHtml(order.parcelDetails.notes)}</span>` : ""}</div>` : ""}
      ${order.customerEditedAt ? `<div class="notice" style="margin-top:8px"><strong>✏️ عدّل العميل تفاصيل الطلب</strong><span>اعتمد العناوين والملاحظات الظاهرة حاليًا؛ هذه أحدث نسخة.</span></div>` : ""}
      <div class="order-bottom">
        <div class="order-meta"><span>${escapeHtml(order.id)}</span><span>👤 ${escapeHtml(order.customerName || "عميل كروة")}</span><span>${escapeHtml(order.payment || "نقدًا")}</span>${mode === "available" ? `<span>🗓️ ${escapeHtml(formatOrderCreatedAt(order))}</span>` : ""}${mode === "available" && Number.isFinite(distanceToOrder(order)) ? `<span>يبعد ${distanceToOrder(order).toFixed(1)} كم</span>` : ""}</div>
        ${order.distanceKm ? `<div class="order-meta"><span>المشوار ${Number(order.distanceKm).toFixed(1)} كم</span><span>≈ ${Math.round(Number(order.durationMin||0))} دقيقة</span><span>صافي الكابتن ${money(order.driverEarnings)}</span></div>` : ""}
        <span class="order-price">${money(order.price)}</span>
      </div>
      ${order.type==="ride"&&statusIndex===2?`<div class="order-meta"><span>📍 إذا لم تُدخل رمز العميل، سيؤكد كروة الوصول تلقائيًا عندما تصلان معًا إلى الوجهة عبر GPS الدقيق.</span></div>`:""}
      ${action || scanAction ? `<div class="order-actions">${scanAction}${action}</div>` : ""}
    </article>`;
}

function renderOrders() {
  const now=Date.now();
  const available = state.orders.filter(order => orderMeetsDriverDispatchConditions(order, now)).sort((a,b) => distanceToOrder(a) - distanceToOrder(b));
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
  const hasLiveLocation = Boolean(currentDriverPoint());
  byId("availableOrders").innerHTML = available.length
    ? available.map(order => orderCard(order, "available")).join("")
    : !hasLiveLocation && state.driverData?.online
      ? `<div class="empty"><span>📍</span>جارٍ تحديد موقعك. لن تظهر الطلبات إلا بعد تفعيل GPS، وضمن نطاق ${DRIVER_REQUEST_RADIUS_KM} كم فقط.</div>`
      : `<div class="empty"><span>✓</span>لا توجد طلبات مطابقة لتصنيفك ضمن نطاق ${DRIVER_REQUEST_RADIUS_KM} كم الآن.</div>`;
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
    addDriverNotification({id:`admin-warning:${warnings}:${state.driverData.warningMessage}`,type:"warning",title:"تنبيه جديد من الإدارة",message:state.driverData.warningMessage,target:"warning"});
  } else {
    notice.className = "notice hidden";
    notice.textContent = "";
  }
  updateDriverSettingsInfo();
}

function openDriverDashboard() {
  clearViewListeners();
  showView("driver");
  loadDriverNotifications();
  updateDriverNotificationSetting();
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
    const savedMarkerStyle = ["arrow","car","bike"].includes(state.driverData.markerStyle) ? state.driverData.markerStyle : null;
    if (savedMarkerStyle && savedMarkerStyle !== state.markerStyle) {
      state.markerStyle = savedMarkerStyle;
      writeDriverPreference("karwa.driver.markerStyle", savedMarkerStyle);
      if (state.driverMarker) { state.driverMarker.setIcon(mapIcon("driver", savedMarkerStyle)); setDriverMarkerVisual(state.driverMarker, state.driverHeading, savedMarkerStyle); }
    }
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
  let ordersSnapshotReady = false;
  let ordersUnsubscribe = null;
  let subscribedOrderMode = "";
  const subscribeToAllowedOrders = () => {
    const mode = driverOrderMode(state.driverData);
    if (mode === subscribedOrderMode) return;
    if (ordersUnsubscribe) ordersUnsubscribe();
    ordersUnsubscribe = null;
    subscribedOrderMode = mode;
    knownOrderIds = new Set();
    ordersSnapshotReady = false;
    state.orders = [];
    renderOrders();
    if (mode === "none") return;
    const ordersQuery = mode === "taxi"
      ? query(collection(db, "orders"), where("type", "==", "ride"))
      : query(collection(db, "orders"), where("type", "in", ["parcel", "food", "serviceDelivery"]));
    ordersUnsubscribe = onSnapshot(ordersQuery, snapshot => {
      const incoming = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
      const previousOrders = new Map(state.orders.map(order => [order.firestoreId, order]));
      if (ordersSnapshotReady && state.driverData?.online) {
        const freshOrders = incoming.filter(o => !knownOrderIds.has(o.firestoreId) && orderMeetsDriverDispatchConditions(o));
        freshOrders.forEach(fresh => {const customer=String(fresh.customerName||"العميل").trim();addDriverNotification({id:`new-order:${fresh.firestoreId}`,type:"order",title:fresh.type==="ride"?`طلب تكسي من ${customer}`:`طلب توصيل من ${customer}`,message:`${fresh.title||"لديك طلب متاح"}${fresh.route?` • ${fresh.route}`:""}`,target:"available"});});
        if(freshOrders.length)toast(freshOrders.length===1?(freshOrders[0].type==="ride"?"طلب تكسي جديد متاح":"طلب توصيل جديد متاح"):`لديك ${freshOrders.length} طلبات جديدة متاحة`);
      }
      if(ordersSnapshotReady){
        incoming.forEach(order=>{
          const previous=previousOrders.get(order.firestoreId);
          const nextStatus=Number(order.statusIndex||0);
          if(!previous||order.driverId!==state.user?.uid||Number(previous.statusIndex||0)===nextStatus)return;
          addDriverNotification({id:`trip-status:${order.firestoreId}:${nextStatus}`,type:"trip",title:"تحديث حالة الرحلة",message:`${order.title||"رحلتك الحالية"} • ${driverStatusLabel(order,nextStatus)}`,target:nextStatus>=4?"":"active"});
        });
      }
      knownOrderIds = new Set(incoming.map(o=>o.firestoreId));
      ordersSnapshotReady = true;
      state.orders = incoming.filter(o => canDriverHandleOrder(o) || o.driverId === state.user?.uid).sort((a, b) => String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || "")));
      syncDriverCustomerTracking();
      releaseDriverLockForCompletedOrder();
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
  if (button.dataset.action === "scan-otp") {
    const order=state.orders.find(item=>item.firestoreId===button.dataset.id); if(!order||!orderNeedsCustomerBarcode(order))return toast("هذا الطلب لا يحتاج مسح الرمز الآن");
    const scanned=await openCustomerBarcodeScanner(); if(!scanned)return;
    if(String(scanned)!==String(order.tripOtp||""))return toast("الباركود لا يطابق رمز هذا الطلب");
    scannedOtpCache.set(order.firestoreId,scanned); toast("تمت قراءة باركود العميل بنجاح");
    const advance=[...document.querySelectorAll('button[data-action="advance"]')].find(x=>x.dataset.id===order.firestoreId); if(advance)advance.click(); return;
  }
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
        const userRef = doc(db, "users", state.user.uid);
        // قبول الطلب وحجز الكابتن وخصم رسم كروة يتم في نفس المعاملة.
        const [snap, driverSnap, userSnap] = await Promise.all([
          transaction.get(orderRef),
          transaction.get(driverRef),
          transaction.get(userRef)
        ]);
        if (!snap.exists()) throw new Error("ORDER_NOT_FOUND");
        if (!driverSnap.exists()) throw new Error("DRIVER_PROFILE_MISSING");
        if (!userSnap.exists()) throw new Error("USER_PROFILE_MISSING");
        const order = snap.data();
        const driver = driverSnap.data();
        const userData = userSnap.data();
        const captainFee=driverOperationFee(order);
        const walletPatch=driverWalletDebitPatch(userData,captainFee);
        if(captainFee>0&&!walletPatch)throw new Error("INSUFFICIENT_WALLET");
        if (driver.blocked === true) throw new Error("DRIVER_BLOCKED");
        if (driver.online !== true) throw new Error("OFFLINE");
        if (driver.activeOrderId) throw new Error("DRIVER_BUSY");
        if (order.cancelled || Number(order.statusIndex || 0) >= 4) throw new Error("ORDER_NOT_AVAILABLE");
        if (order.driverId && order.driverId !== state.user.uid) throw new Error("ORDER_TAKEN");
        if (!canDriverHandleOrder(order, driver)) throw new Error(order.type === "ride" ? "TAXI_DRIVER_ONLY" : "DELIVERY_DRIVER_ONLY");
        const livePoint = currentDriverPoint();
        if (!livePoint) throw new Error("LOCATION_REQUIRED");
        const requestDistanceKm = distanceKmBetween(livePoint, order.pickupLocation);
        if (!Number.isFinite(requestDistanceKm) || requestDistanceKm > DRIVER_REQUEST_RADIUS_KM) throw new Error("OUTSIDE_REQUEST_RADIUS");
        if (order.type === "serviceDelivery" && order.serviceCity && String(order.serviceCity).trim() !== String(driver.city || "").trim()) throw new Error("OUTSIDE_DRIVER_AREA");
        transaction.update(orderRef, {
          driverId: state.user.uid,
          driverName: driver.name || state.userData?.name || state.user.email || "كابتن كروة",
          driverPhone: driver.phone || "",
          assignmentStatus: "accepted",
          captainPlatformFee: captainFee,
          captainFeeCharged: true,
          acceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        transaction.update(driverRef, {
          activeOrderId: button.dataset.id,
          activeOrderCode: String(order.orderCode || order.code || button.dataset.id),
          busySince: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if(walletPatch)transaction.update(userRef,walletPatch);
      });
      if (state.lastPosition) await sharePosition(state.lastPosition, true);
      setTimeout(()=>drawPickupRoute(true),400); toast("تم قبول الطلب بنجاح");
    } else if (button.dataset.action === "cancel") {
      const reason = requestDriverCancellationReason();
      if (!reason) return;
      await runTransaction(db, async transaction => {
        const driverRef = doc(db, "drivers", state.user.uid);
        const [orderSnap, driverSnap] = await Promise.all([transaction.get(orderRef), transaction.get(driverRef)]);
        if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
        const fresh = orderSnap.data();
        if (fresh.driverId !== state.user.uid || fresh.cancelled === true || Number(fresh.statusIndex || 0) >= 4) throw new Error("ORDER_NOT_AVAILABLE");
        transaction.update(orderRef, driverCancellationMeta(reason));
        if (driverSnap.exists() && driverSnap.data().activeOrderId === button.dataset.id) {
          transaction.update(driverRef, { activeOrderId:"", activeOrderCode:"", busySince:null, updatedAt:serverTimestamp() });
        }
      });
      toast("تم إلغاء الطلب وتسجيل السبب للإدارة");
    } else if (button.dataset.action === "advance") {
      const order = state.orders.find(item => item.firestoreId === button.dataset.id);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      const next = Number(order.statusIndex || 0) + 1;
      let otp = "";
      let pickupOtp = "";
      const finalOtpStep = DELIVERY_ORDER_TYPES.has(order.type) ? 4 : 3;
      const pickupOtpStep = order.type === "serviceDelivery" ? 3 : -1;
      if (next === pickupOtpStep) {
        pickupOtp = (prompt("أدخل رمز الاستلام المكوّن من 4 أرقام الذي يعطيك إياه المطعم أو صاحب الخدمة عند وصولك:", "") || "").trim();
        if (!pickupOtp) throw new Error("PICKUP_OTP_REQUIRED");
        if (!/^\d{4}$/.test(pickupOtp)) throw new Error("PICKUP_OTP_INVALID");
      }
      if (next === finalOtpStep) {
        otp = scannedOtpCache.get(order.firestoreId) || "";
        scannedOtpCache.delete(order.firestoreId);
        if (!otp) otp = prompt(DELIVERY_ORDER_TYPES.has(order.type) ? "أدخل رمز التسليم المكوّن من 4 أرقام الذي يعطيك إياه العميل عند الوصول:" : "أدخل رمز بدء الرحلة المكوّن من 4 أرقام:", "") || "";
        if (!otp) throw new Error("OTP_REQUIRED");
      }
      if (next === finalOtpStep && String(otp).trim() !== String(order.tripOtp || "").trim()) throw new Error("OTP_INVALID");
      const fields = { statusIndex: next, updatedAt: serverTimestamp() };
      if (next === 2) fields.arrivedAt = serverTimestamp();
      if (next === 3) fields.startedAt = serverTimestamp();
      if (next === pickupOtpStep) { fields.pickupVerificationCode = pickupOtp; fields.pickupVerifiedAt = serverTimestamp(); }
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
        try {
          await updateDoc(orderRef, fields);
        } catch (updateError) {
          if (next === pickupOtpStep && String(updateError?.code || "").includes("permission-denied")) throw new Error("PICKUP_OTP_INVALID");
          throw updateError;
        }
      }
      if(next===4)state.navigationCompletedOrderId=String(order.firestoreId);
      setTimeout(()=>drawPickupRoute(true,next===4?"arrived":"status-change"),400); toast(driverStatusLabel(order, next));
    }
  } catch (error) {
    console.error(error);
    toast(error.message === "OFFLINE" ? "فعّل حالة الاتصال أولًا" : error.message === "PICKUP_OTP_REQUIRED" ? "يجب إدخال رمز الاستلام من المطعم أو صاحب الخدمة" : error.message === "PICKUP_OTP_INVALID" ? "رمز الاستلام غير صحيح" : error.message === "OTP_REQUIRED" ? "يجب إدخال الرمز" : error.message === "OTP_INVALID" ? "الرمز غير صحيح" : error.message === "ORDER_TAKEN" ? "سبق أن قبل كابتن آخر هذا الطلب" : error.message === "ORDER_NOT_FOUND" ? "الطلب غير موجود" : error.message === "ORDER_NOT_AVAILABLE" ? "الطلب لم يعد متاحًا" : error.message === "DRIVER_BUSY" ? "لديك رحلة نشطة بالفعل، أكملها أولًا" : error.message === "DRIVER_PROFILE_MISSING" ? "ملف الكابتن غير موجود. أعد تفعيل الحساب من الإدارة" : error.message === "DRIVER_BLOCKED" ? "الحساب موقوف من الإدارة" : error.message === "DELIVERY_DRIVER_ONLY" ? "هذا الطلب مخصص لكابتن مسجل في خدمة التوصيل" : error.message === "TAXI_DRIVER_ONLY" ? "هذا الطلب مخصص لكابتن تكسي مسجل لخدمة الركوب" : error.message === "OUTSIDE_DRIVER_AREA" ? "هذا الطلب خارج نطاق المدينة المسجلة لحسابك" : error.message === "LOCATION_REQUIRED" ? "يجب تفعيل GPS وتحديد موقعك الحالي قبل قبول أي طلب" : error.message === "OUTSIDE_REQUEST_RADIUS" ? `هذا الطلب أصبح خارج نطاق ${DRIVER_REQUEST_RADIUS_KM} كم من موقعك الحالي` : error.message === "INSUFFICIENT_WALLET" ? `رصيدك غير كافٍ. يلزم ${driverOperationFee(state.orders.find(item=>item.firestoreId===button.dataset.id)||"parcel").toLocaleString("ar-IQ")} د.ع لقبول هذا الطلب. اشحن المحفظة أولًا.` : error.message === "USER_PROFILE_MISSING" ? "ملف المحفظة غير موجود. أعد تسجيل الدخول." : driverFirestoreMessage(error, button.dataset.action === "accept" ? "قبول الطلب" : "تحديث حالة الرحلة"));
  } finally {
    busy(button, false);
  }
});

byId("driverTopupForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!state.user)return;
  const amount=Math.round(Number(byId("driverTopupAmount")?.value||0));
  const transferReference=byId("driverTopupReference")?.value.trim()||"";
  if(!Number.isFinite(amount)||amount<1000||amount>1000000)return toast("أدخل مبلغًا بين 1,000 و1,000,000 د.ع");
  if(transferReference.length<3)return toast("اكتب مرجع التحويل");
  if(driverHasPendingTopup())return toast("لديك طلب شحن قيد المراجعة. لا يمكن إرسال طلب آخر حتى تعتمد الإدارة الطلب أو ترفضه.");
  const button=event.submitter||byId("driverTopupSubmit");busy(button,true,"جاري الإرسال…");
  try{const requestRef=doc(collection(db,"topupRequests"));const batch=writeBatch(db);batch.set(requestRef,{userId:state.user.uid,customerName:state.userData?.name||state.user.displayName||"كابتن",email:state.user.email||"",amount,transferReference:transferReference.slice(0,80),method:"mastercard_local",accountType:"captain",accountRole:state.userData?.role||"driver",status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});batch.set(doc(db,"topupLocks",state.user.uid),{userId:state.user.uid,requestId:requestRef.id,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await batch.commit();state.topupRequests=[{firestoreId:requestRef.id,userId:state.user.uid,amount,transferReference,status:"pending",createdAt:null},...state.topupRequests.filter(x=>x.firestoreId!==requestRef.id)];renderDriverTopupRequests();event.currentTarget.reset();toast("تم إرسال طلب الشحن مرة واحدة. انتظر قرار الإدارة قبل طلب جديد.");}catch(error){console.error(error);toast(error?.code==="permission-denied"?"يوجد طلب شحن قيد المراجعة بالفعل أو لم تُنشر قواعد Phase 79 بعد.":"تعذر إرسال طلب الشحن");}finally{busy(button,false);updateDriverTopupFormState();}
});

onAuthStateChanged(auth, user => {
  state.user = user;
  if (state.userUnsubscribe) state.userUnsubscribe();
  state.topupUnsubscribe?.(); state.topupUnsubscribe=null; state.topupRequests=[];
  clearViewListeners();
  if (!user) {
    state.userData = null;
    state.driverData = null;
    state.notifications = [];
    state.notificationsLoadedFor = null;
    state.deviceNotificationsEnabled = false;
    state.topupSnapshotReady = false;
    renderDriverNotifications();
    updateDriverNotificationSetting();
    if (state.directRegistration) {
      fillApplication();
      showView("application");
    } else {
      showView("auth");
    }
    return;
  }

  registerDriverPushToken(user); window.setTimeout(()=>registerDriverPushToken(user),5000);
  state.userUnsubscribe = onSnapshot(doc(db, "users", user.uid), async snapshot => {
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
    const deviceCheck = await enforceDeviceSession(db,user,state.userData);
    if (!deviceCheck.ok) {
      const message=deviceCheck.message;
      await signOut(auth);
      window.setTimeout(()=>{showView("auth");byId("authError").textContent=message;},40);
      return;
    }
    state.deviceNotificationsEnabled = state.userData.notifications !== false && driverNativePermissionGranted();
    updateDriverNotificationSetting();
    renderDriverWallet();
    if (!state.topupUnsubscribe) subscribeDriverTopups(user);
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
  if (state.locationWatchId !== null) {
    if(window.KarwaGeo?.clearWatch)window.KarwaGeo.clearWatch(state.locationWatchId);
    else navigator.geolocation?.clearWatch?.(state.locationWatchId);
  }
});

// Phase 11 — mutual reputation and safety
window.karwaRateCustomer=async(orderId)=>{
  const score=Number(prompt("قيّم الراكب من 1 إلى 5:","5"));if(!score||score<1||score>5||!state.user)return;
  try{
    const order=state.orders.find(item=>item.firestoreId===orderId);if(!order||!order.userId)throw new Error("ORDER_NOT_FOUND");
    await setDoc(doc(db,"customerRatings",orderId),{orderId,customerId:order.userId,driverId:state.user.uid,score:Math.round(score),createdAt:serverTimestamp()});
    toast("تم تقييم الراكب");
  }catch(e){console.error(e);toast("تعذر حفظ التقييم أو تم تقييم الرحلة سابقًا");}
};
window.karwaDriverSOS=async(orderId)=>{
  if(!state.user||!confirm("إرسال تنبيه سلامة عاجل للإدارة؟"))return;
  try{
    await addDoc(collection(db,"safetyEvents"),{orderId,reportedBy:state.user.uid,reporterRole:"driver",kind:"driver_sos",latitude:state.lastPosition?.latitude??null,longitude:state.lastPosition?.longitude??null,note:"SOS من الكابتن",createdAt:serverTimestamp()});
    toast("تم إرسال تنبيه السلامة");
  }catch(e){console.error(e);toast("تعذر إرسال التنبيه");}
};

// Phase 61 — road alerts + two-driver verification directly with Firestore (no Cloud Function for this feature)
const communityLayers={reports:new Map(),reportData:new Map(),landmarks:new Map(),landmarkData:[],started:false,proximity:new Map(),activePrompt:null,myVerificationRounds:new Map()};
const reportMeta={traffic:["🚦","ازدحام"],accident:["💥","حادث"],closure:["⛔","شارع مغلق"],roadwork:["🚧","حفريات / أعمال طريق"],hazard:["⚠️","عائق على الطريق"]};
const ROAD_REPORT_WARNING_M=150;
const ROAD_REPORT_RESET_M=220;
const ROAD_REPORT_PROMPT_SECONDS=6;
const ROAD_REPORT_VERIFY_MAX_M=120;
function communityIcon(kind,type="report",confirmations=0,name=""){
 const meta=reportMeta[kind]||["📌","بلاغ"],badge=type==='report'&&confirmations?`<b class="confirm-badge">${confirmations}</b>`:"";
 if(type==='landmark'){
  const label=escapeHtml(name||"معلم كروة");
  return window.L.divIcon({className:"karwa-landmark-div-icon",html:`<div class="karwa-landmark-label" title="${label}"><span>${label}</span></div>`,iconSize:[180,34],iconAnchor:[90,17]});
 }
 return window.L.divIcon({className:"",html:`<div class="road-report-marker">${meta[0]}${badge}</div>`,iconSize:[38,38],iconAnchor:[19,19]});
}
function reportLifetimeMs(x){const c=Number(x.confirmations||0);if(x.type==='closure')return c>=2?6*3600000:2*3600000;if(c>=3)return 4*3600000;if(c>=1)return 2*3600000;return 60*60000;}
function reportIsLive(x){const ts=x.createdAt?.toMillis?.()||Date.parse(x.createdAtISO||0);return x.active!==false&&ts&&Date.now()-ts<reportLifetimeMs(x);}
function roadReportRound(x){return Math.max(0,Math.floor(Number(x?.verificationRound||0)));}
function roadReportDistanceMeters(position,x){if(!position?.coords)return Infinity;return haversine({latitude:Number(position.coords.latitude),longitude:Number(position.coords.longitude)},{latitude:Number(x.latitude),longitude:Number(x.longitude)})*1000;}
function roadReportArrivalRadius(position){const accuracy=Math.max(0,Number(position?.coords?.accuracy||0));return Math.max(32,Math.min(55,accuracy>0?accuracy*.75:36));}
function roadReportAnsweredByMe(reportId,x){const uid=state.user?.uid;if(!uid)return true;if(x.reportedBy===uid)return true;if(x.lastVerifiedBy===uid&&x.lastVerificationResult==='present')return true;if((Array.isArray(x.confirmedBy)&&x.confirmedBy.includes(uid))||(Array.isArray(x.absenceVotes)&&x.absenceVotes.includes(uid)))return true;return communityLayers.myVerificationRounds.get(reportId)===roadReportRound(x);}
function roadReportTransactionMessage(error){const key=String(error?.karwaCode||error?.code||error?.message||"").toUpperCase();if(key.includes('TOO_FAR'))return "يجب أن تكون قريبًا من موقع البلاغ لتأكيد حالته.";if(key.includes('LOCATION_STALE'))return "موقعك لم يُحدّث بعد. انتظر GPS لحظات ثم حاول.";if(key.includes('ALREADY_VERIFIED'))return "سبق أن تحققت من هذا البلاغ في الجولة الحالية.";if(key.includes('REPORT_REMOVED')||key.includes('NOT_FOUND'))return "البلاغ لم يعد موجودًا على الخريطة.";if(key.includes('DRIVER_ONLY')||key.includes('PERMISSION_DENIED'))return "هذه الميزة متاحة للكباتن المعتمدين فقط.";if(key.includes('UNAUTHENTICATED'))return "سجّل الدخول من جديد ثم حاول مرة أخرى.";return "تعذر تسجيل التحقق. تحقق من الإنترنت ومن قواعد Firestore ثم أعد المحاولة.";}
function karwaRoadError(code){const error=new Error(code);error.karwaCode=code;return error;}
async function verifyRoadReportDirect(reportId,answer){
 if(!state.user)throw karwaRoadError('UNAUTHENTICATED');
 if(!['yes','no'].includes(answer))throw karwaRoadError('INVALID_VERIFICATION');
 const uid=state.user.uid,reportRef=doc(db,'roadReports',reportId),driverRef=doc(db,'drivers',uid),verificationRef=doc(db,'roadReportVerifications',`${reportId}_${uid}`);
 return runTransaction(db,async tx=>{
  const reportSnap=await tx.get(reportRef),driverSnap=await tx.get(driverRef),verificationSnap=await tx.get(verificationRef);
  if(!reportSnap.exists())throw karwaRoadError('REPORT_REMOVED');
  if(!driverSnap.exists())throw karwaRoadError('DRIVER_ONLY');
  const report=reportSnap.data(),driver=driverSnap.data();
  if(report.active===false)throw karwaRoadError('REPORT_REMOVED');
  const lat=Number(driver.latitude),lng=Number(driver.longitude),rLat=Number(report.latitude),rLng=Number(report.longitude),updatedAt=driver.locationUpdatedAt?.toMillis?.()||driver.updatedAt?.toMillis?.()||0;
  if(![lat,lng,rLat,rLng].every(Number.isFinite)||!updatedAt||Date.now()-updatedAt>120000)throw karwaRoadError('LOCATION_STALE');
  const distance=haversine({latitude:lat,longitude:lng},{latitude:rLat,longitude:rLng})*1000;
  if(!Number.isFinite(distance)||distance>ROAD_REPORT_VERIFY_MAX_M)throw karwaRoadError('TOO_FAR');
  const round=roadReportRound(report),oldVerification=verificationSnap.exists()?verificationSnap.data():null;
  if(oldVerification&&Number(oldVerification.round)===round)throw karwaRoadError('ALREADY_VERIFIED');
  if(oldVerification&&Number(oldVerification.round)>round)throw karwaRoadError('ALREADY_VERIFIED');
  const verification={reportId,driverId:uid,answer,round,driverLatitude:lat,driverLongitude:lng,locationAccuracy:Math.max(0,Number(driver.locationAccuracy||0)),verifiedAt:serverTimestamp()};
  tx.set(verificationRef,verification,{merge:true});
  const base={lastVerificationId:verificationRef.id,lastVerificationResult:answer==='yes'?'present':'absent',lastVerifiedBy:uid,lastVerifiedAt:serverTimestamp(),updatedAt:serverTimestamp()};
  if(answer==='yes'){
   tx.update(reportRef,{...base,active:true,confirmations:Number(report.confirmations||0)+1,absenceVoteCount:0,firstAbsentBy:'',firstAbsentAt:null,verificationRound:round+1});
   return {kept:true,removed:false,status:'present',distance:Math.round(distance),round:round+1};
  }
  const firstAbsentBy=String(report.firstAbsentBy||'').trim(),hasValidFirst=Number(report.absenceVoteCount||0)===1&&!!firstAbsentBy;
  if(hasValidFirst&&firstAbsentBy===uid)throw karwaRoadError('ALREADY_VERIFIED');
  if(hasValidFirst){
   tx.update(reportRef,{...base,active:false,absenceVoteCount:2,firstAbsentBy,removedBySecond:uid,removedReason:'two_distinct_drivers_confirmed_absent',removedAt:serverTimestamp(),verificationRound:round});
   return {kept:false,removed:true,status:'removed',noVotes:2,distance:Math.round(distance)};
  }
  tx.update(reportRef,{...base,active:true,absenceVoteCount:1,firstAbsentBy:uid,firstAbsentAt:serverTimestamp(),verificationRound:round});
  return {kept:true,removed:false,status:'awaiting_second',noVotes:1,distance:Math.round(distance)};
 });
}
function ensureRoadVerificationDialog(){
 let overlay=byId("roadReportVerifyOverlay");if(overlay)return overlay;
 const style=document.createElement("style");style.id="roadReportVerifyStyle";style.textContent=`
 #roadReportVerifyOverlay{position:fixed;inset:0;z-index:10080;display:grid;place-items:end center;padding:18px;background:linear-gradient(180deg,rgba(4,18,28,.08),rgba(4,18,28,.52));backdrop-filter:blur(2px)}
 #roadReportVerifyOverlay[hidden]{display:none!important}.road-verify-card{width:min(440px,100%);box-sizing:border-box;background:#fff;border:1px solid rgba(5,88,83,.16);border-radius:24px;padding:18px;box-shadow:0 22px 70px rgba(0,0,0,.28);direction:rtl;text-align:right;animation:roadVerifyIn .18s ease-out}.road-verify-head{display:flex;align-items:center;gap:12px}.road-verify-icon{width:54px;height:54px;border-radius:17px;display:grid;place-items:center;background:#e9f8f5;font-size:30px;flex:0 0 auto}.road-verify-copy{min-width:0;flex:1}.road-verify-copy small{display:block;color:#00756f;font-weight:900;margin-bottom:3px}.road-verify-copy h2{font-size:19px;margin:0;color:#102e3d}.road-verify-question{margin:14px 0 13px;color:#304a59;font-weight:800;line-height:1.65}.road-verify-timer{height:5px;background:#e7eef2;border-radius:8px;overflow:hidden;margin-bottom:14px}.road-verify-timer>i{display:block;height:100%;width:100%;background:#008f88;transform-origin:right center;animation:roadVerifyTimer 6s linear forwards}.road-verify-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.road-verify-actions button{min-height:48px;border:0;border-radius:14px;font:inherit;font-weight:950;cursor:pointer}.road-verify-yes{background:#087b75;color:#fff}.road-verify-no{background:#fff1f1;color:#a62323;border:1px solid #f0bebe!important}.road-verify-actions button:disabled{opacity:.55;cursor:wait}.road-verify-note{display:block;text-align:center;color:#6b7e88;font-size:11px;font-weight:800;margin-top:10px}@keyframes roadVerifyIn{from{transform:translateY(22px);opacity:0}to{transform:none;opacity:1}}@keyframes roadVerifyTimer{to{transform:scaleX(0)}}`;
 document.head.appendChild(style);
 overlay=document.createElement("div");overlay.id="roadReportVerifyOverlay";overlay.hidden=true;overlay.innerHTML=`<section class="road-verify-card" role="dialog" aria-modal="true" aria-labelledby="roadReportVerifyTitle"><div class="road-verify-head"><div class="road-verify-icon" id="roadReportVerifyIcon">⚠️</div><div class="road-verify-copy"><small>تحقق ميداني · <span id="roadReportVerifyCountdown">6</span> ثوانٍ</small><h2 id="roadReportVerifyTitle">بلاغ طريق</h2></div></div><p class="road-verify-question">هل لا يزال هذا البلاغ موجودًا في هذا المكان؟</p><div class="road-verify-timer"><i id="roadReportVerifyTimerBar"></i></div><div class="road-verify-actions"><button type="button" class="road-verify-yes" id="roadReportVerifyYes">نعم، ما زال موجودًا</button><button type="button" class="road-verify-no" id="roadReportVerifyNo">لا، لم يعد موجودًا</button></div><small class="road-verify-note">إذا اخترت «لا» فلن يختفي البلاغ إلا بعد تأكيد كابتن ثانٍ مختلف.</small></section>`;
 document.body.appendChild(overlay);return overlay;
}
function closeRoadVerificationPrompt(reason="closed"){
 const current=communityLayers.activePrompt;if(!current)return;clearInterval(current.interval);clearTimeout(current.timeout);communityLayers.activePrompt=null;const overlay=byId("roadReportVerifyOverlay");if(overlay)overlay.hidden=true;if(reason==='timeout')toast("انتهى وقت التحقق — يمكنك التأكيد عند المرور بالموقع مرة أخرى.");
}
async function submitRoadVerification(reportId,answer){
 const current=communityLayers.activePrompt;if(!current||current.reportId!==reportId)return;
 const yes=byId("roadReportVerifyYes"),no=byId("roadReportVerifyNo");if(yes)yes.disabled=true;if(no)no.disabled=true;clearInterval(current.interval);clearTimeout(current.timeout);
 try{
  const result=await verifyRoadReportDirect(reportId,answer);
  if(answer==='yes'){toast("تم تأكيد أن البلاغ ما زال موجودًا — شكرًا لك.");}
  else if(result.removed){toast("أكد كابتنان زوال البلاغ — تم حذفه من خريطة كروة.");}
  else toast("تم تسجيل «لا». ننتظر تأكيد كابتن آخر يمر بالمكان.");
  closeRoadVerificationPrompt("answered");
 }catch(error){console.error("road verification",error);toast(roadReportTransactionMessage(error));closeRoadVerificationPrompt("error");}
}
function showRoadVerificationPrompt(reportId,x,distanceM){
 if(communityLayers.activePrompt||!state.user)return;const meta=reportMeta[x.type]||["⚠️","بلاغ طريق"],overlay=ensureRoadVerificationDialog();const icon=byId("roadReportVerifyIcon"),title=byId("roadReportVerifyTitle"),countdown=byId("roadReportVerifyCountdown"),bar=byId("roadReportVerifyTimerBar"),yes=byId("roadReportVerifyYes"),no=byId("roadReportVerifyNo");if(icon)icon.textContent=meta[0];if(title)title.textContent=`${meta[1]}${x.note?` — ${String(x.note).slice(0,55)}`:""}`;if(countdown)countdown.textContent=String(ROAD_REPORT_PROMPT_SECONDS);if(bar){bar.style.animation='none';void bar.offsetWidth;bar.style.animation=`roadVerifyTimer ${ROAD_REPORT_PROMPT_SECONDS}s linear forwards`;}if(yes){yes.disabled=false;yes.onclick=()=>submitRoadVerification(reportId,'yes');}if(no){no.disabled=false;no.onclick=()=>submitRoadVerification(reportId,'no');}overlay.hidden=false;
 let remaining=ROAD_REPORT_PROMPT_SECONDS;const interval=setInterval(()=>{remaining-=1;if(countdown)countdown.textContent=String(Math.max(0,remaining));},1000);const timeout=setTimeout(()=>closeRoadVerificationPrompt("timeout"),ROAD_REPORT_PROMPT_SECONDS*1000);communityLayers.activePrompt={reportId,interval,timeout,openedAt:Date.now(),distanceM};try{navigator.vibrate?.([90,55,90]);}catch(_){}
}
function warnRoadReportAhead(reportId,x,distanceM){const meta=reportMeta[x.type]||["⚠️","بلاغ طريق"],meters=Math.max(1,Math.round(distanceM/10)*10);toast(`${meta[0]} ${meta[1]} أمامك على بعد ${meters} م`);addDriverNotification({id:`road-ahead:${reportId}:${Date.now()}`,type:"warning",title:`${meta[0]} تنبيه طريق بعد ${meters} م`,message:`${meta[1]}${x.note?` — ${String(x.note).slice(0,100)}`:""}`,target:"map",device:true});try{navigator.vibrate?.([180,80,180]);}catch(_){} }
function checkRoadReportProximity(position){
 if(!position?.coords||!state.user||!state.driverData?.online)return;const arrival=roadReportArrivalRadius(position);
 for(const [id,x] of communityLayers.reportData){if(!reportIsLive(x))continue;const distanceM=roadReportDistanceMeters(position,x);let encounter=communityLayers.proximity.get(id);if(!encounter){encounter={warned:false,prompted:false,lastDistance:Infinity};communityLayers.proximity.set(id,encounter);}if(distanceM>ROAD_REPORT_RESET_M){encounter.warned=false;encounter.prompted=false;}if(distanceM<=ROAD_REPORT_WARNING_M&&!encounter.warned){encounter.warned=true;warnRoadReportAhead(id,x,distanceM);}if(distanceM<=arrival&&!encounter.prompted&&!roadReportAnsweredByMe(id,x)){encounter.prompted=true;showRoadVerificationPrompt(id,x,distanceM);}encounter.lastDistance=distanceM;
 }
}
window.karwaConfirmRoadReport=async(id)=>{if(!state.user)return toast("سجّل الدخول أولًا");try{await sharePosition(state.lastPosition,true).catch(()=>{});const result=await verifyRoadReportDirect(id,"yes");toast(result.removed?"البلاغ لم يعد موجودًا":"تم تأكيد البلاغ — شكرًا لك");}catch(e){console.error(e);toast(roadReportTransactionMessage(e));}};
function startDriverCommunityLayers(){if(communityLayers.started||!state.map||!state.user)return;communityLayers.started=true;
  onSnapshot(query(collection(db,"roadReportVerifications"),where("driverId","==",state.user.uid)),snap=>{communityLayers.myVerificationRounds.clear();snap.forEach(d=>{const x=d.data(),reportId=String(x.reportId||"");if(reportId)communityLayers.myVerificationRounds.set(reportId,Math.max(0,Math.floor(Number(x.round||0))));});if(state.lastPosition)checkRoadReportProximity(state.lastPosition);},error=>console.warn("تعذر تحميل سجل تحقق البلاغات",error));
  onSnapshot(collection(db,"roadReports"),snap=>{const live=new Set(),liveData=new Map();snap.forEach(d=>{const x=d.data();if(!reportIsLive(x))return;live.add(d.id);liveData.set(d.id,x);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;const label=reportMeta[x.type]?.[1]||"بلاغ طريق",c=Number(x.confirmations||0),mine=roadReportAnsweredByMe(d.id,x),absenceCount=Number(x.absenceVoteCount||0);let m=communityLayers.reports.get(d.id);if(!m){m=window.L.marker(ll,{icon:communityIcon(x.type,"report",c)}).addTo(state.map);communityLayers.reports.set(d.id,m)}else{m.setLatLng(ll);m.setIcon(communityIcon(x.type,"report",c));}const verifyStatus=absenceCount===1?'<br><small>كابتن واحد أفاد بزواله — بانتظار تحقق ثانٍ.</small>':`<br><small>${c?`أكده ${c} من الكباتن`:'بلاغ حديث'}</small>`;m.bindPopup(`<div dir="rtl"><b>${label}</b>${x.note?`<br>${escapeHtml(x.note)}`:""}${verifyStatus}${mine?'':`<br><button class="report-confirm" onclick="karwaConfirmRoadReport('${d.id}')">✓ ما زال موجودًا</button>`}</div>`);
  });communityLayers.reportData=liveData;for(const [id,m] of communityLayers.reports)if(!live.has(id)){state.map.removeLayer(m);communityLayers.reports.delete(id);communityLayers.proximity.delete(id);communityLayers.myVerificationRounds.delete(id);if(communityLayers.activePrompt?.reportId===id)closeRoadVerificationPrompt("removed");}if(state.lastPosition)checkRoadReportProximity(state.lastPosition);},error=>console.warn("تعذر تحميل بلاغات الطريق",error));
  onSnapshot(collection(db,"landmarks"),snap=>{const live=new Set(),data=[];snap.forEach(d=>{const x=d.data();if(x.status==="hidden")return;data.push({...x,id:d.id});live.add(d.id);const ll=[Number(x.latitude),Number(x.longitude)];if(!Number.isFinite(ll[0])||!Number.isFinite(ll[1]))return;let m=communityLayers.landmarks.get(d.id);const landmarkName=x.name||"معلم كروة",landmarkCategory=x.category||"معلم محلي",landmarkIcon=communityIcon(null,"landmark",0,landmarkName);if(!m){m=window.L.marker(ll,{icon:landmarkIcon,riseOnHover:true,title:landmarkName}).addTo(state.map);communityLayers.landmarks.set(d.id,m)}else{m.setLatLng(ll);m.setIcon(landmarkIcon)}m.bindPopup(`<div dir="rtl"><b>${escapeHtml(landmarkName)}</b><br><small>${escapeHtml(landmarkCategory)} · أضيف بواسطة ${x.createdByRole==='driver'?'كابتن':'عميل'}</small></div>`)});communityLayers.landmarkData=data;driverMapSearchCache.clear();for(const [id,m] of communityLayers.landmarks)if(!live.has(id)){state.map.removeLayer(m);communityLayers.landmarks.delete(id)}});
}
async function submitRoadReport(type){if(!state.user)return toast("سجّل الدخول أولًا");const p=state.lastPosition?.coords;if(!p||!Number.isFinite(Number(p.latitude)))return toast("فعّل GPS وانتظر تحديد موقعك");const meta=reportMeta[type];if(!meta)return;try{await addDoc(collection(db,"roadReports"),{type,note:byId("roadReportNote")?.value.trim()||"",latitude:Number(p.latitude),longitude:Number(p.longitude),reportedBy:state.user.uid,reporterName:state.driverData?.name||"كابتن كروة",confirmedBy:[state.user.uid],confirmations:1,absenceVotes:[],absenceVoteCount:0,firstAbsentBy:"",verificationRound:0,active:true,createdAt:serverTimestamp(),createdAtISO:new Date().toISOString()});if(byId("roadReportNote"))byId("roadReportNote").value="";toast(`تم إرسال بلاغ: ${meta[1]}`)}catch(e){console.error(e);toast("تعذر حفظ البلاغ — انشر قواعد Firestore الجديدة")}}
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
  locateButton?.addEventListener("click",async()=>{
    const usePosition=position=>{state.lastPosition=position;showOwnPosition(position);selectPlace({lat:position.coords.latitude,lon:position.coords.longitude,name:"موقعي الحالي",display_name:`دقة الموقع نحو ${Math.round(position.coords.accuracy||0)} متر`,namedetails:{"name:ar":"موقعي الحالي"}});};
    const lastAcc=Number(state.lastPosition?.coords?.accuracy||9999),lastAge=Date.now()-Number(state.lastPosition?.timestamp||0);
    locateButton.disabled=true;locateButton.textContent="جاري تثبيت GPS…";
    try{const pos=(state.lastPosition&&lastAcc<=35&&lastAge<10000)?state.lastPosition:await getDriverPrecisePosition();usePosition(pos);}
    catch(error){handleDriverLocationError(error);}
    finally{locateButton.disabled=false;locateButton.textContent="⌖ تحديد موقعي على الخريطة";}
  });
  byId("driverSaveMapLandmark")?.addEventListener("click",async()=>{
    if(!state.user)return toast("سجّل الدخول أولًا");const name=byId("driverMapLandmarkName")?.value.trim();if(!name||name.length<3)return toast("اكتب اسم المعلم بوضوح");initializeDriverMap();const center=state.map.getCenter(),point=state.mapSearchSelection||{latitude:center.lat,longitude:center.lng};
    try{await addDoc(collection(db,"landmarks"),{name,category:byId("driverMapLandmarkCategory")?.value||"place",latitude:Number(point.latitude),longitude:Number(point.longitude),createdBy:state.user.uid,createdByName:state.driverData?.name||"كابتن كروة",createdByRole:"driver",status:"active",createdAt:serverTimestamp(),createdAtISO:new Date().toISOString()});byId("driverMapLandmarkName").value="";driverMapSearchCache.clear();selection.textContent=`تمت إضافة المعلم: ${name}`;toast("تمت إضافة المعلم إلى خريطة كروة");}catch(error){console.error(error);toast("تعذر إضافة المعلم — تحقق من الاتصال والصلاحيات");}
  });
}
setupDriverMapPlaceTool();

const karwaBonusExpiryRefresh=setInterval(()=>{if(state.user)renderDriverWallet();},60000);
