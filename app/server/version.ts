/** Build identity embedded at compile time; "dev" when run from source. */
export const APP_VERSION: string = process.env.APP_VERSION ?? "dev";
export const APP_COMMIT: string = process.env.APP_COMMIT ?? "unknown";
