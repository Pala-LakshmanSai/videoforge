import { createFileRoute } from "@tanstack/react-router";
import { QueueScreen } from "../screens";

export const Route = createFileRoute("/")({ component: QueueScreen });
