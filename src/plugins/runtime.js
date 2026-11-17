import os from "node:os";

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    const parts = [];

    if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);

    parts.push(
        `${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`
    );

    return parts.join(", ");
}

function getJarvisUptime() {
    const duration = process.uptime();

    const seconds = Math.floor(duration % 60);
    const minutes = Math.floor((duration / 60) % 60);
    const hours = Math.floor((duration / 3600) % 24);

    return (
        `_*Uptime: ${String(hours).padStart(2, "0")} hours ` +
        `${String(minutes).padStart(2, "0")} minutes ` +
        `${String(seconds).padStart(2, "0")} seconds*_`
    );
}

function getSystemRuntime() {
    const systemUptime = formatDuration(os.uptime());
    const processRuntime = formatDuration(process.uptime());

    return (
        "╭━━〔 SPIDER-MD RUNTIME 〕━━╮\n" +
        "┃\n" +
        `┃ SYSTEM : ${systemUptime}\n` +
        "┃\n" +
        `┃ PROCESS : ${processRuntime}\n` +
        "┃\n" +
        "╰━━━━━━━━━━━━━━━━━━━━━━╯"
    );
}

async function sendReply(sock, message, text) {
    const jid = message?.key?.remoteJid;

    if (!jid) {
        throw new Error("Message chat JID is missing.");
    }

    return sock.sendMessage(
        jid,
        { text },
        { quoted: message }
    );
}

export const uptimePlugin = {
    name: "uptime",
    category: "SERVER",
    description: "Show how long SPIDER-MD has been running",

    async execute(sock, message) {
        const uptime = getJarvisUptime();

        return sendReply(sock, message, uptime);
    }
};

export const runtimePlugin = {
    name: "runtime",
    category: "SERVER",
    description: "Show system and bot process runtime",

    async execute(sock, message) {
        const runtime = getSystemRuntime();

        return sendReply(sock, message, runtime);
    }
};
