/**
 * SplitText — 标题按字符错峰入场。
 *
 * 中文按字拆、英文/数字按词拆（避免把英文单词切碎）。
 * 服务端渲染即可：每字是一个 <span class="split-char">，靠 --i 做延迟。
 * 注意：不要给这些 span 加 aria-hidden 的父级，否则读屏会读不出整句；
 * 真正的读屏文本由外层元素的原始文本提供，视觉层用 aria-hidden 隔开。
 */

function isCJK(ch: string) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/.test(ch);
}

export default function SplitText({
  text,
  className = "",
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  // 中文逐字；连续的 ASCII 词（字母数字空格）合并为一个整体
  const chunks: string[] = [];
  let buf = "";
  for (const ch of text) {
    if (isCJK(ch) || ch === " ") {
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
      chunks.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf) chunks.push(buf);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>
        {chunks.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className="split-char"
            style={{ ["--i" as string]: i }}
          >
            {c === " " ? " " : c}
          </span>
        ))}
      </span>
      <style>{`.split-char{animation-delay:calc(var(--i,0) * 26ms + ${delay}ms)}`}</style>
    </span>
  );
}