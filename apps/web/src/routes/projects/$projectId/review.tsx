import { createFileRoute } from "@tanstack/react-router";
import { ReviewScreen } from "../../../screens";

export const Route = createFileRoute("/projects/$projectId/review")({
  component: () => <ReviewScreen projectId={Route.useParams().projectId} />,
});
