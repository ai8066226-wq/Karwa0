import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const DEVICE_KEY_RE = /^KDW1-[A-F0-9]{64}$/;

function roleFamily(role="") {
  if (["driver","driverApplicant"].includes(role)) return "driver";
  if (["serviceProvider","serviceApplicant"].includes(role)) return "service";
  return role === "admin" ? "admin" : "customer";
}

export function nativeDeviceInfo() {
  let key = "";
  let label = "Android";
  try { key = String(window.KarwaNative?.getDeviceBindingId?.() || "").trim().toUpperCase(); } catch (_) {}
  try { label = String(window.KarwaNative?.getDeviceLabel?.() || "Android").trim().slice(0,120) || "Android"; } catch (_) {}
  return { key, label, native: Boolean(key && DEVICE_KEY_RE.test(key)) };
}

export function requireNativeRegistrationDevice() {
  const info = nativeDeviceInfo();
  if (!info.native) {
    const error = new Error("DEVICE_NATIVE_REQUIRED");
    error.code = "device/native-required";
    throw error;
  }
  return info;
}

export function addDeviceRegistrationWrites(batch, db, uid, role, info) {
  if (!uid || !info?.native) throw new Error("DEVICE_NATIVE_REQUIRED");
  const family = roleFamily(role);
  batch.set(doc(db, "deviceBindings", info.key), {
    deviceKey: info.key,
    userId: uid,
    roleFamily: family,
    status: "active",
    deviceLabel: info.label,
    boundAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, "accountDeviceLinks", uid), {
    userId: uid,
    deviceKey: info.key,
    roleFamily: family,
    deviceLabel: info.label,
    boundAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, "deviceAccess", uid, "devices", info.key), {
    active: true,
    boundAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function submitReplacementRequest(db, user, userData, info) {
  await setDoc(doc(db, "deviceChangeRequests", user.uid), {
    userId: user.uid,
    accountRole: String(userData?.role || "customer"),
    accountName: String(userData?.name || user.displayName || "مستخدم كروة").slice(0,80),
    email: String(userData?.email || user.email || "").slice(0,160),
    newDeviceKey: info.key,
    newDeviceLabel: info.label,
    status: "pending",
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/**
 * Enforces one active Android device per non-admin account.
 * Legacy accounts without deviceBound are bound atomically on their first native login.
 */
export async function enforceDeviceSession(db, user, userData) {
  if (!user || !userData) return { ok: false, reason: "missing-profile", message: "ملف الحساب غير مكتمل." };
  if (userData.role === "admin") return { ok: true, admin: true };
  const info = nativeDeviceInfo();
  if (!info.native) {
    return {
      ok: false,
      reason: "native-required",
      message: "هذا الحساب محمي ببصمة الجهاز. افتحه من تطبيق كروة على Android."
    };
  }

  if (userData.deviceBound === true) {
    try {
      const access = await getDoc(doc(db, "deviceAccess", user.uid, "devices", info.key));
      if (access.exists() && access.data()?.active === true) return { ok: true, info };
    } catch (error) {
      console.warn("device access check", error);
    }
    try {
      await submitReplacementRequest(db, user, userData, info);
      return {
        ok: false,
        reason: "replacement-pending",
        message: "هذا الحساب مرتبط بهاتف آخر. تم إرسال طلب استبدال الجهاز إلى الإدارة؛ بعد الموافقة سجّل الدخول مجددًا."
      };
    } catch (error) {
      if (String(error?.code || "").includes("permission-denied")) {
        return {
          ok: false,
          reason: "device-in-use",
          message: "هذا الهاتف مرتبط بحساب كروة آخر ولا يمكن استخدامه لحساب ثانٍ."
        };
      }
      throw error;
    }
  }

  // Legacy Phase <=80 account: first native device claims the account if the device is free.
  try {
    await runTransaction(db, async transaction => {
      const bindingRef = doc(db, "deviceBindings", info.key);
      const bindingSnap = await transaction.get(bindingRef);
      if (bindingSnap.exists()) {
        const binding = bindingSnap.data();
        if (binding.userId !== user.uid || binding.status !== "active") throw new Error("DEVICE_IN_USE");
      }
      const family = roleFamily(userData.role);
      if (!bindingSnap.exists()) {
        transaction.set(bindingRef, {
          deviceKey: info.key,
          userId: user.uid,
          roleFamily: family,
          status: "active",
          deviceLabel: info.label,
          boundAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      transaction.set(doc(db, "accountDeviceLinks", user.uid), {
        userId: user.uid,
        deviceKey: info.key,
        roleFamily: family,
        deviceLabel: info.label,
        boundAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      transaction.set(doc(db, "deviceAccess", user.uid, "devices", info.key), {
        active: true,
        boundAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      transaction.update(doc(db, "users", user.uid), { deviceBound: true, updatedAt: serverTimestamp() });
    });
    return { ok: true, info, migrated: true };
  } catch (error) {
    if (String(error?.message || "").includes("DEVICE_IN_USE") || String(error?.code || "").includes("permission-denied")) {
      return {
        ok: false,
        reason: "device-in-use",
        message: "هذا الهاتف مرتبط بحساب كروة آخر ولا يمكن ربط حساب ثانٍ به."
      };
    }
    throw error;
  }
}
