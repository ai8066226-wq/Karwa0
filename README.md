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
