import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

import { config } from "../config.js";

const DATA_DIR = path.join(process.cwd(), "data");
const MENTION_FILE = path.join(DATA_DIR, "mention.json");

const DEFAULT_CONFIG = {
    status: "true",
    message: ""
};

const MAX_DOWNLOAD_SIZE = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 30000;
const FFMPEG_TIMEOUT = 60000;

async function readMentionConfig() {
    try {
        const content = await fs.readFile(MENTION_FILE, "utf8");
        const saved = JSON.parse(content);

        return {
            status: String(saved?.status ?? "true"),
            message: String(saved?.message ?? "")
        };
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("[SPIDER-MD] Mention config read error:", error.message);
        }

        return { ...DEFAULT_CONFIG };
    }
}

async function saveMentionConfig(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporaryFile = `${MENTION_FILE}.tmp`;

    await fs.writeFile(
        temporaryFile,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    await fs.rename(temporaryFile, MENTION_FILE);
}

function extractJsonOptions(text) {
    const start = text.indexOf("{");

    if (start === -1) {
        return { options: {}, remainingText: text };
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = start; i < text.length; i++) {
        const character = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === "{") {
            depth++;
        } else if (character === "}") {
            depth--;

            if (depth === 0) {
                end = i;
                break;
            }
        }
    }

    if (end === -1) {
        console.error("[SPIDER-MD] Mention JSON has unmatched braces.");
        return { options: {}, remainingText: text };
    }

    try {
        const options = JSON.parse(text.slice(start, end + 1));

        return {
            options: options && typeof options === "object" ? options : {},
            remainingText: `${text.slice(0, start)} ${text.slice(end + 1)}`
        };
    } catch (error) {
        console.error("[SPIDER-MD] Mention JSON parse error:", error.message);
        return { options: {}, remainingText: text };
    }
}

function getMediaUrls(text) {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];

    return [...new Set(
        matches
            .map(url => url.replace(/[),.;!?]+$/, ""))
            .filter(url => {
                try {
                    return /\.(jpe?g|png|gif|mp4|webp|mp3|m4a|ogg|opus|aac|wav)$/i
                        .test(new URL(url).pathname);
                } catch {
                    return false;
                }
            })
    )];
}

function getResponseType(text) {
    const match = text.match(
        /type\/(audio|video|image|sticker|gif|reaction)\b/i
    );

    return match ? match[1].toLowerCase() : "text";
}

