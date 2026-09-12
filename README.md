# Karwa Phase 14 — Live Driver Tracking & Ride Experience (Spark Edition)

هذه النسخة مبنية فوق Phase 13 ومتوافقة مع Firebase Spark للعمليات الأساسية.

## الجديد
- تتبع مباشر للكابتن مع حركة سلسة لعلامة السيارة.
- ETA ومسافة متبقية باستخدام مسار طرق OSRM مع fallback تلقائي.
- يتحول هدف المسار بعد بدء الرحلة من الراكب إلى الوجهة.
- شريط رحلة احترافي للراكب مع المرحلة الحالية وزر اتصال بالكابتن.
- لوحة ملاحة للكابتن تعرض الهدف ووقت الوصول والمسافة.
- تنبيه جودة GPS عند ضعف الدقة، وتقليل إعادة حساب المسار إلى تغييرات مفيدة.
- المحافظة على الحجز وقبول الطلب عبر Firestore مباشرة بدون Cloud Functions.

## ملاحظة إنتاجية
OSRM وNominatim العامان مناسبان للتطوير والاختبار. للإطلاق التجاري استخدم مزود خرائط/توجيه بحدود استخدام واتفاقية خدمة مناسبة أو استضافة خاصة.

# Karwa Phase 11 — Spark Edition

هذه النسخة معدلة للعمل في العمليات الأساسية بدون Cloud Functions: إنشاء الرحلة، قبول الكابتن، تحديث مراحل الرحلة وإلغاء الراكب تتم مباشرة عبر Firestore مع Transaction عند القبول.

## مهم قبل الاختبار
1. ارفع ملفات الواجهة الجديدة إلى Hosting بالطريقة التي تستخدمها.
2. انشر محتوى `firestore.rules` على Firestore Rules ثم اضغط Publish.
3. لا تحتاج إلى رفع مجلد `functions` لكي يعمل الحجز وقبول الطلب في هذه النسخة.
4. الميزات المتقدمة التي تعتمد على Functions (مثل SOS الآمن، مشاركة الرحلة الآمنة، التسعير/الكوبونات من الخادم وبعض التقييمات) تبقى محدودة حتى الانتقال لاحقًا إلى Backend.
5. هذه نسخة تطوير مناسبة لخطة Spark وليست نموذج الأمان الموصى به للإطلاق التجاري؛ السعر والعمولة وOTP في المتصفح ويمكن التلاعب بها من مستخدم متقدم.

---

# Karwa0 — Phase 7: Accounts, Security & Notifications

هذه المرحلة تنقل العمليات الحساسة من المتصفح إلى Backend موثوق باستخدام Firebase Cloud Functions، وتجهز المشروع للمصادقة بالهاتف، Push Notifications، محافظ الكباتن، سجل التدقيق ووثائق التحقق.

## أهم ما تغير
- `functions/index.js`: إنشاء رحلة وتسعيرها على الخادم، قبول الطلب Transaction آمن، انتقال حالات الرحلة، التحقق من OTP على الخادم، إلغاء العميل، تسجيل Push Token، وإنشاء قيود أرباح الكابتن.
- لم يعد OTP الخام محفوظًا داخل مستند `orders`. الطلب يحفظ `tripOtpHash` فقط، والرمز الخام في `orderSecrets` لا يستطيع قراءته إلا صاحب الطلب.
- عند إكمال الرحلة ينشأ قيد في `walletTransactions` بقيمة الرحلة والعمولة وصافي مستحق الكابتن وحالة `pending_settlement`.
- `auditLogs` يسجل إنشاء/قبول/تقدم/إكمال/إلغاء الرحلات من الخادم.
- `firestore.rules` تمنع العميل أو الكابتن من تعديل السعر والعمولة وأرباح الرحلة أو مراحلها مباشرة؛ الرحلات الحساسة تمر عبر Cloud Functions.
- `phone-auth.js`: وحدة جاهزة لـ Firebase Phone Auth + reCAPTCHA لإرسال والتحقق من OTP الحقيقي للهاتف.
- `push-notifications.js` و `firebase-messaging-sw.js`: بنية Web Push وFCM مع حفظ الرموز من خلال Backend.
- `storage.rules`: مساحة آمنة لوثائق الكابتن (صور/PDF حتى 5MB) مع وصول الكابتن نفسه أو الإدارة.
- `firebase.json`: إعداد موحد لنشر Functions + Firestore + Hosting.

## النشر
1. من Firebase Console فعّل Authentication ثم Phone provider، وأضف نطاق الاستضافة إلى Authorized domains.
2. فعّل Cloud Messaging وأنشئ Web Push certificate (VAPID key)، ثم استدعِ `enableKarwaPush()` بالمفتاح العام فقط.
3. ثبّت Firebase CLI وسجّل الدخول ثم داخل مجلد المشروع نفّذ `firebase deploy --only functions,firestore:rules,storage,hosting`.
4. تحتاج Cloud Functions عادةً مشروع Firebase بخطة تسمح بالنشر والفوترة حسب إعدادات Firebase الحالية.

