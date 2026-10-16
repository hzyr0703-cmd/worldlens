import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// 写操作鉴权：公网可读（GET），写操作需 cookie wl_auth = data/auth.token
// 首次：访问 /api/auth?token=<auth.token 内容> 换 30 天 cookie。
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
  const cookie = req.cookies.get("wl_auth")?.value;
  if (cookie && cookie === getOrCreateToken()) return true;
  const header = req.headers.get("x-wl-token");
  return Boolean(header && header === getOrCreateToken());
}