function cleanResponseText(text) {
    return text
        .replace(/https?:\/\/[^\s"'<>]+/gi, "")
        .replace(/type\/(audio|video|image|sticker|gif|reaction)\b/gi, "")
        .replace(/,/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function chooseRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}

let lastMentionSongUrl = "";

function normalizeNumber(value) {
    return String(value || "")
        .split("@")[0]
        .split(":")[0]
        .replace(/\D/g, "");
}

function getOwnerNumber() {
    return normalizeNumber(config.ownerNumber);
}

function unwrapMessage(message) {
    let content = message?.message;

    for (let i = 0; i < 10 && content; i++) {
        const wrapped =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message ||
            content.viewOnceMessageV2Extension?.message ||
            content.documentWithCaptionMessage?.message;

        if (!wrapped) break;
        content = wrapped;
    }

    return content;
}


function normalizeJid(value) {
    const jid = String(value || "").trim().toLowerCase();

    if (!jid.includes("@")) return jid;

    const [user, server] = jid.split("@");
    return `${user.split(":")[0]}@${server}`;
}

function isPhoneNumberJid(value) {
    const jid = String(value || "").toLowerCase();

    return (
        jid.endsWith("@s.whatsapp.net") ||
        jid.endsWith("@c.us") ||
        jid.endsWith("@hosted")
    );
}

function collectMessageContexts(root) {
    const contexts = [];
    const queue = [root];
    const seen = new WeakSet();

    let inspected = 0;

    while (queue.length && inspected < 2000) {
        const current = queue.shift();

        if (!current || typeof current !== "object") continue;
        if (seen.has(current)) continue;

        seen.add(current);
        inspected++;

        for (const [key, value] of Object.entries(current)) {
            if (!value || typeof value !== "object") continue;

            // Never inspect quoted messages as independent triggers.
            if (key === "quotedMessage") continue;

            if (key === "contextInfo") {
                contexts.push(value);
                continue;
            }

            queue.push(value);
        }
    }

    return contexts;
}

async function isMentionTrigger(sock, message) {
    const chat = String(message?.key?.remoteJid || "");

    if (!chat.endsWith("@g.us")) return false;

    const content = unwrapMessage(message);
    if (!content) return false;

    const contexts = collectMessageContexts(content);

    if (!contexts.length) return false;

    const ownerNumber = getOwnerNumber();

    const botId = String(sock?.user?.id || "");
    const botLid = String(sock?.user?.lid || "");

    const botJids = new Set(
        [botId, botLid]
            .filter(Boolean)
            .map(normalizeJid)
    );

    const botNumbers = new Set();

    if (isPhoneNumberJid(botId)) {
        botNumbers.add(normalizeNumber(botId));
    }

    if (isPhoneNumberJid(botLid)) {
        botNumbers.add(normalizeNumber(botLid));
    }

    const mapping = sock?.signalRepository?.lidMapping;

    for (const context of contexts) {
        const mentioned = Array.isArray(context.mentionedJid)
            ? context.mentionedJid
            : [];

        // Normal owner or bot-account mentions.
        for (const rawJid of mentioned) {
            const jid = String(rawJid || "");
            if (!jid) continue;

            const normalizedJid = normalizeJid(jid);

            // Exact account identity, including the bot's own LID.
            if (botJids.has(normalizedJid)) {
                return true;
            }

            // Phone-number JIDs can be compared directly.
            if (isPhoneNumberJid(jid)) {
                const number = normalizeNumber(jid);

                if (
                    (ownerNumber && number === ownerNumber) ||
                    botNumbers.has(number)
                ) {
                    return true;
                }
            }

            // Resolve LID to its mapped phone-number JID.
            if (
                (jid.endsWith("@lid") || jid.endsWith("@hosted.lid")) &&
                typeof mapping?.getPNForLID === "function"
            ) {
                try {
                    const phoneJid = await mapping.getPNForLID(jid);

                    if (phoneJid) {
                        const number = normalizeNumber(phoneJid);

                        if (
                            (ownerNumber && number === ownerNumber) ||
                            botNumbers.has(number)
                        ) {
                            return true;
                        }
                    }
                } catch (error) {
                    console.error(
                        "[SPIDER-MD] Mention LID lookup failed:",
                        error.message
                    );
                }
            }
        }

        // Native WhatsApp group mention (@all).
        const groupMentions = Array.isArray(context.groupMentions)
            ? context.groupMentions
            : [];

        if (groupMentions.some(item => {
            const groupJid = normalizeJid(item?.groupJid);

            return groupJid && groupJid === normalizeJid(chat);
        })) {
            return true;
        }
    }

    return false;
}

async function downloadMedia(url) {
    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        DOWNLOAD_TIMEOUT
    );

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow"
        });

        if (!response.ok) {
            throw new Error(`Media download failed: HTTP ${response.status}`);
        }

        const contentLength = Number(
            response.headers.get("content-length") || 0
        );

        if (contentLength > MAX_DOWNLOAD_SIZE) {
            throw new Error("Media file exceeds the 25 MB limit.");
        }

        const chunks = [];
        let totalSize = 0;

        for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk);
            totalSize += buffer.length;

            if (totalSize > MAX_DOWNLOAD_SIZE) {
                controller.abort();
                throw new Error("Media file exceeds the 25 MB limit.");
            }

            chunks.push(buffer);
        }

        if (!totalSize) {
            throw new Error("Downloaded media file is empty.");
        }

        return Buffer.concat(chunks);
    } finally {
        clearTimeout(timeout);
    }
}

/*
 * JARVIS-style audio conversion:
 * 1. Write the downloaded media buffer to a temporary input file.
 * 2. Run FFmpeg using file paths instead of stdin/stdout pipes.
 * 3. Read the converted audio file back into a Buffer.
 * 4. Remove temporary files.
 */
