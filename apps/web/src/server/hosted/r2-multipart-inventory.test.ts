import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({sign: vi.fn()}));
vi.mock("aws4fetch", () => ({AwsClient: class {sign = fixture.sign;}}));
import { HostedR2Signer } from "./r2";

const key = "tenant/account/workspace/workspace/project/project/revision/revision/lane/render/job/attempt/artifact/final.mp4";
const config = {accountId: "fixture", bucketName: "private-fixture", region: "auto",
  accessKeyId: "fixture-key", secretAccessKey: "fixture-secret"} as const;
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const upload = (objectKey: string, id: string) => `<Upload><Key>${xml(objectKey)}</Key><UploadId>${xml(id)}</UploadId>` +
  "<Initiator><ID>fixture</ID><DisplayName>fixture</DisplayName></Initiator></Upload>";
const page = (uploads = "", truncated = "false", markers = "", encoding = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><ListMultipartUploadsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
  `<Prefix>${xml(encoding ? encodeURIComponent(key) : key)}</Prefix>${encoding ? "<EncodingType>url</EncodingType>" : ""}` +
  `${uploads}<IsTruncated>${truncated}</IsTruncated>${markers}</ListMultipartUploadsResult>`;
const next = (objectKey: string, id: string) => `<NextKeyMarker>${xml(objectKey)}</NextKeyMarker>` +
  `<NextUploadIdMarker>${xml(id)}</NextUploadIdMarker>`;
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fixture.sign.mockReset().mockImplementation(async (url: URL, options: RequestInit) => new Request(url, options));
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

it("returns only exact-key opaque IDs after complete paginated bucket-root inventory", async () => {
  const opaque = 'opaque/+?=&"% ü';
  fetcher.mockResolvedValueOnce(new Response(page(upload(key, opaque) + upload(`${key}.neighbor`, "neighbor"),
    "true", next(key, opaque))))
    .mockResolvedValueOnce(new Response(page(upload(key, "second"))));
  expect(await new HostedR2Signer(config).listMultipartUploadsExact(key)).toEqual([opaque, "second"]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const first = new URL(fixture.sign.mock.calls[0]![0]);
  const second = new URL(fixture.sign.mock.calls[1]![0]);
  expect(first.pathname).toBe("/private-fixture");
  expect(first.searchParams.get("uploads")).toBe("");
  expect(first.searchParams.get("prefix")).toBe(key);
  expect(first.searchParams.get("max-uploads")).toBe("100");
  expect(second.searchParams.get("key-marker")).toBe(key);
  expect(second.searchParams.get("upload-id-marker")).toBe(opaque);
});

it("decodes URL-encoded keys and XML entities while preserving opaque percent characters in IDs", async () => {
  const opaque = "id%2F+&/";
  fetcher.mockResolvedValueOnce(new Response(page(upload(encodeURIComponent(key), opaque), "true",
    next(encodeURIComponent(key), opaque), "url")))
    .mockResolvedValueOnce(new Response(page("", "false", "", "url")));
  expect(await new HostedR2Signer(config).listMultipartUploadsExact(key)).toEqual([opaque]);
  expect(new URL(fixture.sign.mock.calls[1]![0]).searchParams.get("key-marker")).toBe(key);
  expect(new URL(fixture.sign.mock.calls[1]![0]).searchParams.get("upload-id-marker")).toBe(opaque);
});

it("never returns partial IDs when a later page fails", async () => {
  fetcher.mockResolvedValueOnce(new Response(page(upload(key, "known"), "true", next(key, "known"))))
    .mockResolvedValueOnce(new Response("unavailable", {status: 503}));
  await expect(new HostedR2Signer(config).listMultipartUploadsExact(key)).rejects.toThrow("HTTP_FAILED");
});

it.each([
  "<Error><Code>AccessDenied</Code></Error>",
  page("", "true"),
  page("", "true", next("outside-prefix", "id")),
  page("", "unknown"),
  page().replace("<IsTruncated>false</IsTruncated>", ""),
  page().replace("<IsTruncated>false</IsTruncated>", "<IsTruncated>false</IsTruncated><IsTruncated>false</IsTruncated>"),
  page(upload(key, "id")).replace("</Upload>", "</Wrong>"),
  page(upload(key, "id")).replace("id</UploadId>", "&unknown;</UploadId>"),
  page(upload(key, "id")).replace("id</UploadId>", "&#0;</UploadId>"),
  page(upload(key, "id")).replace("id</UploadId>", `${String.fromCharCode(0)}</UploadId>`),
  page().replace("<IsTruncated>", "<Delimiter>/</Delimiter><IsTruncated>"),
  page().replace("<IsTruncated>", "<KeyMarker>unexpected</KeyMarker><IsTruncated>"),
  page("<Error><Code>failed</Code></Error>"),
  '<!DOCTYPE x [<!ENTITY hidden SYSTEM "file:///private">]>' + page(),
])("fails closed on incomplete/error/malformed XML inventory %#", async body => {
  fetcher.mockResolvedValue(new Response(body));
  await expect(new HostedR2Signer(config).listMultipartUploadsExact(key)).rejects.toThrow();
});

it("rejects cyclic continuation pairs", async () => {
  fetcher.mockImplementation(async () => new Response(page("", "true", next(key, "same"))));
  await expect(new HostedR2Signer(config).listMultipartUploadsExact(key)).rejects.toThrow("MARKER_CYCLE");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("stops at one hundred pages without claiming complete inventory", async () => {
  fetcher.mockImplementation(async () => new Response(page("", "true", next(key, `id-${fetcher.mock.calls.length}`))));
  await expect(new HostedR2Signer(config).listMultipartUploadsExact(key)).rejects.toThrow("PAGE_LIMIT");
  expect(fetcher).toHaveBeenCalledTimes(100);
});

it("bounds streamed bodies before parsing instead of trusting missing Content-Length", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(new Uint8Array(1_048_577));
  }, cancel: cancelled});
  fetcher.mockResolvedValue(new Response(body));
  await expect(new HostedR2Signer(config).listMultipartUploadsExact(key)).rejects.toThrow("TOO_LARGE");
  expect(cancelled).toHaveBeenCalledOnce();
});

