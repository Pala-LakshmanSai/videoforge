import { createFileRoute } from "@tanstack/react-router";
import { LibraryScreen } from "../screens";

export const Route = createFileRoute("/library")({ component: LibraryScreen });
