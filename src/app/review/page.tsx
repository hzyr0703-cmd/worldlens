import ReviewSession from "@/components/VerifyDesk";
import PageHead from "@/components/PageHead";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <div>
      <PageHead
        index="04"
        kicker="Reconciliation"
        title="当初的判断，现在对不对"
        desc="引擎把到期的验证点连同相关新闻一起端出来——你只看证据、下判断。证实的链条归档，证伪的链条标断。"
      />
      <div className="page-body">
        <div className="card-in">
          <ReviewSession />
        </div>
      </div>
    </div>
  );
}
