import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button, EmptyState, Metric, Panel } from "../components/ui";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

export function UsageScreen() {
  const scenario = currentScenario();
  const query = useQuery({ queryKey: ["usage", scenario], queryFn: () => api.usage(scenario) });
  if (query.isPending) {
    return (
      <Panel eyebrow="Workspace" heading="Loading Usage">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading cost and resource totals…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Usage unavailable"
        body="No estimated spend is substituted when usage data cannot be loaded."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
  const usage = query.data;
  return (
    <>
      <PageHeader title="Usage" />
      <div className="grid grid-4 usage-grid">
        <Metric
          label="Total"
          value={`$${usage.currentMonth.toFixed(2)}`}
          detail="current month"
          tone="success"
        />
        <Metric
          label="Video projects"
          value={`$${usage.projectSpend.toFixed(2)}`}
          detail="generation"
        />
        <Metric
          label="Style analysis"
          value={`$${usage.styleSpend.toFixed(2)}`}
          detail="one time"
        />
        <Metric
          label="Avatar tests"
          value={`$${usage.avatarTestSpend.toFixed(2)}`}
          detail="optional"
        />
      </div>
      <div className="grid grid-3 usage-grid">
        <Metric label="GPU" value={`${usage.gpuSeconds}s`} detail="billed time" />
        <Metric label="Storage" value={`${usage.storageGb.toFixed(2)} GB`} detail="retained" />
        <Metric label="Retries" value={String(usage.retries)} detail="item-level" />
      </div>
    </>
  );
}
