import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { rename, writeFile } from "node:fs/promises";

export const AVATAR_PRIVATE_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;

export type AvatarPrivateTransfer = {
  sourceUrl: string;
  audioUrl: string;
  outputPutUrl: string;
  waitForOutput: () => Promise<void>;
  close: () => Promise<void>;
};

type LocalTransfer = AvatarPrivateTransfer & {
  setPublicBaseUrl: (value: string) => void;
};

export const startLocalAvatarPrivateTransfer = async (input: {
  source: Buffer;
  audio: Buffer;
  outputPath: string;
  publicBaseUrl?: string;
}): Promise<LocalTransfer> => {
  const token = randomBytes(32).toString("hex");
  const sourcePath = `/t/${token}/source.jpg`;
  const audioPath = `/t/${token}/audio.wav`;
  const outputPath = `/t/${token}/output.mp4`;
  const partialPath = `${input.outputPath}.part`;
  let publicBaseUrl = input.publicBaseUrl;
  let settleOutput!: () => void;
  let rejectOutput!: (error: Error) => void;
  let outputSettled = false;
  const outputPromise = new Promise<void>((resolve, reject) => {
    settleOutput = resolve;
    rejectOutput = reject;
  });
  const server = createServer((request, response) => {
    const pathname = request.url?.split("?", 1)[0];
    if (request.method === "GET" && pathname === sourcePath) {
      response.writeHead(200, {
        "content-type": "image/jpeg",
        "content-length": input.source.length,
      });
      response.end(input.source);
      return;
    }
    if (request.method === "GET" && pathname === audioPath) {
      response.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": input.audio.length,
      });
      response.end(input.audio);
      return;
    }
    if (request.method === "PUT" && pathname === outputPath) {
      if (outputSettled) {
        response.writeHead(409);
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      request.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > AVATAR_PRIVATE_OUTPUT_MAX_BYTES)
          request.destroy(new Error("AVATAR_OUTPUT_TOO_LARGE"));
        else chunks.push(chunk);
      });
      request.on("end", () => {
        void (async () => {
          if (bytes === 0 || bytes > AVATAR_PRIVATE_OUTPUT_MAX_BYTES)
            throw new Error("AVATAR_OUTPUT_SIZE_INVALID");
          await writeFile(partialPath, Buffer.concat(chunks), { flag: "wx" });
          await rename(partialPath, input.outputPath);
          outputSettled = true;
          settleOutput();
          response.writeHead(201);
          response.end();
        })().catch((error: unknown) => {
          const failure = error instanceof Error ? error : new Error("AVATAR_OUTPUT_WRITE_FAILED");
          if (!outputSettled) rejectOutput(failure);
          response.writeHead(500);
          response.end();
        });
      });
      request.on("error", (error) => {
        if (!outputSettled) rejectOutput(error);
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("AVATAR_TRANSFER_LISTEN_FAILED");
  const localBaseUrl = `http://127.0.0.1:${address.port}`;
  const url = (path: string): string => `${publicBaseUrl ?? localBaseUrl}${path}`;
  return {
    get sourceUrl() {
      return url(sourcePath);
    },
    get audioUrl() {
      return url(audioPath);
    },
    get outputPutUrl() {
      return url(outputPath);
    },
    setPublicBaseUrl(value) {
      publicBaseUrl = value.replace(/\/$/u, "");
    },
    waitForOutput: () => outputPromise,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
};

const tunnelUrl = /https:\/\/[a-z0-9-]+\.lhr\.life/iu;
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const waitForTunnelReady = async (
  publicUrl: string,
  process: ChildProcessWithoutNullStreams,
): Promise<void> => {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (process.exitCode !== null) throw new Error("AVATAR_TUNNEL_EXITED");
    try {
      const response = await fetch(publicUrl, { signal: AbortSignal.timeout(5_000) });
      if (response.status === 404) return;
    } catch {
      // Quick-tunnel DNS propagation can lag URL announcement.
    }
    await sleep(2_000);
  }
  throw new Error("AVATAR_TUNNEL_NOT_READY");
};

export const startSshAvatarPrivateTransfer = async (input: {
  source: Buffer;
  audio: Buffer;
  outputPath: string;
  sshPath?: string;
}): Promise<AvatarPrivateTransfer> => {
  const local = await startLocalAvatarPrivateTransfer(input);
  const localUrl = new URL(local.sourceUrl);
  const process: ChildProcessWithoutNullStreams = spawn(
    input.sshPath ?? "/usr/bin/ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ServerAliveInterval=15",
      "-R",
      `80:127.0.0.1:${localUrl.port}`,
      "nokey@localhost.run",
    ],
    { stdio: "pipe" },
  );
  try {
    const publicUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
      const timeout = setTimeout(() => rejectUrl(new Error("AVATAR_TUNNEL_TIMEOUT")), 45_000);
      const inspect = (chunk: Buffer): void => {
        const match = chunk.toString("utf8").match(tunnelUrl);
        if (!match) return;
        clearTimeout(timeout);
        resolveUrl(match[0]);
      };
      process.stdout.on("data", inspect);
      process.stderr.on("data", inspect);
      process.once("error", (error) => {
        clearTimeout(timeout);
        rejectUrl(error);
      });
      process.once("exit", (code) => {
        clearTimeout(timeout);
        rejectUrl(new Error(`AVATAR_TUNNEL_EXIT_${code ?? "UNKNOWN"}`));
      });
    });
    await waitForTunnelReady(publicUrl, process);
    local.setPublicBaseUrl(publicUrl);
  } catch (error) {
    process.kill("SIGTERM");
    await local.close();
    throw error;
  }
  return {
    sourceUrl: local.sourceUrl,
    audioUrl: local.audioUrl,
    outputPutUrl: local.outputPutUrl,
    waitForOutput: local.waitForOutput,
    close: async () => {
      process.kill("SIGTERM");
      await local.close();
    },
  };
};
