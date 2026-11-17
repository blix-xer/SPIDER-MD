import { URL } from "node:url";

const PINTEREST_HOSTS = [
    "pinterest.com",
    "www.pinterest.com",
    "pin.it"
];

function getPinterestUrl(args, message) {
    const text = [
        ...(Array.isArray(args) ? args : [String(args || "")]),
        message.message?.conversation || "",
        message.message?.extendedTextMessage?.text || ""
    ].join(" ");

    return text.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[)>.,]+$/, "");
}

function decodeHTML(value = "") {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/\\u002F/g, "/")
        .replace(/\\\//g, "/")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function getMeta(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
        new RegExp(
            `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
            "i"
        )
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return decodeHTML(match[1]);
    }

    return null;
}

function isPinterestMedia(url) {
    try {
        const parsed = new URL(url);
        return (
            parsed.protocol === "https:" &&
            (parsed.hostname === "pinimg.com" ||
             parsed.hostname.endsWith(".pinimg.com"))
        );
    } catch {
        return false;
    }
}

function findVideo(html) {
    const candidates = [
        getMeta(html, "og:video:secure_url"),
        getMeta(html, "og:video"),
        getMeta(html, "og:video:url"),
        getMeta(html, "twitter:player:stream")
    ];

    const matches = html.match(/https?:\\?\/\\?\/[^"'<>\\\s]+?\.mp4(?:\?[^"'<>\\\s]*)?/gi) || [];

    candidates.push(...matches.map(decodeHTML));

    for (const candidate of candidates) {
        if (!candidate) continue;

        const cleaned = candidate.replace(/&amp;/g, "&");

        if (/\.mp4(?:\?|$)/i.test(cleaned) && isPinterestMedia(cleaned)) {
            return cleaned;
        }
    }

    return null;
}

async function getPinterestMedia(pinUrl) {
    const parsed = new URL(pinUrl);

    if (!PINTEREST_HOSTS.includes(parsed.hostname.toLowerCase())) {
        throw new Error("Please provide a valid Pinterest link.");
    }

    const response = await fetch(pinUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
        headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
            "Accept": "text/html,application/xhtml+xml"
        }
    });

    if (!response.ok) {
        throw new Error(`Pinterest returned HTTP ${response.status}.`);
    }

    const finalUrl = new URL(response.url);

    if (!PINTEREST_HOSTS.includes(finalUrl.hostname.toLowerCase())) {
        throw new Error("Pinterest redirected to an unsupported website.");
    }

    const html = await response.text();

    const video = findVideo(html);

    if (video) {
        return { type: "video", url: video };
    }

    const imageCandidates = [
        getMeta(html, "og:image"),
        getMeta(html, "twitter:image"),
        getMeta(html, "og:image:secure_url")
    ];

    const image = imageCandidates.find(
        candidate => candidate && isPinterestMedia(candidate)
    );

    if (image) {
        return { type: "image", url: image };
    }

    throw new Error(
        "Could not find a downloadable photo or video. The pin may be private or unsupported."
    );
}

export const pinterest = {
    name: "pinterest",
    aliases: ["pin", "pinvideo", "pinimg"],
    category: "DOWNLOAD",
    description: "Download Pinterest photos and videos",

    async execute(sock, message, args) {
        const jid = message.key.remoteJid;

        try {
            const pinUrl = getPinterestUrl(args, message);

            if (!pinUrl) {
                return await sock.sendMessage(jid, {
                    text: "Send a Pinterest link.\n\nExample: .pinterest https://pin.it/example"
                }, { quoted: message });
            }

            await sock.sendMessage(jid, {
                text: "Downloading Pinterest media..."
            }, { quoted: message });

            const media = await getPinterestMedia(pinUrl);

            if (media.type === "video") {
                await sock.sendMessage(jid, {
                    video: { url: media.url },
                    mimetype: "video/mp4",
                    caption: "Pinterest video downloaded successfully."
                }, { quoted: message });
            } else {
                await sock.sendMessage(jid, {
                    image: { url: media.url },
                    caption: "Pinterest photo downloaded successfully."
                }, { quoted: message });
            }

        } catch (error) {
            console.error("[PINTEREST DOWNLOADER]", error);

            await sock.sendMessage(jid, {
                text: `Pinterest download failed: ${error.message || "Unknown error"}`
            }, { quoted: message });
        }
    }
};
