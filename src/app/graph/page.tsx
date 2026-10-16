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
        desc="谁和谁总是一起出现？共现网络是理解利益结构的第一张地图——边的粗细代表 30 天内共同出现的强度。"
      />
      <div className="page-body">
        <GraphErrorBoundary>
          <GraphCanvas />
        </GraphErrorBoundary>
      </div>
    </div>
  );
}
