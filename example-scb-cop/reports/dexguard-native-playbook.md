# Ghidra Playbook — DexGuard Native (libe46f / libe598)

**แอป:** SCB.Anywhere 3.9.0 (`com.scb.corporate`) · **ABI:** arm64-v8a  
**วันที่:** 2026-06-16 · **โหมด:** static only  
**Ghidra project:** `lab/apps/scb-cop/ghidra/Scb` (มี libvosWrapperEx.so, libe46f.so, libe598.so)

---

## สรุปสั้น

| หัวข้อ | ผล |
|--------|-----|
| Strings ใน .so | **เข้ารหัสทั้งหมด** — `strings` เห็นแค่ `JNI_OnLoad` + libc imports (~887/639 strings) |
| AES S-box / ChaCha / HBC magic ใน .so | **ไม่พบ** (crypto obfuscated/virtualized) |
| Export symbols | **มีแค่ `JNI_OnLoad`** (+ `__emutls_*` ใน libe598) |
| โหลด lib จาก Java | **ไม่มี `loadLibrary("e46f")` ใน smali** — โหลดผ่าน DexGuard runtime `Lvj;` + reflection ใน `MainApplication.attachBaseContext` |
| จุดอ่าน bundle | RN: `loadScriptFromAssets` @ libreactnative.so **`0x45f580`** → `AAssetManager_fromJava` (ไม่ใช่ใน DexGuard libs) |
| ทาง decrypt asset | Hook ก่อน/หลัง `AAssetManager` read **หรือ** reverse จาก `JNI_OnLoad` → `dlopen`/`dlsym`/`read`/`memcpy` chain |

---

## 1. ข้อมูล ELF (concrete)

### libe46f.so (DexGuard 9.x — APKiD)

| ฟิลด์ | ค่า |
|--------|-----|
| ขนาด | 1,598,000 bytes |
| BuildID (xxHash) | `008fadf38c64bdce` |
| Stripped | ใช่ |
| NEEDED | libc, libstdc++, libm, libdl, liblog |
| Entry VA | `0x34000` |
| **JNI_OnLoad** | VA **`0x131af8`**, size **`0xa5dc`** (42,460 bytes) |
| .text | file off `0x34000`, size `0x13b6cc`, entropy **~6.710** |
| .rodata | file off `0x2cf00`, size `0xec0`, entropy **~6.950** |
| .data | file off `0x174000`, size `0x11b90`, entropy **~1.791** |
| .got.plt | VA `0x1701f8` |
| FINI_ARRAY | VA `0x170028` → ว่าง (0, 0) |

**Prologue JNI_OnLoad (32 bytes แรก @ file `0x131af8`):**

```
fc 6f ba a9 fa 67 01 a9 f8 5f 02 a9 f6 57 03 a9
f4 4f 04 a9 fd 7b 05 a9 fd 43 01 91 ff 43 03 d1
```

### libe598.so (DexGuard 9.x — APKiD)

| ฟิลด์ | ค่า |
|--------|-----|
| ขนาด | 1,173,224 bytes |
| BuildID | `19587bf3bba9a0f5` |
| **JNI_OnLoad** | VA **`0xb7d24`**, size **`0x8478`** (33,912 bytes) |
| **__emutls_get_address** | VA `0x10836c` |
| **__emutls_register_common** | VA `0x1084c4` |
| .text | file off `0x2c000`, size `0xdc508`, entropy **~6.644** |
| .rodata | file off `0x240b0`, size `0x8d8`, entropy **~6.646** |
| .got.plt | VA `0x10c220` |

**Prologue JNI_OnLoad (เหมือน libe46f แต่ stack frame ต่างที่ +0x1c):**

```
fc 6f ba a9 ... ff 83 02 d1   ; sub sp, sp, #0xa0 (libe598) vs #0xd0 (libe46f)
```

### lib อื่นที่เกี่ยวข้อง

| ไฟล์ | หมายเหตุ |
|------|----------|
| `libe.so` | 124 bytes · ELF **ไม่มี section header** (anti-static) · น่าเป็น stub คู่ `loadLibrary("e")` |
| `libc3c13f.so` | 379 KB · **corrupted note / no section header** · ชื่อ random แบบ DexGuard · ยังไม่ import Ghidra |

---

## 2. Import table — สิ่งที่ DexGuard ใช้ (ทั้งคู่)

**I/O / memory (candidate decrypt path):**

- `read`, `fopen`, `fclose`, `close`
- `memcpy`, `memmove`, `memset`
- `malloc`, `calloc`, `realloc`, `free`
- `mprotect`

**Dynamic hooking:**

- `dlopen`, `dlsym`, `dladdr`, `dlerror`

