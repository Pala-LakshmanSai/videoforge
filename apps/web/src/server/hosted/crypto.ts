export async function sha256(value: string): Promise<`sha256:${string}`> {
  return sha256Bytes(new TextEncoder().encode(value));
}

export async function sha256Bytes(value: BufferSource): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function deriveCallbackToken(secret: string, attemptId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v2-06:${attemptId}`),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
