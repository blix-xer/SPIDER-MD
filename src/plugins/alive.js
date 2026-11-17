import fs from "node:fs/promises";
import path from "node:path";
import pino from "pino";

import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { isOwnerMessage } from "../utils/identity.js";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "alive.json");
const MEDIA_DIR = path.join(DATA_DIR, "alive-media");
const MAX_MEDIA_SIZE = 25 * 1024 * 1024;

const mediaLogger = pino({ level: "silent" });

const DEFAULT_TEMPLATE = [
    "Hy &sender I am alive now",
    "",
    "PLATFORM: &platform",
    "RUNTIME: &runtime",
    "",
    "&botname is alive hello &user",
    "",
    "Ram : &ram",
    "Prefix : &prefix",
    "Mode : &mode",
    "Platform : &platform",
    "Date : &date",
    "Speed : &speed",
    "Runtime : &runtime",
    "Version : &version",
    "Sender : &sender",
    "",
    "&quote",
    "",
    "By : &author"
].join("\n");

function isOwner(sock, message) {
    return isOwnerMessage(sock, message, config.ownerNumber);
}

async function readData() {
    try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const data = JSON.parse(raw);

        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return {};
        }

        return data;
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
    }
}

async function saveData(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporary = `${DATA_FILE}.tmp`;

    await fs.writeFile(
        temporary,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    await fs.rename(temporary, DATA_FILE);
}

function getMessageContent(message) {
    let content = message?.message;

    for (let i = 0; i < 10 && content; i++) {
        const next =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message ||
            content.viewOnceMessageV2Extension?.message ||
            content.documentWithCaptionMessage?.message;

        if (!next) break;
        content = next;
    }

    return content || {};
}

function getContextInfo(message) {
    const content = getMessageContent(message);

    return (
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo ||
        null
    );
}

function getQuotedMessage(message) {
    const context = getContextInfo(message);

    if (!context?.quotedMessage || !context?.stanzaId) {
        return null;
    }

    return {
        key: {
            remoteJid: message.key.remoteJid,
            id: context.stanzaId,
            participant: context.participant,
            fromMe: false
        },
        message: context.quotedMessage
    };
}

function getQuotedMediaType(quoted) {
    if (!quoted?.message) return null;

    let content = quoted.message;

    for (let i = 0; i < 10 && content; i++) {
        const next =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message ||
            content.viewOnceMessageV2Extension?.message ||
            content.documentWithCaptionMessage?.message;

        if (!next) break;
        content = next;
    }

    if (content?.imageMessage) return "image";
    if (content?.videoMessage) return "video";

    return null;
}

function formatDuration(seconds) {
    const total = Math.floor(seconds);

    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    const clock = [hours, minutes, secs]
        .map(value => String(value).padStart(2, "0"))
        .join(":");

    return days > 0 ? `${days}d ${clock}` : clock;
}

function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) {
        return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    }

    if (bytes >= 1024 ** 2) {
        return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    }

    return `${(bytes / 1024).toFixed(1)} KB`;
}

function getSender(message) {
    const jid =
        message?.key?.participant ||
        message?.key?.remoteJid ||
        "";

    const number = jid.split("@")[0].split(":")[0];

    return message?.pushName ||
        config.ownerName ||
        number ||
        "Owner";
}

function renderTemplate(template, message, speed) {
    const now = new Date();

    const date = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "long"
    }).format(now);

    const time = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        timeStyle: "medium"
    }).format(now);

    const sender = getSender(message);
    const user = message?.pushName || sender;

    const values = {
        "&botname": String(config.botName || "SPIDER-MD"),
        "&owner": String(config.ownerName || "BLIX-XER"),
        "&user": String(user),
        "&ram": formatBytes(process.memoryUsage().rss),
        "&prefix": String(config.prefix || "."),
        "&mode": String(config.mode || "private"),
        "&platform": String(config.platform || process.platform),
        "&date": date,
        "&time": time,
        "&speed": `${speed} ms`,
        "&runtime": formatDuration(process.uptime()),
        "&version": String(config.version || "1.0.0"),
        "&sender": sender,
        "&quote": "SPIDER-MD is online and ready.",
        "&author": String(config.ownerName || "BLIX-XER")
    };

    return String(template).replace(
        /&(?:botname|owner|user|ram|prefix|mode|platform|date|time|speed|runtime|version|sender|quote|author)\b/gi,
        match => values[match.toLowerCase()] ?? match
    );
}

