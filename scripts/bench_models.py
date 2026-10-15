import json, time, urllib.request

KEY = "f7658196cb994582bcc7602ef43ebfab.rGZHEvug3WymlKdj"
URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"

PROMPT = (
    "从这条信息提炼一个认知原子(类型mechanism/pattern/fact选一)，"
    '只输出JSON: {"type":"...","statement":"一句话","confidence":0.8}\n'
    "信息: 中国央行今日开展560亿元7天期逆回购操作，利率1.40%，与上次持平，今日无逆回购到期。"
)

for model in ["glm-4-flash", "glm-4.5-flash", "glm-5.3-flash"]:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "max_tokens": 512,
        "temperature": 0.1,
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read())
        dt = time.time() - t0
        m = d["choices"][0]["message"]
        content = (m.get("content") or "").replace("\n", " ")[:90]
        has_reasoning = bool(m.get("reasoning_content"))
        usage = d.get("usage", {})
        print(f"{model} | {dt:.1f}s | reasoning={has_reasoning} | total_tokens={usage.get('total_tokens')}")
        print(f"   -> {content}")
    except Exception as e:
        print(f"{model} | FAIL {time.time()-t0:.1f}s | {str(e)[:100]}")
