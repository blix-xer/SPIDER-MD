import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import webpmux from "node-webpmux";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const PACK_NAME = "SPIDER-MD/BLIX-XER";
const PACK_PUBLISHER = "BLIX-XER";

const MAX_VIDEO_SECONDS = 6;
const MAX_STICKER_SIZE = 1024 * 1024;

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderr = "";

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();

            if (stderr.length > 12000) {
                stderr = stderr.slice(-12000);
            }
        });

        child.on("error", (error) => {
            reject(new Error(
                error.code === "ENOENT"
                    ? "FFmpeg is missing. Install it using: pkg install ffmpeg"
                    : error.message
            ));
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(
                    stderr.trim() || `FFmpeg exited with code ${code}.`
                ));
            }
        });
    });
}

function unwrapMessage(content) {
    let current = content;

    for (let i = 0; i < 10 && current; i++) {
        const wrapped =
            current.ephemeralMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.viewOnceMessageV2Extension?.message ||
            current.documentWithCaptionMessage?.message;

        if (!wrapped) break;

        current = wrapped;
    }

    return current || {};
}

function getMediaDetails(content) {
    const current = unwrapMessage(content);

    if (current.imageMessage) {
        return { type: "image" };
    }

    if (current.videoMessage) {
        return { type: "video" };
    }

    const document = current.documentMessage;

    if (document) {
        const mime = String(
            document.mimetype || ""
        ).toLowerCase();

        if (mime.startsWith("image/")) {
            return { type: "image" };
        }

        if (mime.startsWith("video/")) {
            return { type: "video" };
        }
    }

    return null;
}

function buildStickerExif() {
    const metadata = Buffer.from(
        JSON.stringify({
            "sticker-pack-id": "spider-md-blix-xer",
            "sticker-pack-name": PACK_NAME,
            "sticker-pack-publisher": PACK_PUBLISHER,
            emojis: ["🕷️"]
        }),
        "utf8"
    );

    const header = Buffer.from([
        0x49, 0x49, 0x2A, 0x00,
        0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x41, 0x57,
        0x07, 0x00,
        0x00, 0x00,
        0x00, 0x00,
        0x16, 0x00,
        0x00, 0x00
    ]);

    header.writeUInt32LE(metadata.length, 14);

    return Buffer.concat([header, metadata]);
}

async function addStickerMetadata(inputPath, outputPath) {
    const image = new webpmux.Image();

    await image.load(inputPath);

    image.exif = buildStickerExif();

    await image.save(outputPath);

    const verification = new webpmux.Image();

    await verification.load(outputPath);
}

async function convertImage(inputPath, outputPath) {
    await runFFmpeg([
        "-y",
        "-i", inputPath,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-vf",
        "scale=512:512:force_original_aspect_ratio=decrease," +
        "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-c:v", "libwebp",
        "-lossless", "0",
        "-q:v", "75",
        "-preset", "picture",
        outputPath
    ]);
}

async function convertVideo(inputPath, outputPath) {
    await runFFmpeg([
        "-y",
        "-i", inputPath,
        "-map", "0:v:0",
        "-t", String(MAX_VIDEO_SECONDS),
        "-vf",
        "fps=12," +
        "scale=512:512:force_original_aspect_ratio=decrease," +
        "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-an",
        "-fps_mode", "passthrough",
        "-loop", "0",
        "-c:v", "libwebp",
        "-lossless", "0",
        "-q:v", "45",
        "-compression_level", "4",
        "-preset", "picture",
        outputPath
    ]);
}

async function downloadQuotedMedia(sock, quotedMessage, quotedKey) {
    return downloadMediaMessage(
        {
            key: quotedKey,
            message: quotedMessage
        },
        "buffer",
        {},
        {
            reuploadRequest: sock.updateMediaMessage
        }
    );
}

async function react(sock, message, text) {
    try {
        await sock.sendMessage(
            message.key.remoteJid,
            {
                react: {
                    text,
                    key: message.key
                }
            }
        );
    } catch (error) {
        console.error(
            "[SPIDER-MD] Sticker reaction error:",
            error.message
        );
    }
}

async function sendText(sock, jid, message, text) {
    return sock.sendMessage(
        jid,
        { text },
        { quoted: message }
    );
}

export const sticker = {
    name: "sticker",
    category: "CONVERTER",
    description: "Convert replied photos and videos into stickers",

    async execute(sock, message) {
        const jid = message?.key?.remoteJid;

        if (!jid) return;

        const context =
            message.message?.extendedTextMessage?.contextInfo;

        const quotedMessage = context?.quotedMessage;

        if (!quotedMessage || !context?.stanzaId) {
            return sendText(
                sock,
                jid,
                message,
                "_Reply to a image/video/gif!_"
            );
        }

        const media = getMediaDetails(quotedMessage);

        if (!media) {
            return sendText(
                sock,
                jid,
                message,
                "_Reply to a image/video/gif!_"
            );
        }

        const quotedKey = {
            remoteJid: jid,
            id: context.stanzaId,
            fromMe: !context.participant
        };

        if (context.participant) {
            quotedKey.participant = context.participant;
        }

        let tempDirectory;

        try {
            await react(sock, message, "⏫");

            const buffer = await downloadQuotedMedia(
                sock,
                quotedMessage,
                quotedKey
            );

            if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
                throw new Error(
                    "Could not download the replied media."
                );
            }

            tempDirectory = await fs.mkdtemp(
                path.join(os.tmpdir(), "spider-sticker-")
            );

            const inputPath = path.join(
                tempDirectory,
                "input-media"
            );

            const convertedPath = path.join(
                tempDirectory,
                "converted.webp"
            );

            const finalPath = path.join(
                tempDirectory,
                "spider-sticker.webp"
            );

            await fs.writeFile(inputPath, buffer);

            if (media.type === "image") {
                await convertImage(inputPath, convertedPath);
            } else {
                await convertVideo(inputPath, convertedPath);
            }

            await addStickerMetadata(
                convertedPath,
                finalPath
            );

            const stickerBuffer = await fs.readFile(finalPath);

            if (stickerBuffer.length === 0) {
                throw new Error("Generated sticker is empty.");
            }

            if (stickerBuffer.length > MAX_STICKER_SIZE) {
                throw new Error(
                    "Sticker exceeds the 1 MB limit. " +
                    "Try a smaller image or shorter video."
                );
            }

            await sock.sendMessage(
                jid,
                {
                    sticker: stickerBuffer
                },
                { quoted: message }
            );

            await react(sock, message, "✅");

            console.log(
                `[SPIDER-MD] Sticker created: ${media.type} | ${PACK_NAME}`
            );

        } catch (error) {
            console.error(
                "[SPIDER-MD] Sticker error:",
                error
            );

            await react(sock, message, "❌");

        } finally {
            if (tempDirectory) {
                await fs.rm(tempDirectory, {
                    recursive: true,
                    force: true
                }).catch(() => {});
            }
        }
    }
};
