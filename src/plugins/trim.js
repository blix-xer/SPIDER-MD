import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

function reply(sock, message, text) {
    return sock.sendMessage(
        message.key.remoteJid,
        { text },
        { quoted: message }
    );
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

function getMedia(content) {
    const current = unwrap(content);

    if (current.videoMessage) {
        return { type: "video" };
    }

    if (current.audioMessage) {
        return { type: "audio" };
    }

    const document = current.documentMessage;
    const mime = String(document?.mimetype || "").toLowerCase();

    if (mime.startsWith("video/")) {
        return { type: "video" };
    }

    if (mime.startsWith("audio/")) {
        return { type: "audio" };
    }

    return null;
}

function getContext(content) {
    const current = unwrap(content);

    return (
        current.extendedTextMessage?.contextInfo ||
        current.videoMessage?.contextInfo ||
        current.audioMessage?.contextInfo ||
        current.documentMessage?.contextInfo ||
        null
    );
}

function getTarget(message) {
    const current = unwrap(message.message);
    const directMedia = getMedia(current);

    if (directMedia) {
        return {
            target: message,
            media: directMedia
        };
    }

    const context = getContext(current);

    if (!context?.quotedMessage || !context.stanzaId) {
        return null;
    }

    const media = getMedia(context.quotedMessage);

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
        throw new Error("Unable to download media.");
    }

    return buffer;
}

function toSeconds(value) {
    const parts = String(value).trim().split(":").map(Number);

    if (
        parts.length > 2 ||
        parts.some(number => !Number.isFinite(number) || number < 0)
    ) {
        return NaN;
    }

    return parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts[0];
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderr = "";

        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("FFmpeg timed out."));
        }, 180000);

        child.stderr.on("data", chunk => {
            stderr += chunk.toString();

            if (stderr.length > 10000) {
                stderr = stderr.slice(-10000);
            }
        });

        child.on("error", error => {
            clearTimeout(timeout);
            reject(new Error(
                error.code === "ENOENT"
                    ? "FFmpeg is not installed."
                    : error.message
            ));
        });

        child.on("close", code => {
            clearTimeout(timeout);

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

async function trimMedia(buffer, mediaType, start, end) {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "spider-trim-")
    );

    const input = path.join(
        directory,
        mediaType === "video" ? "input.mp4" : "input.m4a"
    );

    const output = path.join(
        directory,
        mediaType === "video" ? "output.mp4" : "output.m4a"
    );

    try {
        await fs.writeFile(input, buffer);

        const duration = end - start;

        const args = [
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", input,
            "-ss", String(start),
            "-t", String(duration)
        ];

        if (mediaType === "video") {
            args.push(
                "-map", "0:v:0",
                "-map", "0:a:0?",
                "-sn",
                "-dn",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                output
            );
        } else {
            args.push(
                "-vn",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                "-f", "ipod",
                output
            );
        }

        await runFFmpeg(args);

        const result = await fs.readFile(output);

        if (!result.length) {
            throw new Error("FFmpeg returned an empty file.");
        }

        return result;
    } finally {
        await fs.rm(directory, {
            recursive: true,
            force: true
        });
    }
}

export const trim = {
    name: "trim",
    aliases: [],
    category: "CONVERTER",
    description: "Trim audio or video",

    async execute(sock, message, args) {
        const target = getTarget(message);

        if (!target) {
            return reply(
                sock,
                message,
                "*Reply to a video/audio e.g. _.trim 0:00,1:10*"
            );
        }

        const query = Array.isArray(args)
            ? args.join(" ").trim()
            : String(args || "").trim();

        if (!query) {
            return reply(
                sock,
                message,
                "*Need query to trim e.g.: _.trim 0:00,1:10*"
            );
        }

        const parts = query.split(",").map(part => part.trim());
        const numberRegex = /^-?\d+(:\d+)?$/;

        if (
            parts.length !== 2 ||
            !parts.every(part => numberRegex.test(part))
        ) {
            return reply(
                sock,
                message,
                "*Please check your format. The correct format is .trim 0:00,1:10*"
            );
        }

        const start = toSeconds(parts[0]);
        const end = toSeconds(parts[1]);

        if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end <= start
        ) {
            return reply(
                sock,
                message,
                "*Please check your format. The correct format is .trim 0:00,1:10*"
            );
        }

        try {
            const buffer = await downloadMedia(sock, target.target);

            const output = await trimMedia(
                buffer,
                target.media.type,
                start,
                end
            );

            if (target.media.type === "video") {
                return sock.sendMessage(
                    message.key.remoteJid,
                    {
                        video: output,
                        mimetype: "video/mp4"
                    },
                    { quoted: message }
                );
            }

            return sock.sendMessage(
                message.key.remoteJid,
                {
                    audio: output,
                    mimetype: "audio/mp4",
                    ptt: false
                },
                { quoted: message }
            );

        } catch (error) {
            console.error("[SPIDER-MD] Trim error:", error);

            return reply(
                sock,
                message,
                "Failed to trim media. Please try again."
            );
        }
    }
};