it("rejects broad keys before signing or storage access", async () => {
  await expect(new HostedR2Signer(config).listMultipartUploadsExact("tenant/account/")).rejects.toThrow("KEY_INVALID");
  expect(fixture.sign).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves exact multipart request body, opaque query and controller-only signing", async () => {
  fetcher.mockResolvedValue(new Response("accepted"));
  const response = await new HostedR2Signer(config).multipartRequest("POST", key,
    {uploadId: "opaque/+&%"}, "<CompleteMultipartUpload/>", "application/xml");
  expect(await response.text()).toBe("accepted");
  expect(new URL(fixture.sign.mock.calls[0]![0]).searchParams.get("uploadId")).toBe("opaque/+&%");
  expect(fixture.sign.mock.calls[0]![1]).toEqual({method: "POST", body: "<CompleteMultipartUpload/>",
    headers: {"content-type": "application/xml"}});
  await expect(new HostedR2Signer(config).multipartRequest("DELETE", "tenant/account/", {})).rejects.toThrow("KEY_INVALID");
  expect(fixture.sign).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("preserves bounded exact part-signing with an opaque upload ID", async () => {
  const signed = new URL(await new HostedR2Signer(config).signMultipartPart(key, "opaque/+&%", 10_000));
  expect(signed.searchParams.get("uploadId")).toBe("opaque/+&%");
  expect(signed.searchParams.get("partNumber")).toBe("10000");
  expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(fixture.sign.mock.calls[0]![1]).toEqual({method: "PUT", aws: {signQuery: true}});
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([["tenant/account/", "id", 1], [key, "", 1], [key, "id", 0],
  [key, "id", 10_001], [key, "id", 1.5]] as const)("rejects invalid exact part authority %#", async (objectKey, id, part) => {
  await expect(new HostedR2Signer(config).signMultipartPart(objectKey, id, part)).rejects.toThrow("PART_INVALID");
  expect(fixture.sign).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
