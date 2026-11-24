// Short-lived signed GLB links for Scene Viewer, which fetches the model without the session cookie
// (feature document asset-studio-mobile, Design > AR: View in your room).
import { createHmac } from "node:crypto";
import { sameSecret } from "./auth.ts";

export const AR_LINK_SECONDS = 15 * 60;

function sign(token: string, id: string, exp: number): string {
  return createHmac("sha256", token).update(`ar:${id}:${String(exp)}`).digest("base64url");
}

/** The signed path for one job's GLB, valid for 15 minutes from `nowMs`. */
export function signedModelPath(token: string, id: string, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + AR_LINK_SECONDS;
  return `/api/assets/${id}/model.glb?exp=${String(exp)}&sig=${sign(token, id, exp)}`;
}

/** True when `exp` is a whole number of seconds not yet passed and `sig` signs this job and `exp`. */
export function verifySignedModel(token: string, id: string, exp: string, sig: string, nowMs: number): boolean {
  if (!/^\d{1,12}$/.test(exp)) return false;
  const e = Number(exp);
  if (e < Math.floor(nowMs / 1000)) return false;
  return sameSecret(sign(token, id, e), sig);
}
