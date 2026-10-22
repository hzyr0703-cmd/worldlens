"use client";

/**
 * CountUp — 保留组件名与用法，但**不再做数字递增**。
 *
 * 历史教训：从 0 数起的动画在三种场景下会显示成 0——
 * ① 无 JS / SSR 直出 ② headless 截图（rAF 不推进）③ 减少动效偏好。
 * 对这个产品来说「数字准」比「数字会跳」重要得多，因此只保留一次淡入。
 */
export default function CountUp({
  value,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  return <span className={`count ${className}`}>{value.toLocaleString()}</span>;
}
