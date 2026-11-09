
import os from "node:os";

function detectPlatform() {
    if (process.env.RENDER) return "RENDER";
    if (process.env.RAILWAY_ENVIRONMENT) return "RAILWAY";
    if (process.env.HEROKU_APP_NAME) return "HEROKU";
    if (process.env.VERCEL) return "VERCEL";

    if (process.env.TERMUX_VERSION ||
        process.env.PREFIX?.includes("com.termux")) {
        return "TERMUX";
    }

    if (process.env.ANDROID_ROOT) return "ANDROID";
    if (process.platform === "win32") return "WINDOWS";
    if (process.platform === "darwin") return "MACOS";
    if (process.platform === "linux") return "LINUX";

    return os.platform().toUpperCase();
}

export const config = {
    botName: "SPIDER-MD",
    ownerName: "BLIX-XER",
    ownerNumber: "918075298454",
    prefix: ".",
    version: "1.0.0",
    mode: "private",
    platform: detectPlatform()
};
