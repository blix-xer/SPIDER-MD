import { config } from "../config.js";
import { isOwnerMessage } from "../utils/identity.js";

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

export const configPlugin = {
    name: "config",
    category: "SERVER",
    description: "View bot configuration",

    async execute(sock, message, args, context = {}) {
        if (
            !isOwnerMessage(
                sock,
                message,
                config.ownerNumber
            )
        ) {
            return;
        }

        const registeredPlugins = context.plugins || [];

        const uniquePlugins = new Set(
            registeredPlugins.map(plugin => plugin.name)
        );

        const output = [
            "╭━━━〔 SPIDER-MD CONFIG 〕━━━",
            "┃",
            `┃ Bot Name : ${config.botName}`,
            `┃ Owner    : ${config.ownerName}`,
            `┃ Prefix   : ${config.prefix}`,
            `┃ Mode     : ${config.mode}`,
            `┃ Platform : ${config.platform}`,
            `┃ Version  : ${config.version}`,
            "┃",
            `┃ Plugins  : ${uniquePlugins.size}`,
            `┃ Uptime   : ${formatDuration(process.uptime())}`,
            "┃",
            "╰━━━━━━━━━━━━━━━━━━━━━━"
        ].join("\n");

        return sock.sendMessage(
            message.key.remoteJid,
            { text: output },
            { quoted: message }
        );
    }
};
