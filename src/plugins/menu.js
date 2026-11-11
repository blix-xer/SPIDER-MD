
import { config } from "../config.js";

export const menu = {
    name: "menu",
    aliases: ["help"],
    category: "GENERAL",
    description: "Display the SPIDER-MD command menu",

    async execute(sock, message, args, context = {}) {
        const user = message.pushName || "BLIX";
        const commands = context.plugins || [];

        const categories = [
            "OWNER",
            "AI",
            "GROUP",
            "DOWNLOAD",
            "MEDIA",
            "GENERAL"
        ];

        const mode = String(config.mode || "private").toUpperCase();

        let output = `*╭━━━〔 SPIDER-MD 〕━━━╮*
*┃ ⬢ SYSTEM IDENTITY*
┃
┃  ⬡ *OWNER*    : ${config.ownerName}
┃  ⬡ *USER*     : ${user}
┃  ⬡ *VERSION*  : ${config.version}
┃  ⬡ *PLATFORM* : ${config.platform}
┃  ⬡ *MODE*     : ${mode}
┃  ⬡ *STATUS*   : ONLINE
┃
*╰━━━〔 SPIDER NETWORK ACTIVE 〕━━━╯*
`;

        for (const category of categories) {
            const categoryCommands = commands.filter(
                plugin => String(plugin.category || "").toUpperCase() === category
            );

            if (categoryCommands.length === 0) continue;

            output += `\n*╭━━〔 ${category} 〕━━╮*\n`;

            for (const plugin of categoryCommands) {
                output += `┃ ⬢ .${plugin.name}\n`;
            }

            output += "*╰━━━━━━━━━━━━━━━━╯*\n";
        }

        output += `\n_Developed for SPIDER-MD • ${config.ownerName}_`;

        await sock.sendMessage(
            message.key.remoteJid,
            { text: output },
            { quoted: message }
        );
    }
};
