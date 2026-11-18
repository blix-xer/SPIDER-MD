import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import webpmux from "node-webpmux";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const { Image } = webpmux;

const PACK_NAME = "SPIDER-MD/BLIX-XER";
const PACK_PUBLISHER = "BLIX-XER";

function reply(sock, message, text) {
    return sock.sendMessage(
        message.key.remoteJid,
        { text },
        { quoted: message }
    );
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderr = "";

        child.stderr.on("data", chunk => {
            stderr += chunk.toString();

            if (stderr.length > 10000) {
                stderr = stderr.slice(-10000);
            }
        });

        child.on("error", error => {
            reject(new Error(
                error.code === "ENOENT"
                    ? "FFmpeg is not installed."
                    : error.message
            ));
        });

        child.on("close", code => {
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

function unwrap(content) {
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

function getContext(content) {
    return (
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo ||
        content.stickerMessage?.contextInfo ||
        null
    );
}

function getMedia(content) {
    const current = unwrap(content);

    if (current.stickerMessage) {
        return {
            type: "sticker",
            animated: current.stickerMessage.isAnimated === true,
            content: current
        };
    }

    if (current.imageMessage) {
        return { type: "image", content: current };
    }

    if (current.videoMessage) {
        return { type: "video", content: current };
    }

    const document = current.documentMessage;

    if (document) {
        const mime = String(document.mimetype || "").toLowerCase();

        if (mime.startsWith("image/")) {
            return { type: "image", content: current };
        }

        if (mime.startsWith("video/")) {
            return { type: "video", content: current };
        }
    }

    return null;
}

function getTarget(message) {
    const current = unwrap(message.message);
    const direct = getMedia(current);

    if (direct) {
        return {
            target: message,
            media: direct
        };
    }

    const context = getContext(current);

    if (!context?.quotedMessage || !context.stanzaId) {
        return null;
    }

    const quotedContent = unwrap(context.quotedMessage);
    const media = getMedia(quotedContent);

    if (!media) return null;

    const key = {
        remoteJid: message.key.remoteJid,
        id: context.stanzaId,
        fromMe: false
    };

    if (context.participant) {
        key.participant = context.participant;
    }

    return {
        target: {
            key,
            message: context.quotedMessage
        },
        media
    };
}

async function downloadMedia(sock, target) {
    const buffer = await downloadMediaMessage(
        target,
        "buffer",
        {},
        {
            reuploadRequest: sock.updateMediaMessage
        }
    );

    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw new Error("Unable to download the replied media.");
    }

    return buffer;
}

function buildExif(packName = PACK_NAME, publisher = PACK_PUBLISHER) {
    const metadata = Buffer.from(
        JSON.stringify({
            "sticker-pack-id": "spider-md-blix-xer",
            "sticker-pack-name": packName,
            "sticker-pack-publisher": publisher,
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

async function withTempDirectory(callback) {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "spider-tools-")
    );

    try {
        return await callback(directory);
    } finally {
        await fs.rm(directory, {
            recursive: true,
            force: true
        }).catch(() => {});
    }
}

async function addExif(inputPath, outputPath, packName, publisher) {
    const image = new Image();

    await image.load(inputPath);

    image.exif = buildExif(packName, publisher);

    await image.save(outputPath);

    const verification = new Image();

    await verification.load(outputPath);
}

async function makeSticker(buffer, directory, name = "sticker") {
    const inputPath = path.join(directory, `${name}-input.webp`);
    const outputPath = path.join(directory, `${name}-output.webp`);

    await fs.writeFile(inputPath, buffer);

    const image = new Image();

    await image.load(inputPath);
    image.exif = buildExif();
    await image.save(outputPath);

    return fs.readFile(outputPath);
}

async function sendSticker(sock, message, buffer) {
    return sock.sendMessage(
        message.key.remoteJid,
        { sticker: buffer },
        { quoted: message }
    );
}

async function sendImage(sock, message, buffer) {
    return sock.sendMessage(
        message.key.remoteJid,
        {
            image: buffer,
            mimetype: "image/png"
        },
        { quoted: message }
    );
}

async function executeSafely(name, sock, message, callback) {
    try {
        return await callback();
    } catch (error) {
        console.error(`[SPIDER-MD] ${name} error:`, error);

        return reply(
            sock,
            message,
            `❌ *${name.toUpperCase()} FAILED*\n\n` +
            (error.message || "Unknown error.")
        );
    }
}

function requireSticker(target, animated) {
    if (!target || target.media.type !== "sticker") {
        throw new Error("Reply to a sticker with this command.");
    }

    if (target.media.animated !== animated) {
        throw new Error(
            animated
                ? "Reply to an animated sticker."
                : "Reply to a non-animated sticker."
        );
    }
}

export const exif = {
    name: "exif",
    category: "CONVERTER",
    description: "Read sticker pack information",

    async execute(sock, message) {
        return executeSafely("exif", sock, message, async () => {
            const target = getTarget(message);

            requireSticker(target, target?.media.animated === true);

            const buffer = await downloadMedia(sock, target.target);

            return withTempDirectory(async directory => {
                const inputPath = path.join(directory, "sticker.webp");

                await fs.writeFile(inputPath, buffer);

                const image = new Image();
                await image.load(inputPath);

                if (!image.exif) {
                    return reply(
                        sock,
                        message,
                        "_No sticker pack info found._"
                    );
                }

                const str = image.exif.toString("utf8");
                const json = str.slice(
                    str.indexOf("{"),
                    str.lastIndexOf("}") + 1
                );

                let data;

                try {
                    data = JSON.parse(json);
                } catch {
                    return reply(
                        sock,
                        message,
                        "_Can't read this sticker's pack info._"
                    );
                }

                return reply(
                    sock,
                    message,
                    "*Sticker Pack ID -->* " +
                    `${data["sticker-pack-id"] || "N/A"}\n\n` +
                    "*Pack name -->* " +
                    `${data["sticker-pack-name"] || "N/A"}\n\n` +
                    "*Publisher Name -->* " +
                    `${data["sticker-pack-publisher"] || "N/A"}`
                );
            });
        });
    }
};

export const take = {
    name: "take",
    category: "CONVERTER",
    description: "Change sticker pack metadata",

    async execute(sock, message, args) {
        return executeSafely("take", sock, message, async () => {
            const target = getTarget(message);

            requireSticker(target, target?.media.animated === true);

            const buffer = await downloadMedia(sock, target.target);

            const custom = args.join(" ").trim();
            const parts = custom
                ? custom.split(";")
                : [PACK_NAME, PACK_PUBLISHER];

            const packName = parts[0]?.trim() || PACK_NAME;
            const publisher = parts[1]?.trim() || PACK_PUBLISHER;

            if (packName.length > 100 || publisher.length > 100) {
                throw new Error("Pack name and publisher must be under 100 characters.");
            }

            return withTempDirectory(async directory => {
                const inputPath = path.join(directory, "input.webp");
                const outputPath = path.join(directory, "output.webp");

                await fs.writeFile(inputPath, buffer);

                await addExif(
                    inputPath,
                    outputPath,
                    packName,
                    publisher
                );

                const result = await fs.readFile(outputPath);

                return sendSticker(sock, message, result);
            });
        });
    }
};

export const photo = {
    name: "photo",
    category: "CONVERTER",
    description: "Convert static sticker to photo",

    async execute(sock, message) {
        return executeSafely("photo", sock, message, async () => {
            const target = getTarget(message);

            requireSticker(target, false);

            const buffer = await downloadMedia(sock, target.target);

            return withTempDirectory(async directory => {
                const inputPath = path.join(directory, "input.webp");
                const outputPath = path.join(directory, "photo.png");

                await fs.writeFile(inputPath, buffer);

                await runFFmpeg([
                    "-y",
                    "-i", inputPath,
                    "-frames:v", "1",
                    "-c:v", "png",
                    outputPath
                ]);

                return sendImage(
                    sock,
                    message,
                    await fs.readFile(outputPath)
                );
            });
        });
    }
};

export const gif = {
    name: "gif",
    category: "CONVERTER",
    description: "Convert animated sticker to GIF video",

    async execute(sock, message) {
        return executeSafely("gif", sock, message, async () => {
            const target = getTarget(message);

            requireSticker(target, true);

            const buffer = await downloadMedia(sock, target.target);

            return withTempDirectory(async directory => {
                const inputPath = path.join(directory, "input.webp");
                const outputPath = path.join(directory, "output.mp4");

                await fs.writeFile(inputPath, buffer);

                await runFFmpeg([
                    "-y",
                    "-i", inputPath,
                    "-an",
                    "-vf", "fps=15,format=yuv420p",
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-crf", "25",
                    "-movflags", "+faststart",
                    outputPath
                ]);

                const result = await fs.readFile(outputPath);

                if (!result.length) {
                    throw new Error("GIF conversion produced an empty video.");
                }

                return sock.sendMessage(
                    message.key.remoteJid,
                    {
                        video: result,
                        mimetype: "video/mp4",
                        gifPlayback: true
                    },
                    { quoted: message }
                );
            });
        });
    }
};

async function processShape(buffer, directory, shape, outputType) {
    const inputPath = path.join(directory, "input-media");
    const outputPath = path.join(
        directory,
        outputType === "webp" ? "output.webp" : "output.png"
    );

    await fs.writeFile(inputPath, buffer);

    const crop = (
        "crop=w='min(iw,ih)':h='min(iw,ih)':" +
        "x='(iw-ow)/2':y='(ih-oh)/2'"
    );

    let filter = crop;

    if (shape === "circle") {
        filter +=
            ",scale=512:512,format=rgba," +
            "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':" +
            "a='if(lte(pow(X-W/2,2)+pow(Y-H/2,2)," +
            "pow(W/2,2)),alpha(X,Y),0)'";
    } else if (outputType === "webp") {
        filter += ",scale=512:512,format=rgba";
    }

    const args = [
        "-y",
        "-i", inputPath,
        "-frames:v", "1",
        "-vf", filter
    ];

    if (outputType === "webp") {
        args.push(
            "-c:v", "libwebp",
            "-lossless", "0",
            "-q:v", "75",
            "-preset", "picture"
        );
    } else {
        args.push("-c:v", "png");
    }

    args.push(outputPath);

    await runFFmpeg(args);

    return fs.readFile(outputPath);
}

async function shapeCommand(sock, message, shape) {
    return executeSafely(shape, sock, message, async () => {
        const target = getTarget(message);

        if (
            !target ||
            !["image", "sticker"].includes(target.media.type)
        ) {
            throw new Error("Reply to a photo or sticker.");
        }

        if (
            target.media.type === "sticker" &&
            target.media.animated
        ) {
            throw new Error("Animated stickers are not supported.");
        }

        const buffer = await downloadMedia(sock, target.target);

        return withTempDirectory(async directory => {
            const outputType =
                target.media.type === "sticker" ? "webp" : "png";

            let result = await processShape(
                buffer,
                directory,
                shape,
                outputType
            );

            if (outputType === "webp") {
                const inputPath = path.join(directory, "shape-input.webp");
                const outputPath = path.join(directory, "shape-final.webp");

                await fs.writeFile(inputPath, result);
                await addExif(inputPath, outputPath);

                result = await fs.readFile(outputPath);

                return sendSticker(sock, message, result);
            }

            return sendImage(sock, message, result);
        });
    });
}

export const circle = {
    name: "circle",
    category: "CONVERTER",
    description: "Make a circular photo or sticker",

    async execute(sock, message) {
        return shapeCommand(sock, message, "circle");
    }
};

export const crop = {
    name: "crop",
    category: "CONVERTER",
    description: "Crop a photo or sticker into a square",

    async execute(sock, message) {
        return shapeCommand(sock, message, "crop");
    }
};
