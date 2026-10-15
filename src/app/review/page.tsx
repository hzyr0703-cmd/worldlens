import ReviewSession from "@/components/ReviewSession";
import PageHead from "@/components/PageHead";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <div>
      <PageHead
        index="04"
        kicker="Reviews"
        title="在你即将遗忘的时刻，把它叫回来"
        desc="FSRS 间隔重复调度。凭记忆作答，答错不惩罚——错误信息才是复习价值最高的部分。"
      />
      <div className="page-body">
        <ReviewSession />
      </div>
    </div>
  );
}
