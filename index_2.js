const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

initializeApp();
const db = getFirestore();

async function requireAdmin(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "يلزم تسجيل دخول الإدارة.");
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.get("role") !== "admin") {
    throw new HttpsError("permission-denied", "هذه العملية للإدارة فقط.");
  }
}

async function recursiveDelete(ref) {
  if (typeof db.recursiveDelete === "function") {
    await db.recursiveDelete(ref);
  } else {
    await ref.delete().catch(() => {});
  }
}

async function docsByField(collectionName, field, value) {
  const out = [];
  let last = null;
  while (true) {
    let q = db.collection(collectionName).where(field, "==", value).orderBy(FieldPath.documentId()).limit(200);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    out.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 200) break;
  }
  return out;
}

async function deleteQueryMatches(collectionName, fields, uid, seen, counter) {
  for (const field of fields) {
    const docs = await docsByField(collectionName, field, uid);
    for (const snap of docs) {
      const key = snap.ref.path;
      if (seen.has(key)) continue;
      seen.add(key);
      await recursiveDelete(snap.ref);
      counter.count += 1;
    }
  }
}

async function deleteDirect(path, counter) {
  const ref = db.doc(path);
  const snap = await ref.get();
  if (!snap.exists) return;
  await recursiveDelete(ref);
  counter.count += 1;
}

exports.deleteAccountCompletely = onCall({ timeoutSeconds: 540, memory: "512MiB" }, async request => {
  const adminUid = request.auth?.uid;
  await requireAdmin(adminUid);
  const targetUid = String(request.data?.uid || "").trim();
  if (!targetUid || targetUid.length > 128) throw new HttpsError("invalid-argument", "معرّف الحساب غير صالح.");
  if (request.data?.confirmation !== "DELETE_COMPLETELY") throw new HttpsError("failed-precondition", "تأكيد الحذف غير صحيح.");
  if (targetUid === adminUid) throw new HttpsError("failed-precondition", "لا يمكن حذف حساب الإدارة الحالي.");

  const targetUserSnap = await db.doc(`users/${targetUid}`).get();
  if (targetUserSnap.exists && targetUserSnap.get("role") === "admin") {
    throw new HttpsError("failed-precondition", "حسابات الإدارة محمية من الحذف الشامل.");
  }

  const counter = { count: 0 };
  const seen = new Set();

  // Orders first because each order can own tracking documents and an orderSecrets document.
  const orderDocs = new Map();
  for (const field of ["userId", "driverId", "providerId"]) {
    for (const snap of await docsByField("orders", field, targetUid)) orderDocs.set(snap.id, snap);
  }
  for (const [orderId, snap] of orderDocs) {
    await recursiveDelete(snap.ref);
    counter.count += 1;
    await deleteDirect(`orderSecrets/${orderId}`, counter);
  }

  const references = [
    ["orderSecrets", ["userId"]],
    ["serviceRequests", ["customerId", "providerId"]],
    ["ratings", ["customerId", "driverId"]],
    ["customerRatings", ["customerId", "driverId"]],
    ["walletTransactions", ["driverId"]],
    ["supportTickets", ["userId"]],
    ["safetyEvents", ["reportedBy", "userId", "driverId"]],
    ["roadReports", ["reportedBy"]],
    ["landmarks", ["createdBy"]],
    ["tripShares", ["userId", "customerId", "driverId", "createdBy"]],
    ["notificationQueue", ["userId", "targetUid", "driverId", "providerId"]],
    ["authChallenges", ["userId", "uid"]],
    ["authRateLimits", ["userId", "uid"]]
  ];
  for (const [collectionName, fields] of references) {
    await deleteQueryMatches(collectionName, fields, targetUid, seen, counter);
  }

  // Documents whose IDs are the Firebase Auth UID.
  for (const collectionName of [
    "driverApplications", "drivers", "publicDrivers", "serviceApplications",
    "serviceProfiles", "restaurants", "users", "authChallenges", "authRateLimits"
  ]) {
    await deleteDirect(`${collectionName}/${targetUid}`, counter);
  }

  // No-image registration is the default, but remove legacy driver documents if any exist.
  try {
    await getStorage().bucket().deleteFiles({ prefix: `driver-documents/${targetUid}/` });
  } catch (error) {
    console.warn("Storage cleanup warning", targetUid, error?.message || error);
  }

  try {
    await getAuth().deleteUser(targetUid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }

  await db.collection("auditLogs").add({
    action: "account_deleted_completely",
    actorUid: adminUid,
    targetUid,
    deletedDocuments: counter.count,
    createdAt: FieldValue.serverTimestamp()
  });

  return { ok: true, uid: targetUid, deletedDocuments: counter.count };
});
