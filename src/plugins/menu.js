
import fs from "node:fs/promises";
import path from "node:path";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

import { config } from "../config.js";
import { isOwnerMessage } from "../utils/identity.js";

const DATA_DIR = path.join(process.cwd(), "data");
const MENU_IMAGE_PATH = path.join(DATA_DIR, "menu-image");

const CATEGORY_ORDER = [
    "AI",
    "ANIME",
    "AUDIO-EDIT",
    "CONVERTER",
    "DOWNLOAD",
    "GREETINGS",
    "GROUP",
    "MANAGE",
    "MISC",
    "NEWS",
    "PRIVACY",
    "SEARCH",
    "SERVER",
    "STALK",
    "SUPPORT",
    "TOOLS",
    "WHATSAPP"
];

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

function getMessageText(message) {
    const content = unwrapMessage(message?.message);

    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.imageMessage?.caption ||
        content?.videoMessage?.caption ||
        ""
    ).trim();
}

function getCommand(message) {
    const text = getMessageText(message);
    const prefix = config.prefix || ".";

    if (!text.startsWith(prefix)) return "";

    return text.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase() || "";
}

function getQuotedMessage(message) {
    const content = unwrapMessage(message?.message);

    const contextInfo =
        content?.extendedTextMessage?.contextInfo ||
        content?.imageMessage?.contextInfo ||
        content?.videoMessage?.contextInfo;

    if (!contextInfo?.quotedMessage) return null;

    return {
        key: {
            remoteJid: message.key.remoteJid,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant,
            fromMe: false
        },
        message: contextInfo.quotedMessage
    };
}

function findImageMessage(message) {
    const content = unwrapMessage(message?.message);

    if (content?.imageMessage) return message;

    const quoted = getQuotedMessage(message);

    if (quoted && unwrapMessage(quoted.message)?.imageMessage) {
        return quoted;
    }

    return null;
}

async function saveMenuImage(sock, message) {
    const mediaMessage = findImageMessage(message);

    if (!mediaMessage) {
        return sock.sendMessage(
            message.key.remoteJid,
            {
                text: "Reply to an image with setimage to save it as the menu picture."
            },
            { quoted: message }
        );
    }

    const content = unwrapMessage(mediaMessage.message);

    if (!content?.imageMessage) {
        return sock.sendMessage(
            message.key.remoteJid,
            { text: "Please provide a valid image." },
            { quoted: message }
        );
    }

    const buffer = await downloadMediaMessage(
        mediaMessage,
        "buffer",
        {}
    );

    if (!buffer?.length) {
        throw new Error("Menu image download failed.");
    }

    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporaryPath = `${MENU_IMAGE_PATH}.tmp`;

    await fs.writeFile(temporaryPath, buffer);
    await fs.rename(temporaryPath, MENU_IMAGE_PATH);

    await sock.sendMessage(
        message.key.remoteJid,
        { text: "Menu image updated successfully." },
        { quoted: message }
    );
}

async function getSavedMenuImage() {
    try {
        return await fs.readFile(MENU_IMAGE_PATH);
    } catch {
        return null;
    }
}

async function removeMenuImage() {
    try {
        await fs.unlink(MENU_IMAGE_PATH);
        return true;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return [
        days ? `${days}d` : null,
        hours ? `${hours}h` : null,
        minutes ? `${minutes}m` : null,
        `${secs}s`
    ].filter(Boolean).join(" ");
}

async function getCurrentMode() {
    try {
        const file = path.join(DATA_DIR, "variables.json");
        const data = JSON.parse(await fs.readFile(file, "utf8"));

        return String(data.mode || config.mode || "private").toUpperCase();
    } catch {
        return String(config.mode || "private").toUpperCase();
    }
}

function buildMenu(message, context, mode) {
    const plugins = context?.plugins || [];
    const categories = new Map();

    for (const category of CATEGORY_ORDER) {
        categories.set(category, new Set());
    }

    for (const plugin of plugins) {
        if (!plugin?.name) continue;

        const category = String(plugin.category || "MISC").toUpperCase();

        if (!categories.has(category)) {
            categories.set(category, new Set());
        }

        categories.get(category).add(plugin.name.toLowerCase());
    }

    // Menu customization commands are always displayed under TOOLS.
    for (const command of [
        "setimage",
        "getimage",
        "resetmenu"
    ]) {
        categories.get("TOOLS").add(command);
    }

    const dateTime = new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short"
    });

    const user = String(message.pushName || "BLIX")
        .replace(/[\r\n]+/g, "");

    let menuText =
