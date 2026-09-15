(function () {
  "use strict";

  const DEFAULT_TARGET_ACCURACY = 20;   // meters
  const DEFAULT_ACCEPTABLE_ACCURACY = 35;
  const DEFAULT_MAX_WAIT = 18000;
  const nativeWatches = new Map();
  let seq = 0;

  const nativeBridge = () => window.KarwaNative || null;
  const hasNativeLocation = () => {
    const b = nativeBridge();
    return !!(b && typeof b.startPreciseLocationWatch === "function" && typeof b.stopPreciseLocationWatch === "function");
  };

  function makeError(code, message, extra = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
  }

  function makePosition(detail) {
    return {
      coords: {
        latitude: Number(detail.latitude),
        longitude: Number(detail.longitude),
        accuracy: Number(detail.accuracy || 9999),
        altitude: detail.altitude == null ? null : Number(detail.altitude),
        altitudeAccuracy: detail.altitudeAccuracy == null ? null : Number(detail.altitudeAccuracy),
        heading: detail.heading == null ? null : Number(detail.heading),
        speed: detail.speed == null ? null : Number(detail.speed)
      },
      timestamp: Number(detail.timestamp || Date.now()),
      provider: String(detail.provider || "gps"),
      isMock: detail.mock === true
    };
  }

  function metersBetween(a, b) {
    if (!a || !b) return Infinity;
    const r = 6371000, toRad = v => Number(v) * Math.PI / 180;
    const lat1 = toRad(a.coords.latitude), lat2 = toRad(b.coords.latitude);
    const dLat = lat2 - lat1, dLon = toRad(b.coords.longitude) - toRad(a.coords.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function precisePermissionState() {
    const b = nativeBridge();
    if (!b || typeof b.preciseLocationGranted !== "function") return { native: false, precise: true, approximate: false };
    try {
      return {
        native: true,
        precise: !!b.preciseLocationGranted(),
        approximate: typeof b.approximateLocationOnly === "function" ? !!b.approximateLocationOnly() : false
      };
    } catch (_) {
      return { native: true, precise: false, approximate: false };
    }
  }

  function waitForNativePermission(timeout = 12000) {
    return new Promise(resolve => {
      let done = false;
      const finish = detail => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener("karwa-native-location-permission", onResult);
        resolve(detail || precisePermissionState());
      };
      const onResult = event => finish(event.detail || {});
      const timer = setTimeout(() => finish(precisePermissionState()), timeout);
      window.addEventListener("karwa-native-location-permission", onResult, { once: true });
      try { nativeBridge()?.requestPreciseLocationPermission?.(); }
      catch (_) { finish(precisePermissionState()); }
    });
  }

  async function ensurePrecisePermission() {
    if (!hasNativeLocation()) return true;
    let state = precisePermissionState();
    if (state.precise) return true;
    state = await waitForNativePermission();
    if (state.precise === true) return true;
    throw makeError(
      "PRECISE_PERMISSION_REQUIRED",
      state.approximate
        ? "تم السماح بالموقع التقريبي فقط. فعّل خيار «الموقع الدقيق» لكروة من إعدادات التطبيق."
        : "يلزم السماح لكروة باستخدام الموقع الدقيق.",
      { approximate: !!state.approximate }
    );
  }

  function promptPreciseSettings(message) {
    const existing = document.getElementById("karwaPreciseLocationPrompt");
    if (existing) return;
    const wrap = document.createElement("div");
    wrap.id = "karwaPreciseLocationPrompt";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(4,20,31,.54);backdrop-filter:blur(5px);display:grid;place-items:end center;padding:18px;direction:rtl;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    wrap.innerHTML = `
      <div style="width:min(100%,460px);background:#fff;border-radius:24px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.28);color:#0e2e43">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="width:48px;height:48px;border-radius:16px;display:grid;place-items:center;background:#e6f7f4;color:#087b75;font-size:25px">⌖</div>
          <div><strong style="font-size:18px">الموقع الدقيق مطلوب</strong><div style="font-size:12px;color:#67808f;margin-top:2px">لرحلات وتحديدات أدق في كروة</div></div>
        </div>
        <p style="margin:0 0 16px;line-height:1.8;font-size:14px;color:#415c6d">${String(message || "فعّل خيار الموقع الدقيق لكروة، ثم حاول مرة أخرى. هذا يمنع اعتماد موقع تقريبي مثل 200 متر.")}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
          <button id="karwaPreciseOpenSettings" type="button" style="border:0;border-radius:14px;padding:13px;font-weight:800;background:#087b75;color:#fff">فتح الإعدادات</button>
          <button id="karwaPreciseClose" type="button" style="border:1px solid #dbe6e9;border-radius:14px;padding:13px;font-weight:800;background:#fff;color:#27495d">لاحقًا</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector("#karwaPreciseClose")?.addEventListener("click", close);
    wrap.addEventListener("click", event => { if (event.target === wrap) close(); });
    wrap.querySelector("#karwaPreciseOpenSettings")?.addEventListener("click", () => {
      try { nativeBridge()?.openAppSettings?.(); } catch (_) {}
      close();
    });
  }

  function startNativeWatch(onSample, onError) {
    const id = `kg_${Date.now()}_${++seq}`;
    nativeWatches.set(id, { onSample, onError });
    try { nativeBridge().startPreciseLocationWatch(id); }
    catch (error) {
      nativeWatches.delete(id);
      onError?.(makeError("NATIVE_LOCATION_START_FAILED", "تعذر بدء GPS الدقيق", { cause: error }));
    }
    return `native:${id}`;
  }

  function stopNativeWatch(externalId) {
    const id = String(externalId || "").replace(/^native:/, "");
    nativeWatches.delete(id);
    try { nativeBridge()?.stopPreciseLocationWatch?.(id); } catch (_) {}
  }

  window.addEventListener("karwa-native-location-sample", event => {
    const detail = event.detail || {};
    const entry = nativeWatches.get(String(detail.id || ""));
    if (!entry) return;
    const position = makePosition(detail);
    if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)) return;
    entry.onSample?.(position);
  });

  window.addEventListener("karwa-native-location-error", event => {
    const detail = event.detail || {};
    const entry = nativeWatches.get(String(detail.id || ""));
    if (!entry) return;
    entry.onError?.(makeError(String(detail.code || "LOCATION_ERROR"), String(detail.message || "تعذر تحديد الموقع"), detail));
  });

  function browserWatch(onSample, onError) {
    if (!navigator.geolocation) {
      onError?.(makeError("UNSUPPORTED", "تحديد الموقع غير مدعوم في هذا الجهاز"));
      return null;
    }
    const watchId = navigator.geolocation.watchPosition(onSample, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    });
    return `web:${watchId}`;
  }

  function stopBrowserWatch(externalId) {
    const id = Number(String(externalId || "").replace(/^web:/, ""));
    if (Number.isFinite(id)) navigator.geolocation?.clearWatch?.(id);
  }

  async function getPrecisePosition(options = {}) {
    const targetAccuracy = Math.max(5, Number(options.targetAccuracy || DEFAULT_TARGET_ACCURACY));
    const acceptableAccuracy = Math.max(targetAccuracy, Number(options.acceptableAccuracy || DEFAULT_ACCEPTABLE_ACCURACY));
    const maxWait = Math.max(5000, Number(options.maxWait || DEFAULT_MAX_WAIT));
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

    await ensurePrecisePermission();

    return new Promise((resolve, reject) => {
      let best = null;
      let finished = false;
      let watchRef = null;
      const stableGpsSamples = [];

      const stop = () => {
        if (!watchRef) return;
        if (String(watchRef).startsWith("native:")) stopNativeWatch(watchRef);
        else stopBrowserWatch(watchRef);
        watchRef = null;
      };
      const finishResolve = position => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        stop();
        resolve(position);
      };
      const finishReject = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        stop();
        reject(error);
      };
      const sample = position => {
        const rawAccuracy = Number(position?.coords?.accuracy || 9999);
        if (!Number.isFinite(rawAccuracy) || rawAccuracy <= 0) return;
        // في Android لا نعتمد قراءة NETWORK كقراءة نهائية دقيقة حتى لو أعلنت قيمة صغيرة؛ ننتظر GPS/GNSS الحقيقي.
        const accuracy = position?.provider === "network" ? Math.max(rawAccuracy, 50) : rawAccuracy;
        if (!best || accuracy < Number(best.__karwaEffectiveAccuracy || best.coords.accuracy || 9999) || position.timestamp > best.timestamp + 5000) {
          best = position;
          best.__karwaEffectiveAccuracy = accuracy;
        }
        onProgress?.({ accuracy, bestAccuracy: Number(best.__karwaEffectiveAccuracy || best.coords.accuracy || accuracy), position });
        if (accuracy <= targetAccuracy && position?.provider !== "network") {
          if (rawAccuracy <= 8) { finishResolve(position); return; }
          const previous = stableGpsSamples[stableGpsSamples.length - 1];
          stableGpsSamples.push(position);
          if (stableGpsSamples.length > 4) stableGpsSamples.shift();
          if (previous && Math.abs(Number(position.timestamp || 0) - Number(previous.timestamp || 0)) >= 450) {
            const separation = metersBetween(previous, position);
            const tolerance = Math.max(18, Math.min(35, Number(previous.coords.accuracy || 20) + rawAccuracy));
            if (separation <= tolerance) {
              finishResolve(rawAccuracy <= Number(previous.coords.accuracy || 9999) ? position : previous);
            }
          }
        }
      };
      const fail = error => {
        if (error?.code === 1 || error?.code === "PERMISSION_DENIED") finishReject(makeError("PERMISSION_DENIED", "تم رفض إذن الموقع"));
        else if (error?.code === "PRECISE_PERMISSION_REQUIRED") finishReject(error);
      };

      const timer = setTimeout(() => {
        if (best && Number(best.__karwaEffectiveAccuracy || best.coords.accuracy || 9999) <= acceptableAccuracy) {
          finishResolve(best);
        } else {
          finishReject(makeError(
            "ACCURACY_TOO_LOW",
            best
              ? `دقة GPS الحالية نحو ${Math.round(best.__karwaEffectiveAccuracy || best.coords.accuracy)} متر ولم تصل للمستوى المطلوب.`
              : "لم نحصل على قراءة GPS دقيقة بعد.",
            { bestAccuracy: best ? Number(best.__karwaEffectiveAccuracy || best.coords.accuracy) : null }
          ));
        }
      }, maxWait);

      if (hasNativeLocation()) watchRef = startNativeWatch(sample, fail);
      else watchRef = browserWatch(sample, fail);
    });
  }

  function watchPosition(success, error, options = {}) {
    const maxAccuracy = Math.max(10, Number(options.maxAccuracy || 45));
    const qualityCallback = typeof options.onQuality === "function" ? options.onQuality : null;
    const externalId = `karwa-watch-${Date.now()}-${++seq}`;
    const control = { cancelled: false, inner: null, lastGoodAt: 0 };
    nativeWatches.set(externalId, control); // local control marker; native ids use different key

    const handleSample = position => {
      if (control.cancelled) return;
      const rawAccuracy = Number(position?.coords?.accuracy || 9999);
      const accuracy = position?.provider === "network" ? Math.max(rawAccuracy, 50) : rawAccuracy;
      qualityCallback?.({ accuracy, acceptable: accuracy <= maxAccuracy, position });
      if (accuracy > maxAccuracy) return;
      control.lastGoodAt = Date.now();
      success?.(position);
    };
    const handleError = err => { if (!control.cancelled) error?.(err); };

    (async () => {
      try {
        await ensurePrecisePermission();
        if (control.cancelled) return;
        control.inner = hasNativeLocation() ? startNativeWatch(handleSample, handleError) : browserWatch(handleSample, handleError);
      } catch (err) {
        handleError(err);
      }
    })();

    control.kind = "control";
    control.externalId = externalId;
    window.__karwaGeoControls = window.__karwaGeoControls || new Map();
    window.__karwaGeoControls.set(externalId, control);
    return externalId;
  }

  function clearWatch(id) {
    const controls = window.__karwaGeoControls;
    const control = controls?.get?.(id);
    if (control) {
      control.cancelled = true;
      if (control.inner) {
        if (String(control.inner).startsWith("native:")) stopNativeWatch(control.inner);
        else stopBrowserWatch(control.inner);
      }
      controls.delete(id);
      nativeWatches.delete(id);
      return;
    }
    if (String(id || "").startsWith("native:")) stopNativeWatch(id);
    if (String(id || "").startsWith("web:")) stopBrowserWatch(id);
  }

  window.KarwaGeo = {
    getPrecisePosition,
    watchPosition,
    clearWatch,
    permissionState: precisePermissionState,
    promptPreciseSettings,
    constants: {
      targetAccuracy: DEFAULT_TARGET_ACCURACY,
      acceptableAccuracy: DEFAULT_ACCEPTABLE_ACCURACY
    }
  };
})();
