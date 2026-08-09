interface VoiceoverWorkerRequest {
  file: File;
}

interface VoiceoverWorkerSuccess {
  buffer: ArrayBuffer;
  hex: string;
  ok: true;
}

interface VoiceoverWorkerFailure {
  message: string;
  ok: false;
}

type VoiceoverWorkerResponse = VoiceoverWorkerFailure | VoiceoverWorkerSuccess;

interface WorkerScope {
  onmessage: ((event: MessageEvent<VoiceoverWorkerRequest>) => void) | null;
  postMessage(message: VoiceoverWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  void (async () => {
    try {
      const buffer = await event.data.file.arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
      const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      workerScope.postMessage({ buffer, hex, ok: true }, [buffer]);
    } catch {
      workerScope.postMessage({
        message: "The voiceover could not be read. Choose a local audio file and try again.",
        ok: false,
      });
    }
  })();
};

export {};
