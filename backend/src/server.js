const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const cors = require("cors");
const express = require("express");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 8787;
const ACCESS_SECRET = process.env.ACCESS_SECRET || "mvp_access_secret_change_me";
const REFRESH_SECRET = process.env.REFRESH_SECRET || "mvp_refresh_secret_change_me";
const ACCESS_EXPIRES_IN = "10m";
const REFRESH_EXPIRES_IN = "7d";
const DEFAULT_DEVICE_LIMIT = 2;
const DEFAULT_KID = "rsa-k1";

const moduleScript = fs.readFileSync(path.join(__dirname, "sample-module.js"), "utf8");
const moduleSha256 = crypto.createHash("sha256").update(moduleScript).digest("hex");

const signingKeyPair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const publicKeyBase64 = signingKeyPair.publicKey.toString("base64");
const privateKeyPem = signingKeyPair.privateKey;

const app = express();
app.use(cors());
app.use(express.json());

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
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

const db = {
  users: [
    { id: "u_demo_001", username: "demo", password: "demo123", plan: "pro" }
  ],
  refreshTokens: new Map(),
  deviceBindings: new Map(),
  subscriptions: new Map(),
  orders: new Map(),
  securityLogs: []
};

const defaultSub = {
  status: "inactive",
  expireAt: "1970-01-01T00:00:00.000Z",
  planCode: "none"
};
db.subscriptions.set("u_demo_001", { ...defaultSub });

function nowIso() {
  return new Date().toISOString();
}

function signObject(payload) {
  const sorted = {};
  Object.keys(payload).sort().forEach((key) => {
    sorted[key] = payload[key];
  });
  const input = JSON.stringify(sorted);
  return crypto.sign("RSA-SHA256", Buffer.from(input), privateKeyPem).toString("base64");
}

function verifyAccess(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return res.status(401).json({ code: "AUTH_REQUIRED", message: "请先登录" });
  }
  try {
    req.auth = jwt.verify(token, ACCESS_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ code: "AUTH_EXPIRED", message: "登录已过期，请刷新" });
  }
}

function issueTokens(user) {
  const jti = uuidv4();
  const accessToken = jwt.sign(
    { sub: user.id, username: user.username, jti, type: "access" },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
  const refreshId = uuidv4();
  const refreshToken = jwt.sign(
    { sub: user.id, rid: refreshId, type: "refresh" },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN }
  );
  db.refreshTokens.set(refreshId, {
    userId: user.id,
    createdAt: nowIso(),
    revoked: false
  });
  return { accessToken, refreshToken };
}

function resolveUserByAccess(req) {
  return db.users.find((u) => u.id === req.auth.sub);
}

function ensureSubActive(userId) {
  const sub = db.subscriptions.get(userId) || { ...defaultSub };
  if (sub.status !== "active") {
    return false;
  }
  return new Date(sub.expireAt).getTime() > Date.now();
}

function getDeviceSet(userId) {
  if (!db.deviceBindings.has(userId)) {
    db.deviceBindings.set(userId, new Set());
  }
  return db.deviceBindings.get(userId);
}

function pushSecurityLog(type, data) {
  db.securityLogs.push({ id: uuidv4(), type, data, createdAt: nowIso() });
}

app.get("/health", (_, res) => {
  res.json({ ok: true, time: nowIso() });
});

app.post("/v1/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username === username && u.password === password);
  if (!user) {
    pushSecurityLog("LOGIN_FAILED", { username, ip: req.ip });
    return res.status(401).json({ code: "AUTH_INVALID", message: "用户名或密码错误" });
  }
  const tokenData = issueTokens(user);
  return res.json({
    code: "OK",
    data: {
      ...tokenData,
      user: { id: user.id, username: user.username }
    }
  });
});

app.post("/v1/auth/refresh", (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ code: "AUTH_REFRESH_REQUIRED", message: "缺少 refresh token" });
  }
  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    const record = db.refreshTokens.get(decoded.rid);
    if (!record || record.revoked) {
      return res.status(401).json({ code: "AUTH_REFRESH_REVOKED", message: "refresh token 已失效" });
    }
    record.revoked = true;
    const user = db.users.find((u) => u.id === decoded.sub);
    if (!user) {
      return res.status(404).json({ code: "AUTH_USER_NOT_FOUND", message: "用户不存在" });
    }
    const tokenData = issueTokens(user);
    return res.json({ code: "OK", data: tokenData });
  } catch (err) {
    return res.status(401).json({ code: "AUTH_REFRESH_INVALID", message: "refresh token 无效" });
  }
});

