import { createFileRoute } from "@tanstack/react-router";
import { StandaloneVoiceover } from "../hosted/StandaloneVoiceover";

export const Route = createFileRoute("/create-voiceover")({ component: StandaloneVoiceover });
