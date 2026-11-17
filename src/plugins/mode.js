import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";
import { isOwnerMessage } from "../utils/identity.js";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "variables.json");

async function readVariables() {
    try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const data = JSON.parse(raw);

        return data && typeof data === "object" && !Array.isArray(data)
            ? data
            : {};
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
    }
}

async function saveVariables(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporary = `${DATA_FILE}.tmp`;

    await fs.writeFile(
        temporary,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    await fs.rename(temporary, DATA_FILE);
}

function getCurrentMode(data) {
    const mode = String(data.mode ?? config.mode ?? "private").toLowerCase();

    return mode === "public" ? "public" : "private";
}

export const modePlugin = {
    name: "mode",
    category: "SERVER",
    description: "Change bot private or public mode",

    async execute(sock, message, args) {
        if (!isOwnerMessage(sock, message, config.ownerNumber)) {
            return;
        }

        const jid = message.key.remoteJid;
        const data = await readVariables();
        const requestedMode = String(args[0] || "").toLowerCase();

        if (!requestedMode) {
            const currentMode = getCurrentMode(data);

            return sock.sendMessage(
                jid,
                {
                    text:
                        "╭━━━〔 SPIDER-MD MODE 〕━━━\n" +
                        "┃\n" +
                        `┃ Current Mode : ${currentMode.toUpperCase()}\n` +
                        "┃\n" +
                        "┃ .mode private\n" +
                        "┃ .mode public\n" +
                        "┃\n" +
                        "╰━━━━━━━━━━━━━━━━━━━━"
                },
                { quoted: message }
            );
        }

        if (!["private", "public"].includes(requestedMode)) {
            return sock.sendMessage(
                jid,
                {
                    text: "Invalid mode.\n\nUse:\n.mode private\n.mode public"
                },
                { quoted: message }
            );
        }

        data.mode = requestedMode;
        await saveVariables(data);

        return sock.sendMessage(
            jid,
            {
                text:
                    `SPIDER-MD mode changed successfully.\n\n` +
                    `New Mode : ${requestedMode.toUpperCase()}`
            },
            { quoted: message }
        );
    }
};