async function toAudio(inputBuffer, outputFormat = "") {
    const temporaryDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "spider-mention-")
    );

    const inputFile = path.join(
        temporaryDirectory,
        `input-${crypto.randomUUID()}.mp4`
    );

    const isPtt = outputFormat === "opus";

    const outputFile = path.join(
        temporaryDirectory,
        `output-${crypto.randomUUID()}.${isPtt ? "ogg" : "mp3"}`
    );

    try {
        await fs.writeFile(inputFile, inputBuffer);

        const audioArguments = isPtt
            ? [
                "-vn",
                "-c:a", "libopus",
                "-b:a", "64k",
                "-vbr", "on",
                "-compression_level", "10",
                "-application", "voip",
                "-ac", "1",
                "-ar", "48000",
                "-f", "ogg"
            ]
            : [
                "-vn",
                "-c:a", "libmp3lame",
                "-b:a", "128k",
                "-ar", "44100",
                "-f", "mp3"
            ];

        await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", [
                "-y",
                "-hide_banner",
                "-loglevel", "error",
                "-i", inputFile,
                ...audioArguments,
                outputFile
            ], {
                stdio: ["ignore", "ignore", "pipe"]
            });

            let stderr = "";
            let settled = false;

            const timeout = setTimeout(() => {
                if (!settled) {
                    ffmpeg.kill("SIGKILL");
                    settled = true;
                    reject(new Error("FFmpeg audio conversion timed out."));
                }
            }, FFMPEG_TIMEOUT);

            ffmpeg.stderr.on("data", chunk => {
                stderr += chunk.toString();
            });

            ffmpeg.on("error", error => {
                clearTimeout(timeout);

                if (settled) return;
                settled = true;

                reject(new Error(`Could not start FFmpeg: ${error.message}`));
            });

            ffmpeg.on("close", code => {
                clearTimeout(timeout);

                if (settled) return;
                settled = true;

                if (code !== 0) {
                    reject(
                        new Error(
                            stderr.trim() ||
                            `FFmpeg exited with code ${code}.`
                        )
                    );
                    return;
                }

                resolve();
            });
        });

        const convertedBuffer = await fs.readFile(outputFile);

        if (!convertedBuffer.length) {
            throw new Error("FFmpeg returned an empty audio file.");
        }

        return convertedBuffer;
    } finally {
        await fs.rm(temporaryDirectory, {
            recursive: true,
            force: true
        }).catch(() => {});
    }
}

function getQuotedMessage(options, originalMessage) {
    const customQuoted = options.quoted;
    delete options.quoted;

    if (
        customQuoted &&
        typeof customQuoted === "object" &&
        customQuoted.key &&
        customQuoted.message
    ) {
        return customQuoted;
    }

    return originalMessage;
}

function prepareTextOptions(options, message) {
    const senderJid =
        message.key.participant ||
        message.key.remoteJid;

    const senderNumber = normalizeNumber(senderJid);
    const senderTag = senderNumber ? `@${senderNumber}` : "";

    const contextInfo = {
        ...(options.contextInfo || {})
    };

    const existingMentions = Array.isArray(contextInfo.mentionedJid)
        ? contextInfo.mentionedJid
        : [];

    if (senderJid && !existingMentions.includes(senderJid)) {
        existingMentions.push(senderJid);
    }

    contextInfo.mentionedJid = existingMentions;

    return {
        ...options,
        contextInfo,
        senderTag
    };
}

