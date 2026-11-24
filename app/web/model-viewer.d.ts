import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        "camera-controls"?: boolean | string;
        loading?: "auto" | "lazy" | "eager";
        "interpolation-decay"?: string;
        "shadow-intensity"?: string;
        ar?: boolean | string;
        "ar-modes"?: string;
        "ar-scale"?: string;
      };
    }
  }
}
