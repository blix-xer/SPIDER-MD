
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { config } from "../config.js";

const DATA_DIR = path.resolve("data");
const CONFIG_FILE = path.join(DATA_DIR, "alive.json");
const MEDIA_DIR = path.join(DATA_DIR, "alive-media");

const DEFAULT_TEMPLATE = `Hy &sender, I am alive now!

╭━━〔 &botname 〕━━╮
┃
┃  ⬢ STATUS   : ONLINE
┃  ⬢ OWNER    : &owner
┃  ⬢ USER     : &user
┃  ⬢ PLATFORM : &platform
┃  ⬢ MODE     : &mode
┃  ⬢ RUNTIME  : &runtime
┃  ⬢ RAM      : &ram
┃  ⬢ PREFIX   : &prefix
┃  ⬢ VERSION  : &version
┃  ⬢ DATE     : &date
┃  ⬢ TIME     : &time
┃  ⬢ SPEED    : &speed
┃
╰━━━━━━━━━━━━━━━━━━╯

_&botname • System operational._`;

function ensureStorage() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(MEDIA_DIR, { recursive: true });

    if (!fs.existsSync(CONFIG_FILE)) {
        saveSettings({
            template: DEFAULT_TEMPLATE,
            media: null
        });
    }
}

function readSettings() {
    ensureStorage();

    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));

        return {
            template: typeof saved.template === "string"
                ? saved.template
                : DEFAULT_TEMPLATE,
            media: saved.media || null
        };
    } catch {
        return {
            template: DEFAULT_TEMPLATE,
            media: null
        };
    }
}

function saveSettings(settings) {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    fs.writeFileSync(
        CONFIG_FILE,
        JSON.stringify(settings, null, 2)
    );
}

function normalize(number) {
    return String(number || "").replace(/\D/g, "");
}

function getSenderNumber(message) {
    const jid =
        message.key.participant ||
        message.key.remoteJid ||
        "";

    return normalize(
        jid.split("@")[0].split(":")[0]
    );
}

function isOwner(message) {
    const owner = normalize(config.ownerNumber);
    const sender = getSenderNumber(message);

    return Boolean(owner && sender && owner === sender);
}

