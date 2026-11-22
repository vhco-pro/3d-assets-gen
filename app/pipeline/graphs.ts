// Port of the image and TRELLIS.2 graph builders in scripts/generate_3d.py (its Hunyuan3D builder stays there
// as reference only). Each builder returns the same ComfyUI API graph,
// node for node, as its Python counterpart for the same inputs; app/pipeline/graphs.test.ts holds them to it.

export type Ref = [string, number];
export interface GraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
}
export type Graph = Record<string, GraphNode>;

export const STYLE_SUFFIX =
  ", single object, game asset, centered, full object in view, " +
  "isolated on plain white background, three-quarter view, soft even lighting, no shadows";

export interface ImageGraphInput {
  prompt: string;
  seed: number;
  size: number;
  prefix: string;
}

export function imageGraph({ prompt, seed, size, prefix }: ImageGraphInput): Graph {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "6": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
    "7": { class_type: "EmptySD3LatentImage", inputs: { width: size, height: size, batch_size: 1 } },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0], seed, steps: 8, cfg: 1,
        sampler_name: "res_multistep", scheduler: "simple", denoise: 1,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: prefix } },
  };
}

export interface TrellisGraphInput {
  image: string;
  seed: number;
  prefix: string;
  faces: number;
  tex: number;
  /** Ultra: more sampler steps and a finer remesh, as trellis_graph(..., ultra=True) in the script. */
  ultra?: boolean;
}

const STANDARD_STEPS = [12, 20, 12, 12] as const;
const ULTRA_STEPS = [20, 30, 20, 20] as const;

