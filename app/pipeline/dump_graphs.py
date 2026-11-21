"""Print the reference ComfyUI graphs that scripts/generate_3d.py builds for the golden input set, as JSON.

Usage: python3 -I -B app/pipeline/dump_graphs.py <path to scripts/generate_3d.py>
The script is loaded by path so no import path or working directory is trusted.
"""
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("generate_3d", sys.argv[1])
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

PREFIX = "asset-studio/11111111-2222-4333-8444-555555555555/66666666-7777-4888-9999-aaaaaaaaaaaa"
SEED = 1234567

cases = {
    "image/style": g.image_graph("a wooden crate" + g.STYLE_SUFFIX, SEED, 1024, PREFIX),
    "image/plain": g.image_graph("a wooden crate", 4294967295, 1024, PREFIX),
}
for faces in (5000, 10000, 20000):
    for tex in (1024, 2048):
        cases[f"trellis/{faces}/{tex}"] = g.trellis_graph("asset-studio/job.png", SEED, PREFIX, faces, tex)
    cases[f"hunyuan/{faces}"] = g.mesh_graph("asset-studio/job.png", SEED, 256, PREFIX, faces)

json.dump({"style_suffix": g.STYLE_SUFFIX, "prefix": PREFIX, "seed": SEED, "cases": cases},
          sys.stdout, indent=1, sort_keys=True)
sys.stdout.write("\n")
