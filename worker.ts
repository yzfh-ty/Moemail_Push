import { Hono } from "hono";

type RuntimeEnv = {
  BASE_URL?: string;
  MOEMAIL_URL?: string;
  DEFAULT_EXPIRY_HOURS?: string;
  WECOM_BOT_WEBHOOK?: string;
  WECOM_BOT_SECRET?: string;
  LOG_WECOM_PAYLOAD?: string;
};

interface MoemailWebhookPayload {
  emailId: string;
  messageId: string;
  fromAddress: string;
  subject: string;
  receivedAt: number | string;
  toAddress: string;
  content?: string;
  html?: string;
}

interface RuntimeConfig {
  baseUrl?: string;
  ApiBaseUrl: string;
  defaultEmailExpiryHours: number;
  wecomBotWebhook: string;
  wecomBotSecret: string;
  logWecomPayload: boolean;
}

const app = new Hono<{ Bindings: RuntimeEnv }>();

function getConfig(env?: RuntimeEnv): RuntimeConfig {
  const nodeEnv = typeof process !== "undefined" ? process.env : undefined;

  const baseUrl = env?.BASE_URL ?? nodeEnv?.BASE_URL;
  const ApiBaseUrl = env?.MOEMAIL_URL ?? nodeEnv?.MOEMAIL_URL ?? "https://example.com/api";
  const defaultEmailExpiryRaw = env?.DEFAULT_EXPIRY_HOURS ?? nodeEnv?.DEFAULT_EXPIRY_HOURS ?? "24";
  const defaultEmailExpiryHours = Number.parseInt(defaultEmailExpiryRaw, 10);
  const wecomBotWebhook = env?.WECOM_BOT_WEBHOOK ?? nodeEnv?.WECOM_BOT_WEBHOOK ?? "";
  const wecomBotSecret = env?.WECOM_BOT_SECRET ?? nodeEnv?.WECOM_BOT_SECRET ?? "";
  const logWecomPayload = (env?.LOG_WECOM_PAYLOAD ?? nodeEnv?.LOG_WECOM_PAYLOAD) === "1";

  return {
    baseUrl,
    ApiBaseUrl,
    defaultEmailExpiryHours:
      Number.isFinite(defaultEmailExpiryHours) && defaultEmailExpiryHours >= 0 ? defaultEmailExpiryHours : 24,
    wecomBotWebhook,
    wecomBotSecret,
    logWecomPayload,
  };
}

type GenerateAliasRequest = {
  domain?: string;
  description?: string;
  local_part?: string;
};

