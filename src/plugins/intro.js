import fs from "fs";
import { execFileSync } from "child_process";
import path from "path";
import dns from "dns/promises";
import net from "net";
import { downloadMediaMessage, jidNormalizedUser } from "@whiskeysockets/baileys";

const DATA_FILE = path.join(process.cwd(), "data", "intro-profiles.json");
const PHOTO_DIR = path.join(process.cwd(), "data", "intro-photos");

const FISH = "𓆝 𓆟 𓆞 𓆝 𓆟𓆝 𓆟 𓆞 𓆝 𓆟";

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(PHOTO_DIR, { recursive: true });

function readProfiles() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveProfiles(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getSender(message, sock) {
    const key = message?.key || {};

    const senderJid = key.fromMe
        ? sock?.user?.id
        : (key.participant || key.remoteJid);

    return senderJid ? jidNormalizedUser(senderJid) : "";
}

function defaultProfile() {
    return {
        name: "",
        place: "",
        gender: "",
        age: "",
        phone: "",
        insta: "",
        role: "",
        photo: ""
    };
}

function getProfile(jid) {
    const profiles = readProfiles();

    if (!profiles[jid]) {
        profiles[jid] = defaultProfile();
        saveProfiles(profiles);
    }

    return {
        ...defaultProfile(),
        ...profiles[jid]
    };
}

function updateProfile(jid, profile) {
    const profiles = readProfiles();
    profiles[jid] = profile;
    saveProfiles(profiles);
}

function getQuotedMessage(message) {
    const msg = message.message || {};

    return (
        msg.extendedTextMessage?.contextInfo?.quotedMessage ||
        msg.imageMessage?.contextInfo?.quotedMessage ||
        msg.videoMessage?.contextInfo?.quotedMessage ||
        null
    );
}

function getQuotedKey(message) {
    const msg = message.message || {};

    const context =
        msg.extendedTextMessage?.contextInfo ||
        msg.imageMessage?.contextInfo ||
        msg.videoMessage?.contextInfo;

    if (!context?.quotedMessage || !context?.stanzaId) {
        return null;
    }

    return {
        remoteJid: message.key.remoteJid,
        id: context.stanzaId,
        participant: context.participant
    };
}

function unwrapMessage(message) {
    let current = message;

    for (let i = 0; i < 10; i++) {
        const next =
            current?.ephemeralMessage?.message ||
            current?.viewOnceMessage?.message ||
            current?.viewOnceMessageV2?.message ||
            current?.viewOnceMessageV2Extension?.message;

        if (!next) break;
        current = next;
    }

    return current;
}

function getImageMessage(message) {
    const content = unwrapMessage(message);
    if (!content) return null;

    if (content.imageMessage) return content.imageMessage;

    const document = content.documentMessage;

    if (
        document &&
        String(document.mimetype || "").toLowerCase().startsWith("image/")
    ) {
        return document;
    }

    return null;
}

function safeFilename(jid) {
    return String(jid).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function imageExtension(buffer) {
    if (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) return ".jpg";

    if (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        )
    ) return ".png";

    if (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
    ) return ".webp";

    if (
        buffer.length >= 6 &&
        ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))
    ) return ".gif";

    return null;
}

function isPrivateIPv4(ip) {
    const parts = ip.split(".").map(Number);

    if (
        parts.length !== 4 ||
        parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
        return true;
    }

    const [a, b] = parts;

    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

function isPrivateIPv6(ip) {
    const value = ip.toLowerCase();

    return (
        value === "::" ||
        value === "::1" ||
        value.startsWith("fc") ||
        value.startsWith("fd") ||
        value.startsWith("fe80:") ||
        value.startsWith("::ffff:127.") ||
        value.startsWith("::ffff:10.") ||
        value.startsWith("::ffff:192.168.")
    );
}

async function validateImageUrl(input) {
    let url;

    try {
        url = new URL(input);
    } catch {
        throw new Error("Invalid image URL.");
    }

    if (url.protocol !== "https:") {
        throw new Error("Only HTTPS image URLs are allowed.");
    }

    if (
        url.username ||
        url.password ||
        url.hostname === "localhost" ||
        url.hostname.endsWith(".localhost") ||
        url.hostname.endsWith(".local")
    ) {
        throw new Error("That image URL is not allowed.");
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    if (net.isIP(hostname)) {
        if (
            (net.isIPv4(hostname) && isPrivateIPv4(hostname)) ||
            (net.isIPv6(hostname) && isPrivateIPv6(hostname))
        ) {
            throw new Error("Private network image URLs are not allowed.");
        }
    } else {
        let addresses;

        try {
            addresses = await dns.lookup(hostname, { all: true });
        } catch {
            throw new Error("Could not verify the image URL.");
        }

        if (
            !addresses.length ||
            addresses.some(item =>
                net.isIPv4(item.address)
                    ? isPrivateIPv4(item.address)
                    : isPrivateIPv6(item.address)
            )
        ) {
            throw new Error("That image host is not allowed.");
        }
    }

    return url;
}

async function downloadImageUrl(input) {
    const url = await validateImageUrl(input);

    const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
            "User-Agent": "SPIDER-MD/1.1"
        }
    });

    if (!response.ok) {
        throw new Error(`Image download failed (${response.status}).`);
    }

    const contentType = String(
        response.headers.get("content-type") || ""
    ).toLowerCase();

    if (!contentType.startsWith("image/")) {
        throw new Error("The URL did not return an image.");
    }

    const declaredSize = Number(
        response.headers.get("content-length") || 0
    );

    if (declaredSize > 8 * 1024 * 1024) {
        throw new Error("Image is too large. Maximum size is 8 MB.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
        throw new Error("Image is empty or larger than 8 MB.");
    }

    const extension = imageExtension(buffer);

    if (!extension) {
        throw new Error("Unsupported image. Use JPG, PNG, WEBP or GIF.");
    }

    return { buffer, extension };
}

