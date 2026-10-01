import { createFileRoute } from "@tanstack/react-router";
import { TeamAccessScreen } from "../hosted/TeamAccessScreen";
export const Route = createFileRoute("/access")({ component: TeamAccessScreen });
