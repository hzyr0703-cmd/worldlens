"use client";

/**
 * 统一写操作 fetch。
 * - 离线时直接报错（离线报 401 是撒谎）
 * - 401 时弹自绘模态框要 token（内容在 data/auth.token，仅在本地生成时可见），
 *   调 /api/auth 换 cookie 后自动重试一次
 */

let modalOpen: boolean = false;

/** 自绘 token 输入模态框：替代 window.prompt（丑、移动端差、无校验反馈） */
function askToken(): Promise<string | null> {
  // 已有弹窗在开则排队等下一轮（简单起见直接拒绝并发）
  if (modalOpen) return Promise.resolve(null);

  return new Promise((resolve) => {
    modalOpen = true;

    const host = document.createElement("div");
    host.id = "wl-token-modal";
    host.style.cssText =
      "position:fixed;inset:0;z-index:90;display:grid;place-items:center;background:rgba(24,24,27,.45);backdrop-filter:blur(4px)";

    const card = document.createElement("div");
    card.style.cssText =
      "width:min(92vw,420px);background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:26px 24px;box-shadow:0 24px 48px -20px rgba(24,24,27,.35);font-family:inherit";

    card.innerHTML = `
      <div style="font-size:15.5px;font-weight:600;letter-spacing:-0.01em">管理 token</div>
      <p style="font-size:13px;color:#71717a;line-height:1.6;margin:8px 0 14px">
        写操作需要管理 token，内容在项目 <code style="background:#f4f4f5;padding:1px 5px;border-radius:4px;font-size:12px">data/auth.token</code> 文件中。
      </p>
      <input id="wl-token-input" type="password" autocomplete="off" spellcheck="false"
        placeholder="粘贴 token…"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d4d4d8;border-radius:10px;font-size:14px;font-family:ui-monospace,monospace;outline:none" />
      <p id="wl-token-err" style="font-size:12px;color:#b4232f;margin:8px 0 0;min-height:16px"></p>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button id="wl-token-cancel" style="flex:1;padding:9px 0;border:1px solid #d4d4d8;background:#fff;color:#3f3f46;border-radius:10px;font-size:13.5px;cursor:pointer">取消</button>
        <button id="wl-token-ok" style="flex:1;padding:9px 0;border:none;background:#18181b;color:#fff;border-radius:10px;font-size:13.5px;cursor:pointer">确认</button>
      </div>`;

    host.appendChild(card);
    document.body.appendChild(host);
    const input = card.querySelector<HTMLInputElement>("#wl-token-input")!;
    input.focus();

    const close = (token: string | null) => {
      host.remove();
      modalOpen = false;
      resolve(token);
    };
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        card.querySelector("#wl-token-err")!.textContent = "token 不能为空";
        return;
      }
      close(v);
    };
    card.querySelector("#wl-token-cancel")!.addEventListener("click", () => close(null));
    card.querySelector("#wl-token-ok")!.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") close(null);
    });
    host.addEventListener("click", (e) => {
      if (e.target === host) close(null);
    });
  });
}

export async function wlFetch(url: string, init?: RequestInit): Promise<Response> {
  // 离线拦截：写操作离线必失败，报 401 是撒谎
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new Response(JSON.stringify({ ok: false, error: "当前离线，写操作暂不可用（恢复网络后重试）" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const res = await fetch(url, init);
  if (res.status !== 401) return res;

  const token = await askToken();
  if (!token) return res;
  const auth = await fetch(`/api/auth?token=${encodeURIComponent(token)}`);
  if (!auth.ok) {
    // token 错误：再给一次机会
    const retry = await askToken();
    if (!retry) return res;
    const auth2 = await fetch(`/api/auth?token=${encodeURIComponent(retry)}`);
    if (!auth2.ok) return res;
  }
  return fetch(url, init);
}