async function sendMentionResponse(sock, message, response) {
    const jid = message.key.remoteJid;

    const { options, remainingText } = extractJsonOptions(response);

    const quoted = getQuotedMessage(options, message);
    const type = getResponseType(remainingText);
    const mediaUrls = getMediaUrls(remainingText);
    const text = cleanResponseText(remainingText);

    const sendOptions = { quoted };

    if (type === "reaction") {
        const reactionText = remainingText
            .split(/type\/reaction/i)[0]
            .replace(/https?:\/\/[^\s"'<>]+/gi, "")
            .trim();

        const emojis = reactionText
            .split(",")
            .map(item => item.trim())
            .filter(Boolean);

        if (!emojis.length) {
            throw new Error("No reaction emoji was provided.");
        }

        await sock.sendMessage(jid, {
            react: {
                text: chooseRandom(emojis),
                key: message.key
            }
        });

        return;
    }

    if (type === "text") {
        const prepared = prepareTextOptions(options, message);
        const senderTag = prepared.senderTag;

        delete prepared.senderTag;

        const finalText = text.replace(/&sender/g, senderTag);
        if (!finalText) return;

        await sock.sendMessage(
            jid,
            {
                ...prepared,
                text: finalText
            },
            sendOptions
        );

        return;
    }

    if (!mediaUrls.length) {
        throw new Error(`No supported media URL found for type/${type}.`);
    }

    let selectedUrl;

    if (type === "audio") {
        const alternatives = mediaUrls.filter(
            url => url !== lastMentionSongUrl
        );

        selectedUrl = chooseRandom(
            alternatives.length ? alternatives : mediaUrls
        );
    } else {
        selectedUrl = chooseRandom(mediaUrls);
    }

    console.log(`[SPIDER-MD] Mention media selected: ${selectedUrl}`);

    if (type === "audio") {
        const ptt = options.ptt === true;

        console.log(
            `[SPIDER-MD] JARVIS-style audio conversion | PTT: ${ptt}`
        );

        const mediaBuffer = await downloadMedia(selectedUrl);

        const convertedAudio = await toAudio(
            mediaBuffer,
            ptt ? "opus" : ""
        );

        const audioContent = {
            ...options,
            audio: convertedAudio,
            mimetype: ptt
                ? "audio/ogg; codecs=opus"
                : "audio/mpeg",
            ptt
        };

        delete audioContent.quoted;

        await sock.sendMessage(
            jid,
            audioContent,
            sendOptions
        );

        lastMentionSongUrl = selectedUrl;

        console.log("[SPIDER-MD] Mention audio sent.");
        return;
    }

    if (type === "image") {
        await sock.sendMessage(
            jid,
            {
                ...options,
                image: { url: selectedUrl },
                caption: text || undefined
            },
            sendOptions
        );
        return;
    }

    if (type === "video") {
        await sock.sendMessage(
            jid,
            {
                ...options,
                video: { url: selectedUrl },
                caption: text || undefined
            },
            sendOptions
        );
        return;
    }

    if (type === "gif") {
        await sock.sendMessage(
            jid,
            {
                ...options,
                video: { url: selectedUrl },
                gifPlayback: true,
                caption: text || undefined
            },
            sendOptions
        );
        return;
    }

    if (type === "sticker") {
        const stickerBuffer = await downloadMedia(selectedUrl);

        await sock.sendMessage(
            jid,
            {
                sticker: stickerBuffer,
                mimetype: "image/webp"
            },
            sendOptions
        );
        return;
    }

    throw new Error(`Unsupported mention response type: ${type}`);
}

export const mentionPlugin = {
    name: "mention",
    aliases: [],

    async execute(sock, message, args, { ownerMessage }) {
        if (!ownerMessage) {
            await sock.sendMessage(
                message.key.remoteJid,
                {
                    text: "This command is only available to the bot owner."
                },
                { quoted: message }
            );
            return;
        }

        const match = args.join(" ").trim();
        const saved = await readMentionConfig();

        if (match.toLowerCase() === "get") {
            await sock.sendMessage(
                message.key.remoteJid,
                {
                    text: saved.message || "_*Mention not set yet*_"
                },
                { quoted: message }
            );
            return;
        }

        if (
            match.toLowerCase() === "on" ||
            match.toLowerCase() === "off"
        ) {
            if (!saved.message.trim()) {
                await sock.sendMessage(
                    message.key.remoteJid,
                    {
                        text: "_Invalid mention message! Please provide valid text._"
                    },
                    { quoted: message }
                );
                return;
            }

            saved.status = match.toLowerCase() === "on" ? "true" : "false";

            await saveMentionConfig(saved);

            await sock.sendMessage(
                message.key.remoteJid,
                { text: "_Mention Updated_" },
                { quoted: message }
            );
            return;
        }

        if (!match) {
            await sock.sendMessage(
                message.key.remoteJid,
                {
                    text:
                        "Mention commands:\n\n" +
                        ".mention get\n" +
                        ".mention on\n" +
                        ".mention off\n" +
                        ".mention <message>"
                },
                { quoted: message }
            );
            return;
        }

        saved.message = match;
        await saveMentionConfig(saved);

        await sock.sendMessage(
            message.key.remoteJid,
            { text: "_Mention Updated_" },
            { quoted: message }
        );
    }
};

export async function handleMentionAuto(sock, message) {
    try {
        if (
            !message?.message ||
            !message?.key?.remoteJid ||
            message.key.fromMe === true
        ) {
            return;
        }

        if (!await isMentionTrigger(sock, message)) {
            return;
        }

        const saved = await readMentionConfig();

        if (
            String(saved.status).toLowerCase() === "false" ||
            !saved.message.trim()
        ) {
            return;
        }

        await sendMentionResponse(sock, message, saved.message);

    } catch (error) {
        console.error("[SPIDER-MD] Automatic mention error:", error);
    }
}