app.post("/v1/auth/logout", verifyAccess, (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
      const record = db.refreshTokens.get(decoded.rid);
      if (record) {
        record.revoked = true;
      }
    } catch (_) {
      // best effort logout
    }
  }
  return res.json({ code: "OK", message: "已退出" });
});

app.get("/v1/license/me", verifyAccess, (req, res) => {
  const user = resolveUserByAccess(req);
  const sub = db.subscriptions.get(user.id) || { ...defaultSub };
  const realActive = ensureSubActive(user.id);
  if (!realActive && sub.status === "active") {
    sub.status = "inactive";
  }
  return res.json({
    code: "OK",
    data: {
      status: realActive ? "active" : "inactive",
      expireAt: sub.expireAt,
      planCode: sub.planCode
    }
  });
});

app.post("/v1/license/bind-device", verifyAccess, (req, res) => {
  const user = resolveUserByAccess(req);
  const { deviceId } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ code: "LICENSE_DEVICE_REQUIRED", message: "缺少 deviceId" });
  }
  const devices = getDeviceSet(user.id);
  if (!devices.has(deviceId) && devices.size >= DEFAULT_DEVICE_LIMIT) {
    pushSecurityLog("DEVICE_BIND_REJECTED", { userId: user.id, deviceId });
    return res.status(403).json({ code: "LICENSE_DEVICE_LIMIT", message: "设备绑定数量已达上限" });
  }
  devices.add(deviceId);
  return res.json({ code: "OK", data: { devices: Array.from(devices) } });
});

app.post("/v1/license/unbind-device", verifyAccess, (req, res) => {
  const user = resolveUserByAccess(req);
  const { deviceId } = req.body || {};
  const devices = getDeviceSet(user.id);
  devices.delete(deviceId);
  return res.json({ code: "OK", data: { devices: Array.from(devices) } });
});

app.post("/v1/license/heartbeat", verifyAccess, (req, res) => {
  const user = resolveUserByAccess(req);
  const { deviceId } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ code: "LICENSE_DEVICE_REQUIRED", message: "缺少 deviceId" });
  }
  const devices = getDeviceSet(user.id);
  if (!devices.has(deviceId)) {
    if (devices.size >= DEFAULT_DEVICE_LIMIT) {
      pushSecurityLog("HEARTBEAT_DEVICE_REJECTED", { userId: user.id, deviceId });
      return res.status(403).json({ code: "LICENSE_DEVICE_LIMIT", message: "请解绑旧设备后重试" });
    }
    devices.add(deviceId);
  }
  const active = ensureSubActive(user.id);
  return res.json({
    code: "OK",
    data: {
      serverTime: nowIso(),
      subscriptionActive: active,
      revoke: false
    }
  });
});

app.get("/v1/capabilities", verifyAccess, (req, res) => {
  const user = resolveUserByAccess(req);
  const active = ensureSubActive(user.id);
  const payload = {
    userId: user.id,
    planCode: active ? "pro" : "none",
    features: active ? ["sample-tools"] : [],
    modules: active ? ["sample-tools"] : [],
    exp: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
  const signature = signObject(payload);
  return res.json({
    code: "OK",
    data: {
      kid: DEFAULT_KID,
      payload,
      signature
    }
  });
});

app.get("/v1/modules/manifest", verifyAccess, (req, res) => {
  const active = ensureSubActive(req.auth.sub);
  if (!active) {
    return res.status(403).json({ code: "LICENSE_INACTIVE", message: "订阅未生效，无法获取模块" });
  }
  const moduleSignPayload = {
    id: "sample-tools",
    version: "1.0.0",
    sha256: moduleSha256
  };
  const moduleSignature = signObject(moduleSignPayload);
  return res.json({
    code: "OK",
    data: {
      modules: [
        {
          ...moduleSignPayload,
          kid: DEFAULT_KID,
          signature: moduleSignature
        }
      ]
    }
  });
});

app.get("/v1/modules/:id/download-url", verifyAccess, (req, res) => {
  const active = ensureSubActive(req.auth.sub);
  if (!active) {
    return res.status(403).json({ code: "LICENSE_INACTIVE", message: "订阅未生效" });
  }
  if (req.params.id !== "sample-tools") {
    return res.status(404).json({ code: "MOD_NOT_FOUND", message: "模块不存在" });
  }
  const token = jwt.sign(
    { sub: req.auth.sub, moduleId: req.params.id, type: "module_download" },
    ACCESS_SECRET,
    { expiresIn: "3m" }
  );
  return res.json({
    code: "OK",
    data: {
      downloadUrl: `http://127.0.0.1:${PORT}/v1/modules/${req.params.id}/bundle.js?token=${token}`
    }
  });
});

app.get("/v1/modules/:id/bundle.js", (req, res) => {
  const { token } = req.query || {};
  if (!token) {
    return res.status(401).send("// missing token");
  }
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET);
    if (decoded.type !== "module_download" || decoded.moduleId !== req.params.id) {
      return res.status(401).send("// invalid module token");
    }
    if (req.params.id !== "sample-tools") {
      return res.status(404).send("// module not found");
    }
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    return res.send(moduleScript);
  } catch (err) {
    return res.status(401).send("// token expired");
  }
});