**RASP / anti-analysis (ไม่ใช่ decrypt โดยตรง):**

- `fork`, `execv`, `prctl`, `killpg`, `raise`
- `__system_property_get`, `__system_property_foreach`, `__system_property_read`
- `pthread_*`, `syscall`, `stat`, `statfs`

**ไม่ import:** `AAssetManager_open`, `AAsset_read`, `open` (direct) — asset path น่าจะ hook ผ่าน **dlsym ไป libandroid.so** หรือ **Java instrumentation** แทน

---

## 3. Java load path (jadx + baksmali)

### 3.1 Application bootstrap

```
MainApplication.attachBaseContext()   ← DexGuard init (~1776 smali lines)
  └ super.attachBaseContext()
  └ Lvj;->c(I) / Lvj;->d(...) reflection (12 calls ใน attachBaseContext)
MainApplication.onCreate()
  └ RASP checks (stack trace / vj fields)
  └ ReactNativeApplicationEntryPoint.loadReactNative()
       └ SoLoader.init(context, OpenSourceMergedSoMapping)
       └ DefaultNewArchitectureEntryPoint.load()
```

**DexGuard runtime:** `Lvj;` (`vj.smali`, ~15,029 บรรทัด) — **ไม่มี `loadLibrary` string ในไฟล์** (decrypt ตอน runtime)

**`vj.c(I)` IDs ใน MainApplication (ใช้ breakpoint Frida / xref ใน vj.smali):**

| Method | IDs (hex) |
|--------|-----------|
| attachBaseContext | `-0x4c9fae94`, `0x0f6fbbf4`, `0x6e1e4a4a`, `-0x0a0e8c13` (×2), `0x5fcc01f0` |
| onCreate | `0x6e1e4a4a`, `-0x0a0e8c13` (×2), `0x5fcc01f0` |

### 3.2 Bundle load path (ไม่ผ่าน DexGuard lib โดยตรง)

```
ReactNativeHost.getBundleAssetName()  →  "index.android.bundle"   (classes.dex string)
JSBundleLoader.Companion.createAssetLoader(context, name, false)
  └ CatalystInstanceImpl.loadScriptFromAssets(AssetManager, name, sync)
       └ jniLoadScriptFromAssets  (native private)
            └ libreactnative.so
```

**libreactnative.so symbols (arm64, nm -D):**

| Symbol | VA |
|--------|-----|
| `facebook::react::loadScriptFromAssets(AAssetManager*, string const&)` | **`0x45f580`** |
| `facebook::react::CatalystInstanceImpl::jniLoadScriptFromAssets(...)` | **`0x450850`** |
| `facebook::react::JReactInstance::loadJSBundleFromAssets(...)` | **`0x487404`** |
| `AAssetManager_fromJava` | undefined import |
| `AAsset_getLength` | undefined import |

**สรุป:** DexGuard decrypt น่าอยู่ **ระหว่าง** `AssetManager.open()` (Java) กับ plaintext ที่ `loadScriptFromAssets` อ่านได้ — ไม่ใช่ใน RN JNI เอง

### 3.3 lib ที่ smali โหลดชัดเจน (ไม่ใช่ DexGuard)

| const-string | ไฟล์ |
|--------------|------|
| `reactnativejni` | BridgeSoLoader |
| `react_newarchdefaults` + obfuscated 2nd lib | DefaultSoLoader |
| `hermesinstancejni` | HermesInstance |
| `rninstance` | BindingsInstaller / JSRuntimeFactory |
| `vosWrapperEx` | VosWrapperBase (ผ่าน DexGuard reflection เช่นกัน) |

---

## 4. Ghidra playbook (GUI step-by-step)

### Phase A — Setup

1. เปิด project `Scb` · analyzer: **ARM v8 AARCH64**, **DWARF** (ไม่มี), **Non-Returning Functions**
2. Import order แนะนำ: **libe598.so → libe46f.so → libreactnative.so** (598 มี emutls = runtime state)
3. Memory block: ยืนยัน `.text` executable ที่ VA ตามตาราง §1

### Phase B — Entry points (rename ทันที)

| Binary | Ghidra address | Rename แนะนำ |
|--------|----------------|--------------|
| libe598.so | **`0x000b7d24`** | `DexGuard_JNI_OnLoad_e598` |
| libe46f.so | **`0x00131af8`** | `DexGuard_JNI_OnLoad_e46f` |
| libe598.so | `0x0010836c` | `DexGuard_emutls_get` |
| libreactnative.so | **`0x0045f580`** | `RN_loadScriptFromAssets` |
| libreactnative.so | `0x00450850` | `RN_jniLoadScriptFromAssets` |

### Phase C — libe598.so (เริ่มที่นี่)

