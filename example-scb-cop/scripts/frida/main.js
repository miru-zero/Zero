function sendLog(payload) {
  console.log(JSON.stringify(payload));
}

// --- toggles ---
const MINIMAL_HOOKS = true; // true = ปิด WebView + URL.openConnection (ลด noise / DexGuard)
const LOG_HTTP = true;      // true = log OkHttp request + response (เปิดได้แม้ MINIMAL_HOOKS)
const LOG_CRYPTO = false; // true = log AES doFinal / SecretKeySpec (อาจรบกวน V-OS)
const LOG_GSON = false;   // true = log ทุก Gson fromJson/toJson (รบกวน telemetry encrypt)
const LOG_SOCKET = false; // true = log SocketChannel (hook นี้เสี่ยงพัง)

const HIDE_STACK = [
  "frida", "Frida", "re.frida", "FridaAgent", "frida-agent", "frida-server",
  "xposed", "Xposed", "lsposed", "LSPosed", "EdXposed",
  "substrate", "Substrate", "libsubstrate", "libriru",
  "de.robv.android.xposed", "com.saurik.substrate",
  "miruzero", "MiruZero",
];

function stackClassHidden(name) {
  if (!name) return false;
  const s = String(name);
  for (let i = 0; i < HIDE_STACK.length; i++) {
    if (s.indexOf(HIDE_STACK[i]) !== -1) return true;
  }
  return false;
}

function filterStackTraceElements(trace) {
  if (!trace || trace.length === 0) return trace;
  const kept = [];
  for (let i = 0; i < trace.length; i++) {
    const el = trace[i];
    try {
      if (!stackClassHidden(el.getClassName())) kept.push(el);
    } catch (e) {
      kept.push(el);
    }
  }
  if (kept.length === trace.length) return trace;
  return Java.array("java.lang.StackTraceElement", kept);
}

function installAntiDetection() {
  try {
    const Thread = Java.use("java.lang.Thread");
    const threadGetStackTrace = Thread.getStackTrace;
    Thread.getStackTrace.implementation = function () {
      return filterStackTraceElements(threadGetStackTrace.call(this));
    };
  } catch (e) {}

  try {
    const Throwable = Java.use("java.lang.Throwable");
    const throwableGetStackTrace = Throwable.getStackTrace;
    Throwable.getStackTrace.implementation = function () {
      return filterStackTraceElements(throwableGetStackTrace.call(this));
    };
  } catch (e) {}

  try {
    const STE = Java.use("java.lang.StackTraceElement");
    const getClassNameOrig = STE.getClassName;
    STE.getClassName.implementation = function () {
      const cn = getClassNameOrig.call(this);
      if (stackClassHidden(cn)) return "dalvik.system.VMStack";
      return cn;
    };
  } catch (e) {}

  try {
    const Debug = Java.use("android.os.Debug");
    Debug.isDebuggerConnected.implementation = function () {
      return false;
    };
    Debug.waitingForDebugger.implementation = function () {
      return false;
    };
  } catch (e) {}

  try {
    const File = Java.use("java.io.File");
    const existsOrig = File.exists;
    File.exists.implementation = function () {
      const path = this.getAbsolutePath();
      if (
        path &&
        (path.indexOf("frida") !== -1 ||
          path.indexOf("xposed") !== -1 ||
          path.indexOf("magisk") !== -1 ||
          path.indexOf("/data/local/tmp") !== -1)
      ) {
        return false;
      }
      return existsOrig.call(this);
    };
  } catch (e) {}

  try {
    const RNS = Java.use("com.scb.corporate.ReactNativeSecurity");
    RNS.isUSBDebuggingEnabled.implementation = function (promise) {
      promise.resolve(false);
    };
    RNS.isWirelessDebuggingEnabled.implementation = function (promise) {
      promise.resolve(false);
    };
  } catch (e) {}

  console.log("✅ Anti-detection (stack / Debug / RNS) พร้อมใช้งาน");
}

// =================================================================
// Byte helpers — รองรับ Java byte[], ArrayBuffer, Uint8Array
// =================================================================
function toJsBytes(input) {
  if (input === null || input === undefined) return null;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  try {
    if (input.getClass && String(input.getClass().getName()) === "[B") {
      const len = input.length;
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = input[i] & 0xff;
      return out;
    }
  } catch (e) {}
  if (typeof input.length === "number") {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] & 0xff;
    return out;
  }
  return null;
}

function bytesToHex(input) {
  const bytes = toJsBytes(input);
  if (!bytes || bytes.length === 0) return "[empty]";
  return Array.from(bytes, (b) => ("00" + b.toString(16)).slice(-2)).join(" ");
}

