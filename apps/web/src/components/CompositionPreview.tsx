export function CompositionPreview({
  type,
}: {
  type: "AVATAR_FULL" | "IMAGE_FULL" | "AVATAR_SPLIT_IMAGE";
}) {
  return (
    <div
      className={`composition composition-${type.toLowerCase()}`}
      aria-label={type.replaceAll("_", " ").toLowerCase()}
    >
      {type === "AVATAR_FULL" ? (
        <div className="avatar-frame">
          <span className="avatar-silhouette" />
        </div>
      ) : null}
      {type === "IMAGE_FULL" ? (
        <div className="image-frame">
          <span className="landscape-shape" />
        </div>
      ) : null}
      {type === "AVATAR_SPLIT_IMAGE" ? (
        <>
          <div className="avatar-frame">
            <span className="avatar-silhouette" />
          </div>
          <div className="image-frame">
            <span className="landscape-shape" />
          </div>
        </>
      ) : null}
    </div>
  );
}
