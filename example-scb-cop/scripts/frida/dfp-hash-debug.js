/**
 * SCB.Anywhere — debug + fix dfpHash null
 *
 * Root cause: VTapPlugin.getDFPHash() reads static iVTapManager without lazy-init.
 * setupVTap() calls getVTapManager() first; getDFPHash() does not.
 *
 * Usage:
 *   frida -U -f com.scb.corporate -l dfp-hash-debug.js --no-pause
 *   # or attach:
 *   frida -U com.scb.corporate -l dfp-hash-debug.js
 */

'use strict';

const TAG = '[DFP]';
const HOOK_REGISTER_NATIVES = false; // true = log JNI RegisterNatives (อาจ trigger DexGuard)
const HOOK_VTAP_METHODS = false;     // true = patch getDFPHash lazy-init (ใช้เมื่อถึง Digital Token)
const VTAP_SETUP_READY = 40200;      // vtapSetupStatus ค่านี้ = V-OS พร้อม (จาก vtapSetupSuccess)
const DFP_RETRY_MS = 500;
const DFP_RETRY_MAX = 24;            // ~12s

/** vkey.android.vos.VosError — subset ที่พบบ่อย */
const VOS_ERROR_NAMES = {
  '-10903': 'VM_ERR_INVALID_HANDLE',
  '-10902': 'VM_ERR_BAD_ARGUMENTS',
  '-10901': 'VM_ERR_INSUFFICIENT_MEMORY',
  '-10904': 'VM_ERR_UNSUPPORTED_CRYPTO_FUNC',
  '-10303': 'VM_ERR_TRT_AUTHENTICATION_FAILED',
  '-10001': 'VM_ERR_VA_FILE_CANNOT_ACCESS',
};

function hexBytes(arr) {
  if (!arr) return 'null';
  const b = Java.array('byte', arr);
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += ('0' + (b[i] & 0xff).toString(16)).slice(-2);
  }
  return s;
}

/** j.a(): len==32 → hex hash; else first 4 bytes LE int as decimal string */
function decodeDfpRaw(arr) {
  if (!arr) return { kind: 'null', value: null };
  const b = Java.array('byte', arr);
  const len = b.length;
  if (len === 32) {
    return { kind: 'hash32', value: hexBytes(arr), note: 'full 32-byte fingerprint' };
  }
  if (len >= 4) {
    const v = ((b[3] & 0xff) << 24) | ((b[2] & 0xff) << 16) | ((b[1] & 0xff) << 8) | (b[0] & 0xff);
    const signed = v > 0x7fffffff ? v - 0x100000000 : v;
    const codeStr = String(signed);
    return {
      kind: 'errorCode',
      value: codeStr,
      vosError: VOS_ERROR_NAMES[codeStr] || 'unknown V-OS error',
      unsigned: v,
      note: 'V-OS error (len!=32) — Java อาจ resolve เป็น String ของ error int แทน dfpHash',
    };
  }
  return { kind: 'unknown', value: hexBytes(arr), len };
}

function ensureVTapManager(pluginInstance) {
  const VTapPlugin = Java.use('com.scb.corporate.vkey.vtap.VTapPlugin');
  const VTapFactory = Java.use('com.vkey.android.vtap.VTapFactory');

  let mgr = VTapPlugin.iVTapManager.value;
  if (mgr !== null) {
    console.log(TAG, 'iVTapManager already set:', mgr.$className);
    return mgr;
  }

  console.log(TAG, 'iVTapManager null — lazy init via VTapFactory.getInstance()');
  const ctx = pluginInstance.reactContext.value;
  mgr = VTapFactory.getInstance(ctx);
  VTapPlugin.iVTapManager.value = mgr;
  console.log(TAG, 'iVTapManager assigned:', mgr.$className);
  return mgr;
}