function bytesToUTF8(input) {
  try {
    const bytes = toJsBytes(input);
    if (!bytes || bytes.length === 0) return "[empty]";

    const StringCls = Java.use("java.lang.String");
    const Charset = Java.use("java.nio.charset.Charset");
    const javaBytes = Java.array("byte", Array.from(bytes));
    const decoded = StringCls.$new(javaBytes, Charset.forName("UTF-8"));
    const str = decoded.toString();

    let bad = 0;
    const sampleLen = Math.min(str.length, 100);
    for (let i = 0; i < sampleLen; i++) {
      const c = str.charCodeAt(i);
      if (c === 0xfffd) bad++;
      else if (c < 32 && c !== 9 && c !== 10 && c !== 13) bad++;
    }

    if (bad > 2) {
      const Base64 = Java.use("android.util.Base64");
      const b64 = Base64.encodeToString(javaBytes, 2);
      return "[Binary Base64]: " + b64.substring(0, 200);
    }
    return str;
  } catch (e) {
    return "[Hex]: " + bytesToHex(input);
  }
}

Java.perform(() => {
  console.log(
    "🛠️ [Ultimate Stabilizer] กำลังใช้งานระบบตัดวงจรลูปและความปลอดภัยเครือข่าย...",
  );

  installAntiDetection();
  if (MINIMAL_HOOKS) {
    console.log("ℹ️ MINIMAL_HOOKS=true — ปิด WebView/URL.openConnection (OkHttp ควบคุมด้วย LOG_HTTP)");
  }

  // =================================================================
  // 1. Anti-Proxy (System.getProperty)
  // =================================================================
  try {
    const System = Java.use("java.lang.System");
    System.getProperty.overload("java.lang.String").implementation = function (key) {
      if (key && (key.indexOf("proxyHost") !== -1 || key.indexOf("proxyPort") !== -1)) {
        return null;
      }
      return this.getProperty(key);
    };
  } catch (e) {
    console.log("⚠️ ไม่สามารถแก้สิทธิ์ System.getProperty ได้");
  }

  // =================================================================
  // 2. ซ่อน USB Debugging
  // =================================================================
  try {
    const Secure = Java.use("android.provider.Settings$Secure");
    const Global = Java.use("android.provider.Settings$Global");
    const SystemProperties = Java.use("android.os.SystemProperties");

    Secure.getString.overload("android.content.ContentResolver", "java.lang.String").implementation =
      function (cr, name) {
        if (name === "adb_enabled" || name === "development_settings_enabled") return "0";
        return this.getString(cr, name);
      };

    Secure.getInt.overload("android.content.ContentResolver", "java.lang.String", "int").implementation =
      function (cr, name, def) {
        if (name === "adb_enabled" || name === "development_settings_enabled") return 0;
        return this.getInt(cr, name, def);
      };

    Global.getString.overload("android.content.ContentResolver", "java.lang.String").implementation =
      function (cr, name) {
        if (name === "adb_enabled") return "0";
        return this.getString(cr, name);
      };

    Global.getInt.overload("android.content.ContentResolver", "java.lang.String", "int").implementation =
      function (cr, name, def) {
        if (name === "adb_enabled") return 0;
        return this.getInt(cr, name, def);
      };

    SystemProperties.get.overload("java.lang.String").implementation = function (key) {
      if (
        key === "sys.usb.state" ||
        key === "init.svc.adbd" ||
        key === "persist.sys.usb.config" ||
        key === "sys.usb.config" ||
        key === "vendor.usb.config"
      ) {
        return "none";
      }
      return this.get(key);
    };

    console.log("✅ เพิ่มระบบซ่อนสถานะ USB Debugging สำเร็จ");
  } catch (e) {
    console.log("⚠️ ไม่สามารถแก้สิทธิ์ USB Debugging state ได้");
  }

  // =================================================================
  // 2.5 ซ่อน VPN / Proxy
  // =================================================================
  try {
    const ConnectivityManager = Java.use("android.net.ConnectivityManager");
    const NetworkInfo = Java.use("android.net.NetworkInfo");
    const NetworkCapabilities = Java.use("android.net.NetworkCapabilities");
    const DetailedState = Java.use("android.net.NetworkInfo$DetailedState");
    const TRANSPORT_VPN = 4;
    const NET_CAPABILITY_NOT_VPN = 15;

    function createFakeMobileNetworkInfo() {
      const fake = NetworkInfo.$new(0, 0, "MOBILE", "LTE");
      fake.mIsAvailable.value = true;
      fake.setDetailedState(DetailedState.CONNECTED.value, null, null);
      return fake;
    }

    ConnectivityManager.getActiveNetworkInfo.implementation = function () {
      return createFakeMobileNetworkInfo();
    };

    NetworkCapabilities.hasTransport.overload("int").implementation = function (t) {
      if (t === TRANSPORT_VPN) return false;
      return this.hasTransport(t);
    };

    NetworkCapabilities.hasCapability.overload("int").implementation = function (cap) {
      if (cap === NET_CAPABILITY_NOT_VPN) return true;
      return this.hasCapability(cap);
    };

    console.log("✅ เพิ่มระบบซ่อนสถานะ VPN/Proxy สำเร็จ");
  } catch (e) {
    console.log("⚠️ ไม่สามารถแก้สิทธิ์ VPN/Proxy state ได้");
  }

  // =================================================================
  // 2.6 FLAG_SECURE removal
  // =================================================================
  try {
    const Window = Java.use("android.view.Window");
    Window.setFlags.implementation = function (flags, mask) {
      const FLAG_SECURE = 0x00002000;
      if ((flags & FLAG_SECURE) !== 0) flags &= ~FLAG_SECURE;
      return this.setFlags(flags, mask);
    };
    console.log("✅ เพิ่มระบบลบ FLAG_SECURE สำเร็จ");
  } catch (e) {
    console.log("⚠️ ไม่สามารถติดตั้ง FLAG_SECURE removal ได้");
  }

  // =================================================================
  // 3. Keep Screen On
  // =================================================================
  try {
    const Activity = Java.use("android.app.Activity");
    const FLAG_KEEP_SCREEN_ON = 0x00000080;

    function keepScreenOn(activity) {
      try {
        const window = activity.getWindow();
        if (window !== null) window.addFlags(FLAG_KEEP_SCREEN_ON);
      } catch (e) {}
    }

    Activity.onCreate.implementation = function (savedInstanceState) {
      keepScreenOn(this);
      return this.onCreate(savedInstanceState);
    };

    Activity.onResume.implementation = function () {
      keepScreenOn(this);
      return this.onResume();
    };

    console.log("✅ เพิ่มระบบป้องกันหน้าจอดับสำเร็จ");
  } catch (e) {
    console.log("⚠️ ไม่สามารถติดตั้ง Keep Screen On ได้");
  }

  // =================================================================
  // Crypto hooks — ติดตั้งเฉพาะเมื่อ LOG_CRYPTO=true (ไม่รบกวน V-OS/encryptData)
  // =================================================================
  if (LOG_CRYPTO) {
    try {
      const Cipher = Java.use("javax.crypto.Cipher");
      Cipher.doFinal.overload("[B").implementation = function (input) {
        const result = this.doFinal(input);
        try {
          const algo = this.getAlgorithm();
          if (algo && algo.indexOf("AES") !== -1) {
            console.log(`\n🔐 [Crypto Match] Algorithm: ${algo}`);
            if (input !== null) console.log(`├─ Input: ${bytesToUTF8(input)}`);
            if (result !== null) console.log(`└─ Output: ${bytesToUTF8(result)}`);
            sendLog({
              type: "crypto_secure",
              algo: algo,
              input_string: input ? bytesToUTF8(input).substring(0, 500) : "null",
              output_string: result ? bytesToUTF8(result).substring(0, 500) : "null",
            });
          }
        } catch (e) {}
        return result;
      };

      const SecretKeySpec = Java.use("javax.crypto.spec.SecretKeySpec");
      SecretKeySpec.$init.overload("[B", "java.lang.String").implementation = function (key, algorithm) {
        try {
          console.log(`\n🔑 [Key Generation] Algorithm: ${algorithm}`);
          console.log(`└─ Key Hex: ${bytesToHex(key)}`);
          sendLog({ type: "crypto_key", algo: algorithm, key_hex: bytesToHex(key) });
        } catch (e) {}
        return this.$init(key, algorithm);
      };
    } catch (e) {
      console.log("⚠️ ไม่สามารถติดตั้ง crypto logger ได้");
    }
  }

  // =================================================================
  // OkHttp logging
  // =================================================================
  function readOkHttpBody(body, label) {
    try {
      if (!body || !body.$className) return "[no body]";
      const contentType = body.contentType();
      const typeStr = contentType ? contentType.toString() : "";
      if (
        typeStr.indexOf("image/") !== -1 ||
        typeStr.indexOf("audio/") !== -1 ||
        typeStr.indexOf("video/") !== -1 ||
        typeStr.indexOf("application/octet-stream") !== -1 ||
        typeStr.indexOf("application/pdf") !== -1 ||
        typeStr.indexOf("zip") !== -1
      ) {
        const len = body.contentLength();
        return `[binary ${label}: ${typeStr}, length=${len >= 0 ? len : "unknown"}]`;
      }
      if (label === "response") {
        const peeked = body.peekBody(8192);
        return bytesToUTF8(peeked.bytes()).substring(0, 2000);
      }
      if (body.isOneShot && body.isOneShot()) return "[one-shot request body skipped]";
      if (body.isDuplex && body.isDuplex()) return "[duplex request body skipped]";
      const BufferCls = Java.use("okio.Buffer");
      const buffer = BufferCls.$new();
      body.writeTo(buffer);
      const raw = buffer.readByteArray(Math.min(buffer.size(), 8192));
      return bytesToUTF8(raw).substring(0, 2000);
    } catch (e) {
      return `[${label} body read error: ${e.message}]`;
    }
  }

  function prettyJsonOrRaw(str) {
    try {
      if (typeof str === "string" && str.length > 0 && (str.trim().startsWith("{") || str.trim().startsWith("["))) {
        return JSON.stringify(JSON.parse(str), null, 2);
      }
    } catch (e) {}
    return String(str);
  }

  function treeLinesFromHeaders(headersStr) {
    const entries = String(headersStr || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (entries.length === 0) return ["│  └─ [none]"];
    return entries.map((h, i) => {
      const branch = i === entries.length - 1 ? "└─" : "├─";
      return `│  ${branch} ${h}`;
    });
  }

  function treeLinesFromBody(bodyStr) {
    const pretty = prettyJsonOrRaw(bodyStr);
    let lines = pretty.split("\n");
    if (lines.length > 40) {
      lines = lines.slice(0, 39).concat([`... (${pretty.split("\n").length - 39} more lines truncated)`]);
    }
    if (lines.length === 0 || (lines.length === 1 && lines[0].length === 0)) return ["   └─ [empty]"];
    return lines.map((b, i) => {
      const branch = i === lines.length - 1 ? "└─" : "├─";
      return `   ${branch} ${b}`;
    });
  }

  function logHttpTree(title, primary, secondary, headersStr, bodyStr, isRequest) {
    const lines = [title];
    if (isRequest) {
      lines.push(`├─ URL     : ${primary}`);
      lines.push(`├─ Method  : ${secondary}`);
    } else {
      lines.push(`├─ Code    : ${primary}`);
      lines.push(`├─ Message : ${secondary}`);
    }
    lines.push("├─ Headers :");
    treeLinesFromHeaders(headersStr).forEach((l) => lines.push(l));
    lines.push("└─ Body    :");
    treeLinesFromBody(bodyStr).forEach((l) => lines.push(l));
    console.log("\n" + lines.join("\n"));
  }

  try {
    const RequestBuilder = Java.use("okhttp3.Request$Builder");
    RequestBuilder.url.overload("okhttp3.HttpUrl").implementation = function (httpUrl) {
      return this.url(httpUrl);
    };
    RequestBuilder.url.overload("java.lang.String").implementation = function (urlStr) {
      return this.url(urlStr);
    };
    RequestBuilder.url.overload("java.net.URL").implementation = function (urlObj) {
      return this.url(urlObj);
    };
    RequestBuilder.header.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
      return this.header(name, value);
    };
    RequestBuilder.addHeader.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
      return this.addHeader(name, value);
    };
  } catch (e) {
    console.log("⚠️ ไม่สามารถติดตั้ง Request$Builder logger ได้");
  }

  if (!LOG_HTTP) {
    console.log("ℹ️ HTTP logger ปิดอยู่ (LOG_HTTP=false)");
  }

  try {
    if (!LOG_HTTP) throw new Error("http logging disabled");
    const RealCall = Java.use("okhttp3.internal.connection.RealCall");
    const executeOrig = RealCall.execute;
    RealCall.execute.implementation = function () {
      const request = this.request();
      let response = null;
      let error = null;

      try {
        logHttpTree(
          "🌐 [HTTP Request]",
          request.url().toString(),
          request.method(),
          request.headers().toString(),
          readOkHttpBody(request.body(), "request"),
          true,
        );
      } catch (e) {}

      try {
        response = executeOrig.call(this);
        logHttpTree(
          "📥 [HTTP Response]",
          response.code(),
          response.message(),
          response.headers().toString(),
          readOkHttpBody(response.body(), "response"),
          false,
        );
      } catch (execErr) {
        error = execErr;
        console.log(`❌ [HTTP Error] ${execErr}`);
      }

      if (error) throw error;
      return response;
    };

    try {
      const enqueueOrig = RealCall.enqueue.overload("okhttp3.Callback");
      RealCall.enqueue.overload("okhttp3.Callback").implementation = function (callback) {
        try {
          const request = this.request();
          logHttpTree(
            "🌐 [HTTP Request]",
            request.url().toString(),
            request.method(),
            request.headers().toString(),
            readOkHttpBody(request.body(), "request"),
            true,
          );
        } catch (e) {}
        enqueueOrig.call(this, callback);
      };
    } catch (e) {
      console.log("⚠️ ไม่สามารถ hook RealCall.enqueue ได้");
    }

    try {
      const CallbackCls = Java.use("okhttp3.Callback");
      const onResponseOrig = CallbackCls.onResponse.overload("okhttp3.Call", "okhttp3.Response");
      CallbackCls.onResponse.overload("okhttp3.Call", "okhttp3.Response").implementation = function (call, response) {
        try {
          logHttpTree(
            "📥 [HTTP Response]",
            response.code(),
            response.message(),
            response.headers().toString(),
            readOkHttpBody(response.body(), "response"),
            false,
          );
        } catch (e) {}
        onResponseOrig.call(this, call, response);
      };
    } catch (e) {
      console.log("⚠️ ไม่สามารถ hook okhttp3.Callback ได้");
    }

    console.log("✅ เพิ่มขอบเขตดักจับโครงข่าย OkHttp สำเร็จ (request + response)");
  } catch (e) {
    if (String(e).indexOf("http logging disabled") === -1) {
      console.log("⚠️ ข้าม OkHttp (แอปพลิเคชันนี้อาจไม่ได้ใช้งานไลบรารีนี้)");
    }
  }

  // WebView
  try {
    if (MINIMAL_HOOKS) throw new Error("minimal hooks");
    const WebView = Java.use("android.webkit.WebView");
    WebView.loadUrl.overload("java.lang.String").implementation = function (url) {
      console.log(`\n🖥️ [WebView Load URL] Target: ${url}`);
      sendLog({ type: "webview", url: url });
      return this.loadUrl(url);
    };
    console.log("✅ เพิ่มขอบเขตดักจับหน้าเว็บ WebView สำเร็จ");
  } catch (e) {
    console.log("❌ ไม่สามารถดักจับ WebView ได้");
  }

  // Gson — ปิด default เพื่อไม่รบกวน telemetry encryptData
  if (LOG_GSON) {
    try {
      const Gson = Java.use("com.google.gson.Gson");
      Gson.fromJson.overload("java.lang.String", "java.lang.Class").implementation = function (json, classOfT) {
        console.log(`\n📥 [JSON Received - Gson]: ${classOfT.getName()}`);
        console.log(`└─ ${json}`);
        return this.fromJson(json, classOfT);
      };
      Gson.toJson.overload("java.lang.Object").implementation = function (src) {
        const jsonResult = this.toJson(src);
        console.log(`\n📤 [JSON Sending - Gson]: ${jsonResult}`);
        return jsonResult;
      };
      console.log("✅ เพิ่มระบบแกะโครงสร้างแพ็กเกจ JSON (Gson) สำเร็จ");
    } catch (e) {}
  } else {
    console.log("ℹ️ Gson logger ปิดอยู่ (LOG_GSON=false) — ลดการรบกวน encryptData/telemetry");
  }

  // SocketChannel — ปิด default (hook เดิมใช้ buf.array() ผิด)
  if (LOG_SOCKET) {
    try {
      const SocketChannelImpl = Java.use("sun.nio.ch.SocketChannelImpl");
      SocketChannelImpl.write.overload("java.nio.ByteBuffer").implementation = function (buf) {
        try {
          const size = buf.remaining();
          if (size > 0) console.log(`\n🔀 [Socket Outgoing] ${size} bytes`);
        } catch (e) {}
        return this.write(buf);
      };
    } catch (e) {}
  }

  // URL.openConnection fallback logger
  try {
    if (MINIMAL_HOOKS) throw new Error("minimal hooks");
    const JavaURL = Java.use("java.net.URL");
    function logUrlOpenConnection(urlObj) {
      try {
        const urlStr = urlObj.toString();
        console.log(`\n🚨 [URL.openConnection] ${urlStr}`);
        sendLog({ type: "url_openconnection", url: urlStr });
      } catch (e) {}
    }
    JavaURL.openConnection.overload().implementation = function () {
      logUrlOpenConnection(this);
      return this.openConnection();
    };
    JavaURL.openConnection.overload("java.net.Proxy").implementation = function (proxy) {
      logUrlOpenConnection(this);
      return this.openConnection(proxy);
    };
  } catch (e) {}
});
