import { createFileRoute } from "@tanstack/react-router";
import { NewStyleScreen } from "../../screens";

export const Route = createFileRoute("/styles/new")({ component: NewStyleScreen });