app.post("/v1/pay/orders", verifyAccess, (req, res) => {
  const user = resolveUserByAccess(req);
  const { channel, planCode } = req.body || {};
  if (!["alipay", "wechat"].includes(channel)) {
    return res.status(400).json({ code: "PAY_CHANNEL_INVALID", message: "仅支持 alipay/wechat" });
  }
  const orderNo = "ORD_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  db.orders.set(orderNo, {
    orderNo,
    userId: user.id,
    channel,
    planCode: planCode || "monthly-pro",
    status: "pending",
    createdAt: nowIso()
  });
  return res.json({
    code: "OK",
    data: {
      orderNo,
      channel,
      payUrl: `https://pay.example.local/${channel}/${orderNo}`
    }
  });
});

function completeOrder(orderNo, gatewayTradeNo) {
  const order = db.orders.get(orderNo);
  if (!order) {
    return { ok: false, code: "PAY_ORDER_NOT_FOUND", message: "订单不存在" };
  }
  if (order.status === "paid") {
    return { ok: true, duplicated: true };
  }
  order.status = "paid";
  order.gatewayTradeNo = gatewayTradeNo || "";
  order.paidAt = nowIso();
  db.subscriptions.set(order.userId, {
    status: "active",
    planCode: order.planCode,
    expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  return { ok: true, duplicated: false };
}

app.post("/v1/pay/callback/alipay", (req, res) => {
  const { orderNo, paid, gatewayTradeNo } = req.body || {};
  if (!paid) {
    return res.status(400).json({ code: "PAY_NOT_PAID", message: "支付未完成" });
  }
  const ret = completeOrder(orderNo, gatewayTradeNo);
  if (!ret.ok) {
    return res.status(404).json(ret);
  }
  return res.json({ code: "OK", data: { duplicated: ret.duplicated } });
});

app.post("/v1/pay/callback/wechat", (req, res) => {
  const { orderNo, paid, gatewayTradeNo } = req.body || {};
  if (!paid) {
    return res.status(400).json({ code: "PAY_NOT_PAID", message: "支付未完成" });
  }
  const ret = completeOrder(orderNo, gatewayTradeNo);
  if (!ret.ok) {
    return res.status(404).json(ret);
  }
  return res.json({ code: "OK", data: { duplicated: ret.duplicated } });
});

app.post("/v1/security/report", verifyAccess, (req, res) => {
  pushSecurityLog("CLIENT_REPORT", { userId: req.auth.sub, payload: req.body || {} });
  return res.json({ code: "OK" });
});

app.get("/v1/security/public-keys", verifyAccess, (_, res) => {
  res.json({
    code: "OK",
    data: {
      keys: {
        [DEFAULT_KID]: publicKeyBase64
      }
    }
  });
});

app.post("/v1/security/revoke-check", verifyAccess, (req, res) => {
  const { deviceId } = req.body || {};
  const devices = getDeviceSet(req.auth.sub);
  const revoked = Boolean(deviceId && !devices.has(deviceId) && devices.size >= DEFAULT_DEVICE_LIMIT);
  return res.json({ code: "OK", data: { revoked } });
});

app.listen(PORT, () => {
  debugLog("pre-fix", "H1", "backend/src/server.js:listen", "backend_listen_ok", { port: PORT });
  console.log(`[refboard-backend] listening on http://127.0.0.1:${PORT}`);
});