## ملاحظات أمنية
- لا تضع مفاتيح خادم أو Service Account داخل HTML/JavaScript.
- Firebase Web API key الظاهر في الواجهة ليس سرًا بحد ذاته؛ الحماية الفعلية تعتمد على Authentication وSecurity Rules وApp Check وBackend authorization.
- قبل الإنتاج فعّل Firebase App Check، سياسات الاحتفاظ بالسجلات، وراقب تكلفة/حدود OSRM أو استخدم مزود Routing إنتاجي.
- التسوية المالية في هذه المرحلة Ledger داخلي وليست تحويلًا مصرفيًا فعليًا. إضافة بوابة دفع/سحب تتطلب مزود دفع مرخص وتدفقات تحقق خاصة به.

## بنية Phase 7
- `index.html`, `app.js`: تطبيق الراكب.
- `driver.html`, `driver.js`: بوابة الكابتن؛ قبول/تقدم الرحلة عبر Cloud Functions.
- `admin.html`, `admin.js`: لوحة الإدارة الحالية.
- `functions/`: Backend الموثوق.
- `firestore.rules`, `storage.rules`: صلاحيات البيانات والوثائق.
- `phone-auth.js`: مصادقة الهاتف القابلة للدمج في واجهات الدخول.
- `push-notifications.js`, `firebase-messaging-sw.js`: Push Notifications.

## المرحلة التالية المقترحة
Phase 8: Dispatch تلقائي لأقرب الكباتن، مهلة قبول وإعادة توزيع، تسعير ديناميكي، كوبونات، إلغاء وغرامات، عناوين محفوظة، دعم وشكاوى، ثم بوابة تسوية مالية إنتاجية.

## Phase 8 — Smart Operations
أضيفت طبقة تشغيل ذكية فوق Phase 7:
- توزيع أولي للطلب على أقرب 5 كباتن متصلين اعتمادًا على آخر موقع معروف للكابتن.
- نافذة أولوية 30 ثانية للكباتن المرشحين، ثم يصبح الطلب متاحًا لبقية الكباتن المتصلين إذا لم يُقبل.
- تسعير ديناميكي من الخادم حسب نسبة الطلبات المتاحة إلى الكباتن المتصلين: 1.00x / 1.15x / 1.30x.
- نظام كوبونات server-side يدعم نسبة أو مبلغ ثابت، حدًا أدنى للرحلة، سقف خصم وتاريخ انتهاء.
- رسوم إلغاء بعد قبول الكابتن (حاليًا 1,500 د.ع) مع تعويض يسجل في محفظة الكابتن.
- حفظ baseFare و surgeMultiplier و discountAmount و dispatchCandidateIds داخل الطلب للتدقيق المالي والتشغيلي.

### مثال كوبون Firestore
أنشئ مستندًا في `coupons/KARWA10` بالقيم:
`active: true`, `type: "percent"`, `value: 10`, `maxDiscount: 3000`, `minFare: 5000`.
يمكن إضافة `expiresAt` كـ Firestore Timestamp.

### ملاحظات إنتاجية
- يلزم نشر Cloud Functions وقواعد Firestore الجديدة بعد الترقية.
- تحديد أقرب الكباتن يعتمد على تحديث موقع الكابتن أثناء كونه Online. للإنتاج واسع النطاق يفضل GeoHash/GeoFire أو فهرسة جغرافية مخصصة بدل قراءة حتى 100 كابتن.
- التسعير الديناميكي الحالي سياسة واضحة وبسيطة قابلة للاستبدال لاحقًا بمحرك مناطق/أوقات أكثر دقة.

## Phase 9 — Customer Experience
- البحث عن الأماكن من داخل حقول الانطلاق والوجهة باستخدام OpenStreetMap Nominatim مع بقاء اختيار الخريطة متاحًا.
- الرحلات المجدولة: يمكن تحديد موعد لاحق، وتبقى الرحلة بحالة `scheduled` ثم يطلقها Cloud Scheduler للتوزيع قبل الموعد بحوالي 10 دقائق.
- العناوين المحفوظة: حتى 10 عناوين لكل مستخدم (البيت، العمل، المفضلة) ويمكن استخدامها كوجهة بنقرة واحدة.
- إعادة الحجز من سجل الرحلات لتحميل مسار رحلة سابقة.
- فاتورة قابلة للطباعة للرحلات المكتملة.
- تذاكر دعم محفوظة في `supportTickets` مع صلاحيات العميل والإدارة.

### متطلبات Phase 9
انشر Cloud Functions مجددًا لأن المرحلة تضيف `releaseScheduledRides` المجدولة كل دقيقة. يتطلب تشغيل الوظائف المجدولة تفعيل الخدمات/الفوترة اللازمة في مشروع Firebase/Google Cloud. خدمة البحث Nominatim مناسبة للتطوير والأحجام المحدودة؛ للإنتاج التجاري استخدم مزود Geocoding بعقد/SLA أو استضافة مناسبة والتزم بسياسة الاستخدام الخاصة بالمزود.

