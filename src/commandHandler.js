
import { config } from "./config.js";

import { ping } from "./plugins/ping.js";
import { alive } from "./plugins/alive.js";

const plugins = [
    ping,
    alive
];

function getMessageText(message) {
    let content = message.message;

    while (content) {
        const next =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message;

        if (!next) break;
        content = next;
    }

    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.imageMessage?.caption ||
        content?.videoMessage?.caption ||
        content?.documentMessage?.caption ||
        ""
    );
}

export async function handleMessage(sock, message) {
    if (!message?.message || message.key?.fromMe) return;

    const text = getMessageText(message).trim();

    if (!text.startsWith(config.prefix)) return;

    const body = text.slice(config.prefix.length).trim();
    const match = body.match(/^(\S+)(?:\s+([\s\S]*))?$/);

    if (!match) return;

    const command = match[1].toLowerCase();
    const rawArgs = match[2] || "";

    const plugin = plugins.find(item =>
        item.name === command ||
        (item.aliases || []).includes(command)
    );

    if (!plugin) return;

    const args = rawArgs.trim()
        ? rawArgs.trim().split(/\s+/)
        : [];

    if (["setalive", "getalive", "resetalive"].includes(command)) {
        args.unshift(command);
    }

    try {
        await plugin.execute(sock, message, args, {
            plugins,
            rawArgs,
            commandName: command
        });
    } catch (error) {
        console.error(`[SPIDER-MD] ${command} error:`, error);

        await sock.sendMessage(
            message.key.remoteJid,
            {
                text: `⚠️ *${command.toUpperCase()} ERROR*\n\n_Unable to complete this command. Check the server logs._`
            },
            { quoted: message }
        );
    }
}
