export const ping = {
    name: "ping",
    aliases: ["p"],
    description: "Check bot response speed",

    async execute(sock, message) {
        const start = Date.now();

        await sock.sendMessage(
            message.key.remoteJid,
            {
                text: `🏓 SPIDER-MD is online!\n\n⚡ Speed: ${Date.now() - start} ms`
            },
            { quoted: message }
        );
    }
};
