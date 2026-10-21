"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { wlFetch } from "@/lib/client/fetch";

/** 深度版简报：用付费模型（glm-4.6）重算一次——按需付费，日常仍用免费模型 */
export default function DigestDeepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await wlFetch("/api/digest", {
        method: "POST",
        body: JSON.stringify({ deep: true }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={run} disabled={busy} className="pill magnetic !text-[12px]" title="用 glm-4.6 重算，成本约几分钱">
      {busy ? "深度分析中…" : "深度版"}
    </button>
  );
}
