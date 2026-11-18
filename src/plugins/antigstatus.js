import fs from "node:fs/promises";
import path from "node:path";

const DATA_FILE = path.join(
    process.cwd(),
    "data",
    "antigstatus.json"
);

const GROUP_SUFFIX = "@g.us";
const ADMIN_REVOKE = 132;

let data = { groups: {} };
let loaded = false;

const processedStatuses = new Set();

async function loadData() {
    if (loaded) return;

    try {
        const saved = JSON.parse(
            await fs.readFile(DATA_FILE, "utf8")
        );

        data = {
            groups: saved.groups || {}
        };
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("[SPIDER-MD] AntiStatus data error:", error);
        }
    }

    loaded = true;
}

async function saveData() {
    await fs.mkdir(path.dirname(DATA_FILE), {
        recursive: true
    });

    const temporary = `${DATA_FILE}.tmp`;

    await fs.writeFile(
        temporary,
        JSON.stringify(data, null, 2)
    );

    await fs.rename(temporary, DATA_FILE);
}

function unwrap(content) {
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

    return content || {};
}

function isGroupStatus(message) {
    const content = unwrap(message?.message);

    if (
        content.groupStatusMessageV2 ||
        content.groupStatusMessage
    ) {
        return true;
    }

    for (const value of Object.values(content)) {
        if (value?.contextInfo?.isGroupStatus === true) {
            return true;
        }

        if (
            value?.message?.contextInfo?.isGroupStatus === true
        ) {
            return true;
        }
    }

    return false;
}

function canonicalJid(value) {
    return String(value || "")
        .replace(/:\d+@/, "@")
        .toLowerCase();
}

function participantJids(participant) {
    return [
        participant?.id,
        participant?.jid,
        participant?.lid,
        participant?.phoneNumber,
        participant?.phone_number
    ]
        .filter(Boolean)
        .map(canonicalJid);
}

function findParticipant(metadata, identities) {
    const targets = (
        Array.isArray(identities) ? identities : [identities]
    )
        .filter(Boolean)
        .map(canonicalJid);

    return (metadata.participants || []).find(participant =>
        participantJids(participant).some(jid =>
            targets.includes(jid)
        )
    );
}

function isAdmin(participant) {
    return Boolean(
        participant &&
        (
            participant.admin === "admin" ||
            participant.admin === "superadmin" ||
            participant.isAdmin === true
        )
    );
}

function getSender(message) {
    return [
        message?.key?.participant,
        message?.key?.participantAlt,
        message?.participant,
        message?.participantAlt
    ].filter(Boolean);
}

function getBot(sock) {
    return [
        sock?.user?.id,
        sock?.user?.lid,
        sock?.user?.phoneNumber
    ].filter(Boolean);
}

function mentionJid(participant, fallback) {
    return (
        participant?.id ||
        participant?.jid ||
        participant?.phoneNumber ||
        fallback
    );
}

function displayMention(jid) {
    return String(jid || "").split("@")[0];
}

async function sendReply(sock, jid, text, quoted) {
    return sock.sendMessage(
        jid,
        { text },
        quoted ? { quoted } : {}
    );
}

async function getAdminStatus(sock, message) {
    const groupJid = message.key.remoteJid;
    const metadata = await sock.groupMetadata(groupJid);

    const sender = findParticipant(
        metadata,
        getSender(message)
    );

    const bot = findParticipant(
        metadata,
        getBot(sock)
    );

    return {
        metadata,
        sender,
        bot,
        senderIsAdmin: isAdmin(sender),
        botIsAdmin: isAdmin(bot)
    };
}

function getCommandName(message) {
    const content = unwrap(message?.message);

    const text =
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        "";

    return String(text)
        .trim()
        .split(/\s+/)[0]
        .replace(/^[.!]/, "")
        .toLowerCase();
}

function getQuotedStatus(message) {
    const content = unwrap(message?.message);

    const contextInfo =
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo;

    if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) {
        return null;
    }

    const quotedMessage = contextInfo.quotedMessage;

    if (!isGroupStatus({ message: quotedMessage })) {
        return null;
    }

    return {
        key: {
            remoteJid: message.key.remoteJid,
            fromMe: false,
            id: contextInfo.stanzaId,
            ...(contextInfo.participant
                ? { participant: contextInfo.participant }
                : {})
        },
        quotedMessage,
        participant: contextInfo.participant
    };
}

