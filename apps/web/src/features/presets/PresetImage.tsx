import { Images } from "lucide-react";
import { useState } from "react";

export function PresetImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed || !src.startsWith("/fixtures/") ? (
    <span className="preset-image-fallback" role="img" aria-label={`${alt} unavailable`}>
      <Images aria-hidden="true" />
    </span>
  ) : (
    <img src={src} alt={alt} onError={() => setFailed(true)} />
  );
}
