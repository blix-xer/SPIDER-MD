const API_BASE = "https://lokixer.koyeb.app/";

function getTextFromMessage(content) {
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

function getFacebookUrl(text) {
    const matches = String(text || "").match(/https?:\/\/[^\s]+/gi) || [];

    return matches
        .map(url => url.replace(/[)\]}>,.!?]+$/g, ""))
        .find(url => {
            try {
                const hostname = new URL(url).hostname
                    .toLowerCase()
                    .replace(/^www\./, "");

                return (
                    hostname === "facebook.com" ||
                    hostname.endsWith(".facebook.com") ||
                    hostname === "fb.watch" ||
                    hostname.endsWith(".fb.watch")
                );
            } catch {
                return false;
            }
        }) || "";
}

export const fb = {
    name: "fb",
    aliases: ["facebook"],
    category: "DOWNLOAD",
    description: "Download Facebook videos",

    async execute(sock, message, args) {
        const jid = message.key.remoteJid;

        const quotedMessage =
            message.message?.extendedTextMessage
                ?.contextInfo?.quotedMessage;

        const quotedText = getTextFromMessage(quotedMessage);

        const input = [
            ...(args || []),
            quotedText
        ].filter(Boolean).join(" ");

        const url = getFacebookUrl(input);

        if (!url) {
            return sock.sendMessage(
                jid,
                {
                    text:
                        "*Need a Facebook public video link*\n\n" +
                        "Example: fb https://www.facebook.com/watch/?v=123456\n\n" +
                        "Only public Facebook video links are supported."
                },
                { quoted: message }
            );
        }

        try {
            await sock.sendMessage(jid, {
                react: {
                    text: "⬇️",
                    key: message.key
                }
            });

            const apiUrl = new URL(
                "download/facebook",
                API_BASE
            );

            apiUrl.searchParams.set("url", url);

            const apiResponse = await fetch(apiUrl, {
                signal: AbortSignal.timeout(60000)
            });

            if (!apiResponse.ok) {
                throw new Error(
                    `Facebook API returned HTTP ${apiResponse.status}`
                );
            }

            const response = await apiResponse.json();
            const result = response?.result;

            if (!result || (!result.hd && !result.sd)) {
                throw new Error(
                    "Facebook API did not return a downloadable video."
                );
            }

            // JARVIS sends SD in private chats.
            // SPIDER-MD uses SD by default because the original
            // group quality poll depends on JARVIS's separate sendurl command.
            const videoUrl = result.sd || result.hd;

            const videoResponse = await fetch(videoUrl, {
                signal: AbortSignal.timeout(120000)
            });

            if (!videoResponse.ok) {
                throw new Error(
                    `Video download failed with HTTP ${videoResponse.status}`
                );
            }

            const contentType =
                videoResponse.headers.get("content-type") || "video/mp4";

            if (
                !contentType.startsWith("video/") &&
                !contentType.includes("octet-stream")
            ) {
                throw new Error(
                    `Unsupported video content type: ${contentType}`
                );
            }

            const videoBuffer = Buffer.from(
                await videoResponse.arrayBuffer()
            );

            if (!videoBuffer.length) {
                throw new Error("Downloaded video is empty.");
            }

            await sock.sendMessage(
                jid,
                {
                    video: videoBuffer,
                    mimetype: contentType.startsWith("video/")
                        ? contentType
                        : "video/mp4",
                    caption: "Facebook video downloaded successfully."
                },
                { quoted: message }
            );

            await sock.sendMessage(jid, {
                react: {
                    text: "✅",
                    key: message.key
                }
            });

        } catch (error) {
            console.error(
                "[SPIDER-MD] Facebook downloader error:",
                error
            );

            await sock.sendMessage(jid, {
                react: {
                    text: "❌",
                    key: message.key
                }
            });

            await sock.sendMessage(
                jid,
                {
                    text:
                        "Could not download the Facebook video.\n" +
                        "Please check that the link is public and try again."
                },
                { quoted: message }
            );
        }
    }
};
