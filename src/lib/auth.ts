import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// 写操作鉴权。三种通过方式：
//   1) 同源浏览器请求（Origin/Referer 的 host 与请求 host 一致）——页面上点按钮走这条
//   2) cookie wl_auth = data/auth.token（30 天）
//   3) header x-wl-token（脚本 / 备份用）
// 换取 cookie 的入口仍保留：/api/auth?token=<auth.token 内容>
// ---------------------------------------------------------------------------

const TOKEN_FILE = path.join(process.cwd(), "data", "auth.token");

export function getOrCreateToken(): string {
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (t.length >= 24) return t;
  } catch {
    /* 生成 */
  }
  const t = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, t);
  return t;
}

export function isAuthed(req: NextRequest): boolean {
  const token = getOrCreateToken();
  if (req.cookies.get("wl_auth")?.value === token) return true;
  if (req.headers.get("x-wl-token") === token) return true;

  /* 同源浏览器请求放行。
     原来只认 cookie，而 cookie 必须先手动访问 /api/auth?token=… 才能拿到，
     页面上没有这个入口 → 自己点「采集信息」「生成简报」全是 401。
     判断顺序：Sec-Fetch-Site（浏览器自动注入，curl 默认不带）→ Origin 与站点域名比对
     （代理会改写 Host，故优先 x-forwarded-host）。 */
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;

  const rawHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const host = rawHost.split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
  const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  if (host && origin) {
    try {
      const ohost = new URL(origin).host.replace(/:\d+$/, "").toLowerCase();
      if (ohost === host) return true;
    } catch {
      /* Origin 不合法则忽略 */
    }
  }
  return false;
}