/*
 * Experimental admin-specific revoke.
 * ADMIN_REVOKE = 132 in this installed Baileys protocol.
 */
async function adminRevoke(sock, groupJid, targetKey) {
    if (typeof sock.relayMessage !== "function") {
        throw new Error("relayMessage is unavailable.");
    }

    if (!targetKey?.id) {
        throw new Error("Status message ID is missing.");
    }

    const metadata = await sock.groupMetadata(groupJid);
    const identities = [
        targetKey.participant,
        targetKey.participantAlt
    ].filter(Boolean).map(canonicalJid);

    const target = (metadata.participants || []).find(participant =>
        participantJids(participant).some(jid => identities.includes(jid))
    );

    if (!target && !identities.length) {
        throw new Error("Could not identify the status poster.");
    }

    const participantIds = target ? participantJids(target) : identities;
    const phoneJid = participantIds.find(jid => jid.endsWith("@s.whatsapp.net"));
    const lidJid = participantIds.find(jid => jid.endsWith("@lid"));

    const addressingMode =
        metadata.addressingMode === "lid" ||
        (!metadata.addressingMode && (lidJid || identities.some(jid => jid.endsWith("@lid"))))
            ? "lid"
            : "pn";

    const targetParticipant =
        addressingMode === "lid"
            ? (lidJid || identities.find(jid => jid.endsWith("@lid")))
            : (phoneJid || identities.find(jid => jid.endsWith("@s.whatsapp.net")));

    if (!targetParticipant) {
        throw new Error("Could not resolve the poster for the group's addressing mode.");
    }

    const revokeMessage = {
        protocolMessage: {
            key: {
                remoteJid: groupJid,
                id: targetKey.id,
                fromMe: false,
                participant: targetParticipant
            },
            type: 0
        }
    };

    const relayOptions = {
        useCachedGroupMetadata: true,
        additionalAttributes: {
            edit: "8",
            addressing_mode: addressingMode
        }
    };

    try {
        return await sock.relayMessage(groupJid, revokeMessage, relayOptions);
    } catch (primaryError) {
        const alternateParticipant = addressingMode === "lid" ? phoneJid : lidJid;

        if (!alternateParticipant || alternateParticipant === targetParticipant) {
            throw primaryError;
        }

        console.warn(
            "[SPIDER-MD] Primary admin revoke failed; retrying with alternate participant:",
            primaryError?.message || primaryError
        );

        return sock.relayMessage(
            groupJid,
            {
                protocolMessage: {
                    key: {
                        remoteJid: groupJid,
                        id: targetKey.id,
                        fromMe: false,
                        participant: alternateParticipant
                    },
                    type: 0
                }
            },
            {
                useCachedGroupMetadata: true,
                additionalAttributes: {
                    edit: "8",
                    addressing_mode: addressingMode === "lid" ? "pn" : "lid"
                }
            }
        );
    }
}

