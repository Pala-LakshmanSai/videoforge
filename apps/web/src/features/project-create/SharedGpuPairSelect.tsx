import { LockKeyhole } from "lucide-react";

import { AppSelect } from "../../components/ui";
import type { GpuOffer, SharedAppState } from "../../lib/types";

function label(offer: GpuOffer): string {
  return `${offer.gpuSku} · ${offer.vramGb} GB · $${offer.rateUsdPerHour.toFixed(2)}/hr`;
}

function detail(offer: GpuOffer): string {
  return `Secure Cloud · ${offer.region} · receipt ${offer.receiptId}`;
}

export function SharedGpuPairSelect({
  shared,
  imageReceiptId,
  avatarReceiptId,
  onImageChange,
  onAvatarChange,
}: {
  shared: SharedAppState;
  imageReceiptId: string;
  avatarReceiptId: string;
  onImageChange: (receiptId: string) => void;
  onAvatarChange: (receiptId: string) => void;
}) {
  if (shared.session) {
    const pair = shared.session.gpuPair;
    return (
      <div className="compute-lane-grid field-wide" aria-label="Locked shared GPU pair">
        {[pair.image, pair.avatar].map((offer) => (
          <div className="compute-lane-card" key={offer.lane}>
            <div className="compute-lane-heading">
              <span>
                <strong>
                  {offer.lane === "image_media" ? "Image and media GPU" : "Avatar GPU"}
                </strong>
                <small>{label(offer)}</small>
              </span>
              <span className="compute-status">
                <LockKeyhole size={14} /> Locked
              </span>
            </div>
            <small>{detail(offer)}</small>
          </div>
        ))}
      </div>
    );
  }

  const options = (lane: GpuOffer["lane"]) =>
    shared.inventory
      .filter((offer) => offer.lane === lane)
      .map((offer) => ({ value: offer.receiptId, label: label(offer), detail: detail(offer) }));
  return (
    <div className="compute-lane-grid field-wide" id="gpu-pair-selectors">
      <div className="compute-lane-card">
        <div className="compute-lane-heading">
          <strong>Image and media GPU</strong>
          <span className="compute-status">
            <i /> Live receipt
          </span>
        </div>
        <AppSelect
          label="Image and media GPU offer"
          value={imageReceiptId}
          onValueChange={onImageChange}
          options={options("image_media")}
        />
      </div>
      <div className="compute-lane-card">
        <div className="compute-lane-heading">
          <strong>Avatar GPU</strong>
          <span className="compute-status">
            <i /> Live receipt
          </span>
        </div>
        <AppSelect
          label="Avatar GPU offer"
          value={avatarReceiptId}
          onValueChange={onAvatarChange}
          options={options("avatar_primary")}
        />
      </div>
    </div>
  );
}
