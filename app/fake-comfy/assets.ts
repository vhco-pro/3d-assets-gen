// Tiny, valid fixture files: a PNG encoder and a one-triangle glTF binary with an embedded base colour
// texture. Used by the fake ComfyUI and the seed so previews and downloads exercise real file formats.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typed = new TextEncoder().encode(type);
  out.set(typed, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Solid-colour RGB PNG of the given size. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function pad4(bytes: Uint8Array, fill: number): Uint8Array {
  const len = Math.ceil(bytes.length / 4) * 4;
  if (len === bytes.length) return bytes;
  const out = new Uint8Array(len).fill(fill);
  out.set(bytes);
  return out;
}

/** A glTF 2.0 binary with one textured triangle. */
export function texturedGlb(rgb: [number, number, number] = [200, 120, 40]): Uint8Array {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 1, 1, 1, 0.5, 0]);
  const png = solidPng(8, 8, rgb);
  const posBytes = new Uint8Array(positions.buffer);
  const uvBytes = new Uint8Array(uvs.buffer);
  const pngPadded = pad4(png, 0);
  const bin = new Uint8Array(posBytes.length + uvBytes.length + pngPadded.length);
  bin.set(posBytes, 0);
  bin.set(uvBytes, posBytes.length);
  bin.set(pngPadded, posBytes.length + uvBytes.length);
  const json = {
    asset: { version: "2.0", generator: "asset-studio fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 2, mimeType: "image/png" }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
      { buffer: 0, byteOffset: posBytes.length, byteLength: uvBytes.length },
      { buffer: 0, byteOffset: posBytes.length + uvBytes.length, byteLength: png.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
    ],
  };
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonBytes.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binHeader = 20 + jsonBytes.length;
  v.setUint32(binHeader, bin.length, true);
  v.setUint32(binHeader + 4, 0x004e4942, true);
  out.set(bin, binHeader + 8);
  return out;
}
