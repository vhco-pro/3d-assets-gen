// Builds the single ComfyUI graph a job submits: image graph plus the TRELLIS.2 mesh graph for a prompt job,
// or the mesh graph alone for an image job, plus a thumbnail branch. Rules are in the feature document's Design.
import { imageGraph, STYLE_SUFFIX, trellisGraph, type Graph, type Ref } from "./graphs.ts";
import { isUltra } from "./presets.ts";
import { IMAGE_SIZE } from "./presets.ts";

interface Common {
  seed: number;
  faces: number;
  tex: number;
}
export type JobGraphInput =
  | (Common & { kind: "prompt"; prompt: string; style: boolean; sharedStyle?: string | null })
  | (Common & { kind: "image"; upload: string });

const OFFSET = 100;

function isRef(v: unknown): v is Ref {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";
}

function meshGraph(input: JobGraphInput, image: string, prefix: string): Graph {
  return trellisGraph({ image, seed: input.seed, prefix, faces: input.faces, tex: input.tex, ultra: isUltra(input.faces, input.tex) });
}

export function combineGraph(input: JobGraphInput, prefix: string): Graph {
  const mesh = meshGraph(input, input.kind === "image" ? input.upload : "", prefix);
  const loadId = Object.keys(mesh).find((id) => mesh[id]?.class_type === "LoadImage");
  if (!loadId) throw new Error("mesh graph has no LoadImage node");
  const shift = (id: string): string => String(Number(id) + OFFSET);
  const out: Graph = {};
  let source: Ref;
  if (input.kind === "prompt") {
    // The prompt, then the batch's Shared style, then the game-asset suffix.
    const withShared = input.sharedStyle ? `${input.prompt}, ${input.sharedStyle}` : input.prompt;
    const text = input.style ? withShared + STYLE_SUFFIX : withShared;
    Object.assign(out, imageGraph({ prompt: text, seed: input.seed, size: IMAGE_SIZE, prefix }));
    source = ["9", 0];
  } else {
    source = [shift(loadId), 0];
  }
  for (const [id, node] of Object.entries(mesh)) {
    if (input.kind === "prompt" && id === loadId) continue;
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isRef(value)) inputs[key] = input.kind === "prompt" && value[0] === loadId ? source : [shift(value[0]), value[1]];
      else inputs[key] = value;
    }
    out[shift(id)] = { class_type: node.class_type, inputs };
  }
  out["200"] = { class_type: "ImageScale", inputs: { image: source, upscale_method: "lanczos", width: 256, height: 256, crop: "center" } };
  out["201"] = { class_type: "SaveImage", inputs: { images: ["200", 0], filename_prefix: `${prefix}/thumb` } };
  return out;
}