function logVtapState(pluginInstance, label) {
  try {
    const VTapPlugin = Java.use('com.scb.corporate.vkey.vtap.VTapPlugin');
    const status = pluginInstance.vtapSetupStatus.value;
    const mgr = VTapPlugin.iVTapManager.value;
    const ready = status === VTAP_SETUP_READY;
    console.log(
      TAG, label,
      'vtapSetupStatus=', status, ready ? '(READY)' : '(not ready, need 40200)',
      'iVTapManager=', mgr !== null ? mgr.$className : 'null',
      'isVosStarted=', VTapPlugin.isVosStarted(),
    );
  } catch (e) {
    console.log(TAG, label, 'state log failed:', e);
  }
}

function probeVosWrapper(ctx) {
  try {
    const VosWrapper = Java.use('vkey.android.vos.VosWrapper');
    const vos = VosWrapper.getInstance(ctx);
    const raw = vos.getDeviceFingerprintHashWithError();
    if (raw === null) {
      console.log(TAG, 'VosWrapper.getDeviceFingerprintHashWithError() => null (V-OS not ready / blocked)');
    } else {
      const dec = decodeDfpRaw(raw);
      console.log(TAG, 'VosWrapper.getDeviceFingerprintHashWithError() len=', raw.length,
        'hex=', hexBytes(raw), 'decoded=', JSON.stringify(dec));
    }
    return raw;
  } catch (e) {
    console.log(TAG, 'VosWrapper probe failed:', e);
    return null;
  }
}

