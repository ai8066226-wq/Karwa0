# Karwa Phase 78 / 2.2.9

نسخة Firestore مباشرة بدون Cloud Functions.

## النشر
- `firebase deploy --only firestore:rules`
- `firebase deploy --only hosting`

الطلبات، قبول الكابتن، حالات الرحلة، طلبات الشحن، الحذف والبحث تعمل عبر Firestore والقواعد. الإشعارات الحية داخل التطبيق تعتمد على مستمعات Firestore. Push تلقائي عندما يكون التطبيق مغلقًا بالكامل غير متوفر في هذه النسخة لعدم وجود مرسل خادمي لـ FCM.
