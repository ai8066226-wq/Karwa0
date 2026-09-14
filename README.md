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


## Phase 16 — Arabic Search & RTL Fix
- إصلاح عرض النص العربي واتجاه RTL في الخريطة ونتائج البحث.
- تفعيل دعم تشكيل وترتيب العربية في MapLibre مع fallback للمتصفحات القديمة.
- تحسين بحث Nominatim: أسماء عربية/كردية/إنجليزية، ترتيب حسب التطابق والقرب، نتائج أكثر، إزالة التكرار، وذاكرة مؤقتة للبحث.
- ما يزال المشروع Spark-compatible ولا يحتاج Cloud Functions للحجز الأساسي.

## Phase 17 — Waze-Style Navigation
- Valhalla هو محرك الملاحة الأساسي للسيارة: مسار قيادة، ETA، وتعليمات المناورات.
- OSRM يعمل كبديل تلقائي إذا تعذر خادم Valhalla العام.
- خط المسار أصبح أوضح، مع توجيه الانعطاف التالي في بوابة الكابتن.
- اتجاه أيقونة الكابتن يتبع heading من GPS عند توفره.
- النسخة ما زالت Firebase Spark Edition ولا تعتمد على Cloud Functions للحجز الأساسي.

### ملاحظة تشغيلية
خادم Valhalla المستخدم هنا هو خادم demo عام تابع لـ FOSSGIS ومناسب للتطوير والاستخدام العادل، وليس ضمان استضافة إنتاجية لتطبيق كبير. عند نمو كروة يجب استضافة Valhalla خاص بك أو اختيار مزود إنتاجي.

## Phase 18 — Community Traffic + Arabic Driver Map + Landmarks
- إصلاح عرض النص العربي في خريطة الكابتن بإضافة RTL text plugin وتنسيق RTL للنوافذ المنبثقة.
- بلاغات طريق مباشرة من الكابتن: ازدحام، حادث، شارع مغلق، حفريات، وعائق. تظهر للراكب والكباتن لمدة 3 ساعات بصريًا.
- معالم كروة: يستطيع العميل تحريك الخريطة فوق معلم غير موجود، تسميته وتصنيفه وحفظه في Firestore.
- المعالم المضافة تظهر على الخرائط وتدخل في نتائج البحث داخل كروة.
- أضيفت مجموعتا Firestore: `roadReports` و `landmarks` مع قواعد Spark-compatible.

### مهم بعد رفع الملفات
انسخ محتوى `firestore.rules` الجديد إلى Firestore Rules واضغط Publish، وإلا لن تعمل إضافة البلاغات والمعالم.

## Phase 19 — Verified Traffic & Shared Landmarks
- يستطيع العميل والكابتن إضافة معالم محلية إلى خريطة كروة. العميل يحددها من مركز الخريطة، والكابتن يحفظها عند موقع GPS الحالي.
- يستطيع الكباتن تأكيد البلاغات الموجودة بزر «ما زال موجودًا»، ويظهر عدد التأكيدات على العلامة.
- مدة البلاغ ديناميكية: البلاغات غير المؤكدة تنتهي أسرع، والبلاغات المؤكدة تبقى أطول، وإغلاق الطريق المؤكد يبقى حتى 6 ساعات بصريًا.
- تنبيه للكابتن عند الاقتراب لمسافة نحو 700 متر من بلاغ حديث.
- المعالم المضافة من العميل والكابتن تظهر للطرفين، وتدخل معالم كروة في بحث العميل.
- هذه نسخة Spark-compatible. يجب نشر `firestore.rules` الجديدة بعد رفع الملفات.
- ملاحظة إنتاجية: إعادة توجيه المسار لتجنب إغلاق طريق بشكل مضمون تحتاج محرك Routing يدعم live closures أو backend خاص؛ النسخة الحالية تعرض الإغلاق وتنبه الكابتن ولا تدّعي أن Valhalla العام يعرف إغلاق كروة المحلي.

## Phase 20 — Map-First Floating UI
- خريطة كبيرة بملء مساحة شاشة الراكب والكابتن.
- لوحة حجز عائمة قابلة للتصغير فوق خريطة العميل.
- لوحة طلبات عائمة قابلة للتصغير للكابتن مع إبقاء الخريطة ظاهرة دائمًا.
- بطاقات ETA والملاحة والحالة أصبحت عائمة فوق الخريطة.
- أدوات البلاغات وحالة الاتصال موزعة كعناصر عائمة ومناسبة للموبايل.
- يحافظ هذا الإصدار على Firebase Spark وميزات Phase 19 (المعالم المشتركة والبلاغات والتأكيدات).

## Phase 33 — Advanced Map Search & Stable Driver Tools
- زر «بلاغات الطريق» يمرر محتوى لوحة الكابتن داخليًا من دون تحريك عنوان اللوحة أو إخفاء الأزرار خلفه.
- زر «تحديد موقعي على الخريطة» داخل بطاقة البحث والمعالم للعميل والكابتن، مع علامة دقيقة قابلة للاستخدام عند إضافة معلم.
- بحث متقدم حسب نوع المكان: مطاعم، صحة، تسوق، تعليم، وقود وفنادق.
- نطاقان للبحث: قريب من مساحة الخريطة الحالية أو في كل العراق.
- ترتيب النتائج حسب جودة التطابق والقرب، وإظهار المسافة عن مركز الخريطة.
- البحث يتم بزر البحث أو Enter للمحافظة على استخدام معتدل لخدمة Nominatim العامة.

