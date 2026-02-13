# MoeMail -> 企业微信机器人（Cloudflare Workers）

把 MoeMail 的新邮件 Webhook 转发为企业微信机器人文本通知，并提供 Bitwarden(Addy.io 兼容)别名创建接口。

## 功能概览

- 接收 MoeMail Webhook：`POST /moemail-webhook`
- 兼容 MoeMail 面板测试请求（快速返回 2xx）
- 异步推送到企业微信机器人（不阻塞 webhook 响应）
- Bitwarden(Addy.io 兼容)：`POST /api/v1/aliases`

## 接口说明

### 1) 邮件通知 Webhook

- 路径：`POST /moemail-webhook`
- 请求头：
  - `Content-Type: application/json`
  - `X-Webhook-Event: new_message`
- 作用：接收 MoeMail 的新邮件事件并推送到企业微信

### 2) Bitwarden(Addy.io) 兼容接口

- 路径：`POST /api/v1/aliases`
- 请求头：
  - `Authorization: Bearer <MoeMail API Key>`
  - `Content-Type: application/json`（可选，带 body 时建议设置）
- 作用：为 Bitwarden 生成转发邮箱（底层调用 MoeMail API）

## 环境变量

请在 Cloudflare Worker 的 Variables/Secrets 中配置：

- `WECOM_BOT_WEBHOOK`（Secret，必填）
  - 企业微信机器人 webhook 地址
- `WECOM_BOT_SECRET`（Secret，可选）
  - 企业微信机器人加签密钥（仅开启签名时需要）
- `MOEMAIL_URL`（Variable，可选）
  - MoeMail OpenAPI 基础地址，默认 `https://example.com/api`
- `DEFAULT_EXPIRY_HOURS`（Variable，可选）
  - Bitwarden 创建邮箱默认有效期，单位小时，默认 `24`
  - 设置为 `0` 表示永久
- `BASE_URL`（Variable，可选）
  - 状态页显示用，不影响实际路由
- `LOG_WECOM_PAYLOAD`（Variable，可选）
  - `1` 开启企业微信推送 payload 日志，`0` 关闭（默认）

## 可视化部署（Cloudflare Dashboard）

### 第 1 步：创建项目

1. 打开 Cloudflare Dashboard -> `Workers & Pages`
2. 点击 `Create`
3. 选择 `Import a repository`（推荐）
4. 连接 GitHub 并选择本仓库

### 第 2 步：构建设置

- Framework preset：`None`
- Build command：留空
- Build output directory：留空
- Root directory：仓库根目录（默认）
- 入口文件（Main/Entry）：`worker.ts`

### 第 3 步：配置变量

进入 Worker 项目的 `Settings -> Variables and Secrets`，添加上面的环境变量。

建议：
- `WECOM_BOT_WEBHOOK` 用 Secret 存
- `WECOM_BOT_SECRET` 用 Secret 存
- 其他可放 Variable

### 第 4 步：部署

点击 `Deploy`，等待完成。

部署成功后会得到域名，例如：

```text
https://<your-worker>.workers.dev
```

## MoeMail 配置

把 MoeMail 的 Webhook URL 配置为：

```text
https://<your-worker>.workers.dev/moemail-webhook
```

## Bitwarden 配置（Addy.io）

在 Bitwarden 用户名生成器中：

- 服务：`Addy.io`
- API Key：你的 MoeMail API Key
- 自托管 URL：`https://<your-worker>.workers.dev`
- 域名：你在 MoeMail 可用的域名

## 快速验证

### 1) 状态页

```text
GET /
```

返回服务状态与接口提示。

### 2) Webhook 探活

```text
GET /moemail-webhook
```

应返回 `200`。

### 3) Webhook 模拟

```bash
curl -X POST "https://<your-worker>.workers.dev/moemail-webhook" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Event: new_message" \
  -d '{
    "emailId":"email-uuid",
    "messageId":"message-uuid",
    "fromAddress":"sender@example.com",
    "subject":"测试邮件",
    "content":"hello from moemail",
    "receivedAt":"2024-01-01T12:00:00.000Z",
    "toAddress":"test@example.com"
  }'
```

## 常见问题

### 1) MoeMail 面板测试失败

优先检查：
- URL 是否是 `https://.../moemail-webhook`
- Worker 日志中是否有 `Webhook inbound` 记录
- 是否返回了非 2xx

### 2) 收到 webhook 但企业微信没消息

检查：
- `WECOM_BOT_WEBHOOK` 是否正确
- 是否配置了 `WECOM_BOT_SECRET`（且与机器人一致）
- 开启 `LOG_WECOM_PAYLOAD=1` 看发送日志

### 3) Bitwarden 生成失败

检查：
- `Authorization: Bearer <MoeMail API Key>` 是否有效
- `MOEMAIL_URL` 是否可访问
- MoeMail API Key 是否具备创建邮箱权限

## 本地命令（可选）

如果你使用命令行部署：

```bash
npm install
npx wrangler login
npm run deploy:cf
```

本项目核心入口：`worker.ts`
