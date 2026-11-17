import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { SPIDER_API_URL, SPIDER_API_KEY } from "../spiderApiConfig.js";

function unwrap(content) {
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

function findMedia(message) {
    const current = unwrap(message.message);

    const isMedia = content =>
        content?.audioMessage ||
        content?.videoMessage ||
        content?.documentMessage;

    if (isMedia(current)) return message;

    const context =
        current?.extendedTextMessage?.contextInfo ||
        current?.imageMessage?.contextInfo ||
        current?.videoMessage?.contextInfo;

    if (!context?.quotedMessage) return null;

    const quoted = {
        key: {
            remoteJid: message.key.remoteJid,
            id: context.stanzaId,
            participant: context.participant,
            fromMe: false
        },
        message: context.quotedMessage
    };

    return isMedia(unwrap(quoted.message)) ? quoted : null;
}

export const mp3 = {
    name: "mp3",
    aliases: [],
    category: "CONVERTER",

    async execute(sock, message) {
        const jid = message.key.remoteJid;
        const api = SPIDER_API_URL;
        const key = SPIDER_API_KEY;

        const reply = text =>
            sock.sendMessage(jid, { text }, { quoted: message });

        try {
            if (!key) {
                return reply("SPIDER-API key is missing.");
            }

            const mediaMessage = findMedia(message);

            if (!mediaMessage) {
                return reply("Reply to an audio or video with .mp3");
            }

            const content = unwrap(mediaMessage.message);
            const media =
                content.audioMessage ||
                content.videoMessage ||
                content.documentMessage;

            const buffer = await downloadMediaMessage(
                mediaMessage,
                "buffer",
                {}
            );

            if (!buffer?.length) {
                throw new Error("Unable to download the media.");
            }

            if (buffer.length > 50 * 1024 * 1024) {
                throw new Error("Media exceeds the 50 MB upload limit.");
            }

            const mime = media.mimetype || "application/octet-stream";
            const form = new FormData();

            form.append(
                "media",
                new Blob([buffer], { type: mime }),
                "spider-input"
            );

            const response = await fetch(api + "/api/media/mp3", {
                method: "POST",
                headers: { "x-api-key": key },
                body: form,
                signal: AbortSignal.timeout(180000)
            });

            if (!response.ok) {
                let reason = "MP3 conversion failed.";
                try {
                    const result = await response.json();
                    reason = result.error || reason;
                } catch {}
                throw new Error(reason);
            }

            const result = Buffer.from(await response.arrayBuffer());

            if (!result.length) {
                throw new Error("The converted audio is empty.");
            }

            await sock.sendMessage(
                jid,
                {
                    audio: result,
                    mimetype: "audio/mpeg",
                    fileName: "SPIDER-MD-BLIX-XER.mp3",
                    ptt: false
                },
                { quoted: message }
            );

        } catch (error) {
            console.error("[SPIDER-MD] MP3 error:", error);
            await reply("MP3 conversion failed: " + (error.message || "Unknown error."));
        }
    }
};
