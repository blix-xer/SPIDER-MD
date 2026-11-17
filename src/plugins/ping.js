
export const ping = {
    name: "ping",
    aliases: ["p"],
    category: "GENERAL",
    description: "Check bot response speed",

    async execute(sock, message) {
        const jid = message.key.remoteJid;
        const start = Date.now();

        try {
            const sent = await sock.sendMessage(
                jid,
                { text: "Checking latency..." },
                { quoted: message }
            );

            const latency = Date.now() - start;

            await sock.sendMessage(jid, {
                text: `𝘚𝘗𝘌𝘌𝘋 ${latency} ms`,
                edit: sent.key
            });

        } catch (error) {
            console.error("[SPIDER-MD] Ping error:", error);

            await sock.sendMessage(jid, {
                text: "PING FAILED"
            });
        }
    }
};
