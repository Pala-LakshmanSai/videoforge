import { createFileRoute } from "@tanstack/react-router";
import { NewAvatarScreen } from "../../screens";

export const Route = createFileRoute("/avatars/new")({ component: NewAvatarScreen });
