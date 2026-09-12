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
