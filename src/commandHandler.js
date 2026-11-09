
import { ping } from "./plugins/ping.js";
import { menu } from "./plugins/menu.js";

const pluginList = [
    ping,
    menu
];

const plugins = new Map();

for (const plugin of pluginList) {
    const names = [
        plugin.name,
        ...(plugin.aliases || [])
    ];

    for (const name of names) {
        plugins.set(name.toLowerCase(), plugin);
    }
}

export async function handleMessage(sock, message) {
    if (!message.message || message.key.fromMe) return;

    const jid = message.key.remoteJid;

    const text =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        "";

    if (!text.startsWith(".")) return;

    const args = text
        .slice(1)
        .trim()
        .split(/\s+/);

    const command = args.shift()?.toLowerCase();

    if (!command) return;

    const plugin = plugins.get(command);

    if (!plugin) return;

    try {
        await plugin.execute(
            sock,
            message,
            args,
            { plugins: pluginList }
        );
    } catch (error) {
        console.error("Plugin error:", error);

        await sock.sendMessage(jid, {
            text: "An error occurred while executing this command."
        });
    }
}
