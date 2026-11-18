const GROUP_SUFFIX = "@g.us";

const TEXT = {
    ERROR_METADATA: "_Failed to fetch group metadata._",
    NOT_GROUP: "_This command only works in group chats._",
    NOT_ADMIN: "_I'm not admin_",
    NOT_GROUP_ADMIN: "_You don't have permission._\n_Only admins and sudo users can use this command._",
    TAG_ALERT: "_Please enter text or reply to a message._",
    KICK_ALERT: "_Reply to a message or mention a participant to kick!._",
    KICKED: "_{} kick outed from the group._",
    PROMOTE_ALERT: "_Reply to a message or mention a participant to promote!._",
    ALREADY_PROMOTED: "_This participant is already admin role!._",
    PROMOTED: "_{} now an admin._",
    DEMOTE_ALERT: "_Reply to a message or mention a participant to demote!._",
    ALREADY_DEMOTED: "_This participant is already member role!._",
    DEMOTED: "_{} no longer an admin._",
    MUTED: "_Group muted!_",
    UNMUTED: "_Group unmuted!_",
    GLOCKED: "_Group settings have been locked. Only admins can edit group details now._",
    GUNLOCKED: "_Group settings have been unlocked. All members can now edit group details._",
    INVITE: "{}",
    REVOKED: "_Revoked_",
    GNAME_ALERT: "_Give a name to change the group name!._",
    GNAME_SUCCESS: "_Group name changed to: {}_",
    GDESC_ALERT: "_Give a description to change the group description!._",
    GDESC_SUCCESS: "_Group description changed to: {}_"
};

function canonicalJid(value) {
    return String(value || "").replace(/:\d+@/, "@");
}

