"""Headless prompt -> 2D image (Z-Image Turbo) -> 3D mesh via the ComfyUI API.

Engines: TRELLIS.2 (default; textured, UV-unwrapped, with normal/AO maps) or Hunyuan3D 2.1 (shape only).

Usage:
  python generate_3d.py "a wooden treasure chest"           # text -> image -> textured GLB
  python generate_3d.py --image chest.png                    # existing image -> GLB
  python generate_3d.py "a sword" --faces 5000 --tex 1024    # lighter game asset
  python generate_3d.py "a sword" --engine hunyuan           # untextured Hunyuan3D mesh

Requires a running ComfyUI server (Comfy Desktop, or start_headless.ps1).
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
import uuid

STYLE_SUFFIX = (", single object, game asset, centered, full object in view, "
                "isolated on plain white background, three-quarter view, soft even lighting, no shadows")


def api(server, path, data=None, headers=None):
    req = urllib.request.Request(f"{server}{path}", data=data, headers=headers or {})
    with urllib.request.urlopen(req) as r:
        return r.read()


def queue(server, graph):
    body = json.dumps({"prompt": graph, "client_id": str(uuid.uuid4())}).encode()
    try:
        res = json.loads(api(server, "/prompt", body, {"Content-Type": "application/json"}))
    except urllib.error.HTTPError as e:
        sys.exit(f"ComfyUI rejected the workflow:\n{e.read().decode()}")
    return res["prompt_id"]


def wait(server, prompt_id, label):
    start = time.time()
    while True:
        hist = json.loads(api(server, f"/history/{prompt_id}"))
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                sys.exit(f"{label} failed:\n{json.dumps(status.get('messages'), indent=1)}")
            print(f"{label} done in {time.time() - start:.0f}s")
            return entry["outputs"]
        time.sleep(1)


def output_files(outputs):
    for node_out in outputs.values():
        for items in node_out.values():
            if isinstance(items, list):
                for f in items:
                    if isinstance(f, dict) and "filename" in f:
                        yield f


def download(server, f, out_dir):
    q = urllib.parse.urlencode({"filename": f["filename"], "subfolder": f.get("subfolder", ""),
                                "type": f.get("type", "output")})
    path = os.path.join(out_dir, f["filename"])
    with open(path, "wb") as fh:
        fh.write(api(server, f"/view?{q}"))
    return path


def upload(server, path):
    boundary = uuid.uuid4().hex
    with open(path, "rb") as fh:
        data = fh.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
            f"filename=\"{os.path.basename(path)}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    body += data + (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\n"
                    f"true\r\n--{boundary}--\r\n").encode()
    res = json.loads(api(server, "/upload/image", body,
                         {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
    return f"{res['subfolder']}/{res['name']}" if res.get("subfolder") else res["name"]


def image_graph(prompt, seed, size, prefix):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": size, "height": size, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0],
                                                    "latent_image": ["7", 0], "seed": seed, "steps": 8, "cfg": 1,
                                                    "sampler_name": "res_multistep", "scheduler": "simple", "denoise": 1}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": prefix}},
    }


def mesh_graph(image_name, seed, octree, prefix, faces):
    graph = {
        "1": {"class_type": "ImageOnlyCheckpointLoader", "inputs": {"ckpt_name": "hunyuan_3d_v2.1.safetensors"}},
        "2": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "3": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 1}},
        "4": {"class_type": "CLIPVisionEncode", "inputs": {"clip_vision": ["1", 1], "image": ["2", 0], "crop": "center"}},
        "5": {"class_type": "Hunyuan3Dv2Conditioning", "inputs": {"clip_vision_output": ["4", 0]}},
        "6": {"class_type": "EmptyLatentHunyuan3Dv2", "inputs": {"resolution": 4096, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["3", 0], "positive": ["5", 0], "negative": ["5", 1],
                                                    "latent_image": ["6", 0], "seed": seed, "steps": 30, "cfg": 5,
                                                    "sampler_name": "euler", "scheduler": "normal", "denoise": 1}},
        "8": {"class_type": "VAEDecodeHunyuan3D", "inputs": {"samples": ["7", 0], "vae": ["1", 2],
                                                              "num_chunks": 8000, "octree_resolution": octree}},
        "9": {"class_type": "VoxelToMesh", "inputs": {"voxel": ["8", 0], "algorithm": "surface net", "threshold": 0.6}},
        "10": {"class_type": "SaveGLB", "inputs": {"mesh": ["9", 0], "filename_prefix": prefix}},
    }
    if faces:
        # Voxel extraction gives a dense, uniform mesh. Rebuild it as one watertight solid (drops double shells
        # and floating bits), collapse it to the target face count keeping sharp edges, then set hard-surface normals.
        graph["11"] = {"class_type": "RemeshMesh", "inputs": {
            "mesh": ["9", 0], "resolution": 256, "sign_mode": "solid", "sign_mode.fill": 20.0, "sign_mode.qef": True,
            "band": 1.0, "project_back": 0.0, "fix_poles": True, "smooth_iters": 0,
            "drop_small_components": 0.01, "precluster_max_verts": 20000000}}
        graph["12"] = {"class_type": "DecimateMesh", "inputs": {
            "mesh": ["11", 0], "target_face_count": faces, "placement_mode": "qem",
            "placement_mode.line_quadric_weight": 1.0, "placement_mode.feature_edge_quadric_weight": 10.0,
            "placement_mode.feature_edge_min_dihedral_deg": 30.0, "placement_mode.clamp_v_to_edge": True}}
        graph["13"] = {"class_type": "MeshSmoothNormals", "inputs": {"mesh": ["12", 0], "crease_angle": 40.0}}
        graph["10"]["inputs"]["mesh"] = ["13", 0]
    return graph


def trellis_graph(image_name, seed, prefix, faces, tex):
    # Mirrors the TRELLIS.2 path of ComfyUI's "Pixal3D / TRELLIS.2 image to model" template.
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "LoadBackgroundRemovalModel", "inputs": {"bg_removal_name": "birefnet.safetensors"}},
        "3": {"class_type": "RemoveBackground", "inputs": {"bg_removal_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "ImageCropToMask", "inputs": {"images": ["1", 0], "masks": ["3", 0], "width": 1024, "height": 1024,
                                                          "pad_factor": 1.1, "grow_mask": 0, "background": "#000000"}},
        "5": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": "dino_v3_L_naf_fp32.safetensors"}},
        "6": {"class_type": "Trellis2Conditioning", "inputs": {"clip_vision_model": ["5", 0], "image": ["4", 0]}},
        "7": {"class_type": "UNETLoader", "inputs": {"unet_name": "trellis_2_int8_convrot.safetensors", "weight_dtype": "default"}},
        "8": {"class_type": "VAELoader", "inputs": {"vae_name": "trellis_2_shape_vae_bf16.safetensors"}},
        "9": {"class_type": "VAELoader", "inputs": {"vae_name": "trellis_2_texture_vae_bf16.safetensors"}},
        # stage 1: sparse structure
        "10": {"class_type": "CFGOverride", "inputs": {"model": ["7", 0], "cfg": 1.0, "start_percent": 0.667, "end_percent": 1.0}},
        "11": {"class_type": "RescaleCFG", "inputs": {"model": ["10", 0], "multiplier": 0.7}},
        "12": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["11", 0], "shift": 5.0}},
        "13": {"class_type": "EmptyTrellis2LatentStructure", "inputs": {"batch_size": 1}},
        "14": {"class_type": "KSampler", "inputs": {"model": ["12", 0], "positive": ["6", 0], "negative": ["6", 1], "latent_image": ["13", 0],
                                                     "seed": seed, "steps": 12, "cfg": 7.5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1}},
        "15": {"class_type": "VaeDecodeStructureTrellis2", "inputs": {"samples": ["14", 0], "vae": ["8", 0], "resolution": "32"}},
        # stage 2: shape, then upsampled shape
        "16": {"class_type": "CFGOverride", "inputs": {"model": ["7", 0], "cfg": 1.0, "start_percent": 0.769, "end_percent": 1.0}},
        "17": {"class_type": "RescaleCFG", "inputs": {"model": ["16", 0], "multiplier": 0.5}},
        "18": {"class_type": "Trellis2ShapeStage", "inputs": {"positive": ["6", 0], "negative": ["6", 1], "voxel": ["15", 0]}},
        "19": {"class_type": "KSampler", "inputs": {"model": ["17", 0], "positive": ["18", 0], "negative": ["18", 1], "latent_image": ["18", 2],
                                                     "seed": seed, "steps": 20, "cfg": 7.5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1}},
        "20": {"class_type": "Trellis2UpsampleStage", "inputs": {"positive": ["18", 0], "negative": ["18", 1], "shape_latent": ["19", 0],
                                                                  "vae": ["8", 0], "target_resolution": 1536}},
        "21": {"class_type": "KSampler", "inputs": {"model": ["17", 0], "positive": ["20", 0], "negative": ["20", 1], "latent_image": ["20", 2],
                                                     "seed": seed, "steps": 12, "cfg": 7.5, "sampler_name": "euler", "scheduler": "simple", "denoise": 1}},
        "22": {"class_type": "VaeDecodeShapeTrellis", "inputs": {"samples": ["21", 0], "vae": ["8", 0]}},
        # stage 3: texture voxels
        "23": {"class_type": "Trellis2TextureStage", "inputs": {"positive": ["20", 0], "negative": ["20", 1], "shape_latent": ["21", 0]}},
        "24": {"class_type": "KSampler", "inputs": {"model": ["7", 0], "positive": ["23", 0], "negative": ["23", 1], "latent_image": ["23", 2],
                                                     "seed": seed, "steps": 12, "cfg": 1.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1}},
        "25": {"class_type": "VaeDecodeTextureTrellis", "inputs": {"samples": ["24", 0], "vae": ["9", 0], "shape_subdivides": ["22", 1]}},
        # game mesh: clean high-poly, decimate to target, unwrap, bake textures + normal/AO from the high-poly
        "26": {"class_type": "RemeshMesh", "inputs": {
            "mesh": ["22", 0], "resolution": 768, "sign_mode": "solid", "sign_mode.fill": 20.0, "sign_mode.qef": False,
            "band": 1.0, "project_back": 0.0, "fix_poles": False, "smooth_iters": 20,
            "drop_small_components": 0.01, "precluster_max_verts": 20000000}},
        "27": {"class_type": "DecimateMesh", "inputs": {"mesh": ["26", 0], "target_face_count": faces, "placement_mode": "midpoint"}},
        "28": {"class_type": "MeshSmoothNormals", "inputs": {"mesh": ["27", 0], "crease_angle": 180.0}},
        "29": {"class_type": "UnwrapMesh", "inputs": {"mesh": ["28", 0], "segmenter": "pec", "resolution": tex, "padding": 1, "weld_distance": 0.0002}},
        "30": {"class_type": "BakeTextureFromVoxel", "inputs": {"mesh": ["29", 0], "voxel_colors": ["25", 0], "reference_mesh": ["22", 0], "texture_size": tex}},
        "31": {"class_type": "BakeAmbientOcclusion", "inputs": {"low_poly": ["29", 0], "high_poly": ["26", 0], "resolution": min(tex, 1024),
                                                                 "samples": 64, "max_distance": 0.71, "strength": 1.0, "bias": 0.01}},
        "32": {"class_type": "BakeNormalMapFromMesh", "inputs": {"low_poly": ["29", 0], "high_poly": ["26", 0], "resolution": tex,
                                                                  "cage_distance": 0.05, "ignore_backfaces": True}},
        "33": {"class_type": "ApplyTextureToMesh", "inputs": {"mesh": ["29", 0], "base_color": ["30", 0], "metallic": ["30", 1],
                                                               "roughness": ["30", 2], "occlusion": ["31", 0], "normal_map": ["32", 0]}},
        "34": {"class_type": "MeshSmoothNormals", "inputs": {"mesh": ["33", 0], "crease_angle": 180.0}},
        "35": {"class_type": "MeshToFile3D", "inputs": {"mesh": ["34", 0]}},
        "36": {"class_type": "SaveGLB", "inputs": {"mesh": ["35", 0], "filename_prefix": prefix}},
    }


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("prompt", nargs="?", help="what to generate (skipped if --image is given)")
    p.add_argument("--image", help="use an existing image instead of generating one")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--size", type=int, default=1024, help="2D image size (default 1024)")
    p.add_argument("--octree", type=int, default=256, help="mesh detail: 256 default, 384/512 finer but slower")
    p.add_argument("--engine", choices=["trellis", "hunyuan"], default="trellis",
                   help="trellis: TRELLIS.2, textured (default). hunyuan: Hunyuan3D 2.1, shape only")
    p.add_argument("--faces", type=int, default=10000,
                   help="target triangle count after cleanup (default 10000); 0 keeps the raw dense mesh (hunyuan only)")
    p.add_argument("--tex", type=int, default=2048, help="texture size for trellis (default 2048)")
    p.add_argument("--no-style", action="store_true", help="don't append the game-asset prompt suffix")
    p.add_argument("--out", default=os.path.join(os.getcwd(), "output"))
    p.add_argument("--server", default="http://127.0.0.1:8188")
    a = p.parse_args()
    if not a.prompt and not a.image:
        p.error("give a prompt or --image")

    os.makedirs(a.out, exist_ok=True)
    seed = a.seed if a.seed is not None else random.randint(0, 2**32)
    name = f"asset_{time.strftime('%Y%m%d_%H%M%S')}"
    try:
        api(a.server, "/system_stats")
    except Exception:
        sys.exit(f"No ComfyUI server at {a.server}. Start Comfy Desktop or run start_headless.ps1.")

    if a.image:
        image_path = a.image
    else:
        prompt = a.prompt + ("" if a.no_style else STYLE_SUFFIX)
        print(f"[1/2] Generating image (seed {seed}): {prompt}")
        outs = wait(a.server, queue(a.server, image_graph(prompt, seed, a.size, f"comfy3d/{name}")), "Image")
        image_path = download(a.server, next(output_files(outs)), a.out)
        print(f"      -> {image_path}")

    print(f"[2/2] Generating 3D mesh with {a.engine}...")
    image_name = upload(a.server, image_path)
    if a.engine == "trellis":
        graph = trellis_graph(image_name, seed, f"comfy3d/{name}", a.faces or 10000, a.tex)
    else:
        graph = mesh_graph(image_name, seed, a.octree, f"comfy3d/{name}", a.faces)
    outs = wait(a.server, queue(a.server, graph), "Mesh")
    for f in output_files(outs):
        if f["filename"].lower().endswith(".glb"):
            print(f"      -> {download(a.server, f, a.out)}")
            print("Import into Blender with File > Import > glTF 2.0 (.glb)")


if __name__ == "__main__":
    main()
