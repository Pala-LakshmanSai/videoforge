import { createFileRoute } from "@tanstack/react-router";
import { CreateProjectScreen } from "../../screens";

export const Route = createFileRoute("/projects/new")({ component: CreateProjectScreen });