function getMessageContent(message) {
    let content = message?.message || {};

    for (let i = 0; i < 10; i++) {
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

function getTextFromContent(content) {
    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.imageMessage?.caption ||
        content?.videoMessage?.caption ||
        content?.documentMessage?.caption ||
        ""
    );
}

function getContextInfo(message) {
    const content = getMessageContent(message);

    return (
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo ||
        {}
    );
}

async function reply(sock, message, text) {
    return sock.sendMessage(
        message.key.remoteJid,
        { text },
        { quoted: message }
    );
}

async function getGroup(sock, message) {
    const jid = message?.key?.remoteJid || "";

    if (!jid.endsWith(GROUP_SUFFIX)) {
        await reply(sock, message, TEXT.NOT_GROUP);
        return null;
    }

    try {
        return await sock.groupMetadata(jid);
    } catch (error) {
        console.error("[SPIDER-MD] Group metadata error:", error);
        await reply(sock, message, TEXT.ERROR_METADATA);
        return null;
    }
}

function participantJids(participant) {
    return [
        participant?.id,
        participant?.jid,
        participant?.lid,
        participant?.phoneNumber,
        participant?.phone_number
    ].filter(Boolean).map(String);
}

function findParticipant(metadata, jid) {
    const targets = (Array.isArray(jid) ? jid : [jid])
        .filter(Boolean)
        .map(value => canonicalJid(value).toLowerCase());

    return metadata.participants.find(participant =>
        participantJids(participant).some(value =>
            targets.includes(canonicalJid(value).toLowerCase())
        )
    );
}

function isAdminParticipant(participant) {
    return Boolean(
        participant &&
        (
            participant.admin === "admin" ||
            participant.admin === "superadmin" ||
            participant.isAdmin === true
        )
    );
}

function getSenderJid(message) {
    return message?.key?.participant ||
        message?.participant ||
        "";
}

function getBotJid(sock) {
    return [
        sock?.user?.id,
        sock?.user?.lid,
        sock?.user?.phoneNumber
    ].filter(Boolean).map(String);
}

async function requireAdmins(sock, message, metadata) {
    const sender = getSenderJid(message);
    const bot = getBotJid(sock);

    const senderParticipant = findParticipant(metadata, sender);
    const botParticipant = findParticipant(metadata, bot);

    if (!isAdminParticipant(senderParticipant)) {
        await reply(sock, message, TEXT.NOT_GROUP_ADMIN);
        return false;
    }

    if (!isAdminParticipant(botParticipant)) {
        await reply(sock, message, TEXT.NOT_ADMIN);
        return false;
    }

    return true;
}

function getTargetJid(message, args) {
    const context = getContextInfo(message);

    const mentioned = context.mentionedJid?.[0];
    const quoted = context.participant;
    const supplied = args.join(" ").trim();

    const target = mentioned || quoted || supplied;

    if (!target) return "";

    if (String(target).includes("@")) {
        return String(target);
    }

    const digits = String(target).replace(/\D/g, "");

    return digits ? `${digits}@s.whatsapp.net` : "";
}

function mentionName(jid) {
    return String(jid).split("@")[0];
}

async function changeParticipant(
    sock,
    message,
    args,
    action,
    alert,
    success,
    alreadyCheck
) {
    const metadata = await getGroup(sock, message);
    if (!metadata) return;

    if (!await requireAdmins(sock, message, metadata)) return;

    const target = getTargetJid(message, args);

    if (!target) {
        return reply(sock, message, alert);
    }

    const participant = findParticipant(metadata, target);

    if (!participant) {
        return reply(sock, message, alert);
    }

    if (
        alreadyCheck === "admin" &&
        isAdminParticipant(participant)
    ) {
        return reply(sock, message, TEXT.ALREADY_PROMOTED);
    }

    if (
        alreadyCheck === "member" &&
        !isAdminParticipant(participant)
    ) {
        return reply(sock, message, TEXT.ALREADY_DEMOTED);
    }

    const targetJid =
        participant.id ||
        participant.jid ||
        target;

    await sock.groupParticipantsUpdate(
        message.key.remoteJid,
        [targetJid],
        action
    );

    return sock.sendMessage(
        message.key.remoteJid,
        {
            text: success.replace(
                "{}",
                `@${mentionName(targetJid)}`
            ),
            mentions: [targetJid]
        },
        { quoted: message }
    );
}

async function changeGroupSetting(
    sock,
    message,
    setting,
    success
) {
    const metadata = await getGroup(sock, message);
    if (!metadata) return;

    if (!await requireAdmins(sock, message, metadata)) return;

    await sock.groupSettingUpdate(
        message.key.remoteJid,
        setting
    );

    return reply(sock, message, success);
}

export const groupPlugins = [
    {
        name: "tag",
        category: "GROUP",
        description: "Tag all participants with message.",

        async execute(sock, message, args) {
            const metadata = await getGroup(sock, message);
            if (!metadata) return;

            const context = getContextInfo(message);

            const quotedText = getTextFromContent(
                context.quotedMessage || {}
            );

            const text = args.join(" ").trim() || quotedText;

            if (!text) {
                return reply(sock, message, TEXT.TAG_ALERT);
            }

            const mentions = metadata.participants
                .map(p => p.id || p.jid)
                .filter(Boolean);

            return sock.sendMessage(
                message.key.remoteJid,
                { text, mentions },
                { quoted: message }
            );
        }
    },

    {
        name: "tagall",
        category: "GROUP",
        description: "Tags all members in a group chat with mentions.",

        async execute(sock, message) {
            const metadata = await getGroup(sock, message);
            if (!metadata) return;

            if (!metadata.participants?.length) {
                return reply(sock, message, TEXT.ERROR_METADATA);
            }

            const mentions = metadata.participants
                .map(p => p.id || p.jid)
                .filter(Boolean);

            const text = metadata.participants
                .map((p, i) =>
                    `${i + 1}. @${mentionName(p.id || p.jid)}`
                )
                .join("\n");

            return sock.sendMessage(
                message.key.remoteJid,
                { text, mentions },
                { quoted: message }
            );
        }
    },

    {
        name: "kick",
        category: "GROUP",
        description: "Kicks members from the group.",

        async execute(sock, message, args) {
            return changeParticipant(
                sock, message, args,
                "remove",
                TEXT.KICK_ALERT,
                TEXT.KICKED
            );
        }
    },

    {
        name: "promote",
        category: "GROUP",
        description: "Promotes participants to admin role.",

        async execute(sock, message, args) {
            return changeParticipant(
                sock, message, args,
                "promote",
                TEXT.PROMOTE_ALERT,
                TEXT.PROMOTED,
                "admin"
            );
        }
    },

    {
        name: "demote",
        category: "GROUP",
        description: "Demotes participants to member role.",

        async execute(sock, message, args) {
            return changeParticipant(
                sock, message, args,
                "demote",
                TEXT.DEMOTE_ALERT,
                TEXT.DEMOTED,
                "member"
            );
        }
    },

    {
        name: "mute",
        category: "GROUP",
        description: "Mutes group chat. Only the admins can send messages.",

        async execute(sock, message) {
            return changeGroupSetting(
                sock, message,
                "announcement",
                TEXT.MUTED
            );
        }
    },

    {
        name: "unmute",
        category: "GROUP",
        description: "Unmutes group chat allowing all participants to send messages.",

        async execute(sock, message) {
            return changeGroupSetting(
                sock, message,
                "not_announcement",
                TEXT.UNMUTED
            );
        }
    },

    {
        name: "glock",
        category: "GROUP",
        description: "Change group settings to allow only admins to edit group's info.",

        async execute(sock, message) {
            return changeGroupSetting(
                sock, message,
                "locked",
                TEXT.GLOCKED
            );
        }
    },

    {
        name: "gunlock",
        category: "GROUP",
        description: "Change group settings to allow everyone to edit group's info.",

        async execute(sock, message) {
            return changeGroupSetting(
                sock, message,
                "unlocked",
                TEXT.GUNLOCKED
            );
        }
    },

    {
        name: "invite",
        category: "GROUP",
        description: "Provides the group's invitation link.",

        async execute(sock, message) {
            const metadata = await getGroup(sock, message);
            if (!metadata) return;

            if (!await requireAdmins(sock, message, metadata)) return;

            const code = await sock.groupInviteCode(
                message.key.remoteJid
            );

            return reply(
                sock,
                message,
                TEXT.INVITE.replace(
                    "{}",
                    `https://chat.whatsapp.com/${code}`
                )
            );
        }
    },

    {
        name: "revoke",
        category: "GROUP",
        description: "Resets the group's invitation link.",

        async execute(sock, message) {
            const metadata = await getGroup(sock, message);
            if (!metadata) return;

            if (!await requireAdmins(sock, message, metadata)) return;

            await sock.groupRevokeInvite(message.key.remoteJid);

            return reply(sock, message, TEXT.REVOKED);
        }
    },

    {
        name: "gname",
        category: "GROUP",
        description: "Change the group name(subject).",

        async execute(sock, message, args) {
            const metadata = await getGroup(sock, message);
            if (!metadata) return;

            if (!await requireAdmins(sock, message, metadata)) return;

            const name = args.join(" ").trim();

            if (!name) {
                return reply(sock, message, TEXT.GNAME_ALERT);
            }

            await sock.groupUpdateSubject(
                message.key.remoteJid,
                name
            );

            return reply(
                sock,
                message,
                TEXT.GNAME_SUCCESS.replace("{}", name)
            );
        }
    },

    {
        name: "gdesc",
        category: "GROUP",
        description: "Change the group description.",

        async execute(sock, message, args) {
            const metadata = await getGroup(sock, message);
            if (!metadata) return;

            if (!await requireAdmins(sock, message, metadata)) return;

            const description = args.join(" ").trim();

            if (!description) {
                return reply(sock, message, TEXT.GDESC_ALERT);
            }

            await sock.groupUpdateDescription(
                message.key.remoteJid,
                description
            );

            return reply(
                sock,
                message,
                TEXT.GDESC_SUCCESS.replace("{}", description)
            );
        }
    }
];
