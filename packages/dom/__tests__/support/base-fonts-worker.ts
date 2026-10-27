// An engine worker with the base fonts only: the script fonts it doesn't
// register are fonts a catalogue can bring (browser/fonts.test.ts).
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { engineWasm, serve } from "../../../engine/src/server";

serve(engineWasm({ fonts: baseFonts }));
