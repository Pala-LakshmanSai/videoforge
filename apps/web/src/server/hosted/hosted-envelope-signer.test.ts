import { canonicalizeJson } from "@videoforge/contracts";
import { describe, expect, it } from "vitest";

import {
  createHostedEnvelopePairSigner,
  HostedEnvelopeSigningError,
  signHostedEnvelopeBody,
} from "./hosted-envelope-signer";

const SECRET = "differential-envelope-key-0123456789abcdef";
const SECRET_HEX = Array.from(new TextEncoder().encode(SECRET), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");
const BODY = {
  schema: "serverless-worker-job-envelope/v3",
  dispatch_token: "dispatch-token-0123456789abcdef0123456789abcdef",
  tenant: { account_id: "account-a", workspace_id: "workspace-a" },
  work: { item_count: 2, labels: ["café", "😀"] },
  limits: { expires_at: "2099-01-01T00:00:00Z", max_items: 2 },
  policy: { model_download_permitted: false },
} as const;

describe("hosted v3 envelope signing", () => {
  it("matches the pinned TypeScript/Python differential vector", async () => {
    const result = await signHostedEnvelopeBody(BODY, {
      keyId: "envelope-key-v1",
      secretHex: SECRET_HEX,
    });
    expect(canonicalizeJson(BODY)).toBe(
      '{"dispatch_token":"dispatch-token-0123456789abcdef0123456789abcdef","limits":{"expires_at":"2099-01-01T00:00:00Z","max_items":2},"policy":{"model_download_permitted":false},"schema":"serverless-worker-job-envelope/v3","tenant":{"account_id":"account-a","workspace_id":"workspace-a"},"work":{"item_count":2,"labels":["café","😀"]}}',
    );
    expect(result).toEqual({
      authoritySha256: "sha256:44de71c2d97cb8ca42c3670a0ebd7b3d2b6a1d0789ea84bc16f766217f59bf0d",
      keyId: "envelope-key-v1",
      keyHash: "sha256:4d177e1922e6e187a483273e842b2dfabe1284751139acfe55662affb5b036cc",
      signature: {
        algorithm: "HMAC-SHA256",
        key_id: "envelope-key-v1",
        value: "ddd459747ce4f7588615ab10d845014d7d2333436db7b22630f84b455337e616",
      },
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("is deterministic and changes for any body or key identity drift", async () => {
    const first = await signHostedEnvelopeBody(BODY, {
      keyId: "envelope-key-v1",
      secretHex: SECRET_HEX,
    });
    const reordered = Object.fromEntries(Object.entries(BODY).reverse()) as typeof BODY;
    await expect(
      signHostedEnvelopeBody(reordered, { keyId: "envelope-key-v1", secretHex: SECRET_HEX }),
    ).resolves.toEqual(first);
    const tampered = await signHostedEnvelopeBody(
      { ...BODY, work: { ...BODY.work, item_count: 1 } },
      { keyId: "envelope-key-v1", secretHex: SECRET_HEX },
    );
    expect(tampered.authoritySha256).not.toBe(first.authoritySha256);
    expect(tampered.signature.value).not.toBe(first.signature.value);
    const rotated = await signHostedEnvelopeBody(BODY, {
      keyId: "envelope-key-v2",
      secretHex: SECRET_HEX,
    });
    expect(rotated.authoritySha256).toBe(first.authoritySha256);
    expect(rotated.signature.value).not.toBe(first.signature.value);
  });

  it("fails closed on signed bodies, weak keys, and values outside the restricted I-JSON subset", async () => {
    const cases: readonly [unknown, { keyId: string; secretHex: string }][] = [
      [
        { ...BODY, authority_sha256: `sha256:${"a".repeat(64)}` },
        { keyId: "key-a", secretHex: SECRET_HEX },
      ],
      [BODY, { keyId: "key-a", secretHex: "short" }],
      [
        { ...BODY, fractional: 1.5 },
        { keyId: "key-a", secretHex: SECRET_HEX },
      ],
      [
        { ...BODY, é: true },
        { keyId: "key-a", secretHex: SECRET_HEX },
      ],
      [
        { ...BODY, work: { labels: ["\ud800"] } },
        { keyId: "key-a", secretHex: SECRET_HEX },
      ],
    ];
    for (const [body, binding] of cases) {
      await expect(signHostedEnvelopeBody(body as never, binding)).rejects.toBeInstanceOf(
        HostedEnvelopeSigningError,
      );
    }
  });

  it("requires and signs both exact lane bodies as one pair", async () => {
    const signer = createHostedEnvelopePairSigner({
      keyId: "envelope-key-v1",
      secretHex: SECRET_HEX,
    });
    await expect(signer.signPair([{ lane: "mage_image", body: BODY }])).rejects.toBeInstanceOf(
      HostedEnvelopeSigningError,
    );
    const bodies = [
      { lane: "mage_image" as const, body: BODY },
      { lane: "soulx_avatar" as const, body: { ...BODY, work: { item_count: 1 } } },
    ];
    const signatures = await signer.signPair(bodies);
    expect(signatures).toEqual([
      expect.objectContaining({ lane: "mage_image", keyId: "envelope-key-v1" }),
      expect.objectContaining({ lane: "soulx_avatar", keyId: "envelope-key-v1" }),
    ]);
    await expect(signer.verifyPair(bodies, signatures)).resolves.toBe(true);
    await expect(
      signer.verifyPair(bodies, [
        { ...signatures[0]!, signature: { ...signatures[0]!.signature, value: "0".repeat(64) } },
        signatures[1]!,
      ]),
    ).resolves.toBe(false);
  });
});
