import fs from "node:fs";
import path from "node:path";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const FILE = path.join(process.cwd(), "data", "group-extras.json");

function load() {
    try {
        return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
        return { warnings: {}, activity: {}, votes: {} };
    }
}

function save(data) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

const db = load();

function jid(message) {
    return message?.key?.remoteJid || "";
}

function sender(message) {
    return message?.key?.participant ||
        message?.participant ||
        "";
}

function group(message) {
    return jid(message).endsWith("@g.us");
}

function text(sock, message, value, extra = {}) {
    return sock.sendMessage(
        jid(message),
        { text: value, ...extra },
        { quoted: message }
    );
}

function number(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits ? `${digits}@s.whatsapp.net` : "";
}

async function metadata(sock, message) {
    if (!group(message)) {
        await text(sock, message, "_This command only works in group chats._");
        return null;
    }

    try {
        return await sock.groupMetadata(jid(message));
    } catch {
        await text(sock, message, "_Failed to fetch group metadata._");
        return null;
    }
}

function admin(meta, who) {
    const p = meta?.participants?.find(x =>
        [x.id, x.jid, x.lid].filter(Boolean).includes(who)
    );
    return Boolean(p && (
        p.admin === "admin" ||
        p.admin === "superadmin" ||
        p.isAdmin === true
    ));
}

async function botAdmin(sock, message, meta) {
    const bot = sock.user?.id || "";
    if (!admin(meta, bot)) {
        await text(sock, message, "_I'm not admin_");
        return false;
    }
    return true;
}

function target(message, args) {
    const ctx = message.message?.extendedTextMessage?.contextInfo ||
        message.message?.imageMessage?.contextInfo ||
        message.message?.videoMessage?.contextInfo || {};

    return ctx.mentionedJid?.[0] ||
        ctx.participant ||
        (args[0] ? number(args[0]) : "");
}

function argsText(args) {
    return args.join(" ").trim();
}

async function inviteCode(sock, message) {
    const code = await sock.groupInviteCode(jid(message));
    return `https://chat.whatsapp.com/${code}`;
}

export function handleGroupActivity(message) {
    if (!group(message) || message.key?.fromMe) return;

    const g = jid(message);
    const user = sender(message);
    if (!user) return;

    db.activity[g] ||= {};
    db.activity[g][user] ||= { count: 0, last: 0 };
    db.activity[g][user].count++;
    db.activity[g][user].last = Date.now();

    save(db);
}

