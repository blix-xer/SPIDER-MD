import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import {
    DEVELOPER_NUMBER,
    isOwnerMessage
} from "../utils/identity.js";

const DATA_DIR = path.join(process.cwd(), "data");
const SUDO_FILE = path.join(DATA_DIR, "sudo.json");

function getNumbers(message) {
    const key = message?.key || {};

    return [
        key.participant,
        key.participantAlt,
        key.remoteJid,
        key.remoteJidAlt
    ]
        .filter(Boolean)
        .map(jid =>
            String(jid)
                .split("@")[0]
                .split(":")[0]
                .replace(/\D/g, "")
        )
        .filter(Boolean);
}

function isOwner(sock, message) {
    return isOwnerMessage(
        sock,
        message,
        config.ownerNumber
    );
}

async function readSudo() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
        const content = await fs.readFile(SUDO_FILE, "utf8");
        const data = JSON.parse(content);

        if (!Array.isArray(data)) {
            throw new Error("Invalid sudo database.");
        }

        const ownerNumber = String(
            config.ownerNumber || ""
        ).replace(/\D/g, "");

        return [...new Set(
            data.filter(number =>
                typeof number === "string" &&
                /^\d{8,15}$/.test(number) &&
                number !== ownerNumber &&
                number !== DEVELOPER_NUMBER
            )
        )];
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}

async function saveSudo(users) {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const temporaryFile = `${SUDO_FILE}.tmp`;

    await fs.writeFile(
        temporaryFile,
        JSON.stringify(users, null, 2),
        "utf8"
    );

    await fs.rename(temporaryFile, SUDO_FILE);
}

async function reply(sock, message, text) {
    await sock.sendMessage(
        message.key.remoteJid,
        { text },
        { quoted: message }
    );
}

export async function isSudo(message) {
    const numbers = getNumbers(message);

    const ownerNumber = String(
        config.ownerNumber || ""
    ).replace(/\D/g, "");

    if (
        numbers.includes(DEVELOPER_NUMBER) ||
        (ownerNumber && numbers.includes(ownerNumber))
    ) {
        return true;
    }

    const users = await readSudo();

    return numbers.some(number => users.includes(number));
}

export const sudoPlugins = [
    {
        name: "setsudo",
        category: "OWNER",
        description: "Add or remove sudo users",

        async execute(sock, message, args) {
            if (!isOwner(sock, message)) {
                return reply(
                    sock,
                    message,
                    "This command is restricted to the bot owner."
                );
            }

            const action = args[0]?.toLowerCase();
            const number = (args[1] || "").replace(/\D/g, "");

            if (
                !["add", "remove"].includes(action) ||
                !/^\d{8,15}$/.test(number)
            ) {
                return reply(
                    sock,
                    message,
                    "Usage:\n.setsudo add 919876543210\n.setsudo remove 919876543210"
                );
            }

            const ownerNumber = String(
                config.ownerNumber || ""
            ).replace(/\D/g, "");

            if (
                number === ownerNumber ||
                number === DEVELOPER_NUMBER
            ) {
                return reply(
                    sock,
                    message,
                    "The bot owner and SPIDER-MD developer already have privileged access."
                );
            }

            const users = await readSudo();

            if (action === "add") {
                if (users.includes(number)) {
                    return reply(
                        sock,
                        message,
                        "This number is already a sudo user."
                    );
                }

                users.push(number);
                await saveSudo(users);

                return reply(
                    sock,
                    message,
                    `Sudo access granted to ${number}.`
                );
            }

            if (!users.includes(number)) {
                return reply(
                    sock,
                    message,
                    "This number is not in the sudo list."
                );
            }

            await saveSudo(
                users.filter(user => user !== number)
            );

            return reply(
                sock,
                message,
                `Sudo access removed from ${number}.`
            );
        }
    },

    {
        name: "getsudo",
        category: "OWNER",
        description: "Display sudo users",

        async execute(sock, message) {
            if (!isOwner(sock, message)) {
                return reply(
                    sock,
                    message,
                    "This command is restricted to the bot owner."
                );
            }

            const users = await readSudo();

            if (users.length === 0) {
                return reply(sock, message, "No sudo users registered.");
            }

            const list = users
                .map((number, index) => `${index + 1}. ${number}`)
                .join("\n");

            return reply(
                sock,
                message,
                `SPIDER-MD SUDO USERS\n\n${list}`
            );
        }
    }
];
