
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

        let output = `┌─[ SYSTEM IDENTITY ]
│
├─ OWNER    : ${config.ownerName}
├─ USER     : ${user}
├─ VERSION  : ${config.version}
├─ PLATFORM : ${config.platform}
├─ MODE     : ${config.mode.toUpperCase()}
├─ STATUS   : ONLINE
│
└─[ SPIDER NETWORK ACTIVE ]
`;

        for (const category of categories) {
            const categoryCommands = commands.filter(
                plugin => plugin.category === category
            );

            if (categoryCommands.length === 0) continue;

            output += `╭─〔 ${category} COMMANDS 〕\n`;

            for (const plugin of categoryCommands) {
                output += `│\n├─ .${plugin.name}\n`;
            }

            output += "╰────────────────────\n";
        }

        output += `\n[SPIDER-MD/${config.ownerName}]`;

        await sock.sendMessage(
            message.key.remoteJid,
            { text: output },
            { quoted: message }
        );
    }
};