function savePhoto(jid, buffer, extension) {
    const filename = safeFilename(jid) + extension;
    const fullPath = path.join(PHOTO_DIR, filename);

    for (const oldExtension of [".jpg", ".png", ".webp", ".gif"]) {
        const oldPath = path.join(
            PHOTO_DIR,
            safeFilename(jid) + oldExtension
        );

        if (oldPath !== fullPath && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
        }
    }

    fs.writeFileSync(fullPath, buffer);
    return fullPath;
}

function removePhoto(jid) {
    for (const extension of [".jpg", ".png", ".webp", ".gif"]) {
        const file = path.join(
            PHOTO_DIR,
            safeFilename(jid) + extension
        );

        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    }
}

async function saveQuotedImage(sock, message, jid) {
    const quotedMessage = getQuotedMessage(message);
    const quotedKey = getQuotedKey(message);

    if (!quotedMessage || !quotedKey) {
        throw new Error("Reply to an image with `.introset photo`.");
    }

    if (!getImageMessage(quotedMessage)) {
        throw new Error("The quoted message must contain an image.");
    }

    const buffer = await downloadMediaMessage(
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

    const extension = imageExtension(buffer);

    if (!extension) {
        throw new Error("Unsupported image format.");
    }

    if (buffer.length > 8 * 1024 * 1024) {
        throw new Error("Image is too large. Maximum size is 8 MB.");
    }

    return savePhoto(jid, buffer, extension);
}

function buildCaption(profile) {
    const fields = [
        ["Name", profile.name],
        ["Place", profile.place],
        ["Gender", profile.gender],
        ["Age", profile.age],
        ["Phone", profile.phone],
        ["IG ID", profile.insta],
        ["Role", profile.role]
    ];

    const lines = [
        FISH,
        "",
        "┏━━━━━━━━━━━━━━━━━━━━",
        "┃  『 𝐌𝐘 𝐈𝐍𝐓𝐑𝐎 』"
    ];

    for (const [label, value] of fields) {
        const cleanValue = String(value || "").trim();

        if (!cleanValue) continue;

        const parts = cleanValue.split("\n");

        lines.push(`┃  ◈ ${label.padEnd(7)} : ${parts[0]}`);

        for (const part of parts.slice(1)) {
            lines.push(`┃      ${part}`);
        }
    }

    lines.push("┃");
    lines.push("┗━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push(FISH);

    return lines.join("\n");
}

async function sendIntro(sock, message, jid) {
    const chat = message.key.remoteJid;
    const profile = getProfile(jid);
    const caption = buildCaption(profile);

    let loading;

    try {
        loading = await sock.sendMessage(chat, {
            text: "𝙄𝙉𝙏𝙍𝙊 𝙇𝙊𝘼𝘿𝙄𝙉𝙂...."
        }, { quoted: message });
    } catch (error) {
        console.error("[SPIDER-MD] Intro loading error:", error);
    }

    let thumbnailBuffer = null;
    let thumbnailPath = null;

    try {
        if (profile.photo && fs.existsSync(profile.photo)) {
            thumbnailPath = path.join(
                PHOTO_DIR,
                `${safeFilename(jid)}-preview-${Date.now()}.jpg`
            );

            execFileSync("ffmpeg", [
                "-y",
                "-i", profile.photo,
                "-vf",
                "scale=96:96:force_original_aspect_ratio=decrease,pad=96:96:(ow-iw)/2:(oh-ih)/2",
                "-frames:v", "1",
                "-q:v", "5",
                thumbnailPath
            ], { stdio: "ignore" });

            thumbnailBuffer = fs.readFileSync(thumbnailPath);
        }
    } catch (error) {
        console.error("[SPIDER-MD] Intro thumbnail error:", error);
        thumbnailBuffer = null;
    } finally {
        if (thumbnailPath && fs.existsSync(thumbnailPath)) {
            fs.unlinkSync(thumbnailPath);
        }
    }

    const externalAdReply = {
        title: "『 𝐒𝐏𝐈𝐃𝐄𝐑-𝐌𝐃 』",
        body: "PROFILE INTRODUCTION",
        mediaType: 1,
        renderLargerThumbnail: false,
        showAdAttribution: false
    };

    if (thumbnailBuffer) {
        externalAdReply.thumbnail = thumbnailBuffer;
    }

    const sent = await sock.sendMessage(chat, {
        text: caption,
        contextInfo: {
            externalAdReply
        }
    }, { quoted: message });

    if (loading?.key) {
        try {
            await sock.sendMessage(chat, {
                delete: loading.key
            });
        } catch (error) {
            console.error("[SPIDER-MD] Could not delete intro loading message:", error);
        }
    }

    return sent;
}

function usageText() {
    return [
        "━━━〔 SPIDER INTRO SETTINGS 〕━━━",
        "",
        ".intro",
        ".introset name BLIX-XER",
        ".introset place KERALA",
        ".introset gender MALE",
        ".introset age 17",
        ".introset phone 9876543210",
        ".introset insta @username",
        ".introset role Developer",
        "",
        ".introset photo <HTTPS URL>",
        "Reply to an image with: .introset photo",
        ".introset photo remove",
        "",
        ".introset clear name",
        ".introset preview",
        ".introset reset",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━"
    ].join("\n");
}

export const introPlugin = {
    name: "intro",
    aliases: [],

    async execute(sock, message) {
        const jid = getSender(message, sock);
        return sendIntro(sock, message, jid);
    }
};

export const introSetPlugin = {
    name: "introset",
    aliases: [],

    async execute(sock, message, args, context = {}) {
        const jid = getSender(message, sock);
        const chat = message.key.remoteJid;

        const raw = String(
            context.rawArgs || args.join(" ")
        ).trim();

        const input = raw.replace(/^introset\s*/i, "").trim();

        if (!input || input.toLowerCase() === "help") {
            return sock.sendMessage(
                chat,
                { text: usageText() },
                { quoted: message }
            );
        }

        const profile = getProfile(jid);
        const firstSpace = input.indexOf(" ");

        const action = (
            firstSpace === -1
                ? input
                : input.slice(0, firstSpace)
        ).toLowerCase();

        const value = firstSpace === -1
            ? ""
            : input.slice(firstSpace + 1).trim();

        try {
            if (action === "preview") {
                return sendIntro(sock, message, jid);
            }

            if (action === "reset") {
                removePhoto(jid);

                const fresh = defaultProfile();
                updateProfile(jid, fresh);

                return sock.sendMessage(
                    chat,
                    { text: "Your intro profile has been reset." },
                    { quoted: message }
                );
            }

            if (action === "photo") {
                if (!value) {
                    const saved = await saveQuotedImage(
                        sock,
                        message,
                        jid
                    );

                    profile.photo = saved;
                    updateProfile(jid, profile);

                    return sock.sendMessage(
                        chat,
                        { text: "Intro photo updated successfully." },
                        { quoted: message }
                    );
                }

                if (value.toLowerCase() === "remove") {
                    removePhoto(jid);
                    profile.photo = "";
                    updateProfile(jid, profile);

                    return sock.sendMessage(
                        chat,
                        { text: "Intro photo removed." },
                        { quoted: message }
                    );
                }

                const { buffer, extension } =
                    await downloadImageUrl(value);

                profile.photo = savePhoto(
                    jid,
                    buffer,
                    extension
                );

                updateProfile(jid, profile);

                return sock.sendMessage(
                    chat,
                    { text: "Intro photo updated successfully." },
                    { quoted: message }
                );
            }

            const fields = [
                "name",
                "place",
                "gender",
                "age",
                "phone",
                "insta",
                "role"
            ];

            if (action === "clear") {
                const field = value.toLowerCase();

                if (!fields.includes(field)) {
                    throw new Error(
                        "Use `.introset clear name` or another valid field."
                    );
                }

                profile[field] = "";
                updateProfile(jid, profile);

                return sock.sendMessage(
                    chat,
                    { text: `${field} cleared from your intro.` },
                    { quoted: message }
                );
            }

            if (fields.includes(action)) {
                if (!value) {
                    throw new Error(
                        `Enter a value for ${action}.`
                    );
                }

                profile[action] = value;
                updateProfile(jid, profile);

                return sock.sendMessage(
                    chat,
                    { text: `${action} updated successfully.` },
                    { quoted: message }
                );
            }

            return sock.sendMessage(
                chat,
                { text: usageText() },
                { quoted: message }
            );

        } catch (error) {
            return sock.sendMessage(
                chat,
                {
                    text: error.message || "Could not update your intro."
                },
                { quoted: message }
            );
        }
    }
};
