import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { isOwnerMessage } from "../utils/identity.js";

const DATA_DIR = path.join(process.cwd(), "data");
const VAR_FILE = path.join(DATA_DIR, "variables.json");

async function readVariables() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
        const content = await fs.readFile(VAR_FILE, "utf8");
        const data = JSON.parse(content);

        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Invalid variables database.");
        }

        return data;
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
    }
}

async function saveVariables(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporaryFile = `${VAR_FILE}.tmp`;

    await fs.writeFile(
        temporaryFile,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    await fs.rename(temporaryFile, VAR_FILE);
}

function isOwner(sock, message) {
    return isOwnerMessage(sock, message, config.ownerNumber);
}

async function reply(sock, message, text) {
    await sock.sendMessage(
        message.key.remoteJid,
        { text },
        { quoted: message }
    );
}

function validKey(key) {
    return (
        /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(key) &&
        !["__proto__", "constructor", "prototype"].includes(key)
    );
}

export const ownerPlugins = [
    {
        name: "setvar",
        category: "OWNER",
        description: "Save a custom bot variable",

        async execute(sock, message, args) {
            if (!isOwner(sock, message)) {
                return reply(
                    sock,
                    message,
                    "This command is restricted to the bot owner."
                );
            }

            const key = args.shift();
            const value = args.join(" ");

            if (!key || !value) {
                return reply(
                    sock,
                    message,
                    "Usage: .setvar KEY VALUE\nExample: .setvar botname SPIDER-MD"
                );
            }

            if (!validKey(key)) {
                return reply(sock, message, "Invalid variable name.");
            }

            if (value.length > 1000) {
                return reply(
                    sock,
                    message,
                    "The value is too long. Maximum: 1000 characters."
                );
            }

            const variables = await readVariables();
            variables[key] = value;

            await saveVariables(variables);

            return reply(
                sock,
                message,
                `Variable "${key}" saved successfully.`
            );
        }
    },

    {
        name: "getvar",
        category: "OWNER",
        description: "Read a saved bot variable",

        async execute(sock, message, args) {
            if (!isOwner(sock, message)) {
                return reply(
                    sock,
                    message,
                    "This command is restricted to the bot owner."
                );
            }

            const key = args[0];

            if (!key || !validKey(key)) {
                return reply(sock, message, "Usage: .getvar KEY");
            }

            const variables = await readVariables();

            if (!Object.hasOwn(variables, key)) {
                return reply(
                    sock,
                    message,
                    `Variable "${key}" was not found.`
                );
            }

            return reply(
                sock,
                message,
                `${key} : ${String(variables[key])}`
            );
        }
    },

    {
        name: "delvar",
        category: "OWNER",
        description: "Delete a saved bot variable",

        async execute(sock, message, args) {
            if (!isOwner(sock, message)) {
                return reply(
                    sock,
                    message,
                    "This command is restricted to the bot owner."
                );
            }

            const key = args[0];

            if (!key || !validKey(key)) {
                return reply(sock, message, "Usage: .delvar KEY");
            }

            const variables = await readVariables();

            if (!Object.hasOwn(variables, key)) {
                return reply(
                    sock,
                    message,
                    `Variable "${key}" was not found.`
                );
            }

            delete variables[key];

            await saveVariables(variables);

            return reply(
                sock,
                message,
                `Variable "${key}" deleted successfully.`
            );
        }
    }
];