async function generateAliasThroughMoemail(
  cfg: RuntimeConfig,
  userApiKey: string,
  req: GenerateAliasRequest,
): Promise<{ email: string }> {
  const expiryTime = cfg.defaultEmailExpiryHours === 0 ? 0 : cfg.defaultEmailExpiryHours * 3600000;
  const payload: { domain?: string; name?: string; expiryTime: number } = {
    expiryTime,
  };

  if (req.domain && typeof req.domain === "string") {
    payload.domain = req.domain.trim();
  }

  if (req.local_part && typeof req.local_part === "string") {
    payload.name = req.local_part.trim();
  }

  const response = await fetch(`${cfg.ApiBaseUrl}/emails/generate`, {
    method: "POST",
    headers: {
      "X-API-Key": userApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Moemail API 错误: ${response.status} ${msg}`);
  }

  const email = (data as { email?: string } | null)?.email;
  if (!email) {
    throw new Error("Moemail API 返回缺少 email 字段");
  }

  return { email };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function truncateUtf8(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(input).length <= maxBytes) {
    return input;
  }

  let result = "";
  for (const ch of input) {
    const next = result + ch;
    if (encoder.encode(next).length > maxBytes) {
      break;
    }
    result = next;
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function hmacSha256Base64(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return bytesToBase64(new Uint8Array(signature));
}

async function buildWecomWebhookUrl(cfg: RuntimeConfig): Promise<string> {
  if (!cfg.wecomBotWebhook) {
    throw new Error("WECOM_BOT_WEBHOOK 未设置");
  }

  if (!cfg.wecomBotSecret) {
    return cfg.wecomBotWebhook;
  }

  const timestamp = Date.now();
  const signRaw = `${timestamp}\n${cfg.wecomBotSecret}`;
  const sign = await hmacSha256Base64(cfg.wecomBotSecret, signRaw);

  const url = new URL(cfg.wecomBotWebhook);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url.toString();
}

async function sendToWecom(cfg: RuntimeConfig, payload: MoemailWebhookPayload): Promise<void> {
  const emailSubject = payload.subject || "无主题";
  const emailTextContent = payload.content || htmlToText(payload.html || "");
  const receivedAt = new Date(payload.receivedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const preview = (emailTextContent || "无可展示内容").substring(0, 500);

  const textMessage =
    `【新邮件通知】\n` +
    `收件箱: ${payload.toAddress || "未知"}\n` +
    `发件人: ${payload.fromAddress || "未知"}\n` +
    `主题: ${emailSubject}\n` +
    `时间: ${receivedAt}\n\n` +
    `内容预览:\n${preview}${emailTextContent.length > 500 ? "..." : ""}`;

  const finalText = truncateUtf8(textMessage, 1800);
  const wecomPayload = {
    msgtype: "text",
    text: { content: finalText },
  };

  if (cfg.logWecomPayload) {
    console.log("[WECOM] payload:", JSON.stringify(wecomPayload));
  }

  const response = await fetch(await buildWecomWebhookUrl(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(wecomPayload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`企业微信推送失败: HTTP ${response.status} - ${errText}`);
  }

  const data = await response.json();
  if (data.errcode !== 0) {
    throw new Error(`企业微信推送失败: errcode=${data.errcode}, errmsg=${data.errmsg}`);
  }
}

app.get("/", (c) => {
  const cfg = getConfig(c.env);
  const requestUrl = new URL(c.req.url);
  const baseUrl = cfg.baseUrl || requestUrl.origin;
  const info = [
    "Moemail -> 企业微信 机器人 通知服务",
    "",
    "状态: 运行中",
    `BASE_URL: ${baseUrl}`,
    `企业微信机器人: ${cfg.wecomBotWebhook ? "已配置" : "未配置"}`,
    `默认邮箱有效期(小时): ${cfg.defaultEmailExpiryHours === 0 ? "永久" : cfg.defaultEmailExpiryHours}`,
    "",
    "Webhook 接口:",
    `POST ${baseUrl}/moemail-webhook`,
    "要求请求头: X-Webhook-Event: new_message, Content-Type: application/json",
    "",
    "Bitwarden(Addy.io兼容)接口:",
    `POST ${baseUrl}/api/v1/aliases`,
    "要求请求头: Authorization: Bearer <Moemail API Key>",
  ].join("\n");
  return c.text(info);
});

app.get("/favicon.ico", (c) => c.body(null, 204));
app.get("/moemail-webhook", (c) => c.json({ success: true, message: "Webhook endpoint is alive" }));
app.on("HEAD", "/moemail-webhook", (c) => c.body(null, 200));
app.options("/moemail-webhook", (c) => c.json({ success: true, message: "Webhook endpoint is alive" }));

app.post("/api/v1/aliases", async (c) => {
  const cfg = getConfig(c.env);
  const authHeader = c.req.header("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "Unauthorized: Missing or invalid API Key." }, 401);
  }

  const userApiKey = authHeader.slice(7).trim();
  if (!userApiKey) {
    return c.json({ error: "Unauthorized: Empty API Key." }, 401);
  }

  let body: GenerateAliasRequest = {};
  const contentType = c.req.header("Content-Type") || "";
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      body = (await c.req.json()) as GenerateAliasRequest;
    } catch {
      return c.json({ error: "Bad Request: Invalid JSON payload." }, 400);
    }
  }

  try {
    const alias = await generateAliasThroughMoemail(cfg, userApiKey, body);
    return c.json({ data: { email: alias.email } }, 201);
  } catch (error) {
    const message = (error as Error).message || "Internal Server Error";
    if (message.includes("401") || message.includes("403")) {
      return c.json({ error: message }, 401);
    }
    if (message.includes("400")) {
      return c.json({ error: message }, 400);
    }
    return c.json({ error: message }, 500);
  }
});

app.post("/moemail-webhook", async (c) => {
  const cfg = getConfig(c.env);
  const eventType = c.req.header("X-Webhook-Event");
  const contentType = c.req.header("Content-Type") || "";

  console.log(
    `[${new Date().toISOString()}] Webhook inbound: POST /moemail-webhook event=${eventType || "-"} ct=${contentType || "-"}`,
  );

  if (eventType && eventType !== "new_message" && eventType !== "test") {
    return c.text("无效的 X-Webhook-Event 请求头。", 400);
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    return c.text("无效的 Content-Type 请求头。", 415);
  }

  let payload: MoemailWebhookPayload;
  try {
    payload = (await c.req.json()) as MoemailWebhookPayload;
  } catch {
    return c.text("无效的 JSON Payload。", 400);
  }

  const isNewMessageEvent = eventType === "new_message";
  if (!isNewMessageEvent) {
    return c.json({ success: true, message: "Webhook test accepted" });
  }

  const requiredFields: Array<keyof MoemailWebhookPayload> = [
    "emailId",
    "messageId",
    "fromAddress",
    "subject",
    "receivedAt",
    "toAddress",
  ];

  for (const field of requiredFields) {
    if (!payload[field]) {
      return c.text(`Payload 中缺少必需字段: ${field}`, 400);
    }
  }

  if (!payload.content && !payload.html) {
    return c.text("Payload 中缺少必需字段: content 或 html", 400);
  }

  if (!cfg.wecomBotWebhook) {
    return c.text("服务未配置 WECOM_BOT_WEBHOOK。", 500);
  }

  const forwardTask = sendToWecom(cfg, payload).catch((error) => {
    console.error(`[${new Date().toISOString()}] 企业微信转发失败:`, (error as Error).message);
  });

  const execCtx = (c as { executionCtx?: { waitUntil: (promise: Promise<unknown>) => void } }).executionCtx;
  if (execCtx?.waitUntil) {
    execCtx.waitUntil(forwardTask);
  } else {
    queueMicrotask(() => {
      void forwardTask;
    });
  }

  return c.json({ success: true, message: "Webhook accepted" });
});

app.notFound((c) => c.text("未找到端点。", 404));

app.onError((err, c) => {
  console.error(`[${new Date().toISOString()}] 请求处理失败:`, err.message);
  return c.text(`处理失败: ${err.message}`, 500);
});

export { app, getConfig };
export default {
  fetch: app.fetch,
};