`╭━━━〔 ${config.botName || "SPIDER-MD"} 〕━━━···▸
┃╭──────────────
┃│
┃│  *OWNER* : ${config.ownerName || "BLIX-XER"}
┃│  *USER* : ${user}
┃│  *MODE* : ${mode}
┃│  *PLUGINS* : ${plugins.length}
┃│  *PLATFORM* : ${config.platform || "UNKNOWN"}
┃│  *STATUS* : ONLINE
┃│  *VERSION* : ${config.version || "1.0.0"}
┃│  *UPTIME* : ${formatUptime(process.uptime())}
┃│  *DATE* : ${dateTime}
┃│
┃╰──────────────
╰━━━━━━━━━━━━━━━━━━···▸

`;

    for (const category of CATEGORY_ORDER) {
        const commands = categories.get(category);

        if (!commands || commands.size === 0) continue;

        menuText +=
`╭━━〔 ${category} 〕
┃
`;

        for (const command of [...commands].sort()) {
            menuText += `┃  ➛ ${command}\n`;
        }

        menuText += `┃\n╰━━━━━━━━━━━━━━\n\n`;
    }

    // Preserve any additional registered categories after the requested order.
    const extraCategories = [...categories.keys()]
        .filter(category => !CATEGORY_ORDER.includes(category))
        .sort();

    for (const category of extraCategories) {
        const commands = categories.get(category);

        if (!commands?.size) continue;

        menuText +=
`╭━━〔 ${category} 〕
┃
`;

        for (const command of [...commands].sort()) {
            menuText += `┃  ➛ ${command}\n`;
        }

        menuText += `┃\n╰━━━━━━━━━━━━━━\n\n`;
    }

    menuText +=
`╭━━━━━━━━━━━━━━━━━━
┃  SPIDER-MD/BLIX-XER
╰━━━━━━━━━━━━━━━━━━`;

    return menuText;
}

async function sendMenu(sock, message, context) {
    const mode = await getCurrentMode();
    const caption = buildMenu(message, context, mode);
    const image = await getSavedMenuImage();

    if (image) {
        return sock.sendMessage(
            message.key.remoteJid,
            { image, caption },
            { quoted: message }
        );
    }

    return sock.sendMessage(
        message.key.remoteJid,
        { text: caption },
        { quoted: message }
    );
}

export const menu = {
    name: "menu",

    aliases: [
        "help",
        "setmenu",
        "setimage",
        "getmenu",
        "getimage",
        "resetmenu",
        "resetimage"
    ],

    category: "GENERAL",

    description: "Display and customize the menu",

    async execute(sock, message, args, context) {
        const command = getCommand(message);
        const jid = message.key.remoteJid;

        try {
            if (
                [
                    "setmenu",
                    "setimage",
                    "getmenu",
                    "getimage",
                    "resetmenu",
                    "resetimage"
                ].includes(command) &&
                !isOwnerMessage(sock, message, config.ownerNumber)
            ) {
                return;
            }

            switch (command) {
                case "setmenu":
                case "setimage":
                    await saveMenuImage(sock, message);
                    break;

                case "getmenu":
                case "getimage": {
                    const image = await getSavedMenuImage();

                    await sock.sendMessage(
                        jid,
                        image
                            ? { image, caption: "Current custom menu image." }
                            : { text: "No custom menu image is saved." },
                        { quoted: message }
                    );
                    break;
                }

                case "resetmenu":
                case "resetimage": {
                    const removed = await removeMenuImage();

                    await sock.sendMessage(
                        jid,
                        {
                            text: removed
                                ? "Custom menu image removed. Text menu restored."
                                : "No custom menu image was saved."
                        },
                        { quoted: message }
                    );
                    break;
                }

                default:
                    await sendMenu(sock, message, context);
                    break;
            }
        } catch (error) {
            console.error("[SPIDER-MD] Menu error:", error);

            await sock.sendMessage(
                jid,
                { text: "Menu operation failed. Check the Termux log." },
                { quoted: message }
            );
        }
    }
};
