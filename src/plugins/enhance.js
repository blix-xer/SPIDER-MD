import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { SPIDER_API_URL, SPIDER_API_KEY } from "../spiderApiConfig.js";

function unwrapMessage(message) {
    let content = message;

    for (let i = 0; i < 10; i++) {
        const wrapped =
            content?.ephemeralMessage?.message ||
            content?.viewOnceMessage?.message ||
            content?.viewOnceMessageV2?.message ||
            content?.viewOnceMessageV2Extension?.message ||
            content?.documentWithCaptionMessage?.message;

        if (!wrapped) break;
        content = wrapped;
    }

    return content;
}

function findImageMessage(message) {
    const current = unwrapMessage(message.message);

    if (current?.imageMessage) return message;

    const contextInfo =
        current?.extendedTextMessage?.contextInfo ||
        current?.imageMessage?.contextInfo;

    const quotedMessage = contextInfo?.quotedMessage;

    if (!quotedMessage) return null;

    const quoted = {
        key: {
            remoteJid: message.key.remoteJid,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant,
            fromMe: false
        },
        message: quotedMessage
    };

    if (unwrapMessage(quoted.message)?.imageMessage) {
        return quoted;
    }

    return null;
}

export const enhance = {
    name: "enhance",
    aliases: ["enhancer"],
    category: "TOOLS",

    async execute(sock, message) {
        const jid = message.key.remoteJid;


        const sendText = (text) =>
            sock.sendMessage(jid, { text }, { quoted: message });

        try {
            if (!SPIDER_API_KEY) {
                return sendText(
                    "SPIDER-API key is missing. Configure SPIDER_API_KEY before starting SPIDER-MD."
                );
            }

            const imageMessage = findImageMessage(message);

            if (!imageMessage) {
                return sendText(
                    "🖼️ *SPIDER IMAGE ENHANCER*\n\n" +
                    "Reply to an image with `.enhance` to improve it.\n\n" +
                    "Supported: JPG, PNG and WebP."
                );
            }

            await sendText("𝗘𝗡𝗛𝗔𝗡𝗖𝗜𝗡𝗚....");

            const buffer = await downloadMediaMessage(
                imageMessage,
                "buffer",
                {}
            );

            if (!buffer?.length) {
                throw new Error("Unable to download the image.");
            }

            if (buffer.length > 50 * 1024 * 1024) {
                throw new Error("Image exceeds the 50 MB upload limit.");
            }

            const form = new FormData();

            form.append(
                "media",
                new Blob([buffer], { type: "image/jpeg" }),
                "spider-image.jpg"
            );

            const response = await fetch(
                SPIDER_API_URL + "/api/image/enhance",
                {
                    method: "POST",
                    headers: {
                        "x-api-key": SPIDER_API_KEY
                    },
                    body: form,
                    signal: AbortSignal.timeout(180000)
                }
            );

            if (!response.ok) {
                let errorMessage = "SPIDER-API enhancement failed.";

                try {
                    const result = await response.json();
                    errorMessage = result.error || errorMessage;
                } catch {}

                throw new Error(errorMessage);
            }

            const contentType =
                response.headers.get("content-type") || "";

            if (!contentType.includes("image/")) {
                throw new Error(
                    "SPIDER-API did not return an enhanced image."
                );
            }

            const enhancedBuffer = Buffer.from(
                await response.arrayBuffer()
            );

            if (!enhancedBuffer.length) {
                throw new Error("Enhanced image is empty.");
            }

            await sock.sendMessage(
                jid,
                {
                    image: enhancedBuffer,
                    mimetype: "image/jpeg",
                    fileName: "SPIDER-ENHANCED.jpg",
                    caption:
                        "𝗠𝗔𝗗𝗘 𝗕𝗬 𝗦𝗣𝗜𝗗𝗘𝗥-𝗠𝗗/𝗕𝗟𝗜𝗫-𝗫𝗘𝗥"
                },
                { quoted: message }
            );

        } catch (error) {
            console.error("[SPIDER-MD] Enhance error:", error);

            await sendText(
                "❌ *Image enhancement failed!*\n\n" +
                (error.message || "Unknown enhancement error.")
            );
        }
    }
};