export const groupExtraPlugins = [
    {
        name: "join",
        category: "GROUP",
        description: "Join a WhatsApp group or follow a channel.",
        async execute(sock, message, args) {
            let url = argsText(args);
            if (!url) {
                const ctx = message.message?.extendedTextMessage?.contextInfo;
                const quoted = ctx?.quotedMessage;
                url = quoted?.conversation ||
                    quoted?.extendedTextMessage?.text || "";
            }

            const channel = url.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
            const groupLink = url.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);

            if (channel) {
                try {
                    const info = await sock.newsletterMetadata("invite", channel[1]);
                    await sock.newsletterFollow(info.id);
                    return text(sock, message,
                        `_Followed channel: ${info.name || info.id}_`);
                } catch (e) {
                    return text(sock, message,
                        `_Failed to follow channel: ${e.message || e}_`);
                }
            }

            if (groupLink) {
                try {
                    const result = await sock.groupAcceptInvite(groupLink[1]);
                    return text(sock, message,
                        result ? "_Joined!_" : "_Invalid Group Link!_");
                } catch (e) {
                    return text(sock, message,
                        `_Failed to join: ${e.message || e}_`);
                }
            }

            return text(sock, message,
                url ? "_Invalid Group or Channel Link!_" :
                    "_Enter a valid group or channel link!_");
        }
    },

    {
        name: "left",
        category: "GROUP",
        description: "Leave the current group.",
        async execute(sock, message) {
            if (!group(message)) {
                return text(sock, message, "_This command only works in group chats._");
            }
            return sock.groupLeave(jid(message));
        }
    },

    {
        name: "gjid",
        category: "GROUP",
        description: "Show group and participant JIDs.",
        async execute(sock, message, args) {
            const meta = await metadata(sock, message);
            if (!meta) return;

            const mode = argsText(args).toLowerCase();

            if (mode === "participants jid") {
                const list = meta.participants.map(p =>
                    p.id || p.jid || p.lid
                ).filter(Boolean).join("\n");

                return text(sock, message,
                    `*Group Participants Jid*\n\n*Group Name:* ${meta.subject}\n*All Participants Jid*\n\n${list}`);
            }

            if (mode === "info") {
                return text(sock, message,
                    `*Group Jid Info*\n\n*Group Name:* ${meta.subject}\n*Group Jid:* ${jid(message)}\n*Participants:* ${meta.participants.length}`);
            }

            return text(sock, message,
                `*Group Jid Info 🎏*\n\n*Group Name:* ${meta.subject}\n*Group Jid:* ${jid(message)}\n\n*Group Participants Jid*\n${meta.participants.map(p => p.id || p.jid || p.lid).filter(Boolean).join("\n")}`);
        }
    },

    {
        name: "ginfo",
        category: "GROUP",
        description: "Get information about a group invite.",
        async execute(sock, message, args) {
            let link = argsText(args);
            if (!link && group(message)) link = await inviteCode(sock, message);

            const match = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
            if (!match) {
                return text(sock, message,
                    link ? "*Invalid invite link*" :
                        "*Need Group Link*\n_Example : ginfo group link_");
            }

            try {
                const info = await sock.groupGetInviteInfo(match[1]);
                const date = info.creation
                    ? new Date(info.creation * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
                    : "unknown";

                return text(sock, message,
                    `id: ${info.id}\nsubject: ${info.subject}\nowner: ${info.owner ? info.owner.split("@")[0] : "unknown"}\nsize: ${info.size}\nrestrict: ${info.restrict}\nannounce: ${info.announce}\ncreation: ${date}\ndesc: ${info.desc || ""}`);
            } catch {
                return text(sock, message, "*Invalid invite link*");
            }
        }
    },

    {
        name: "gapprove",
        category: "GROUP",
        description: "Approve group join requests.",
        async execute(sock, message, args) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;

            const match = argsText(args).toLowerCase();
            if (!match) {
                return text(sock, message,
                    "_Provide a match, e.g., gapprove all or gapprove: 917025673121, 4915147867879_");
            }

            const requests = await sock.groupRequestParticipantsList(jid(message));
            if (!requests?.length) {
                return text(sock, message, "_*No pending requests*_");
            }

            const selected = match === "all"
                ? requests
                : requests.filter(p => {
                    const digits = (p.jid || p.id || "").replace(/\D/g, "");
                    return match.split(/[,\s]+/).some(n => n.replace(/\D/g, "") === digits);
                });

            if (!selected.length) {
                return text(sock, message, "_*No matching request*_");
            }

            for (const p of selected) {
                await sock.groupRequestParticipantsUpdate(
                    jid(message), [p.jid || p.id], "approve"
                );
            }

            return text(sock, message,
                match === "all" ? "_*Approved all*_" : "_*Approved selected members*_");
        }
    },

    {
        name: "greject",
        category: "GROUP",
        description: "Reject group join requests.",
        async execute(sock, message, args) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;

            const match = argsText(args).toLowerCase();
            if (!match) {
                return text(sock, message,
                    "_Provide a match, e.g., greject all or greject 917025673121, 4915147867879_");
            }

            const requests = await sock.groupRequestParticipantsList(jid(message));
            if (!requests?.length) {
                return text(sock, message, "_*No pending requests*_");
            }

            const selected = match === "all"
                ? requests
                : requests.filter(p => {
                    const digits = (p.jid || p.id || "").replace(/\D/g, "");
                    return match.split(/[,\s]+/).some(n => n.replace(/\D/g, "") === digits);
                });

            if (!selected.length) {
                return text(sock, message, "_*No matching request*_");
            }

            for (const p of selected) {
                await sock.groupRequestParticipantsUpdate(
                    jid(message), [p.jid || p.id], "reject"
                );
            }

            return text(sock, message,
                match === "all" ? "_*Reject all*_" : "_*Reject selected members*_");
        }
    },

    {
        name: "add",
        category: "GROUP",
        description: "Add a participant to the group.",
        async execute(sock, message, args) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;

            const who = target(message, args);
            if (!who) {
                return text(sock, message,
                    "_Reply to user or need number_\n*Example:* .add 919876543210_");
            }

            try {
                const result = await sock.groupParticipantsUpdate(jid(message), [who], "add");
                const status = result?.[0]?.status;

                if (status === "403" || status === 403 || status === "408" || status === 408) {
                    await text(sock, message, "_Couldn't add. Invite sent!_");
                    return text(sock, message, await inviteCode(sock, message));
                }

                if (status === "401" || status === 401) {
                    return text(sock, message,
                        `Couldn't add @${who.split("@")[0]} because they blocked the bot number.`,
                        { mentions: [who] });
                }

                if (status === "409" || status === 409) {
                    return text(sock, message,
                        `@${who.split("@")[0]}, Already in the group.`,
                        { mentions: [who] });
                }

                return text(sock, message,
                    `@${who.split("@")[0]}, Added to the group.`,
                    { mentions: [who] });
            } catch (e) {
                return text(sock, message, `_Failed to add participant: ${e.message || e}_`);
            }
        }
    },

    {
        name: "warn",
        category: "GROUP",
        description: "Warn a group member or reset warnings.",
        async execute(sock, message, args) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;

            const value = argsText(args);
            if (value.toLowerCase() === "reset") {
                const who = target(message, []);
                if (!who) {
                    return text(sock, message, "_Reply to someone/mention_\n*Example:* .warn reset");
                }
                delete db.warnings[`${jid(message)}:${who}`];
                save(db);
                return text(sock, message, "_Warn reset_");
            }

            const who = target(message, args);
            if (!who) {
                return text(sock, message,
                    "_Reply to someone/mention_\n*Example:* . warn @user\n_To reset warn_\n*Example:* .warn reset");
            }

            if (admin(meta, who)) {
                return text(sock, message,
                    `_${who.split("@")[0]} is admin_`,
                    { mentions: [who] });
            }

            const key = `${jid(message)}:${who}`;
            db.warnings[key] = (db.warnings[key] || 0) + 1;
            save(db);

            return text(sock, message,
                `⚠️ @${who.split("@")[0]} has received a warning.\n*Total Warnings:* ${db.warnings[key]}`,
                { mentions: [who] });
        }
    },

    {
        name: "create",
        category: "GROUP",
        description: "Create a group with a participant.",
        async execute(sock, message, args) {
            const who = target(message, []);
            if (!who) {
                return text(sock, message,
                    "*To create group with someone*\n_Example : . create @user/reply_");
            }

            const name = argsText(args) || "SPIDER-MD Group";
            try {
                await sock.groupCreate(name, [who, sender(message)]);
                return text(sock, message, "_Group successfully created_");
            } catch (e) {
                return text(sock, message, `_Failed to create group: ${e.message || e}_`);
            }
        }
    },

    {
        name: "inactive",
        category: "GROUP",
        description: "List inactive group members.",
        async execute(sock, message) {
            const meta = await metadata(sock, message);
            if (!meta) return;

            const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const inactive = meta.participants.filter(p => {
                const id = p.id || p.jid;
                const record = db.activity[jid(message)]?.[id];
                return !record || record.last < cutoff;
            });

            if (!inactive.length) {
                return text(sock, message, "_*No inactive users found.*_");
            }

            const list = inactive.map((p, i) =>
                `*${i + 1}. User: @${(p.id || p.jid).split("@")[0]}*\n*Role: ${p.admin || "member"}*`
            ).join("\n\n");

            return text(sock, message,
                `*Total Inactive Users ${inactive.length}*\n\n${list}`,
                { mentions: inactive.map(p => p.id || p.jid).filter(Boolean) });
        }
    },

    {
        name: "active",
        category: "GROUP",
        description: "List active group members.",
        async execute(sock, message) {
            const meta = await metadata(sock, message);
            if (!meta) return;

            const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const active = meta.participants.filter(p => {
                const id = p.id || p.jid;
                const record = db.activity[jid(message)]?.[id];
                return record && record.last >= cutoff;
            });

            if (!active.length) {
                return text(sock, message, "_*No active users found.*_");
            }

            const list = active.map(p => {
                const id = p.id || p.jid;
                const record = db.activity[jid(message)][id];
                return `*Name: ${p.name || id.split("@")[0]}*\n*Number: ${id.split("@")[0]}*\n*Total Messages: ${record.count}*`;
            }).join("\n\n");

            return text(sock, message,
                `*Total Active Users ${active.length}*\n\n${list}`,
                { mentions: active.map(p => p.id || p.jid).filter(Boolean) });
        }
    },

    {
        name: "lock",
        category: "GROUP",
        description: "Allow only admins to edit group settings.",
        async execute(sock, message) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;
            if (meta.restrict) {
                return text(sock, message, "_Already only admin can modify group settings_");
            }
            await sock.groupSettingUpdate(jid(message), "locked");
            return text(sock, message, "*Only admin can modify group settings*");
        }
    },

    {
        name: "unlock",
        category: "GROUP",
        description: "Allow all members to edit group settings.",
        async execute(sock, message) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;
            if (!meta.restrict) {
                return text(sock, message, "_Already everyone can modify group settings_");
            }
            await sock.groupSettingUpdate(jid(message), "unlocked");
            return text(sock, message, "*Everyone can modify group settings*");
        }
    },

    {
        name: "gpp",
        category: "GROUP",
        description: "Change or remove the group profile picture.",
        async execute(sock, message, args) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;

            if (argsText(args).toLowerCase() === "remove") {
                await sock.removeProfilePicture(jid(message));
                return text(sock, message, "_Group Profile Picture Removed_");
            }

            const ctx = message.message?.extendedTextMessage?.contextInfo;
            if (!ctx?.quotedMessage) {
                return text(sock, message, "_Reply to a photo_");
            }

            try {
                const quoted = {
                    key: {
                        remoteJid: jid(message),
                        id: ctx.stanzaId,
                        participant: ctx.participant
                    },
                    message: ctx.quotedMessage
                };

                const buffer = await downloadMediaMessage(
                    quoted, "buffer", {},
                    { logger: console, reuploadRequest: sock.updateMediaMessage }
                );

                await sock.updateProfilePicture(jid(message), buffer);
                return text(sock, message, "_Group Profile Picture Updated_");
            } catch (e) {
                return text(sock, message, `_Failed to update group picture: ${e.message || e}_`);
            }
        }
    },

    {
        name: "gadd",
        category: "GROUP",
        description: "Change who can add members.",
        async execute(sock, message, args) {
            const meta = await metadata(sock, message);
            if (!meta || !await botAdmin(sock, message, meta)) return;

            const mode = argsText(args).toLowerCase();
            if (!mode) {
                return text(sock, message,
                    "\n*Who can add members? 👥*\n\nReply with: gadd all or gadd admin");
            }

            if (mode === "all") {
                await sock.groupMemberAddMode(jid(message), "all_member_add");
                return text(sock, message, "*Everyone can add members now :)*");
            }

            if (["admin", "admins"].includes(mode)) {
                await sock.groupMemberAddMode(jid(message), "admin_add");
                return text(sock, message, "*Only admins can add members now !*");
            }

            return text(sock, message,
                "*Example:*\n_.memberadd all_ (everyone can add)\n_.memberadd admin_ (only admins can add)");
        }
    },

    {
        name: "vote",
        category: "GROUP",
        description: "Create a WhatsApp poll.",
        async execute(sock, message, args) {
            const value = argsText(args);

            if (!value) {
                return text(sock, message,
                    "*Hey, where's the vote text?* Use: _vote What's your favorite color?;Blue,Red_");
            }

            if (value.toLowerCase() === "result" || value.toLowerCase() === "get") {
                return text(sock, message,
                    "_Reply to a WhatsApp poll and use the poll's built-in results._");
            }

            if (value.toLowerCase() === "delete") {
                return text(sock, message,
                    "_*Reply to a vote message*_");
            }

            const split = value.split(";");
            if (split.length !== 2) {
                return text(sock, message,
                    "*The text is not in the correct format. Use* ```What's your favorite color?;Blue,Red```");
            }

            const question = split[0].trim();
            const options = split[1].split(",").map(x => x.trim()).filter(Boolean);

            if (!question || options.length < 2 || options.length > 12) {
                return text(sock, message,
                    "*The text is not in the correct format. Use* ```What's your favorite color?;Blue,Red```");
            }

            return sock.sendMessage(jid(message), {
                poll: {
                    name: question,
                    values: options,
                    selectableCount: 1
                }
            }, { quoted: message });
        }
    }
];
