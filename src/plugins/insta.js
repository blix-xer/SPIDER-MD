const API_URL = "https://api-aswin-sparky.koyeb.app/api/downloader/igdl";

function extractMessageText(content) {
    if (!content) return "";

    for (let i = 0; i < 10; i++) {
        const wrapped =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message ||
            content.viewOnceMessageV2Extension?.message ||
            content.documentWithCaptionMessage?.message;

        if (!wrapped) break;
        content = wrapped;
    }

    return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        content.documentMessage?.caption ||
        ""
    ).trim();
}

function getQuotedText(message) {
    const content = message?.message || {};

    const context =
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo;

    return extractMessageText(context?.quotedMessage);
}

async function react(sock, message, emoji) {
    try {
        await sock.sendMessage(
            message.key.remoteJid,
            {
                react: {
                    text: emoji,
                    key: message.key
                }
            }
        );
    } catch {}
}

async function getInstagramMedia(url) {
    const endpoint = new URL(API_URL);
    endpoint.searchParams.set("url", url);

    const response = await fetch(endpoint, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        },
        signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
        throw new Error(
            `Instagram API error: HTTP ${response.status}`
        );
    }

    const result = await response.json();

    if (!Array.isArray(result?.data) || !result.data.length) {
        throw new Error(
            result?.message || "No Instagram media found."
        );
    }

    return result.data;
}

async function downloadMedia(url) {
    if (
        typeof url !== "string" ||
        !/^https?:\/\//i.test(url)
    ) {
        throw new Error("Invalid media URL returned by API.");
    }

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        },
        signal: AbortSignal.timeout(90000)
    });

    if (!response.ok) {
        throw new Error(
            `Media download failed: HTTP ${response.status}`
        );
    }

    const contentType = (
        response.headers.get("content-type") || ""
    ).toLowerCase();

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
        throw new Error("Downloaded media is empty.");
    }

    if (contentType.includes("image/")) {
        return {
            type: "image",
            buffer,
            mimetype: contentType.split(";")[0]
        };
    }

    if (contentType.includes("video/")) {
        return {
            type: "video",
            buffer,
            mimetype: contentType.split(";")[0]
        };
    }

    throw new Error(
        `Unsupported media type: ${contentType || "unknown"}`
    );
}

export const insta = {
    name: "insta",
    aliases: [],
    category: "DOWNLOAD",
    description: "Download Instagram images and videos",

    async execute(sock, message, args) {
        const jid = message.key.remoteJid;

        const url = (
            args.join(" ").trim() ||
            getQuotedText(message)
        ).trim();

        if (!url) {
            return sock.sendMessage(
                jid,
                {
                    text: "Please provide an Instagram URL or reply to a message containing one."
                },
                { quoted: message }
            );
        }

        try {
            await react(sock, message, "⬇️");

            const mediaList = await getInstagramMedia(url);

            let sentCount = 0;

            for (const item of mediaList) {
                if (!item?.url) continue;

                const media = await downloadMedia(item.url);

                if (media.type === "image") {
                    await sock.sendMessage(
                        jid,
                        {
                            image: media.buffer,
                            mimetype: media.mimetype
                        },
                        { quoted: message }
                    );
                } else if (media.type === "video") {
                    await sock.sendMessage(
                        jid,
                        {
                            video: media.buffer,
                            mimetype: media.mimetype
                        },
                        { quoted: message }
                    );
                }

                sentCount++;
            }

            if (!sentCount) {
                throw new Error("No supported Instagram media was sent.");
            }

            await react(sock, message, "✅");

        } catch (error) {
            console.error("[SPIDER-MD] Instagram error:", error);

            await react(sock, message, "❌");

            await sock.sendMessage(
                jid,
                {
                    text: `Instagram download failed: ${error.message || "Unknown error"}`
                },
                { quoted: message }
            );
        }
    }
};
