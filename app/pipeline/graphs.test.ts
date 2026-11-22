import { describe, expect, test } from "bun:test";
import golden from "./golden/graphs.json";
import * as graphs from "./graphs.ts";
import { imageGraph, STYLE_SUFFIX, trellisGraph, type Graph, type Ref } from "./graphs.ts";
import { combineGraph } from "./combine.ts";

const g = golden as { style_suffix: string; prefix: string; seed: number; cases: Record<string, Graph> };
const PREFIX = g.prefix;
const SEED = g.seed;
const IMAGE = "asset-studio/job.png";

function gold(name: string): Graph {
  const graph = g.cases[name];
  if (!graph) throw new Error(`missing golden case ${name}`);
  return graph;
}

describe("builders match scripts/generate_3d.py", () => {
  test("style suffix", () => {
    expect(STYLE_SUFFIX).toBe(g.style_suffix);
  });
  test("image graph", () => {
    expect(imageGraph({ prompt: "a wooden crate" + STYLE_SUFFIX, seed: SEED, size: 1024, prefix: PREFIX })).toEqual(gold("image/style"));
    expect(imageGraph({ prompt: "a wooden crate", seed: 4294967295, size: 1024, prefix: PREFIX })).toEqual(gold("image/plain"));
  });
  for (const faces of [5000, 10000, 20000]) {
    for (const tex of [1024, 2048]) {
      test(`trellis ${faces}/${tex}`, () => {
        expect(trellisGraph({ image: IMAGE, seed: SEED, prefix: PREFIX, faces, tex })).toEqual(gold(`trellis/${faces}/${tex}`));
      });
    }
  }
});

/** Expected combined graph, derived from the golden graphs by the rules in the feature document. */
function expectedCombined(mesh: Graph, image: Graph | null, imageName: string): Graph {
  const out: Graph = {};
  const loadId = Object.entries(mesh).find(([, n]) => n.class_type === "LoadImage")?.[0];
  if (!loadId) throw new Error("mesh graph without LoadImage");
  const shift = (id: string): string => String(Number(id) + 100);
  const source: Ref = image ? ["9", 0] : [shift(loadId), 0];
  if (image) Object.assign(out, structuredClone(image));
  for (const [id, node] of Object.entries(mesh)) {
    if (image && id === loadId) continue;
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") {
        inputs[k] = image && v[0] === loadId ? ["9", 0] : [shift(v[0]), v[1]];
      } else inputs[k] = v;
    }
    if (!image && id === loadId) inputs.image = imageName;
    out[shift(id)] = { class_type: node.class_type, inputs };
  }
  out["200"] = { class_type: "ImageScale", inputs: { image: source, upscale_method: "lanczos", width: 256, height: 256, crop: "center" } };
  out["201"] = { class_type: "SaveImage", inputs: { images: ["200", 0], filename_prefix: `${PREFIX}/thumb` } };
  return out;
}

describe("combined graphs", () => {
  test("prompt job, TRELLIS.2, style on", () => {
    const got = combineGraph(
      { kind: "prompt", prompt: "a wooden crate", style: true, seed: SEED, faces: 10000, tex: 2048 },
      PREFIX,
    );
    expect(got).toEqual(expectedCombined(gold("trellis/10000/2048"), gold("image/style"), ""));
    expect(Object.values(got).filter((n) => n.class_type === "LoadImage")).toHaveLength(0);
  });
  test("prompt job, style off", () => {
    const got = combineGraph({ kind: "prompt", prompt: "a wooden crate", style: false, seed: 4294967295, faces: 20000, tex: 1024 }, PREFIX);
    const mesh = structuredClone(gold("trellis/20000/1024"));
    for (const n of Object.values(mesh)) if ("seed" in n.inputs) n.inputs.seed = 4294967295;
    expect(got).toEqual(expectedCombined(mesh, gold("image/plain"), ""));
  });
  test("image job keeps LoadImage with the job's upload", () => {
    const upload = "asset-studio/11111111-2222-4333-8444-555555555555.webp";
    const got = combineGraph({ kind: "image", upload, seed: SEED, faces: 5000, tex: 1024 }, PREFIX);
    expect(got).toEqual(expectedCombined(gold("trellis/5000/1024"), null, upload));
  });
  test("every save node carries the attempt prefix", () => {
    const got = combineGraph({ kind: "prompt", prompt: "x", style: true, seed: 1, faces: 10000, tex: 2048 }, PREFIX);
    const saves = Object.values(got).filter((n) => n.class_type === "SaveImage" || n.class_type === "SaveGLB");
    expect(saves).toHaveLength(3);
    for (const n of saves) expect(String(n.inputs.filename_prefix)).toStartWith(PREFIX);
  });
});

describe("TRELLIS.2 is the only mesh model (AC-23)", () => {
  test("the Ultra graph matches the reference script's Ultra setting (AC-29)", () => {
    expect(trellisGraph({ image: IMAGE, seed: SEED, prefix: PREFIX, faces: 30000, tex: 4096, ultra: true })).toEqual(gold("trellis/ultra"));
  });

  test("the golden set holds no Hunyuan3D case", () => {
    expect(Object.keys(g.cases).filter((k) => k.startsWith("hunyuan"))).toEqual([]);
  });
  test("the app exports no Hunyuan3D builder", () => {
    expect(Object.keys(graphs).filter((k) => k.toLowerCase().includes("hunyuan"))).toEqual([]);
  });
  test("combined graphs use only image, TRELLIS.2 and thumbnail node types", () => {
    const got = combineGraph({ kind: "image", upload: "asset-studio/x.png", seed: 1, faces: 10000, tex: 2048 }, PREFIX);
    expect(Object.values(got).map((n) => n.class_type).filter((t) => t.toLowerCase().includes("hunyuan"))).toEqual([]);
  });
});
