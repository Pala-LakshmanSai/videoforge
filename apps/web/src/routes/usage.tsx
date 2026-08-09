import { createFileRoute } from "@tanstack/react-router";
import { UsageScreen } from "../screens";

export const Route = createFileRoute("/usage")({ component: UsageScreen });
