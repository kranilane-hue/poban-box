(function main() {
  var API_BASE = "http://127.0.0.1:8787";
  var MODULE_ID = "sample-tools";
  var cs = new CSInterface();

  var state = {
    accessToken: "",
    refreshToken: "",
    user: null,
    heartbeatTimer: null
  };

  function debugLog(runId, hypothesisId, location, message, data) {
    // #region agent log
    fetch("http://127.0.0.1:7384/ingest/06bc6771-099c-47d4-95cd-434c7ce76ea6", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "1f7838"
      },
      body: JSON.stringify({
        sessionId: "1f7838",
        runId: runId,
        hypothesisId: hypothesisId,
        location: location,
        message: message,
        data: data || {},
        timestamp: Date.now()
      })
    }).catch(function () {});
    // #endregion
  }

  var dom = {
    loginSection: document.getElementById("loginSection"),
    accountSection: document.getElementById("accountSection"),
    username: document.getElementById("username"),
    password: document.getElementById("password"),
    loginBtn: document.getElementById("loginBtn"),
    loginMessage: document.getElementById("loginMessage"),
    licenseState: document.getElementById("licenseState"),
    payBtn: document.getElementById("payBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    reloadPanelBtn: document.getElementById("reloadPanelBtn"),
    reloadJsxBtn: document.getElementById("reloadJsxBtn"),
    reloadLog: document.getElementById("reloadLog"),
    statusLog: document.getElementById("statusLog"),
    moduleContainer: document.getElementById("moduleContainer")
  };

  function log(text) {
    dom.statusLog.textContent = String(text || "");
  }

  function logReload(text, isError) {
    dom.reloadLog.style.color = isError ? "#f39b9b" : "#9fe09f";
    dom.reloadLog.textContent = String(text || "");
  }

  function setLoginMessage(text, isError) {
    dom.loginMessage.style.color = isError ? "#f39b9b" : "#9fe09f";
    dom.loginMessage.textContent = String(text || "");
  }

  function setToken(data) {
    state.accessToken = data.accessToken || "";
    state.refreshToken = data.refreshToken || "";
    localStorage.setItem("refboard.accessToken", state.accessToken);
    localStorage.setItem("refboard.refreshToken", state.refreshToken);
  }

  function clearToken() {
    state.accessToken = "";
    state.refreshToken = "";
    localStorage.removeItem("refboard.accessToken");
    localStorage.removeItem("refboard.refreshToken");
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  function restoreToken() {
    state.accessToken = localStorage.getItem("refboard.accessToken") || "";
    state.refreshToken = localStorage.getItem("refboard.refreshToken") || "";
  }

  function updateAuthUI(authenticated) {
    dom.loginSection.classList.toggle("hidden", authenticated);
    dom.accountSection.classList.toggle("hidden", !authenticated);
  }

  function request(path, options) {
    var cfg = options || {};
    var headers = cfg.headers || {};
    if (state.accessToken) {
      headers.Authorization = "Bearer " + state.accessToken;
    }
    if (!headers["Content-Type"] && cfg.body) {
      headers["Content-Type"] = "application/json";
    }
    var fullUrl = API_BASE + path;
    debugLog("pre-fix", "H2", "com.refboard.cloudpanel/js/main.js:request", "request_start", {
      path: path,
      url: fullUrl,
      hasAccessToken: Boolean(state.accessToken)
    });
    return fetch(fullUrl, {
      method: cfg.method || "GET",
      headers: headers,
      body: cfg.body ? JSON.stringify(cfg.body) : undefined
    }).then(function (res) {
      return res.json().then(function (payload) {
        if (!res.ok) {
          var err = new Error(payload.message || "请求失败");
          err.code = payload.code || "HTTP_" + res.status;
          throw err;
        }
        return payload;
      });
    }).catch(function (err) {
      debugLog("pre-fix", "H3", "com.refboard.cloudpanel/js/main.js:request", "request_network_error", {
        path: path,
        url: fullUrl,
        errMessage: err && err.message ? err.message : "unknown"
      });
      throw err;
    });
  }

  function base64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function utf8ToBytes(text) {
    return new TextEncoder().encode(text);
  }

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }

  function canonicalJson(obj) {
    var keys = Object.keys(obj).sort();
    var normalized = {};
    for (var i = 0; i < keys.length; i += 1) {
      normalized[keys[i]] = obj[keys[i]];
    }
    return JSON.stringify(normalized);
  }

  function verifySignature(publicKeySpkiBase64, payloadObj, signatureBase64) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("当前 CEP 运行时不支持 WebCrypto，无法完成签名校验。");
    }
    var payload = canonicalJson(payloadObj);
    return window.crypto.subtle.importKey(
      "spki",
      base64ToArrayBuffer(publicKeySpkiBase64),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    ).then(function (publicKey) {
      return window.crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5" },
        publicKey,
        new Uint8Array(base64ToArrayBuffer(signatureBase64)),
        utf8ToBytes(payload)
      );
    });
  }

  function verifySha256(text, expectedHex) {
    return window.crypto.subtle.digest("SHA-256", utf8ToBytes(text)).then(function (hash) {
      return toHex(hash) === expectedHex;
    });
  }

  function refreshSession() {
    if (!state.refreshToken) {
      return Promise.reject(new Error("缺少 refresh token"));
    }
    return fetch(API_BASE + "/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: state.refreshToken })
    }).then(function (res) {
      return res.json().then(function (payload) {
        if (!res.ok) {
          throw new Error(payload.message || "刷新令牌失败");
        }
        setToken(payload.data);
      });
    });
  }

  function guardedRequest(path, options) {
    return request(path, options).catch(function (err) {
      if (err.code !== "AUTH_EXPIRED") {
        throw err;
      }
      return refreshSession().then(function () {
        return request(path, options);
      });
    });
  }

  function loadLicenseAndModule() {
    return guardedRequest("/v1/license/me").then(function (licenseResp) {
      var license = licenseResp.data;
      dom.licenseState.textContent = "订阅状态: " + license.status + "，到期: " + license.expireAt;
      if (license.status !== "active") {
        dom.moduleContainer.textContent = "当前无有效订阅，模块不可用。";
        return;
      }

      return guardedRequest("/v1/capabilities")
        .then(function (capResp) {
          var capData = capResp.data;
          return guardedRequest("/v1/security/public-keys").then(function (keyResp) {
            return verifySignature(
              keyResp.data.keys[capData.kid],
              capData.payload,
              capData.signature
            ).then(function (ok) {
              if (!ok) {
                throw new Error("能力声明签名校验失败。");
              }
              return capData.payload;
            });
          });
        })
        .then(function (capPayload) {
          if (!capPayload.modules || capPayload.modules.indexOf(MODULE_ID) < 0) {
            dom.moduleContainer.textContent = "授权未包含模块 " + MODULE_ID;
            return;
          }
          return guardedRequest("/v1/modules/manifest").then(function (manifestResp) {
            var item = null;
            for (var i = 0; i < manifestResp.data.modules.length; i += 1) {
              if (manifestResp.data.modules[i].id === MODULE_ID) {
                item = manifestResp.data.modules[i];
                break;
              }
            }
            if (!item) {
              throw new Error("模块清单中不存在 " + MODULE_ID);
            }
            return guardedRequest("/v1/modules/" + MODULE_ID + "/download-url")
              .then(function (dlResp) {
                return fetch(dlResp.data.downloadUrl, { method: "GET" });
              })
              .then(function (res) {
                if (!res.ok) {
                  throw new Error("模块下载失败");
                }
                return res.text();
              })
              .then(function (scriptText) {
                return verifySha256(scriptText, item.sha256).then(function (ok) {
                  if (!ok) {
                    throw new Error("模块哈希校验失败");
                  }
                  return scriptText;
                });
              })
              .then(function (scriptText) {
                return guardedRequest("/v1/security/public-keys").then(function (keyResp) {
                  return verifySignature(
                    keyResp.data.keys[item.kid],
                    {
                      id: item.id,
                      version: item.version,
                      sha256: item.sha256
                    },
                    item.signature
                  ).then(function (ok) {
                    if (!ok) {
                      throw new Error("模块签名校验失败");
                    }
                    return scriptText;
                  });
                });
              })
              .then(function (safeScript) {
                /* no-new-func: dynamic module loading is required here */
                var factory = new Function("return (" + safeScript + ");");
                var moduleDef = factory();
                if (!moduleDef || typeof moduleDef.mount !== "function") {
                  throw new Error("模块格式错误，缺少 mount()");
                }
                dom.moduleContainer.textContent = "";
                moduleDef.mount({
                  container: dom.moduleContainer,
                  csInterface: cs,
                  callHost: function (fnName, arg) {
                    var rawArg = typeof arg === "undefined" ? "" : JSON.stringify(arg);
                    return new Promise(function (resolve) {
                      cs.evalScript(fnName + "(" + rawArg + ")", function (result) {
                        resolve(result);
                      });
                    });
                  }
                });
                log("模块加载成功: " + MODULE_ID + "@" + item.version);
              });
          });
        });
    });
  }

  function startHeartbeat() {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
    }
    state.heartbeatTimer = setInterval(function () {
      guardedRequest("/v1/license/heartbeat", {
        method: "POST",
        body: { deviceId: "windows-demo-device" }
      }).catch(function (err) {
        log("心跳失败: " + err.message);
      });
    }, 30000);
  }

  function logout() {
    guardedRequest("/v1/auth/logout", {
      method: "POST",
      body: { refreshToken: state.refreshToken }
    }).catch(function () {
      return null;
    }).then(function () {
      clearToken();
      updateAuthUI(false);
      dom.moduleContainer.textContent = "尚未加载模块。";
      setLoginMessage("已退出。", false);
    });
  }

  function createOrderAndActivate() {
    guardedRequest("/v1/pay/orders", {
      method: "POST",
      body: {
        channel: "alipay",
        planCode: "monthly-pro"
      }
    }).then(function (resp) {
      var orderNo = resp.data.orderNo;
      log("订单创建成功: " + orderNo + "，模拟回调中...");
      return fetch(API_BASE + "/v1/pay/callback/alipay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNo: orderNo,
          paid: true,
          gatewayTradeNo: "SIMULATED_" + Date.now()
        })
      });
    }).then(function () {
      return loadLicenseAndModule();
    }).catch(function (err) {
      log("支付流程失败: " + err.message);
    });
  }

  function escapeJsxPath(pathText) {
    return String(pathText || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function reloadJsx() {
    var extensionPath = "";
    try {
      extensionPath = cs.getSystemPath(SystemPath.EXTENSION);
    } catch (err) {
      logReload("获取扩展路径失败: " + err.message, true);
      return;
    }
    if (!extensionPath) {
      logReload("未获取到扩展路径，无法重载 JSX。", true);
      return;
    }
    var jsxFilePath = extensionPath + "/jsx/hostscript.jsx";
    var cmd = "$.evalFile('" + escapeJsxPath(jsxFilePath) + "')";
    cs.evalScript(cmd, function (result) {
      logReload("JSX 已重载: " + jsxFilePath + " | 返回: " + (result || "OK"), false);
    });
  }

  function reloadPanel() {
    var url = window.location.href;
    var separator = url.indexOf("?") >= 0 ? "&" : "?";
    window.location.replace(url + separator + "ts=" + Date.now());
  }

  dom.loginBtn.addEventListener("click", function () {
    debugLog("pre-fix", "H1", "com.refboard.cloudpanel/js/main.js:login", "login_clicked", {
      usernameLength: dom.username.value.trim().length
    });
    setLoginMessage("登录中...", false);
    fetch(API_BASE + "/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: dom.username.value.trim(),
        password: dom.password.value
      })
    }).then(function (res) {
      return res.json().then(function (payload) {
        if (!res.ok) {
          throw new Error(payload.message || "登录失败");
        }
        return payload;
      });
    }).then(function (payload) {
      setToken(payload.data);
      state.user = payload.data.user;
      updateAuthUI(true);
      setLoginMessage("登录成功。", false);
      startHeartbeat();
      return loadLicenseAndModule();
    }).catch(function (err) {
      setLoginMessage(err.message, true);
    });
  });

  dom.refreshBtn.addEventListener("click", function () {
    loadLicenseAndModule().catch(function (err) {
      log("刷新失败: " + err.message);
    });
  });
  dom.payBtn.addEventListener("click", createOrderAndActivate);
  dom.logoutBtn.addEventListener("click", logout);
  dom.reloadPanelBtn.addEventListener("click", reloadPanel);
  dom.reloadJsxBtn.addEventListener("click", reloadJsx);

  restoreToken();
  if (state.accessToken) {
    updateAuthUI(true);
    startHeartbeat();
    loadLicenseAndModule().catch(function () {
      clearToken();
      updateAuthUI(false);
    });
  } else {
    updateAuthUI(false);
  }
})();

// ci-negative-test
