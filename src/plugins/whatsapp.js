import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { config } from "../config.js";

function unwrap(message) {
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

function quotedMessage(message) {
    const content = unwrap(message?.message);

    const info =
        content?.extendedTextMessage?.contextInfo ||
        content?.imageMessage?.contextInfo ||
        content?.videoMessage?.contextInfo ||
        content?.documentMessage?.contextInfo;

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

function getTarget(message, args = []) {
    const quoted = quotedMessage(message);

    if (quoted?.key?.participant) {
        return quoted.key.participant;
    }

    const content = unwrap(message?.message);
    const info =
        content?.extendedTextMessage?.contextInfo ||
        content?.imageMessage?.contextInfo ||
        content?.videoMessage?.contextInfo;

    const mentioned = info?.mentionedJid?.[0];

    if (mentioned) return mentioned;

    const number = String(args[0] || "").replace(/\D/g, "");

    if (number.length >= 7) {
        return `${number}@s.whatsapp.net`;
    }

    const jid = message.key.remoteJid;

    if (jid && jid.endsWith("@s.whatsapp.net")) {
        return jid;
    }

    return null;
}

function numberFromJid(jid) {
    return String(jid || "")
        .split("@")[0]
        .split(":")[0];
}

async function reply(sock, message, text) {
    return sock.sendMessage(
        message.key.remoteJid,
        { text },
        { quoted: message }
    );
}

async function getBlockList(sock) {
    if (typeof sock.fetchBlocklist !== "function") {
        throw new Error("Block list is not supported by this Baileys build.");
    }

    return await sock.fetchBlocklist() || [];
}

async function blockCommand(sock, message, args) {
    const jid = message.key.remoteJid;

    if (String(args[0] || "").toLowerCase() === "list") {
        const list = await getBlockList(sock);

        if (!list.length) {
            return reply(sock, message, "_*No block list found*_");
        }

        const output = list.map(item => `- +${numberFromJid(item)}`).join("\n");

        return reply(
            sock,
            message,
            `_*Block List*_\n\n${output}`
        );
    }

    const target = getTarget(message, args);

    if (!target) {
        return reply(
            sock,
            message,
            "*Reply to a user to block them or use 'block list' to view the block list.*"
        );
    }

    await sock.updateBlockStatus(target, "block");

    return reply(sock, message, "_*Blocked!*_");
}

async function unblockCommand(sock, message, args) {
    const option = String(args[0] || "").toLowerCase();

    if (option === "all") {
        const list = await getBlockList(sock);

        if (!list.length) {
            return reply(sock, message, "_*No block list found*_");
        }

        for (const jid of list) {
            await sock.updateBlockStatus(jid, "unblock");
        }

        const output = list.map(item => `- +${numberFromJid(item)}`).join("\n");

        return reply(
            sock,
            message,
            `_*Unblock List*_\n\n${output}`
        );
    }

    const target = getTarget(message, args);

    if (!target) {
        return reply(
            sock,
            message,
            "*Reply to a user to unblock them or use 'unblock all' to unblock all the block list.*"
        );
    }

    await sock.updateBlockStatus(target, "unblock");

    return reply(sock, message, "_*Unblocked!*_");
}

async function whoisCommand(sock, message, args) {
    const target = getTarget(message, args);

    if (!target) {
        return reply(sock, message, "*Reply to a user or provide a phone number.*");
    }

    let picture;

    try {
        picture = await sock.profilePictureUrl(target, "image");
    } catch {
        picture = null;
    }

    const caption =
        `*Name:* ${target === message.key.remoteJid ? message.pushName || "Unknown" : "Not available"}\n` +
        `*JID:* ${target}\n` +
        `*WhatsApp:* https://wa.me/${numberFromJid(target)}`;

    if (picture) {
        return sock.sendMessage(
            message.key.remoteJid,
            { image: { url: picture }, caption },
            { quoted: message }
        );
    }

    return reply(sock, message, caption);
}

async function jidCommand(sock, message) {
    const quoted = quotedMessage(message);
    const target = quoted?.key?.participant || message.key.remoteJid;

    return reply(sock, message, target);
}

async function ppCommand(sock, message, args) {
    const option = String(args[0] || "").toLowerCase();

    if (option === "remove") {
        if (typeof sock.removeProfilePicture !== "function") {
            return reply(sock, message, "Profile picture removal isn't supported by this Baileys build.");
        }

        await sock.removeProfilePicture(sock.user.id);

        return reply(sock, message, "_Profile Picture Removed_");
    }

    const quoted = quotedMessage(message);
    const current = unwrap(message.message);

    let mediaMessage = null;

    if (current?.imageMessage) {
        mediaMessage = message;
    } else if (quoted && unwrap(quoted.message)?.imageMessage) {
        mediaMessage = quoted;
    }

    if (!mediaMessage) {
        return reply(sock, message, "_Reply to a photo_");
    }

    const buffer = await downloadMediaMessage(
        mediaMessage,
        "buffer",
        {}
    );

    if (!buffer?.length) {
        throw new Error("Could not download the image.");
    }

    await sock.updateProfilePicture(sock.user.id, buffer);

    return reply(sock, message, "_*Profile Picture Updated!*_");
}

async function setBioCommand(sock, message, args) {
    const quoted = quotedMessage(message);
    const quotedContent = quoted ? unwrap(quoted.message) : null;

    const status = args.join(" ").trim() ||
        quotedContent?.conversation ||
        quotedContent?.extendedTextMessage?.text ||
        "";

    if (!status) {
        return reply(
            sock,
            message,
            "*Need Status!*\n*Example: setbio Hey there! I am using WhatsApp*."
        );
    }

    await sock.updateProfileStatus(status);

    return reply(sock, message, "_Profile bio updated_");
}

async function setNameCommand(sock, message, args) {
    const quoted = quotedMessage(message);
    const quotedContent = quoted ? unwrap(quoted.message) : null;

    const name = args.join(" ").trim() ||
        quotedContent?.conversation ||
        quotedContent?.extendedTextMessage?.text ||
        "";

    if (!name) {
        return reply(
            sock,
            message,
            "*Need Name!*\n*Example: setname your name*."
        );
    }

    await sock.updateProfileName(name);

    return reply(sock, message, "_Profile name updated_");
}

async function forwardCommand(sock, message, args) {
    const quoted = quotedMessage(message);

    if (!quoted) {
        return reply(sock, message, "Reply to message");
    }

    const destinations = args
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => {
            if (value.endsWith("@g.us") || value.endsWith("@s.whatsapp.net")) {
                return value;
            }

            const number = value.replace(/\D/g, "");
            return number ? `${number}@s.whatsapp.net` : null;
        })
        .filter(Boolean);

    if (!destinations.length) {
        return reply(
            sock,
            message,
            "*Provide a JID; use 'jid' command to get JID*"
        );
    }

    for (const destination of destinations) {
        await sock.sendMessage(destination, {
            forward: quoted
        });
    }

    return reply(sock, message, "_Message forwarded_");
}

async function captionCommand(sock, message, args) {
    const quoted = quotedMessage(message);
    const current = unwrap(message.message);

    const mediaMessage = quoted || (
        current?.imageMessage || current?.videoMessage
            ? message
            : null
    );

    if (!mediaMessage) {
        return reply(sock, message, "*_Reply to an image or video_*");
    }

    const mediaContent = unwrap(mediaMessage.message);
    const image = mediaContent?.imageMessage;
    const video = mediaContent?.videoMessage;

    if (!image && !video) {
        return reply(sock, message, "*_Reply to an image or video_*");
    }

    const caption = args.join(" ").trim();

    if (!caption) {
        return reply(sock, message, "*Need a query, e.g., .caption Hello*");
    }

    const buffer = await downloadMediaMessage(
        mediaMessage,
        "buffer",
        {}
    );

    if (image) {
        await sock.sendMessage(
            message.key.remoteJid,
            {
                image: buffer,
                caption
            },
            { quoted: message }
        );
    } else {
        await sock.sendMessage(
            message.key.remoteJid,
            {
                video: buffer,
                caption
            },
            { quoted: message }
        );
    }
}

async function msgPinCommand(sock, message) {
    const quoted = quotedMessage(message);

    if (!quoted) {
        return reply(sock, message, "Reply to a message");
    }

    if (typeof sock.sendMessage !== "function") {
        return reply(sock, message, "Message pinning isn't supported by this Baileys build.");
    }

    try {
        await sock.sendMessage(message.key.remoteJid, {
            pin: {
                type: 1,
                time: 86400,
                key: quoted.key
            }
        });

        return reply(sock, message, "_Message pinned_");
    } catch {
        return reply(
            sock,
            message,
            "Message pinning isn't supported by this Baileys build."
        );
    }
}


function normalizeDeleteJid(jid) {
    return String(jid || "").replace(/:\d+@/, "@").toLowerCase();
}

function isDeleteAdmin(participant) {
    return Boolean(
        participant &&
        (
            participant.admin === "admin" ||
            participant.admin === "superadmin" ||
            participant.isAdmin === true
        )
    );
}

async function deleteCommand(sock, message) {
    const jid = message.key.remoteJid;

    if (!jid?.endsWith("@g.us")) {
        return reply(sock, message, "_This command only works in groups._");
    }

    const quoted = quotedMessage(message);

    if (!quoted) {
        return reply(sock, message, "_Reply to the message you want to delete._");
    }

    const senderJid = message.key.participant || message.participant;
    const botJids = [
        sock.user?.id,
        sock.user?.lid,
        sock.user?.phoneNumber
    ].filter(Boolean);

    let metadata;

    try {
        metadata = await sock.groupMetadata(jid);
    } catch {
        return reply(sock, message, "_Failed to fetch group information._");
    }

    const findMember = (jids) => {
        const wanted = jids
            .filter(Boolean)
            .map(normalizeDeleteJid);

        return metadata.participants.find(member => {
            const identities = [
                member.id,
                member.jid,
                member.lid,
                member.phoneNumber,
                member.phone_number
            ].filter(Boolean).map(normalizeDeleteJid);

            return identities.some(identity => wanted.includes(identity));
        });
    };

    if (!isDeleteAdmin(findMember([senderJid]))) {
        return reply(sock, message, "_Only group admins can use this command._");
    }

    if (!isDeleteAdmin(findMember(botJids))) {
        return reply(sock, message, "_I need to be a group admin to delete messages._");
    }

    const quotedSender = quoted.key.participant;
    const botIdentities = botJids.map(normalizeDeleteJid);

    const targetKey = {
        ...quoted.key,
        fromMe: botIdentities.includes(normalizeDeleteJid(quotedSender))
    };

    try {
        await sock.sendMessage(jid, { delete: targetKey });
        await sock.sendMessage(jid, { delete: message.key });
    } catch (error) {
        console.error("[SPIDER-MD] Delete command error:", error);
        return reply(sock, message, "_Unable to delete the message._");
    }
}

function makePlugin(name, aliases, execute, ownerOnly = true) {
    return {
        name,
        aliases,
        category: "WHATSAPP",
        ownerOnly,
        description: `${name} WhatsApp command`,
        execute
    };
}

export const whatsappPlugins = [
    makePlugin("delete", [], deleteCommand, false),
    makePlugin("whois", [], whoisCommand),
    makePlugin("jid", [], jidCommand),
    makePlugin("pp", ["fullpp", "setpp"], ppCommand),
    makePlugin("clear", [], async (sock, message) => {
        await sock.chatModify(
            {
                delete: true,
                lastMessages: [message]
            },
            message.key.remoteJid
        );

        return reply(sock, message, "_Cleared.._");
    }),
    makePlugin("archive", [], async (sock, message) => {
        await sock.chatModify(
            { archive: true },
            message.key.remoteJid
        );

        return reply(sock, message, "_Archived.._");
    }),
    makePlugin("unarchive", [], async (sock, message) => {
        await sock.chatModify(
            { archive: false },
            message.key.remoteJid
        );

        return reply(sock, message, "_Unarchived.._");
    }),
    makePlugin("chatpin", [], async (sock, message) => {
        await sock.chatModify(
            { pin: true },
            message.key.remoteJid
        );

        return reply(sock, message, "_Pined.._");
    }),
    makePlugin("unpin", [], async (sock, message) => {
        await sock.chatModify(
            { pin: false },
            message.key.remoteJid
        );

        return reply(sock, message, "_Unpined.._");
    }),
    makePlugin("block", ["blk"], blockCommand),
    makePlugin("unblock", ["unblk"], unblockCommand),
    makePlugin("setbio", [], setBioCommand),
    makePlugin("setname", [], setNameCommand),
    makePlugin("forward", [], forwardCommand),
    makePlugin("caption", [], captionCommand),
    makePlugin("msgpin", [], msgPinCommand)
];
