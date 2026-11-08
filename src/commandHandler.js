
import { ping } from "./plugins/ping.js";
import { config } from "./config.js";

const plugins = {
    ping
};

export async function handleMessage(sock, message) {
    if (!message.message || message.key.fromMe) return;

    const jid = message.key.remoteJid;

    const text =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        "";

    if (!text.startsWith(config.prefix)) return;

    const args = text.slice(config.prefix.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    const plugin = plugins[command];

    if (!plugin) return;

    try {
        await plugin.execute(sock, message, args);
    } catch (error) {
        console.error("Plugin error:", error);
        await sock.sendMessage(jid, {
            text: "An error occurred while executing the command."
        });
    }
}