## Phase 10 — Production UX, PWA & Service Areas
- أضيف `manifest.webmanifest` وService Worker لتثبيت كروة كتطبيق PWA على الهاتف، مع App Shell مخزن محليًا وتجربة أفضل عند ضعف الشبكة.
- أضيف مؤشر واضح لحالة انقطاع الإنترنت. العمليات الحساسة (الحجز/القبول/تغيير حالة الرحلة) لا تُنفذ دون اتصال وتبقى Cloud Functions هي مصدر الحقيقة.
- أضيف مفهوم `serviceAreas` في Firestore. عند وجود مناطق فعالة، يتحقق الخادم أن الانطلاق والوجهة داخل نطاق خدمة فعّال قبل إنشاء الرحلة.
- حسّن Dispatch لاستبعاد الكباتن الذين لم يحدّثوا موقعهم خلال آخر دقيقتين، حتى لا تظهر حسابات Online قديمة ضمن العرض المتاح.
- يحفظ الطلب `serviceAreaId` و`serviceAreaName` لتسهيل التقارير والتسعير حسب المناطق لاحقًا.

### إعداد مناطق الخدمة
أنشئ مستندًا في `serviceAreas` مثل `mosul-center` بالقيم: `active: true`, `name: "مركز المدينة"`, و`polygon` كمصفوفة نقاط `{latitude, longitude}` مرتبة حول حدود المنطقة (3 نقاط على الأقل). إذا لم توجد أي منطقة فعالة، يعمل النظام بالنطاق الافتراضي لتسهيل التطوير. عند إضافة مناطق فعالة يصبح التحقق إلزاميًا.

### ملاحظات PWA
الـ Service Worker يعمل فقط على HTTPS أو localhost. بعد كل إصدار غيّر اسم `CACHE` في `sw.js` لضمان تحديث App Shell لدى المستخدمين. للاستخدام الإنتاجي يفضّل إضافة أيقونات PNG متعددة المقاسات وتهيئة صفحات Offline أكثر تخصيصًا.

## Phase 11 — Safety, Trust & Driver Compliance
- Safety Events / SOS are created server-side and written to `safetyEvents` with audit logging.
- Secure trip-share tokens expire after 6 hours; raw trip data is not made public by Firestore rules. A production share landing page can exchange the token through a callable/HTTP endpoint.
- Mutual reputation: passengers keep the existing driver rating flow; `driverRateCustomer` adds a server-enforced one-rating-per-trip customer rating.
- Driver compliance sweep evaluates license/registration/insurance expiry fields and writes `documentStatus` (`valid`, `expiring`, `expired`). Populate `licenseExpiresAt`, `vehicleRegistrationExpiresAt`, and `insuranceExpiresAt` on driver documents.
- Risk monitoring flags unusually long active trips and opens a safety review event for administrators.
- Before production, connect SOS events to a staffed operations workflow and local emergency guidance; do not represent the in-app SOS button as a replacement for emergency services.

## إصلاح تشخيص الحجز وقبول الكابتن
تم تحديث الواجهات بحيث تعرض سبب الخطأ الحقيقي القادم من Firebase Functions بدل الرسائل العامة. من الأمثلة: خدمة Function غير منشورة، الحساب ليس customer/driver، الكابتن غير متاح، الطلب ضمن جولة توزيع لكباتن أقرب، الموقع خارج Service Area، أو مشكلة شبكة.

بعد رفع هذه النسخة، يجب نشر الـ Backend والقواعد من مجلد المشروع (وليس Hosting فقط):

```bash
firebase use karwa0
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules,storage
firebase deploy --only hosting
```

تأكد في Firebase Console أن Functions التالية موجودة على الأقل: `createRideOrderV2`, `quoteRide`, `cancelOrderV2`, `acceptOrder`, `advanceTrip`. كما يجب أن يكون مستند `users/{uid}` للراكب بقيمة `role: customer`، ومستند الكابتن `users/{uid}` بقيمة `role: driver` مع وجود `drivers/{uid}` وأن `online: true` عند قبول الطلب.

ملاحظة التوزيع: خلال أول 30 ثانية من إنشاء الرحلة قد يرفض الخادم قبول كابتن غير موجود في `dispatchCandidateIds` برسالة `NOT_IN_DISPATCH_ROUND`. الواجهة الآن تشرح ذلك بدل عرض «تعذر تنفيذ العملية».


## Phase 15 — Free Professional Maps
- استبدال طبقة الخريطة التقليدية بطبقة Vector حديثة عبر MapLibre GL + OpenFreeMap (Liberty/Bright/Positron) بدون API key.
- بيانات الخريطة من OpenStreetMap، مع أسماء الطرق والمعالم ونقاط الاهتمام حسب توفرها في OSM.
- البحث أصبح بزر «بحث» أو Enter بدل autocomplete المستمر، التزامًا بسياسة Nominatim العامة.
- لا توجد رسوم Google Maps ولا حاجة إلى Firebase Blaze لهذه الخريطة.
- OpenFreeMap خدمة عامة مجانية بلا SLA؛ عند التوسع التجاري الكبير يُنصح بالاستضافة الذاتية أو مزود بموثوقية تعاقدية.
