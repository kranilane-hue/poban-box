# 联网版 Illustrator CEP 插件（MVP）

本项目实现了一个可联网的 CEP 主壳插件与配套后端，支持：

- 用户登录与会话刷新
- 订阅授权校验
- 支付下单与回调后订阅生效（MVP 模拟回调）
- 远程模块清单拉取、下载 URL 获取
- 模块哈希与签名校验后挂载
- 基础设备绑定、心跳、审计上报

## 目录

- `com.refboard.cloudpanel/`：Illustrator CEP 主壳插件
- `backend/`：MVP 后端服务
- `install.bat`：将主壳插件同步到 `%AppData%\Adobe\CEP\extensions`

## 快速启动

1. 启动后端：
   - `cd backend`
   - `npm install`
   - `npm run start`
2. 同步 CEP 扩展：
   - 在仓库根执行：`cmd /c install.bat`
3. 重启 Illustrator，在 `Window -> Extensions -> Cloud Plugin Center` 打开面板。

## 演示账号

- 用户名：`demo`
- 密码：`demo123`

初始状态无订阅。可在面板中点击“创建订阅订单(模拟)”触发订单与模拟回调，随后订阅状态变为 `active` 并允许加载示例模块。

## 关键接口

- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `GET /v1/license/me`
- `POST /v1/license/heartbeat`
- `GET /v1/capabilities`
- `GET /v1/modules/manifest`
- `GET /v1/modules/{id}/download-url`
- `POST /v1/pay/orders`
- `POST /v1/pay/callback/alipay`
- `POST /v1/pay/callback/wechat`
- `GET /v1/security/public-keys`

## 安全说明（MVP）

- Access Token 10 分钟，Refresh Token 7 天，并在刷新时轮换。
- 能力声明与模块元数据均采用 RSA-SHA256 签名。
- 模块脚本下载后先校验 SHA-256，再校验签名，再挂载。
- 支持基础设备数量限制（默认 2 台）与心跳校验。
- 审计上报可通过 `/v1/security/report` 写入内存日志。

## 生产化建议

- 将内存存储替换为数据库与缓存（MySQL + Redis）。
- 接入支付宝/微信官方 SDK 与签名校验，不使用模拟回调。
- 将私钥托管到 KMS，启用 `kid` 轮换与吊销策略。
- 对模块分发引入 CDN、防盗链、灰度发布与回滚。
- 在高价值功能中减少本地可逆逻辑，更多走服务端计算。
