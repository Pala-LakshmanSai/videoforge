import { Images } from "lucide-react";
import { useEffect, useState } from "react";

const SAFE_ID = "[A-Za-z0-9][A-Za-z0-9._:-]*";
const SAFE_FIXTURE_IMAGE = /^\/fixtures\/(?:avatar|styles)\/[a-z0-9][a-z0-9._-]*\.svg$/u;
const SAFE_AVATAR_PREVIEW = new RegExp(
  `^/api/v1/avatar-profiles/${SAFE_ID}/versions/${SAFE_ID}/preview$`,
  "u",
);
const SAFE_STYLE_PREVIEW = new RegExp(
  `^/api/v1/image-styles/${SAFE_ID}/versions/${SAFE_ID}/references/${SAFE_ID}/preview$`,
  "u",
);
const SAFE_HOSTED_PRESET_PREVIEW = new RegExp(
  `^/api/v2/hosted/(?:avatars|styles)/${SAFE_ID}/preview$`,
  "u",
);

export function isSafePresetImageSource(src: string): boolean {
  const normalized = src.trim();
  return (
    SAFE_FIXTURE_IMAGE.test(normalized) ||
    SAFE_AVATAR_PREVIEW.test(normalized) ||
    SAFE_STYLE_PREVIEW.test(normalized) ||
    SAFE_HOSTED_PRESET_PREVIEW.test(normalized)
  );
}

export function PresetImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const normalized = src.trim();
  useEffect(() => setFailed(false), [normalized]);

  return failed || !isSafePresetImageSource(normalized) ? (
    <span className="preset-image-fallback" role="img" aria-label={`${alt} unavailable`}>
      <Images aria-hidden="true" />
    </span>
  ) : (
    <img src={normalized} alt={alt} onError={() => setFailed(true)} />
  );
}