export function trellisGraph({ image, seed, prefix, faces, tex, ultra = false }: TrellisGraphInput): Graph {
  const [s1, s2, s3, s4] = ultra ? ULTRA_STEPS : STANDARD_STEPS;
  const remesh = ultra ? 1024 : 768;
  const ks = (model: Ref, positive: Ref, negative: Ref, latent: Ref, steps: number, cfg: number, scheduler: string): GraphNode => ({
    class_type: "KSampler",
    inputs: {
      model, positive, negative, latent_image: latent, seed, steps, cfg, sampler_name: "euler", scheduler, denoise: 1,
    },
  });
  return {
    "1": { class_type: "LoadImage", inputs: { image } },
    "2": { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: "birefnet.safetensors" } },
    "3": { class_type: "RemoveBackground", inputs: { bg_removal_model: ["2", 0], image: ["1", 0] } },
    "4": {
      class_type: "ImageCropToMask",
      inputs: { images: ["1", 0], masks: ["3", 0], width: 1024, height: 1024, pad_factor: 1.1, grow_mask: 0, background: "#000000" },
    },
    "5": { class_type: "CLIPVisionLoader", inputs: { clip_name: "dino_v3_L_naf_fp32.safetensors" } },
    "6": { class_type: "Trellis2Conditioning", inputs: { clip_vision_model: ["5", 0], image: ["4", 0] } },
    "7": { class_type: "UNETLoader", inputs: { unet_name: "trellis_2_int8_convrot.safetensors", weight_dtype: "default" } },
    "8": { class_type: "VAELoader", inputs: { vae_name: "trellis_2_shape_vae_bf16.safetensors" } },
    "9": { class_type: "VAELoader", inputs: { vae_name: "trellis_2_texture_vae_bf16.safetensors" } },
    "10": { class_type: "CFGOverride", inputs: { model: ["7", 0], cfg: 1.0, start_percent: 0.667, end_percent: 1.0 } },
    "11": { class_type: "RescaleCFG", inputs: { model: ["10", 0], multiplier: 0.7 } },
    "12": { class_type: "ModelSamplingSD3", inputs: { model: ["11", 0], shift: 5.0 } },
    "13": { class_type: "EmptyTrellis2LatentStructure", inputs: { batch_size: 1 } },
    "14": ks(["12", 0], ["6", 0], ["6", 1], ["13", 0], s1, 7.5, "normal"),
    "15": { class_type: "VaeDecodeStructureTrellis2", inputs: { samples: ["14", 0], vae: ["8", 0], resolution: "32" } },
    "16": { class_type: "CFGOverride", inputs: { model: ["7", 0], cfg: 1.0, start_percent: 0.769, end_percent: 1.0 } },
    "17": { class_type: "RescaleCFG", inputs: { model: ["16", 0], multiplier: 0.5 } },
    "18": { class_type: "Trellis2ShapeStage", inputs: { positive: ["6", 0], negative: ["6", 1], voxel: ["15", 0] } },
    "19": ks(["17", 0], ["18", 0], ["18", 1], ["18", 2], s2, 7.5, "normal"),
    "20": {
      class_type: "Trellis2UpsampleStage",
      inputs: { positive: ["18", 0], negative: ["18", 1], shape_latent: ["19", 0], vae: ["8", 0], target_resolution: 1536 },
    },
    "21": ks(["17", 0], ["20", 0], ["20", 1], ["20", 2], s3, 7.5, "simple"),
    "22": { class_type: "VaeDecodeShapeTrellis", inputs: { samples: ["21", 0], vae: ["8", 0] } },
    "23": { class_type: "Trellis2TextureStage", inputs: { positive: ["20", 0], negative: ["20", 1], shape_latent: ["21", 0] } },
    "24": ks(["7", 0], ["23", 0], ["23", 1], ["23", 2], s4, 1.0, "normal"),
    "25": { class_type: "VaeDecodeTextureTrellis", inputs: { samples: ["24", 0], vae: ["9", 0], shape_subdivides: ["22", 1] } },
    "26": {
      class_type: "RemeshMesh",
      inputs: {
        mesh: ["22", 0], resolution: remesh, sign_mode: "solid", "sign_mode.fill": 20.0, "sign_mode.qef": false,
        band: 1.0, project_back: 0.0, fix_poles: false, smooth_iters: 20,
        drop_small_components: 0.01, precluster_max_verts: 20000000,
      },
    },
    "27": { class_type: "DecimateMesh", inputs: { mesh: ["26", 0], target_face_count: faces, placement_mode: "midpoint" } },
    "28": { class_type: "MeshSmoothNormals", inputs: { mesh: ["27", 0], crease_angle: 180.0 } },
    "29": { class_type: "UnwrapMesh", inputs: { mesh: ["28", 0], segmenter: "pec", resolution: tex, padding: 1, weld_distance: 0.0002 } },
    "30": { class_type: "BakeTextureFromVoxel", inputs: { mesh: ["29", 0], voxel_colors: ["25", 0], reference_mesh: ["22", 0], texture_size: tex } },
    "31": {
      class_type: "BakeAmbientOcclusion",
      inputs: {
        low_poly: ["29", 0], high_poly: ["26", 0], resolution: Math.min(tex, 1024),
        samples: 64, max_distance: 0.71, strength: 1.0, bias: 0.01,
      },
    },
    "32": {
      class_type: "BakeNormalMapFromMesh",
      inputs: { low_poly: ["29", 0], high_poly: ["26", 0], resolution: tex, cage_distance: 0.05, ignore_backfaces: true },
    },
    "33": {
      class_type: "ApplyTextureToMesh",
      inputs: {
        mesh: ["29", 0], base_color: ["30", 0], metallic: ["30", 1],
        roughness: ["30", 2], occlusion: ["31", 0], normal_map: ["32", 0],
      },
    },
    "34": { class_type: "MeshSmoothNormals", inputs: { mesh: ["33", 0], crease_angle: 180.0 } },
    "35": { class_type: "MeshToFile3D", inputs: { mesh: ["34", 0] } },
    "36": { class_type: "SaveGLB", inputs: { mesh: ["35", 0], filename_prefix: prefix } },
  };
}
