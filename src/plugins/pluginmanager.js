import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";
import { isOwnerMessage } from "../utils/identity.js";

const DATA_DIR = path.join(process.cwd(), "data");
const REGISTRY_FILE = path.join(
    DATA_DIR,
    "external-plugins.json"
);

async function readRegistry() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
        const content = await fs.readFile(
            REGISTRY_FILE,
            "utf8"
        );

        const data = JSON.parse(content);

        if (!Array.isArray(data)) {
            throw new Error(
                "External plugin registry must be an array."
            );
        }

        return data.filter(
            name =>
                typeof name === "string" &&
                /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(name)
        );
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }

        throw error;
    }
}

async function saveRegistry(plugins) {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporaryFile = `${REGISTRY_FILE}.tmp`;

    await fs.writeFile(
        temporaryFile,
        JSON.stringify(plugins, null, 2),
        "utf8"
    );

    await fs.rename(temporaryFile, REGISTRY_FILE);
}

function isOwner(sock, message) {
    return isOwnerMessage(
        sock,
        message,
        config.ownerNumber
    );
}

async function reply(sock, message, text) {
    await sock.sendMessage(
        message.key.remoteJid,
        { text },
        { quoted: message }
    );
}

const validPluginName = name =>
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(name);

export const pluginManagerPlugins = [
    {
        name: "plugin",
        category: "OWNER",
        description: "Register an external plugin",

        async execute(sock, message, args) {
            if (!isOwner(sock, message)) {
                return reply(
                    sock,
                    message,
                    "This command is restricted to the bot owner."
                );
            }

            const action = (
                args.shift() || ""
            ).toLowerCase();

            if (action !== "add") {
                return reply(
                    sock,
                    message,
                    "Usage: .plugin add <name>\nExample: .plugin add weather"
                );
            }

            const name = args[0];

            if (!name || !validPluginName(name)) {
                return reply(
                    sock,
                    message,
                    "Invalid plugin name.\nUse letters, numbers, _ or - (maximum 40 characters)."
                );
            }

            const registered = await readRegistry();

            if (
                registered.some(
                    item =>
                        item.toLowerCase() === name.toLowerCase()
                )
            ) {
                return reply(
                    sock,
                    message,
                    `Plugin "${name}" is already registered.`
                );
            }

            registered.push(name);

            await saveRegistry(registered);

            return reply(
                sock,
                message,
                `External plugin "${name}" registered successfully.\n\nNote: Registration is saved only. Plugin execution will be added later.`
            );
        }
    },

    {
        name: "plugins",
        category: "OWNER",
        description: "List registered external plugins",

        async execute(sock, message) {
            if (!isOwner(sock, message)) {
                return reply(
                    sock,
                    message,
                    "This command is restricted to the bot owner."
                );
            }

            const registered = await readRegistry();

            if (registered.length === 0) {
                return reply(
                    sock,
                    message,
                    "╭━━〔 EXTERNAL PLUGINS 〕━━╮\n┃\n┃ No external plugins added yet.\n┃\n╰━━━━━━━━━━━━━━━━━━━━╯"
                );
            }

            let output =
                "╭━━〔 EXTERNAL PLUGINS 〕━━╮\n";

            output += `┃ Total: ${registered.length}\n`;
            output += "┃\n";

            registered.forEach((name, index) => {
                output += `┃ ${index + 1}. ${name}\n`;
            });

            output += "┃\n";
            output += "╰━━━━━━━━━━━━━━━━━━━━╯";

            return reply(sock, message, output);
        }
    }
];