1. **`DexGuard_JNI_OnLoad_e598`** → Decompile · ฟังก์ชัน ~33 KB = init + register + hook setup
2. **Search → For Scalars:** ไม่คาดหวัง string search (ว่าง)
3. **Xrefs จาก GOT `@ 0x10c220`:**
   - **`dlsym`** → rename caller เป็น `DexGuard_resolve_*` · ตาม chain หา hook target (มัก `AAssetManager_open`, `open`, `mmap`)
   - **`dlopen`** → ดู path decrypt (buffer ก่อน dlopen)
   - **`mprotect`** → มักอยู่ก่อน patch PLT/GOT หรือ unpack stub
4. **`read` / `fopen` xrefs:** หา pattern `read(fd, buf, len)` → **`memcpy(dst, buf, n)`** โดย `n ≈ 8_300_000` (ขนาด bundle) หรือ block cipher loop
5. **`__emutls_get_address` xrefs:** thread-local key material / decrypt state — rename field ที่ load/store หลัง emutls
6. **RegisterNatives hunt:** ใน decompiler หา call ผ่าน `JNIEnv*` vtable offset **215** (`RegisterNatives`) — มักอยู่ท้าย JNI_OnLoad · rename class/method arrays เป็น `DG_JNI_class_*`

### Phase D — libe46f.so

1. **`DexGuard_JNI_OnLoad_e46f`** (~42 KB) — ใหญ่กว่า 598 · อาจเป็น **crypto core** หรือ **asset decrypt engine**
2. ทำซ้ำ Phase C (dlsym/mprotect/read/memcpy)
3. **Cross-reference:** หา `dlsym` ที่ resolve symbol จาก libe598 หรือ callback จาก 598 → 46f
4. **Crypto heuristic (ไม่มี S-box ชัด):**
   - ฟังก์ชันที่มี loop 16-byte block + XOR/ADD + table lookup ผ่าน index obfuscated
   - หลัง loop → buffer ขึ้นต้น **`c6 1f bc 03`** (HBC magic) = **decrypt success**

### Phase E — เชื่อม RN (multi-binary)

1. ใน **libreactnative.so** ไป **`RN_loadScriptFromAssets` @ `0x45f580`**
2. Decompile · หา call chain ไป `AAssetManager_fromJava` → internal open/read
3. **หมายเหตุ:** ถ้า DexGuard hook PLT ของ libreactnative ต่อ `libandroid.so` จะไม่เห็นใน libe46f imports — ต้องตาม **dlsym results** จาก Phase C

### Phase F — Java-side correlation (Frida รอบหลัง / static xref)

| จุด | ใช้ทำอะไร |
|-----|-----------|
| `MainApplication.attachBaseContext` | breakpoint หลัง `Lvj;->c` เพื่อดู decrypted `Class.forName` / `Method.invoke` → ชื่อ lib |
| `JSBundleLoader.createAssetLoader` | ยืนยัน asset name `"index.android.bundle"` |
| `CatalystInstanceImpl.jniLoadScriptFromAssets` | native entry หลัง Java decrypt |

---

## 5. Alternative strategy (strings 加密)

เมื่อ Ghidra decompile เป็น spaghetti ไม่มี string:

1. **Compare execution trace** (ต้องรันแอพ): hook `__system_property_get` returns จาก libe598 = RASP ไม่ใช่ decrypt
2. **Memory dump gate:** hook `RN_loadScriptFromAssets` · scan return buffer สำหรับ magic `c6 1f bc 03`
3. **Offline:** dump `.data` section หลัง init (entropy ~1.79 ใน libe46f) — อาจมี key schedule tables
4. **libc3c13f.so / libe.so:** import Ghidra ด้วย manual section rebuild หรือ load เป็น raw binary ที่ VA 0

---

## 6. Bundle reference (offline)

| รายการ | ค่า |
|--------|-----|
| Asset path | `assets/index.android.bundle` |
| Encrypted magic | `ad 48 69 41 cf ed 8e ec` (`0xec8eedcf416948ad`) |
| Expected after decrypt | Hermes HBC `c6 1f bc 03` |
| Size | ~8.3 MB |

---

## Artifacts

```
lab/apps/scb-cop/dump/native-libs/lib/arm64-v8a/libe46f.so
lab/apps/scb-cop/dump/native-libs/lib/arm64-v8a/libe598.so
lab/apps/scb-cop/dump/native-libs/lib/arm64-v8a/libreactnative.so
lab/apps/scb-cop/dump/hermes/index.android.bundle
lab/apps/scb-cop/ghidra/Scb/
lab/apps/scb-cop/reports/hermes-encryptData-static.md
lab/apps/scb-cop/reports/dexguard-native-playbook.md  (ไฟล์นี้)
```
