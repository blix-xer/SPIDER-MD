import os from "node:os";

function detectPlatform() {
    const env = process.env;

    // Hosted platforms take priority over local Termux indicators.
    if (env.B4A_URL) return "BACK4APP";
    if (env.PWD?.toLowerCase().includes("userland")) return "USERLAND";
    if (env.PITCHER_API_BASE_URL?.includes("codesandbox")) {
        return "CODESANDBOX";
    }
    if (env.REPLIT_USER) return "REPLIT";
    if (env.AWS_REGION) return "AWS";
    if (env.DYNO) return "HEROKU";
    if (env.KOYEB_APP_ID) return "KOYEB";
    if (env.GITHUB_SERVER_URL) return "GITHUB";
    if (env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_URL) {
        return "RENDER";
    }
    if (env.RAILWAY_SERVICE_NAME) return "RAILWAY";
    if (env.VERCEL) return "VERCEL";
    if (env.DIGITALOCEAN_APP_NAME) return "DIGITALOCEAN";
    if (env.AZURE_HTTP_FUNCTIONS) return "AZURE";
    if (env.NETLIFY) return "NETLIFY";
    if (env.FLY_IO) return "FLY_IO";
    if (env.CF_PAGES) return "CLOUDFLARE";
    if (env.SPACE_ID) return "HUGGINGFACE";
    if (env.TERMUX_VERSION) return "TERMUX";

    return os.platform().toUpperCase();
}

function formatPlatform(platform) {
    return platform
        .toLowerCase()
        .split("_")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export const platformPlugin = {
    name: "platform",
    aliases: ["server"],
    category: "SERVER",
    description: "Show deployment platform",

    async execute(sock, message) {
        const platform = formatPlatform(detectPlatform());

        return sock.sendMessage(
            message.key.remoteJid,
            {
                text: `_*You are deployed on ${platform}*_`
            },
            { quoted: message }
        );
    }
};
