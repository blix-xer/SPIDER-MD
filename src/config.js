
import os from "node:os";

function detectPlatform() {
    if (process.env.RENDER) return "Render";
    if (process.env.RAILWAY_ENVIRONMENT) return "Railway";
    if (process.env.TERMUX_VERSION) return "Termux";

    return os.platform();
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
