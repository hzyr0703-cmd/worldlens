"use client";

/**
 * 统一写操作 fetch：401 时弹窗要 token（内容在 data/auth.token，仅在本地生成时可见），
 * 调 /api/auth 换 cookie 后自动重试一次。
 */
export async function wlFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;

  const token = window.prompt("此操作需要管理 token（内容在项目 data/auth.token 文件中）:");
  if (!token) return res;
  const auth = await fetch(`/api/auth?token=${encodeURIComponent(token.trim())}`);
  if (!auth.ok) {
    window.alert("token 不正确");
    return res;
  }
  return fetch(url, init);
}
