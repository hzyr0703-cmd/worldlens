import GraphCanvas from "@/components/GraphCanvas";
import GraphErrorBoundary from "@/components/GraphErrorBoundary";
import PageHead from "@/components/PageHead";

export const dynamic = "force-dynamic";

export default function GraphPage() {
  return (
    <div>
      <PageHead
        index="06"
        kicker="Graph"
        title="实体关系图谱"
        desc="实体共现看「哪些主体总在同一类事件里出现」——线的粗细是重叠度而不是出现次数，点开任一实体能看到它的强关联对象与具体证据；原子关系网看「你的认知之间如何互相支持或矛盾」。"
      />
      <div className="page-body">
        <div className="card-in">
          <GraphErrorBoundary>
            <GraphCanvas />
          </GraphErrorBoundary>
        </div>
      </div>
    </div>
  );
}
