import { AppSelect } from "../../components/ui";
import type { ExecutionProfileCatalog } from "../../lib/types";

export function ComputeLaneSelect({
  lane,
  selectedProfileId,
  onChange,
}: {
  lane: ExecutionProfileCatalog["lanes"][number];
  selectedProfileId: string;
  onChange: (profileId: string) => void;
}) {
  return (
    <div className="compute-lane-card">
      <div className="compute-lane-heading">
        <span>
          <strong>{lane.selector_label}</strong>
          <small>{lane.model.display_name}</small>
        </span>
        <span className="compute-status">
          <i aria-hidden="true" />
          {lane.status.provider_state === "NOT_CONNECTED" ? "No GPU connected" : lane.status.label}
        </span>
      </div>
      <AppSelect
        className="compute-profile-select"
        label={`${lane.selector_label} compute profile`}
        value={selectedProfileId}
        onValueChange={onChange}
        options={[
          ...lane.selector_options.map((option) => ({
            value: option.profile_id,
            label: option.label,
            detail: option.detail,
          })),
          ...lane.planned_candidates.map((candidate) => ({
            value: candidate.candidate_id,
            label: candidate.label,
            detail: "Benchmark required",
            disabled: true,
            group: "GPU qualification",
          })),
        ]}
      />
    </div>
  );
}