async function saveQuotedMedia(sock, message, data) {
    const quoted = getQuotedMessage(message);

    if (!quoted) return false;

    const mediaType = getQuotedMediaType(quoted);

    if (!mediaType) return false;

    const buffer = await downloadMediaMessage(
        quoted,
        "buffer",
        {},
        {
            logger: mediaLogger,
            reuploadRequest: sock.updateMediaMessage
        }
    );

    if (!buffer || !buffer.length) {
        throw new Error("The replied media could not be downloaded.");
    }

    if (buffer.length > MAX_MEDIA_SIZE) {
        throw new Error("Media is too large. Maximum supported size is 25 MB.");
    }

    await fs.mkdir(MEDIA_DIR, { recursive: true });

    const extension = mediaType === "video" ? "mp4" : "jpg";
    const fileName = `alive.${extension}`;
    const filePath = path.join(MEDIA_DIR, fileName);
    const temporary = `${filePath}.tmp`;

    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, filePath);

    data.media = {
        type: mediaType,
        file: fileName
    };

    return true;
}

async function sendAlive(sock, message) {
    const jid = message.key.remoteJid;
    const started = Date.now();

    const data = await readData();

    const template =
        typeof data.template === "string"
            ? data.template
            : DEFAULT_TEMPLATE;

    const caption = renderTemplate(
        template,
        message,
        Date.now() - started
    );

    if (
        data.media?.file &&
        ["image", "video"].includes(data.media.type)
    ) {
        const mediaPath = path.join(MEDIA_DIR, data.media.file);

        try {
            const buffer = await fs.readFile(mediaPath);

            if (data.media.type === "video") {
                return await sock.sendMessage(
                    jid,
                    {
                        video: buffer,
                        caption,
                        gifPlayback: true,
                        mimetype: "video/mp4"
                    },
                    { quoted: message }
                );
            }

            return await sock.sendMessage(
                jid,
                {
                    image: buffer,
                    caption
                },
                { quoted: message }
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;

            delete data.media;
            await saveData(data);
        }
    }

    return sock.sendMessage(
        jid,
        { text: caption },
        { quoted: message }
    );
}

export const alivePlugins = [
    {
        name: "alive",
        category: "GENERAL",
        description: "Show bot alive status",

        async execute(sock, message) {
            await sendAlive(sock, message);
        }
    },

    {
        name: "setalive",
        category: "GENERAL",
        description: "Customize alive message and media",

        async execute(sock, message, args, context = {}) {
            if (!isOwner(sock, message)) return;

            const data = await readData();

            const rawArgs = String(
                context.rawArgs || args.join(" ")
            );

            let mediaSaved = false;

            if (getQuotedMessage(message)) {
                mediaSaved = await saveQuotedMedia(
                    sock,
                    message,
                    data
                );
            }

            const template = rawArgs
                .replace(/\\n/g, "\n")
                .trim();

            if (template) {
                data.template = template;
            }

            if (mediaSaved || template) {
                data.updatedAt = new Date().toISOString();
                await saveData(data);
            }

            let response = "";

            if (mediaSaved) {
                response +=
                    `Alive ${data.media.type} saved successfully.\n`;
            }

            if (template) {
                response +=
                    "Alive message template updated successfully.\n";
            }

            if (!response) {
                response =
                    "Reply to a photo/video with .setalive to save media.\n\n" +
                    "Or use:\n" +
                    ".setalive Hy &sender I am alive now\\nRuntime: &runtime";
            }

            return sock.sendMessage(
                message.key.remoteJid,
                { text: response.trim() },
                { quoted: message }
            );
        }
    },

    {
        name: "getalive",
        category: "GENERAL",
        description: "View alive message settings",

        async execute(sock, message) {
            if (!isOwner(sock, message)) return;

            const data = await readData();

            const template =
                typeof data.template === "string"
                    ? data.template
                    : DEFAULT_TEMPLATE;

            const mediaStatus = data.media
                ? `${data.media.type} (${data.media.file})`
                : "No media configured";

            return sock.sendMessage(
                message.key.remoteJid,
                {
                    text:
                        "ALIVE SETTINGS\n\n" +
                        "Template:\n" + template +
                        "\n\nMedia: " + mediaStatus +
                        "\n\nPlaceholders:\n" +
                        "&botname, &owner, &user, &ram, &prefix, " +
                        "&mode, &platform, &date, &time, &speed, " +
                        "&runtime, &version, &sender, &quote, &author"
                },
                { quoted: message }
            );
        }
    },

    {
        name: "resetalive",
        category: "GENERAL",
        description: "Reset alive message settings",

        async execute(sock, message) {
            if (!isOwner(sock, message)) return;

            await fs.rm(DATA_FILE, { force: true });
            await fs.rm(MEDIA_DIR, {
                recursive: true,
                force: true
            });

            return sock.sendMessage(
                message.key.remoteJid,
                {
                    text: "Alive settings and media have been reset."
                },
                { quoted: message }
            );
        }
    }
];

export { DEFAULT_TEMPLATE };
