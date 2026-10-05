import { createFileRoute } from "@tanstack/react-router";
import { CentralizedLibraryScreen } from "../screens/CentralizedLibraryScreen";
export const Route = createFileRoute("/centralized-library")({
  component: CentralizedLibraryScreen,
});