function getMode() {
    try {
        const saved = JSON.parse(
            fs.readFileSync(path.resolve("data/mode.json"), "utf8")
        );

        return saved.mode === "public" ? "public" : "private";
    } catch {
        return String(config.mode || "private").toLowerCase();
    }
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function unwrapMessage(message) {
    let content = message;

    while (content) {
        const next =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message;

        if (!next) break;

        content = next;
    }

    return content || {};
}

function getQuotedMessage(message) {
    const content = unwrapMessage(message.message || {});
    const extended = content.extendedTextMessage;

    if (!extended?.contextInfo?.quotedMessage) {
        return null;
    }

    return {
        content: unwrapMessage(extended.contextInfo.quotedMessage),
        contextInfo: extended.contextInfo
    };
}

function getMediaType(content) {
    if (content.imageMessage) return "image";
    if (content.videoMessage) return "video";

    return null;
}

async function downloadMedia(mediaMessage, type) {
    const stream = await downloadContentFromMessage(
        mediaMessage,
        type
    );

    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

function getExtension(type, mediaMessage) {
    const mime = mediaMessage.mimetype || "";

    if (type === "image") {
        if (mime.includes("png")) return ".png";
        if (mime.includes("webp")) return ".webp";
        return ".jpg";
    }

    if (mime.includes("webm")) return ".webm";
    return ".mp4";
}

async function saveQuotedMedia(message) {
    const quoted = getQuotedMessage(message);

    if (!quoted) {
        throw new Error("Reply to a photo or video first.");
    }

    const type = getMediaType(quoted.content);

    if (!type) {
        throw new Error("The replied message must contain a photo or video.");
    }

    const mediaMessage = quoted.content[
        type === "image" ? "imageMessage" : "videoMessage"
    ];

    const buffer = await downloadMedia(mediaMessage, type);

    if (!buffer.length) {
        throw new Error("Unable to download the replied media.");
    }

    const extension = getExtension(type, mediaMessage);

    fs.mkdirSync(MEDIA_DIR, { recursive: true });

    const filename = `alive${extension}`;
    const filepath = path.join(MEDIA_DIR, filename);

    for (const oldFile of fs.readdirSync(MEDIA_DIR)) {
        fs.unlinkSync(path.join(MEDIA_DIR, oldFile));
    }

    fs.writeFileSync(filepath, buffer);

    return {
        type,
        filename,
        mimetype: mediaMessage.mimetype || ""
    };
}

function getQuotedText(message) {
    const quoted = getQuotedMessage(message);

    if (!quoted) return "None";

    const content = quoted.content;

    return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        "Media message"
    );
}

function getVariables(message, startedAt) {
    const now = new Date();
    const memory = process.memoryUsage();

    const senderJid =
        message.key.participant ||
        message.key.remoteJid ||
        "";

    const senderName = message.pushName || "User";

    const quoted = getQuotedMessage(message);
    const quotedSender =
        quoted?.contextInfo?.participant || "Unknown";

    const variables = {
        botname: config.botName || "SPIDER-MD",
        owner: config.ownerName || "BLIX-XER",
        user: senderName,
        ram: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
        prefix: config.prefix || ".",
        mode: getMode().toUpperCase(),
        platform: config.platform || os.platform(),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        speed: `${Date.now() - startedAt} ms`,
        runtime: formatUptime(process.uptime()),
        uptime: formatUptime(process.uptime()),
        version: config.version || "1.0.0",
        sender: senderName,
        quote: getQuotedText(message),
        author: quotedSender
    };

    const result = {};

    for (const [key, value] of Object.entries(variables)) {
        result[`&${key}`] = String(value);
        result[`{${key}}`] = String(value);
    }

    result["&senderid"] = senderJid;
    result["{senderid}"] = senderJid;

    return result;
}

function renderTemplate(template, variables) {
    return String(template).replace(
        /&[a-z]+|\{[a-z]+\}/gi,
        match => variables[match] ?? match
    );
}

async function sendAlive(sock, message) {
    const startedAt = Date.now();
    const settings = readSettings();

    const caption = renderTemplate(
        settings.template,
        getVariables(message, startedAt)
    );

    if (settings.media?.filename) {
        const filepath = path.join(
            MEDIA_DIR,
            path.basename(settings.media.filename)
        );

        if (fs.existsSync(filepath)) {
            const buffer = fs.readFileSync(filepath);

            if (settings.media.type === "video") {
                return sock.sendMessage(
                    message.key.remoteJid,
                    {
                        video: buffer,
                        gifPlayback: true,
                        caption
                    },
                    { quoted: message }
                );
            }

            return sock.sendMessage(
                message.key.remoteJid,
                {
                    image: buffer,
                    caption
                },
                { quoted: message }
            );
        }
    }

    return sock.sendMessage(
        message.key.remoteJid,
        { text: caption },
        { quoted: message }
    );
}

export const alive = {
    name: "alive",
    aliases: ["status"],
    category: "GENERAL",
    description: "Customizable SPIDER-MD alive system",

    async execute(sock, message, args, context = {}) {
        const action = (args[0] || "").toLowerCase();
        const rawArgs = String(context.rawArgs || "").trim();

        if (action === "setalive" || action === "set") {
            if (!isOwner(message)) {
                return sock.sendMessage(
                    message.key.remoteJid,
                    { text: "⛔ _Only the bot owner can customize Alive._" },
                    { quoted: message }
                );
            }

            const quoted = getQuotedMessage(message);

            if (quoted) {
                try {
                    const media = await saveQuotedMedia(message);
                    const settings = readSettings();

                    settings.media = media;
                    saveSettings(settings);

                    return sock.sendMessage(
                        message.key.remoteJid,
                        {
                            text: `*╭━━〔 ALIVE MEDIA UPDATED 〕━━╮*\n┃\n┃  ⬢ Type: ${media.type.toUpperCase()}\n┃  ⬢ GIF playback: ${media.type === "video" ? "Enabled" : "Not applicable"}\n┃  ⬢ Storage: Persistent\n┃\n*╰━━━━━━━━━━━━━━━━━━━━━━━━╯*`
                        },
                        { quoted: message }
                    );
                } catch (error) {
                    return sock.sendMessage(
                        message.key.remoteJid,
                        { text: `⚠️ ${error.message}` },
                        { quoted: message }
                    );
                }
            }

            const template = rawArgs
                .replace(/^(setalive|set)\s*/i, "")
                .trim();

            if (!template) {
                return sock.sendMessage(
                    message.key.remoteJid,
                    {
                        text: "*ALIVE CUSTOMIZATION*\n\n⬢ .setalive Your custom message\n⬢ Reply to a photo/video with .setalive\n\nAvailable variables:\n&botname &owner &user &ram &prefix &mode &platform &date &time &speed &runtime &version &sender &quote &author"
                    },
                    { quoted: message }
                );
            }

            const settings = readSettings();
            settings.template = template;
            saveSettings(settings);

            return sock.sendMessage(
                message.key.remoteJid,
                { text: "✅ _Your custom Alive message has been saved._" },
                { quoted: message }
            );
        }

        if (action === "getalive" || action === "get") {
            if (!isOwner(message)) {
                return sock.sendMessage(
                    message.key.remoteJid,
                    { text: "⛔ _Only the bot owner can view Alive settings._" },
                    { quoted: message }
                );
            }

            const settings = readSettings();

            return sock.sendMessage(
                message.key.remoteJid,
                {
                    text: `*╭━━〔 ALIVE CONFIGURATION 〕━━╮*\n┃\n┃  ⬢ Media: ${settings.media?.type || "None"}\n┃  ⬢ Template:\n┃\n${settings.template}\n┃\n*╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯*`
                },
                { quoted: message }
            );
        }

        if (action === "resetalive" || action === "reset") {
            if (!isOwner(message)) {
                return sock.sendMessage(
                    message.key.remoteJid,
                    { text: "⛔ _Only the bot owner can reset Alive._" },
                    { quoted: message }
                );
            }

            if (fs.existsSync(MEDIA_DIR)) {
                for (const file of fs.readdirSync(MEDIA_DIR)) {
                    fs.unlinkSync(path.join(MEDIA_DIR, file));
                }
            }

            saveSettings({
                template: DEFAULT_TEMPLATE,
                media: null
            });

            return sock.sendMessage(
                message.key.remoteJid,
                { text: "✅ _Alive message and media restored to defaults._" },
                { quoted: message }
            );
        }

        return sendAlive(sock, message);
    }
};