export const antigstatusPlugin = {
    name: "antigstatus",
    aliases: ["dlt"],
    category: "MANAGE",
    description: "Automatically deletes group statuses and warns the poster.",

    async execute(sock, message, args, context = {}) {
        const jid = message.key.remoteJid;

        if (!jid?.endsWith(GROUP_SUFFIX)) {
            return sendReply(
                sock,
                jid,
                "_This command only works in group chats._",
                message
            );
        }

        try {
            const {
                senderIsAdmin,
                botIsAdmin
            } = await getAdminStatus(sock, message);

            if (!senderIsAdmin) {
                return sendReply(
                    sock,
                    jid,
                    "_You don't have permission. Only group admins can use this command._",
                    message
                );
            }

            const commandName = String(context.command || "").toLowerCase();

            await loadData();

            // MANUAL STATUS DELETION
            if (commandName === "dlt") {
                if (!botIsAdmin) {
                    return sendReply(
                        sock,
                        jid,
                        "i'm not the admin of this group",
                        message
                    );
                }

                const quoted = getQuotedStatus(message);

                if (!quoted) {
                    return sendReply(
                        sock,
                        jid,
                        "Reply directly to a group status with .dlt",
                        message
                    );
                }

                try {
                    await adminRevoke(
                        sock,
                        jid,
                        quoted.key
                    );

                    console.log(
                        "[SPIDER-MD] Manual ADMIN_REVOKE request sent:",
                        quoted.key.id
                    );

                    return sendReply(
                        sock,
                        jid,
                        "Status deletion request sent.",
                        message
                    );
                } catch (error) {
                    console.error(
                        "[SPIDER-MD] Manual status deletion error:",
                        error
                    );

                    return sendReply(
                        sock,
                        jid,
                        "Status deletion request failed. Check Termux logs.",
                        message
                    );
                }
            }

            const action = String(
                args?.[0] || "status"
            ).toLowerCase();

            if (action === "on") {
                if (!botIsAdmin) {
                    return sendReply(
                        sock,
                        jid,
                        "i'm not the admin of this group",
                        message
                    );
                }

                data.groups[jid] = true;
                await saveData();

                return sendReply(
                    sock,
                    jid,
                    "🛡️ AntiStatus enabled for this group.",
                    message
                );
            }

            if (action === "off") {
                data.groups[jid] = false;
                await saveData();

                return sendReply(
                    sock,
                    jid,
                    "AntiStatus disabled for this group.",
                    message
                );
            }

            if (action === "status") {
                return sendReply(
                    sock,
                    jid,
                    `AntiStatus: ${data.groups[jid] ? "ON" : "OFF"}`,
                    message
                );
            }

            return sendReply(
                sock,
                jid,
                "Usage: .antigstatus on / off / status",
                message
            );

        } catch (error) {
            console.error(
                "[SPIDER-MD] AntiStatus command error:",
                error
            );

            return sendReply(
                sock,
                jid,
                "_AntiStatus operation failed. Check the Termux log._",
                message
            );
        }
    }
};

export async function handleGroupStatus(sock, message) {
    try {
        const groupJid = message?.key?.remoteJid;

        if (
            !groupJid?.endsWith(GROUP_SUFFIX) ||
            message?.key?.fromMe === true ||
            !message?.message ||
            !isGroupStatus(message)
        ) {
            return;
        }

        await loadData();

        if (!data.groups[groupJid]) return;

        const statusId = message.key.id;
        const processedKey = `${groupJid}|${statusId}`;

        if (processedStatuses.has(processedKey)) return;

        const senderIdentities = getSender(message);

        if (!senderIdentities.length) {
            console.log("[SPIDER-MD] AntiStatus: sender not identified.");
            return;
        }

        const metadata = await sock.groupMetadata(groupJid);

        const participant = findParticipant(
            metadata,
            senderIdentities
        );

        if (!participant) {
            console.log("[SPIDER-MD] AntiStatus: participant not found.");
            return;
        }

        const targetJid = mentionJid(
            participant,
            senderIdentities[0]
        );

        const botParticipant = findParticipant(
            metadata,
            getBot(sock)
        );

        if (!isAdmin(botParticipant)) {
            console.log(
                "[SPIDER-MD] AntiStatus: i'm not the admin of this group"
            );
            return;
        }

        processedStatuses.add(processedKey);

        if (processedStatuses.size > 1000) {
            const oldest = processedStatuses.values().next().value;
            processedStatuses.delete(oldest);
        }

        try {
            await adminRevoke(
                sock,
                groupJid,
                message.key
            );

            console.log(
                "[SPIDER-MD] Automatic ADMIN_REVOKE request sent:",
                statusId
            );

        } catch (error) {
            console.error(
                "[SPIDER-MD] Automatic status deletion error:",
                error
            );
        }

        const mention = `@${displayMention(targetJid)}`;

        await sock.sendMessage(groupJid, {
            text: `${mention} Warning: Group status is not allowed in this group. Please don't post group statuses here.`,
            mentions: [targetJid]
        });

    } catch (error) {
        console.error(
            "[SPIDER-MD] AntiStatus handler error:",
            error
        );
    }
}
