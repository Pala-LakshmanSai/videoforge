import { MPEGDecoder } from "mpg123-decoder";
import module from "./mpg123.wasm";

export function createVoiceoverDecoder(): MPEGDecoder {
  // Workers require a statically bundled module, not runtime WebAssembly compilation.
  (MPEGDecoder as typeof MPEGDecoder & { module: WebAssembly.Module }).module = module;
  return new MPEGDecoder({ enableGapless: false });
}
