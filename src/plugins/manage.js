import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "manage.json");
const GROUP_SUFFIX = "@g.us";
const OWNER_NUMBER = "918075298454";
let schedulerStarted = false;
let schedulerSocket = null;
const pendingRoleChanges = new Set();

async function readStore() {
    try {
        const parsed = JSON.parse(await fs.readFile(DATA_FILE, "utf8"), (key, value) => {
            if (value && value.type === "Buffer" && Array.isArray(value.data)) {
                return Buffer.from(value.data);
            }
            return value;
        });
        return {
            groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {},
            schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
            mediaCommands: parsed.mediaCommands && typeof parsed.mediaCommands === "object" ? parsed.mediaCommands : {},
            ownerSettings: parsed.ownerSettings && typeof parsed.ownerSettings === "object" ? parsed.ownerSettings : {}
        };
    } catch (error) {
        if (error.code !== "ENOENT") console.error("[SPIDER-MD] Manage data read error:", error);
        return { groups: {}, schedules: [], mediaCommands: {}, ownerSettings: {} };
    }
}

async function writeStore(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporary = `${DATA_FILE}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data, null, 2));
    await fs.rename(temporary, DATA_FILE);
}

function groupConfig(store, jid) {
    if (!store.groups[jid]) store.groups[jid] = {};
    return store.groups[jid];
}

function cleanJid(value) {
    return String(value || "").trim().replace(/:\d+@/, "@");
}

function isGroup(jid) {
    return String(jid || "").endsWith(GROUP_SUFFIX);
}

function unwrap(content) {
    let current = content;
    for (let i = 0; i < 10; i++) {
        const next = current?.ephemeralMessage?.message ||
            current?.viewOnceMessage?.message ||
            current?.viewOnceMessageV2?.message ||
            current?.viewOnceMessageV2Extension?.message ||
            current?.documentWithCaptionMessage?.message;
        if (!next) break;
        current = next;
    }
    return current || {};
}

function textOf(message) {
    const content = unwrap(message?.message);
    return String(content.conversation || content.extendedTextMessage?.text ||
        content.imageMessage?.caption || content.videoMessage?.caption ||
        content.documentMessage?.caption || "").trim();
}

function quotedMessage(message) {
    const content = unwrap(message?.message);
    const info = content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo || content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo;
    if (!info?.quotedMessage || !info?.stanzaId) return null;
    return {
        key: {
            remoteJid: message.key.remoteJid,
            id: info.stanzaId,
            participant: info.participant,
            fromMe: false
        },
        message: info.quotedMessage
    };
}

function mediaHash(message) {
    const content = unwrap(message?.message);
    const media = content.imageMessage || content.videoMessage || content.audioMessage ||
        content.stickerMessage || content.documentMessage;
    const hash = media?.fileSha256;
    if (!hash) return "";
    try { return Buffer.from(hash).toString("base64"); } catch { return ""; }
}

function quotedMediaHash(message) {
    const quoted = quotedMessage(message);
    if (!quoted) return "";

    const content = unwrap(quoted.message);
    const media = content.imageMessage ||
        content.videoMessage ||
        content.audioMessage ||
        content.stickerMessage;

    const hash = media?.fileSha256;
    if (!hash) return "";

    try {
        return Buffer.from(hash).toString("base64");
    } catch {
        return "";
    }
}

function ownerOnly(context) {
    return context?.ownerMessage === true;
}

async function send(sock, message, text, extra = {}) {
    return sock.sendMessage(message.key.remoteJid, { text, ...extra }, { quoted: message });
}

async function isBotAdmin(sock, jid) {
    if (!isGroup(jid)) return false;
    try {
        const metadata = await sock.groupMetadata(jid);
        const self = cleanJid(sock.user?.id || "");
        const selfNumber = self.split("@")[0].split(":")[0];
        return (metadata.participants || []).some(p => {
            const id = cleanJid(p.id || p.jid || "");
            const sameAccount = id === self || Boolean(selfNumber && id.split("@")[0].split(":")[0] === selfNumber);
            return sameAccount && (p.admin === "admin" || p.admin === "superadmin");
        });
    } catch (error) {
        console.error("[SPIDER-MD] Manage admin check failed:", error.message);
        return false;
    }
}

function parseClock(value) {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (match[3].toUpperCase() === "AM") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return { hour, minute };
}

function parseScheduleDate(value) {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s+(\d{1,2})-(\d{1,2})-(\d{4})$/i);
    if (!match) return null;
    const clock = parseClock(`${match[1]}:${match[2]} ${match[3]}`);
    const day = Number(match[4]);
    const month = Number(match[5]);
    const year = Number(match[6]);
    if (!clock || month < 1 || month > 12 || day < 1 || day > 31) return null;
    // The schedule format follows the JARVIS command and uses India time.
    const timestamp = Date.UTC(year, month - 1, day, clock.hour, clock.minute) - 330 * 60 * 1000;
    const check = new Date(timestamp + 330 * 60 * 1000);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return timestamp;
}

function indiaParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

async function requireOwner(sock, message, context) {
    if (ownerOnly(context)) return true;
    await send(sock, message, "This command is restricted to the bot owner.");
    return false;
}

async function requireGroupAdmin(sock, message) {
    const jid = message.key.remoteJid;
    if (!isGroup(jid)) {
        await send(sock, message, "This command can only be used in a group.");
        return false;
    }
    if (!await isBotAdmin(sock, jid)) {
        await send(sock, message, "I'm not an admin");
        return false;
    }
    return true;
}

async function togglePlugin(sock, message, context, key, help, extraHandler) {
    if (!await requireOwner(sock, message, context)) return;
    if (!await requireGroupAdmin(sock, message)) return;
    const jid = message.key.remoteJid;
    const arg = String(context.rawArgs || "").trim().split(/\s+/).slice(1).join(" ").toLowerCase();
    if (!arg) return send(sock, message, help);
    if (!["on", "off"].includes(arg)) return send(sock, message, help);
    const store = await readStore();
    const cfg = groupConfig(store, jid);
    cfg[key] = { ...(cfg[key] || {}), enabled: arg === "on" };
    await writeStore(store);
    if (extraHandler) await extraHandler(cfg[key], store);
    return send(sock, message, `_${key} ${arg === "on" ? "activated" : "deactivated"}_`);
}

function makePlugin(name, description, execute) {
    return { name, category: "MANAGE", description, execute };
}

const plugins = [];

plugins.push(makePlugin("antidelete", "Notify when a message is deleted", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;
    const jid = message.key.remoteJid;
    const arg = (args[0] || "").toLowerCase();
    const allowed = ["on", "off", "chat", "pm"];
    if (!allowed.includes(arg)) return send(sock, message, "*Example:*\n.antidelete on/off\n.antidelete chat/pm\n\nAntidelete reports deletion events only; it does not recover deleted message content.");
    const store = await readStore();
    store.ownerSettings ||= {};
    const ownerId = cleanJid(sock.user?.id || OWNER_NUMBER);
    store.ownerSettings[ownerId] ||= { antidelete: { mode: "chat", enabled: false } };
    const cfg = store.ownerSettings[ownerId].antidelete;
    if (arg === "on" || arg === "off") cfg.enabled = arg === "on";
    else cfg.mode = arg;
    await writeStore(store);
    return send(sock, message, `Antidelete ${arg === "on" ? "enabled" : arg === "off" ? "disabled" : `mode set to ${arg}`}. Deleted message content is not stored or recovered.`);
}));

plugins.push(makePlugin("antiviewones", "View-once privacy setting", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;
    return send(sock, message, "Antiviewones is unavailable: SPIDER-MD will not bypass WhatsApp's view-once privacy controls or secretly save view-once media.");
}));

plugins.push(makePlugin("pdm", "Enable promotion and demotion notices", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
    const arg = (args[0] || "").toLowerCase();
    if (!["on", "off"].includes(arg)) return send(sock, message, "*Usage:* .pdm on/off");
    const store = await readStore();
    groupConfig(store, message.key.remoteJid).pdm = arg === "on";
    await writeStore(store);
    return send(sock, message, `PDM ${arg === "on" ? "activated" : "deactivated"}.`);
}));

plugins.push(makePlugin("gcaccess", "Set group command access preference", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
    const arg = (args[0] || "").toLowerCase();
    if (!["on", "off"].includes(arg)) return send(sock, message, "*Usage:* .gcaccess on/off");
    const store = await readStore();
    groupConfig(store, message.key.remoteJid).gcaccess = arg === "on";
    await writeStore(store);
    return send(sock, message, `Group command access preference ${arg === "on" ? "enabled" : "disabled"}. Existing command-specific permission checks remain active.`);
}));

plugins.push(makePlugin("antiword", "Moderate configured restricted words", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
    const jid = message.key.remoteJid;
    const value = args.join(" ").trim();
    const store = await readStore(); const cfg = groupConfig(store, jid);
    const old = cfg.antiword || { enabled: false, words: [], action: "null" };
    const lower = value.toLowerCase();
    if (!value) return send(sock, message, "*Usage:* .antiword on/off/get | .antiword word1,word2 | .antiword action warn/kick/null");
    if (lower === "on" || lower === "off") old.enabled = lower === "on";
    else if (lower === "get") return send(sock, message, `Antiword: ${old.enabled ? "ON" : "OFF"}\nWords: ${(old.words || []).join(", ") || "None"}\nAction: ${old.action || "null"}`);
    else if (lower.startsWith("action ")) {
        const action = lower.slice(7).trim(); if (!["warn", "kick", "null"].includes(action)) return send(sock, message, "Action must be warn, kick or null."); old.action = action;
    } else old.words = value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 100);
    cfg.antiword = old; await writeStore(store);
    return send(sock, message, "Antiword settings updated.");
}));

plugins.push(makePlugin("antilink", "Moderate group links", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
    const jid = message.key.remoteJid; const value = args.join(" ").trim();
    const store = await readStore(); const cfg = groupConfig(store, jid);
    const old = cfg.antilink || { enabled: false, allowed: [], action: "null" };
    const lower = value.toLowerCase();
    if (!value) return send(sock, message, "*Usage:* .antilink on/off/get | .antilink allow domain.com,example.org | .antilink action warn/kick/null");
    if (lower === "on" || lower === "off") old.enabled = lower === "on";
    else if (lower === "get") return send(sock, message, `Antilink: ${old.enabled ? "ON" : "OFF"}\nAllowed domains: ${(old.allowed || []).join(", ") || "None"}\nAction: ${old.action}`);
    else if (lower.startsWith("action ")) { const a = lower.slice(7).trim(); if (!["warn", "kick", "null"].includes(a)) return send(sock, message, "Action must be warn, kick or null."); old.action = a; }
    else if (lower.startsWith("allow ")) old.allowed = lower.slice(6).split(",").map(x => x.trim().replace(/^https?:\/\//, "").replace(/^www\./, "")).filter(Boolean);
    else return send(sock, message, "Use `allow domain.com` to set allowed domains.");
    cfg.antilink = old; await writeStore(store); return send(sock, message, "Antilink settings updated.");
}));

plugins.push(makePlugin("antifake", "Restrict group member phone prefixes", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
    const value = args.join(" ").trim(); const store = await readStore(); const cfg = groupConfig(store, message.key.remoteJid);
    const old = cfg.antifake || { enabled: false, prefixes: [] }; const lower = value.toLowerCase();
    if (!value) return send(sock, message, "*Usage:* .antifake on/off/get | .antifake 91,92");
    if (lower === "on" || lower === "off") old.enabled = lower === "on";
    else if (lower === "get" || lower === "list") return send(sock, message, `Antifake: ${old.enabled ? "ON" : "OFF"}\nPrefixes: ${(old.prefixes || []).join(", ") || "None"}`);
    else { const prefixes = value.split(",").map(x => x.replace(/\D/g, "")).filter(Boolean); if (!prefixes.length) return send(sock, message, "Enter country calling prefixes, e.g. 91,92."); old.prefixes = prefixes; }
    cfg.antifake = old; await writeStore(store); return send(sock, message, "Antifake settings updated.");
}));

plugins.push(makePlugin("antibot", "Bot account moderation preference", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
    const arg = (args[0] || "").toLowerCase(); if (!["on", "off"].includes(arg)) return send(sock, message, "*Usage:* .antibot on/off\nWhatsApp does not provide a reliable bot-account flag, so this setting will not automatically remove members.");
    const store = await readStore(); groupConfig(store, message.key.remoteJid).antibot = arg === "on"; await writeStore(store);
    return send(sock, message, `Antibot preference ${arg === "on" ? "enabled" : "disabled"}. WhatsApp does not expose reliable bot-account identification; no members will be removed based on guesses.`);
}));

for (const [name, setting, opposite] of [["antidemote", "antidemote", "promote"], ["antipromote", "antipromote", "demote"]]) {
    plugins.push(makePlugin(name, `Prevent unauthorized ${opposite} actions`, async (sock, message, args, context) => {
        if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
        const arg = (args[0] || "").toLowerCase(); if (!["on", "off"].includes(arg)) return send(sock, message, `*Usage:* .${name} on/off`);
        const store = await readStore(); groupConfig(store, message.key.remoteJid)[setting] = arg === "on"; await writeStore(store);
        return send(sock, message, `${name} ${arg === "on" ? "activated" : "deactivated"}.`);
    }));
}

plugins.push(makePlugin("setschedule", "Schedule a replied-to message", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;
    const quoted = quotedMessage(message); if (!quoted) return send(sock, message, "Reply to the message you want to schedule.\nUsage: .setschedule jid, HH:MM AM/PM DD-MM-YYYY");
    const raw = args.join(" "); const comma = raw.indexOf(","); if (comma < 0) return send(sock, message, "Usage: .setschedule jid, HH:MM AM/PM DD-MM-YYYY");
    const jid = cleanJid(raw.slice(0, comma)); const timestamp = parseScheduleDate(raw.slice(comma + 1));
    if (!jid.includes("@") || !timestamp || timestamp <= Date.now()) return send(sock, message, "Invalid JID or date/time. Use a future India-time date: .setschedule jid, 10:30 PM 19-11-2026");
    const store = await readStore(); store.schedules.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, jid, timestamp, content: quoted.message, sent: false }); await writeStore(store);
    return send(sock, message, `Message scheduled for ${new Date(timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`);
}));

plugins.push(makePlugin("getschedule", "List scheduled messages", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;
    const store = await readStore(); if (!store.schedules.length) return send(sock, message, "_No Schedule Message Found_");
    const rows = store.schedules.map((item, index) => `${index + 1}. ${item.jid}\n   ${new Date(item.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST${item.sent ? " (sent)" : ""}`);
    return send(sock, message, "*Schedule Message List*\n\n" + rows.join("\n\n"));
}));

plugins.push(makePlugin("delschedule", "Delete a scheduled message", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;
    const raw = args.join(" ").trim();
    const store = await readStore();
    const index = Number(raw);
    let targetIndex = -1;
    if (Number.isInteger(index) && index >= 1 && index <= store.schedules.length) {
        targetIndex = index - 1;
    } else if (raw.includes(",")) {
        const comma = raw.indexOf(",");
        const jid = cleanJid(raw.slice(0, comma));
        const timestamp = parseScheduleDate(raw.slice(comma + 1));
        if (jid && timestamp) targetIndex = store.schedules.findIndex(item => item.jid === jid && item.timestamp === timestamp && !item.sent);
    }
    if (targetIndex < 0) return send(sock, message, "Usage: .delschedule list-number OR .delschedule jid, HH:MM AM/PM DD-MM-YYYY");
    store.schedules.splice(targetIndex, 1);
    await writeStore(store);
    return send(sock, message, "_Schedule deleted_");
}));

plugins.push(makePlugin("setcmd", "Set a media file as a command", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;

    const hash = quotedMediaHash(message);

    if (!hash) {
        return send(sock, message, "_Reply to an image/video/audio/sticker_");
    }

    const command = args.join(" ")
        .trim()
        .replace(/^\./, "")
        .split(/\s+/)[0]
        ?.toLowerCase();

    if (!command) {
        return send(sock, message, "_Example: setcmd ping_");
    }

    try {
        const store = await readStore();
        store.mediaCommands[hash] = command;
        await writeStore(store);
        return send(sock, message, "_Success_");
    } catch (error) {
        console.error("[SPIDER-MD] Setcmd failed:", error);
        return send(sock, message, "_Failed_");
    }
}));

plugins.push({
    ...makePlugin("detcmd", "Delete a media command", async (sock, message, args, context) => {
        if (!await requireOwner(sock, message, context)) return;

        const command = args.join(" ")
            .trim()
            .replace(/^\./, "")
            .split(/\s+/)[0]
            ?.toLowerCase();

        const quoted = quotedMessage(message);

        if (!command && !quoted) {
            return send(
                sock,
                message,
                "_Send a cmd name to remove it or reply to an image/video/audio/sticker_"
            );
        }

        try {
            const store = await readStore();
            let removed = false;

            if (command) {
                for (const [hash, value] of Object.entries(store.mediaCommands)) {
                    if (String(value).toLowerCase() === command) {
                        delete store.mediaCommands[hash];
                        removed = true;
                    }
                }
            } else {
                const hash = quotedMediaHash(message);

                if (hash && store.mediaCommands[hash]) {
                    delete store.mediaCommands[hash];
                    removed = true;
                }
            }

            if (!removed) {
                return send(sock, message, "_Failed_");
            }

            await writeStore(store);
            return send(sock, message, "_Success_");
        } catch (error) {
            console.error("[SPIDER-MD] Detcmd failed:", error);
            return send(sock, message, "_Failed_");
        }
    }),
    aliases: ["delcmd"]
});

plugins.push(makePlugin("listcmd", "List all media commands", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;

    try {
        const store = await readStore();
        const values = Object.values(store.mediaCommands);

        if (!values.length) {
            return send(sock, message, "_*No commands set*_");
        }

        const messages = values.map(
            (value, index) => `_${index + 1}. ${value}_`
        );

        return send(sock, message, "*List Cmd*\n\n" + messages.join("\n"));
    } catch (error) {
        console.error("[SPIDER-MD] Listcmd failed:", error);
        return send(sock, message, "_*No commands set*_");
    }
}));

for (const [name, field, value] of [["automute", "automute", "announcement"], ["autounmute", "autounmute", "not_announcement"]]) {
    plugins.push(makePlugin(name, `Schedule group ${name === "automute" ? "mute" : "unmute"}`, async (sock, message, args, context) => {
        if (!await requireOwner(sock, message, context) || !await requireGroupAdmin(sock, message)) return;
        const input = args.join(" ").trim(); const store = await readStore(); const cfg = groupConfig(store, message.key.remoteJid);
        if (!input) return send(sock, message, `*Usage:* .${name} HH:MM AM/PM | .${name} on/off\nExample: .${name} 10:00 PM`);
        if (["off", "on"].includes(input.toLowerCase())) {
            cfg[field] ||= {}; cfg[field].enabled = input.toLowerCase() === "on";
        } else {
            const clock = parseClock(input); if (!clock) return send(sock, message, "Time format must be HH:MM AM/PM, e.g. 10:00 PM.");
            cfg[field] = { ...(cfg[field] || {}), enabled: true, hour: clock.hour, minute: clock.minute, lastRun: "" };
        }
        await writeStore(store); return send(sock, message, `${name} settings updated.`);
    }));
}

plugins.push(makePlugin("getmute", "Show scheduled group mute settings", async (sock, message, args, context) => {
    if (!await requireOwner(sock, message, context)) return;
    if (!isGroup(message.key.remoteJid)) return send(sock, message, "This command can only be used in a group.");
    const store = await readStore(); const cfg = store.groups[message.key.remoteJid] || {};
    const format = item => item?.enabled ? `${String(item.hour % 12 || 12).padStart(2, "0")}:${String(item.minute).padStart(2, "0")} ${item.hour >= 12 ? "PM" : "AM"}` : "OFF";
    return send(sock, message, `*Scheduled Mutes/Unmutes*\n\n*Auto Mute:* ${format(cfg.automute)}\n*Auto Unmute:* ${format(cfg.autounmute)}`);
}));

export const managePlugins = plugins;

export async function getMediaCommand(message) {
    const hash = mediaHash(message);
    if (!hash) return "";
    const store = await readStore();
    return store.mediaCommands[hash] || "";
}

export async function handleManageMessage(sock, message) {
    if (!message?.key?.remoteJid || !isGroup(message.key.remoteJid)) return;
    const jid = message.key.remoteJid;
    const sender = cleanJid(message.key.participant || message.key.participantAlt || "");
    if (!sender || message.key.fromMe) return;
    const body = textOf(message);
    if (!body || body.startsWith(".")) return;
    const store = await readStore(); const cfg = store.groups[jid] || {};
    const checks = [];
    if (cfg.antiword?.enabled && cfg.antiword.words?.some(word => word && body.toLowerCase().includes(word))) checks.push(["antiword", cfg.antiword.action || "null"]);
    if (cfg.antilink?.enabled) {
        const links = body.match(/https?:\/\/[^\s]+|(?:www\.)?[-\w]+\.[a-z]{2,}(?:\/[^\s]*)?/gi) || [];
        const allowed = cfg.antilink.allowed || [];
        const blocked = links.some(link => {
            let host = link.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
            return !allowed.some(domain => host === domain || host.endsWith(`.${domain}`));
        });
        if (blocked) checks.push(["antilink", cfg.antilink.action || "null"]);
    }
    if (!checks.length) return;
    if (!await isBotAdmin(sock, jid)) return;
    try { await sock.sendMessage(jid, { delete: message.key }); } catch (error) { console.error("[SPIDER-MD] Manage delete failed:", error.message); }
    const [rule, action] = checks[0];
    if (action === "warn") await sock.sendMessage(jid, { text: `@${sender.split("@")[0]}: your message was removed by ${rule}.`, mentions: [sender] });
    if (action === "kick") {
        await sock.sendMessage(jid, { text: `@${sender.split("@")[0]}: removed for violating ${rule}.`, mentions: [sender] });
        try { await sock.groupParticipantsUpdate(jid, [sender], "remove"); } catch (error) { console.error("[SPIDER-MD] Manage kick failed:", error.message); }
    }
}

export async function handleManageParticipantUpdate(sock, update) {
    const jid = update?.id;
    if (!isGroup(jid)) return;
    const store = await readStore(); const cfg = store.groups[jid] || {};
    const action = String(update.action || "").toLowerCase();
    const participants = (update.participants || []).map(cleanJid).filter(Boolean);
    if (!participants.length) return;
    if (cfg.pdm) {
        const verb = action === "promote" ? "promoted" : action === "demote" ? "demoted" : action;
        const mentions = participants;
        await sock.sendMessage(jid, { text: `Group update: ${participants.map(p => `@${p.split("@")[0]}`).join(", ")} ${verb}.`, mentions });
    }
    const pendingTargets = participants.filter(participant =>
        pendingRoleChanges.delete(`${jid}:${action}:${participant}`)
    );
    const externalTargets = participants.filter(participant => !pendingTargets.includes(participant));
    if (!externalTargets.length) return;

    const actor = cleanJid(update.author || "");
    const botId = cleanJid(sock.user?.id || "");
    if (actor && botId && actor === botId) return;
    if (!await isBotAdmin(sock, jid)) return;
    if (action === "demote" && cfg.antidemote) {
        for (const participant of externalTargets) pendingRoleChanges.add(`${jid}:promote:${participant}`);
        try { await sock.groupParticipantsUpdate(jid, externalTargets, "promote"); }
        catch (error) {
            for (const participant of externalTargets) pendingRoleChanges.delete(`${jid}:promote:${participant}`);
            console.error("[SPIDER-MD] Antidemote reversal failed:", error.message);
        }
    }
    if (action === "promote" && cfg.antipromote) {
        for (const participant of externalTargets) pendingRoleChanges.add(`${jid}:demote:${participant}`);
        try { await sock.groupParticipantsUpdate(jid, externalTargets, "demote"); }
        catch (error) {
            for (const participant of externalTargets) pendingRoleChanges.delete(`${jid}:demote:${participant}`);
            console.error("[SPIDER-MD] Antipromote reversal failed:", error.message);
        }
    }
    if (action === "add" && cfg.antifake?.enabled && await isBotAdmin(sock, jid)) {
        const prefixes = cfg.antifake.prefixes || [];
        const invalid = participants.filter(p => p.endsWith("@s.whatsapp.net") && prefixes.some(prefix => p.split("@")[0].startsWith(prefix)));
        if (invalid.length) {
            await sock.sendMessage(jid, { text: `Restricted phone prefix detected. Removing: ${invalid.map(p => `@${p.split("@")[0]}`).join(", ")}`, mentions: invalid });
            try { await sock.groupParticipantsUpdate(jid, invalid, "remove"); } catch (error) { console.error("[SPIDER-MD] Antifake removal failed:", error.message); }
        }
    }
}

export async function handleManageMessageUpdate(sock, updates) {
    const store = await readStore();
    const settings = Object.values(store.ownerSettings || {}).map(item => item.antidelete).filter(item => item?.enabled);
    if (!settings.length) return;
    for (const item of updates || []) {
        const update = item.update || {};
        const protocol = update.message?.protocolMessage || update.message?.editedMessage?.message?.protocolMessage;
        if (protocol?.type !== 0 && protocol?.type !== "REVOKE") continue;
        const jid = item.key?.remoteJid || "";
        const mode = settings[0].mode || "chat";
        if (mode === "pm" && isGroup(jid)) continue;
        const participant = cleanJid(item.key?.participant || item.key?.participantAlt || "");
        if (isGroup(jid) && participant) {
            await sock.sendMessage(jid, { text: `@${participant.split("@")[0]} deleted a message. (Content is not recovered.)`, mentions: [participant] });
        } else {
            await sock.sendMessage(jid, { text: "A message was deleted. (Content is not recovered.)" });
        }
    }
}

export function startManageScheduler(sock) {
    schedulerSocket = sock;
    if (schedulerStarted) return;
    schedulerStarted = true;
    setInterval(async () => {
        try {
            const activeSock = schedulerSocket;
            if (!activeSock) return;
            const now = Date.now();
            const store = await readStore();
            let changed = false;
            for (const item of store.schedules) {
                if (!item.sent && item.timestamp <= now) {
                    try { await activeSock.sendMessage(item.jid, item.content); item.sent = true; changed = true; }
                    catch (error) { console.error("[SPIDER-MD] Scheduled message failed:", error.message); }
                }
            }
            const parts = indiaParts();
            const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
            {
                for (const [jid, cfg] of Object.entries(store.groups)) {
                    for (const [field, setting] of [["automute", "announcement"], ["autounmute", "not_announcement"]]) {
                        const item = cfg[field];
                        if (!item?.enabled || item.hour !== Number(parts.hour) || item.minute !== Number(parts.minute) || item.lastRun === dayKey) continue;
                        if (await isBotAdmin(activeSock, jid)) {
                            try { await activeSock.groupSettingUpdate(jid, setting); item.lastRun = dayKey; changed = true; }
                            catch (error) { console.error(`[SPIDER-MD] ${field} failed:`, error.message); }
                        }
                    }
                }
            }
            if (changed) await writeStore(store);
        } catch (error) { console.error("[SPIDER-MD] Manage scheduler error:", error); }
    }, 15000);
}