## تحديث أنواع التسجيل
أصبحت شاشة إنشاء الحساب تعرض ثلاثة أنواع مستقلة: عميل، كابتن، وخدمات أخرى. حساب خدمات أخرى مخصص لمزودي الخدمات مثل المطاعم ولا يتحول إلى حساب كابتن عند اعتماده.

## Phase 34 — بوابة الخدمات الأخرى والاعتماد الإداري

- زر «خدمات أخرى» في الصفحة الرئيسية يفتح بوابة مستقلة للتسجيل أو الدخول.
- إنشاء حساب خدمة يحفظ بيانات النشاط وينشئ طلبًا بحالة `pending` داخل `serviceApplications` في عملية واحدة.
- يبقى صاحب الطلب في شاشة متابعة مباشرة، ولا يفتح لوحة الخدمة قبل أن تغيّر الإدارة دوره إلى `serviceProvider`.
- لوحة الإدارة تعرض طلبات مزودي الخدمات في قسم مستقل عن طلبات الكباتن، مع قبول ذري أو رفض مرفق بملاحظة.
- عند القبول يُنشأ ملف معتمد داخل `serviceProfiles`، وتُفتح لوحة مزود الخدمة تلقائيًا من دون إعادة تسجيل الدخول.
- لوحة مزود الخدمة تدعم ملف النشاط، التصنيف، الموقع، الإظهار المؤقت، وقائمة الخدمات أو المنتجات.
- المطاعم المعتمدة تتزامن مع مجموعة `restaurants` للمحافظة على ظهور الوجبات في تطبيق العميل.
- قواعد Firestore تمنع الحساب من اعتماد نفسه أو تعديل حقول الاعتماد، وتسمح فقط للإدارة بمنح صلاحية `serviceProvider`.

### مسار التفعيل

1. افتح `services.html?mode=register` أو اختر «تسجيل خدمة جديدة» من الصفحة الرئيسية.
2. أنشئ الحساب وأكمل بيانات النشاط؛ يُرسل الطلب تلقائيًا إلى الإدارة.
3. افتح `admin.html` بحساب دوره `admin`، ثم راجع قسم «طلبات مزودي الخدمات».
4. اختر «قبول وتفعيل» لفتح لوحة الخدمة، أو «رفض مع ملاحظة» لإتاحة التصحيح وإعادة الإرسال.

> يجب نشر `firestore.rules` المرفق قبل اختبار دورة الاعتماد الجديدة.

## Phase 35 — الهوية الموحدة وسوق الخدمات

- توحّدت الألوان الأساسية في صفحات العميل والكابتن والإدارة مع هوية بوابة الخدمات الأخرى: الكحلي والأخضر المزرق والخلفيات الفاتحة.
- أصبح تحديد موقع GPS للنشاط إلزاميًا عند تسجيل خدمة جديدة أو إعادة إرسال الطلب، ويُنسخ الموقع إلى ملف النشاط عند موافقة الإدارة.
- أضيف تبويب «خدمات أخرى» للعميل يعرض الأنشطة المعتمدة والنشطة، بما فيها المطاعم والماركت، مع الاسم والتصنيف والعنوان وإحداثيات الموقع.
- يستطيع العميل اختيار نشاط وخدمة أو منتج، كتابة تفاصيل الطلب وموقعه، ثم إرسال طلب مباشر إلى المزود.
- أضيفت مجموعة `serviceRequests` لمتابعة الطلبات؛ يستطيع المزود القبول أو الرفض مع ملاحظة أو إكمال الخدمة، ويستطيع العميل إلغاء الطلب ما دام قيد الانتظار.
- تظهر حالات الطلب لحظيًا للطرفين، وتمنع قواعد Firestore كل طرف من تعديل الحقول التي لا تخصه.

> انشر `firestore.rules` الجديدة قبل اختبار سوق الخدمات والطلبات المباشرة.

## Phase 38 — media reliability, catalog management, blocking and service ratings
- Meal/service images are compressed immediately after selection to a safe ~92 KB target and upload/download operations have timeouts so the UI cannot remain indefinitely on “جاري الإضافة”.
- Providers can edit or delete individual catalog items before publishing changes.
- Admin can block/unblock approved service providers; blocked profiles are hidden from customers and cannot receive new service requests.
- Customers can rate a completed service/product from 1–5 stars; marketplace cards show provider rating averages.
- Deploy both `firestore.rules` and `storage.rules` with this release.


## Phase 40
- تم إلغاء رفع صور الخدمات والمنتجات بالكامل لتسريع الإضافة.
- تم تحديث بطاقات الخدمات والمنتجات بتصميم احترافي يعتمد على الأيقونات والمعلومات والسعر وأزرار الإدارة.


## Phase 41 - Service request delivery fix
- Fixed customer serviceRequests creation rule that could reject valid requests when the local display name differed from users/{uid}.name.
- Provider can read its own serviceRequests by providerId identity even during role/profile refresh.
- Customer name/phone are refreshed from users/{uid} immediately before creating the request.
- Added clearer permission diagnostics in customer and provider portals.
