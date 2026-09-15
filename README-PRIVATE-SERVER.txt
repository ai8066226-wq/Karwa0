KARWA PHASE 53 — FIRESTORE ONLY

لا توجد Cloud Functions في هذه النسخة.

النشر المطلوب للقواعد فقط:
  firebase deploy --only firestore

لوحة الإدارة موجودة في private-admin/ وتعمل مباشرة مع Firestore.

الشحن المحلي:
- العميل يرسل amount + reference إلى topupRequests.
- الإدارة تتحقق من التحويل ثم تعتمد الطلب.
- الاعتماد يزيد balance داخل Firestore Transaction مباشرة.

حذف الحساب:
- الإدارة تعطل المستخدم داخل كروة وتحذف بيانات Firestore المرتبطة.
- Firebase Authentication لا يمكن حذف مستخدم آخر منه عبر Web SDK فقط.
- إذا أردت حذف سجل Auth نفسه، احذفه يدويًا من Firebase Console > Authentication > Users.

التسعير والعمولات:
- تحفظ في platformSettings/pricing.
- الدفع المحلي يحفظ في platformSettings/payments.
- لا يلزم Functions لتطبيقها في هذه النسخة.
