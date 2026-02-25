# MoeMail to WeCom: 邮件通知与 Bitwarden 别名生成器

一个部署在 **Cloudflare Workers** 上的轻量级服务，用于将 [MoeMail ](https://moemail.app/) 的新邮件 Webhook 转发为**企业微信机器人**通知，并提供了一个兼容 **Bitwarden** 的邮箱别名创建接口。

---

## ✨ 功能特性 (Features)

- **新邮件实时通知**：接收 MoeMail 的 `new_message` Webhook，并立即将邮件信息推送到企业微信群聊。
- **异步处理**：推送通知的操作是异步的，确保能快速响应 MoeMail 的 Webhook 请求（2xx），避免重试。
- **Bitwarden 集成**：提供 Addy.io 兼容的 API 端点，允许 Bitwarden 的用户名生成器直接创建 MoeMail 邮箱别名。
- **高可用性**：基于 Cloudflare 全球网络，稳定可靠。
- **易于部署**：无需服务器，通过 Cloudflare Dashboard 点击几下即可完成部署。
- **安全**：敏感信息（如 API Key 和 Webhook 地址）可通过 Cloudflare Secrets 安全存储。

## 🏗️ 架构简图 (Architecture)

**1. 邮件通知流程**
```
MoeMail --(新邮件 Webhook)--> Cloudflare Worker --(格式化消息)--> 企业微信机器人
```

**2. Bitwarden 别名创建流程**
```
Bitwarden --(Addy.io API 请求)--> Cloudflare Worker --(MoeMail API 调用)--> MoeMail 服务
```

## 🚀 部署指南 (Deployment Guide)

推荐使用 Cloudflare 的 Git 集成进行可视化部署。

### 第 1 步：创建 Worker 项目
1. 登录 Cloudflare Dashboard [<sup>5</sup>](https://dash.cloudflare.com/)，进入 `Workers & Pages`。
2. 点击 `创建应用程序` (Create Application)，选择 `Workers` 标签页。
3. 选择 `连接 Git` (Connect Git) 选项，连接并授权你的 GitHub 账户。
4. 选择你的项目仓库。

### 第 2 步：配置构建与部署
在项目设置页面，进行如下配置：
- **Production branch**: `main` (或其他你的主分支)
- **构建命令 (Build command)**: 留空
- **构建输出目录 (Build output directory)**: 留空
- **根目录 (Root directory)**: 保持默认 (`/`)
- 在 `高级设置` > `兼容性标志` 中添加 `nodejs_compat` 标志，确保依赖库正常工作。

### 第 3 步：配置环境变量
进入刚创建好的 Worker 项目，导航至 `设置 (Settings)` -> `变量 (Variables)`。
- 点击 `添加变量 (Add variable)`，配置下文所需的环境变量。
- **强烈建议**将 `WECOM_BOT_WEBHOOK`, `WECOM_BOT_SECRET` 和 MoeMail API Key (用于 Bitwarden) 等敏感信息配置为 `Encrypted` (加密 Secret)。

配置完成后，点击 `保存并部署 (Save and Deploy)`。

### 第 4 步：获取访问域名
部署成功后，你将得到一个 Worker 域名，形如：
`https://<your-worker-name>.<your-subdomain>.workers.dev`

## ⚙️ 环境配置 (Configuration)

### 环境变量 (Environment Variables)

请在 Cloudflare Worker 的 `Settings -> Variables` 中配置以下变量。

| 变量名 (Variable)      | 说明                                               | 是否必填 | 推荐类型 | 默认值                   |
| ---------------------- | -------------------------------------------------- | -------- | -------- | ------------------------ |
| `WECOM_BOT_WEBHOOK`    | 企业微信机器人的 Webhook 地址                      | **必填** | Secret   | -                        |
| `WECOM_BOT_SECRET`     | 企业微信机器人加签密钥（若机器人开启了签名校验）   | 可选     | Secret   | -                        |
| `MOEMAIL_URL`          | 你的 MoeMail OpenAPI 基础地址                      | 可选     | Variable | `https://moemail.io/api` |
| `DEFAULT_EXPIRY_HOURS` | Bitwarden 创建别名时的默认有效期（单位：小时）     | 可选     | Variable | `24` (0 表示永久)        |
| `BASE_URL`             | 用于状态页显示的 URL，不影响实际功能               | 可选     | Variable | Worker 自己的 URL        |
| `LOG_WECOM_PAYLOAD`    | `1` 开启，`0` 关闭。用于调试企业微信推送的 Payload | 可选     | Variable | `0`                      |

### MoeMail 配置
将 MoeMail 的 Webhook URL 设置为你的 Worker 地址：
- **Webhook URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev/moemail-webhook`
- **事件**: 确保勾选了 `new_message` 事件。

### Bitwarden 配置 (Addy.io 兼容)
在 Bitwarden 的 `设置 -> 用户名生成器` 中，配置如下：
- **生成器服务**: 选择 `Addy.io`
- **API Key**: 填入你的 **MoeMail API Key**
- **自托管服务器 URL**: `https://<your-worker-name>.<your-subdomain>.workers.dev`
- **域名**: 你在 MoeMail 中可用于生成别名的域名

## 🔧 API 接口说明 (API Endpoints)

### 1. 邮件通知 Webhook
接收 MoeMail 的新邮件通知。
- **路径**: `POST /moemail-webhook`
- **请求头**:
  - `Content-Type: application/json`
  - `X-Webhook-Event: new_message`

### 2. Bitwarden (Addy.io) 兼容接口
为 Bitwarden 提供创建邮箱别名的能力。
- **路径**: `POST /api/v1/aliases`
- **请求头**:
  - `Authorization: Bearer <Your-MoeMail-API-Key>`
  - `Content-Type: application/json`

## 🔍 快速验证 (Quick Verification)

### 状态页
访问 Worker 的根路径可以查看服务状态。
```bash
curl https://<your-worker-name>.<your-subdomain>.workers.dev/
```

### Webhook 探活
`GET` 请求 Webhook 路径，用于 MoeMail 面板的连通性测试。
```bash
curl https://<your-worker-name>.<your-subdomain>.workers.dev/moemail-webhook
```
预期返回 `Webhook endpoint is active.` 状态码 `200`。

### 模拟 Webhook 推送
使用 `curl` 模拟一次新邮件事件。
```bash
curl -X POST "https://<your-worker-name>.<your-subdomain>.workers.dev/moemail-webhook" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Event: new_message" \
  -d '{
    "emailId":"email-uuid-test",
    "messageId":"message-uuid-test",
    "fromAddress":"sender@example.com",
    "subject":"这是一封测试邮件",
    "content":"Hello from MoeMail Webhook!",
    "receivedAt":"2024-05-21T12:00:00.000Z",
    "toAddress":"alias@yourdomain.com"
  }'
```
如果配置正确，你的企业微信将收到一条通知。

## 🤔 常见问题 (FAQ)

**1. MoeMail 面板的 Webhook 测试失败怎么办？**
- **检查 URL**：确保填写的 URL 是完整的 Worker 地址，并以 `/moemail-webhook` 结尾。
- **检查 Worker 日志**：在 Cloudflare Dashboard 查看 Worker 的实时日志，确认是否收到了来自 MoeMail 的 `GET` 请求。
- **检查响应**：正常的探活请求应返回 200 状态码。

**2. 收到 Webhook 但企业微信没有消息？**
- **检查 `WECOM_BOT_WEBHOOK`**：确认该环境变量是否正确配置且未过期。
- **检查 `WECOM_BOT_SECRET`**：如果你的机器人开启了签名校验，请确保此 Secret 与机器人设置完全一致。如果未开启，请不要设置此环境变量。
- **开启调试日志**：将 `LOG_WECOM_PAYLOAD` 设置为 `1`，然后触发一次 Webhook，检查 Worker 日志中打印的 `WeCom payload` 是否符合预期。

**3. Bitwarden 生成邮箱别名失败？**
- **检查 API Key**: 确保在 Bitwarden 配置中填写的 API Key 是有效的 **MoeMail API Key**，并且 `Authorization` 请求头格式正确。
- **检查 `MOEMAIL_URL`**: 确认此 URL 指向了正确的 MoeMail API 地址。
- **检查权限**: 确保你使用的 MoeMail API Key 拥有创建别名的权限。

## 🛠️ 本地开发与部署 (Local Development)

如果你习惯使用命令行，可以克隆本仓库后执行以下命令：
```bash
# 安装依赖
npm install

# 登录 Cloudflare
npx wrangler login

# 部署到 Cloudflare
npm run deploy:cf
```
> 项目的核心逻辑位于 `worker.ts`。

## 📜 许可证 (License)

本项目采用 [MIT License ](LICENSE) 开源。
