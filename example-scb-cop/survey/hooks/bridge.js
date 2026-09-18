// ponytail: generated from survey-architecture.py — verify class names per APK version
Java.perform(function () {
  try {
    var C = Java.use("com.reactnativecommunity.webview.RNCWebView");
    C.callInjectedJavaScript.overloads.forEach(function (ol) {
      ol.implementation = function () {
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.callInjectedJavaScript args=" + JSON.stringify(Array.prototype.slice.call(arguments)));
        var r = ol.apply(this, arguments);
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.callInjectedJavaScript ret=" + r);
        return r;
      };
    });
  } catch (e) { console.log("[bridge] skip com.reactnativecommunity.webview.RNCWebView.callInjectedJavaScript: " + e); }
  try {
    var C = Java.use("com.reactnativecommunity.webview.RNCWebView");
    C.callInjectedJavaScriptBeforeContentLoaded.overloads.forEach(function (ol) {
      ol.implementation = function () {
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.callInjectedJavaScriptBeforeContentLoaded args=" + JSON.stringify(Array.prototype.slice.call(arguments)));
        var r = ol.apply(this, arguments);
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.callInjectedJavaScriptBeforeContentLoaded ret=" + r);
        return r;
      };
    });
  } catch (e) { console.log("[bridge] skip com.reactnativecommunity.webview.RNCWebView.callInjectedJavaScriptBeforeContentLoaded: " + e); }
  try {
    var C = Java.use("com.reactnativecommunity.webview.RNCWebView");
    C.cleanupCallbacksAndDestroy.overloads.forEach(function (ol) {
      ol.implementation = function () {
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.cleanupCallbacksAndDestroy args=" + JSON.stringify(Array.prototype.slice.call(arguments)));
        var r = ol.apply(this, arguments);
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.cleanupCallbacksAndDestroy ret=" + r);
        return r;
      };
    });
  } catch (e) { console.log("[bridge] skip com.reactnativecommunity.webview.RNCWebView.cleanupCallbacksAndDestroy: " + e); }
  try {
    var C = Java.use("com.reactnativecommunity.webview.RNCWebView");
    C.createRNCWebViewBridge.overloads.forEach(function (ol) {
      ol.implementation = function () {
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.createRNCWebViewBridge args=" + JSON.stringify(Array.prototype.slice.call(arguments)));
        var r = ol.apply(this, arguments);
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.createRNCWebViewBridge ret=" + r);
        return r;
      };
    });
  } catch (e) { console.log("[bridge] skip com.reactnativecommunity.webview.RNCWebView.createRNCWebViewBridge: " + e); }
  try {
    var C = Java.use("com.reactnativecommunity.webview.RNCWebView");
    C.destroy.overloads.forEach(function (ol) {
      ol.implementation = function () {
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.destroy args=" + JSON.stringify(Array.prototype.slice.call(arguments)));
        var r = ol.apply(this, arguments);
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.destroy ret=" + r);
        return r;
      };
    });
  } catch (e) { console.log("[bridge] skip com.reactnativecommunity.webview.RNCWebView.destroy: " + e); }
  try {
    var C = Java.use("com.reactnativecommunity.webview.RNCWebView");
    C.dispatchDirectMessage.overloads.forEach(function (ol) {
      ol.implementation = function () {
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.dispatchDirectMessage args=" + JSON.stringify(Array.prototype.slice.call(arguments)));
        var r = ol.apply(this, arguments);
        console.log("[bridge] com.reactnativecommunity.webview.RNCWebView.dispatchDirectMessage ret=" + r);
        return r;
      };
    });
  } catch (e) { console.log("[bridge] skip com.reactnativecommunity.webview.RNCWebView.dispatchDirectMessage: " + e); }
});
