import { createFileRoute } from "@tanstack/react-router";
import { VoiceoverHub } from "../hosted/VoiceoverHub";
export const Route = createFileRoute("/voiceovers")({ component: VoiceoverHub });
