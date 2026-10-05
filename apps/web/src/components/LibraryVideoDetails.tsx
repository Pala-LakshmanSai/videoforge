import { Image, Mic, UserRound } from "lucide-react";
import "../styles/features/library-video-details.css";

import type { VideoDetails } from "../lib/library-video-details";

function version(name: string | null | undefined, number: number | null | undefined) {
  return name ? `${name}${number ? ` · v${number}` : ""}` : "Not recorded";
}
export function LibraryVideoDetails({ details }: { details?: VideoDetails }) {
  return (
    <dl className="library-video-details" aria-label="Video settings">
      <div>
        <dt>
          <UserRound size={14} aria-hidden="true" />
          Avatar
        </dt>
        <dd>
          {details?.avatar_enabled === false
            ? "No avatar"
            : version(details?.avatar_name, details?.avatar_version)}
        </dd>
      </div>
      <div>
        <dt>
          <Mic size={14} aria-hidden="true" />
          Voiceover
        </dt>
        <dd>{details?.voiceover_name ?? details?.voiceover_filename ?? "Not recorded"}</dd>
        {details?.voiceover_name && details.voiceover_filename ? (
          <small>{details.voiceover_filename}</small>
        ) : null}
      </div>
      <div>
        <dt>
          <Image size={14} aria-hidden="true" />
          Image style
        </dt>
        <dd>{version(details?.image_style_name, details?.image_style_version)}</dd>
      </div>
    </dl>
  );
}