Java.perform(function () {
  // --- passive: log setupVTap + status (ทำงานแม้ HOOK_VTAP_METHODS=false) ---
  try {
    const VTapPlugin = Java.use('com.scb.corporate.vkey.vtap.VTapPlugin');
    const setupOrig = VTapPlugin.setupVTap;
    VTapPlugin.setupVTap.implementation = function (okCb, errCb) {
      console.log(TAG, 'setupVTap() called');
      logVtapState(this, 'before setupVTap');
      setupOrig.call(this, okCb, errCb);
      logVtapState(this, 'after setupVTap sync return');
      console.log(TAG, 'setupVTap() returned — VGuard init ยัง async จน vtapSetupStatus=40200');
    };
  } catch (e) {
    console.log(TAG, 'setupVTap monitor skipped:', e);
  }

  if (!HOOK_VTAP_METHODS) {
    console.log(TAG, 'getDFPHash patch ปิด (HOOK_VTAP_METHODS=false) — เปิดเมื่อ debug Digital Token');
  } else {
  const VTapPlugin = Java.use('com.scb.corporate.vkey.vtap.VTapPlugin');

  function resolveDfpWithRetry(plugin, promise, attempt) {
    logVtapState(plugin, 'getDFPHash attempt ' + attempt);

    const mgr = ensureVTapManager(plugin);
    const ctx = plugin.reactContext.value;
    const raw = probeVosWrapper(ctx);
    const dec = decodeDfpRaw(raw);

    if (dec.kind === 'hash32') {
      console.log(TAG, 'getDFPHash OK hash32');
      promise.resolve(dec.value);
      return;
    }

    const status = plugin.vtapSetupStatus.value;
    const shouldRetry =
      attempt < DFP_RETRY_MAX &&
      (dec.value === '-10903' || status !== VTAP_SETUP_READY);

    if (shouldRetry) {
      console.log(TAG, 'getDFPHash retry', attempt + 1, '/', DFP_RETRY_MAX,
        'reason=', dec.vosError || dec.kind, 'status=', status);
      setTimeout(function () {
        Java.perform(function () {
          resolveDfpWithRetry(plugin, promise, attempt + 1);
        });
      }, DFP_RETRY_MS);
      return;
    }

    let hash = null;
    try {
      hash = mgr.getDFPHash();
    } catch (e) {
      console.log(TAG, 'mgr.getDFPHash() threw:', e);
    }
    console.log(TAG, 'getDFPHash final result:', hash, '(decoded native:', JSON.stringify(dec), ')');
    promise.resolve(hash);
  }

  // --- Patch getDFPHash: lazy-init + retry until V-OS handle valid ---
  VTapPlugin.getDFPHash.implementation = function (promise) {
    console.log(TAG, 'getDFPHash() hooked');
    resolveDfpWithRetry(this, promise, 0);
  };

  // --- Native layer visibility ---
  try {
    const VosWrapper = Java.use('vkey.android.vos.VosWrapper');
    const dfpOrig = VosWrapper.getDeviceFingerprintHashWithError;
    VosWrapper.getDeviceFingerprintHashWithError.implementation = function () {
      const ret = dfpOrig.call(this);
      if (ret === null) {
        console.log(TAG, '[native] getDeviceFingerprintHashWithError => null');
      } else {
        const dec = decodeDfpRaw(ret);
        console.log(TAG, '[native] getDeviceFingerprintHashWithError =>',
          'len=' + ret.length, 'hex=' + hexBytes(ret), 'decoded=', JSON.stringify(dec));
      }
      return ret;
    };
  } catch (e) {
    console.log(TAG, 'Could not hook VosWrapper native:', e);
  }
  } // end HOOK_VTAP_METHODS

  // --- encryptData probe (JS telemetry entryPoint) ---
  try {
    const SecureFileIO = Java.use('com.vkey.securefileio.SecureFileIO');
    const encryptBytes = SecureFileIO.encryptData.overload('[B', 'java.util.ArrayList');
    encryptBytes.implementation = function (input, out) {
      const ret = encryptBytes.call(this, input, out);
      console.log(TAG, '[SecureFileIO.encryptData] inLen=', input ? input.length : 0, 'ret=', ret, 'outSize=', out ? out.size() : 0);
      return ret;
    };
  } catch (e) {
    console.log(TAG, 'SecureFileIO hook skipped:', e.message || e);
  }

  // --- Runtime: hook RegisterNatives in libart (optional) ---
  if (HOOK_REGISTER_NATIVES) {
  try {
    const sym =
      Module.findExportByName('libart.so', '_ZN3art3JNIILb0EE15RegisterNativesEP7_JNIEnvP7_jclassPK15JNINativeMethodi') ||
      Module.findExportByName('libart.so', '_ZN3art3JNIILb0EE15RegisterNativesEP7_JNIEnvP7_jclassPK15JNINativeMethodi') ||
      Module.findExportByName('libart.so', 'RegisterNatives');
    if (!sym) {
      console.log(TAG, 'RegisterNatives symbol not found in libart.so');
    } else {
      Interceptor.attach(sym, {
        onEnter(args) {
          const count = args[3].toInt32();
          const methods = args[2];
          const stride = Process.pointerSize * 3;
          for (let i = 0; i < count; i++) {
            const entry = methods.add(i * stride);
            const namePtr = entry.readPointer();
            const sigPtr = entry.add(Process.pointerSize).readPointer();
            const fn = entry.add(Process.pointerSize * 2).readPointer();
            const name = namePtr.isNull() ? null : namePtr.readCString();
            const sig = sigPtr.isNull() ? null : sigPtr.readCString();
            if (!name) continue;
            if (name.indexOf('Finger') >= 0 || name.indexOf('Cel') >= 0 || name.indexOf('dfp') >= 0 ||
                name.indexOf('Device') >= 0 || sig === '()[B' || name.indexOf('Vos') >= 0) {
              console.log(TAG, '[RegisterNatives]', name, sig || '?', fn);
            }
          }
        },
      });
      console.log(TAG, 'RegisterNatives interceptor @', sym);
    }
  } catch (e) {
    console.log(TAG, 'RegisterNatives hook skipped:', e);
  }
  } // end HOOK_REGISTER_NATIVES

  console.log(TAG, 'hooks installed (VTap=' + HOOK_VTAP_METHODS + ', RegisterNatives=' + HOOK_REGISTER_NATIVES + ')');
});
