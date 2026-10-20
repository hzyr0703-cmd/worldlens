/**
 * 极简 markdown → HTML（零依赖）。只支持简报用到的子集：
 * #/##/### 标题、- 列表、> 引用、**加粗**、段落。输出已转义，防注入。
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="mono text-[0.92em] bg-zinc-100 px-1 py-0.5 rounded">$1</code>');
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length) {
      out.push(`<ul class="my-3 space-y-1.5">${list.map((li) => `<li class="leading-relaxed">${inline(li)}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^- /.test(line)) {
      list.push(line.slice(2));
      continue;
    }
    flushList();
    if (/^### /.test(line)) {
      out.push(`<h3 class="mt-5 mb-2 text-[15px] font-semibold text-zinc-800">${inline(line.slice(4))}</h3>`);
    } else if (/^## /.test(line)) {
      out.push(`<h2 class="mt-7 mb-3 text-[17px] font-semibold text-zinc-900 tracking-[-0.01em]">${inline(line.slice(3))}</h2>`);
    } else if (/^# /.test(line)) {
      out.push(`<h1 class="mt-2 mb-4 text-[19px] font-semibold text-zinc-900 tracking-[-0.015em]">${inline(line.slice(2))}</h1>`);
    } else if (/^> /.test(line)) {
      out.push(`<blockquote class="my-3 border-l-2 border-[#00b8d4] pl-4 text-[13px] text-zinc-500 mono">${inline(line.slice(2))}</blockquote>`);
    } else if (line.trim() === "") {
      // 空行
    } else {
      out.push(`<p class="my-2.5 leading-[1.85]">${inline(line)}</p>`);
    }
  }
  flushList();
  return out.join("\n");
}
