
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";
import { handleMessage } from "./commandHandler.js";

const PAIRING_MODE = (
    process.env.PAIRING_MODE || "qr"
).toLowerCase();

const PAIRING_NUMBER = (
    process.env.PAIRING_NUMBER || ""
).replace(/\D/g, "");

async function startSpider() {
    const { state, saveCreds } =
        await useMultiFileAuthState("./session");

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && PAIRING_MODE === "qr") {
            console.log("\nScan this QR using WhatsApp Linked Devices:\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("SPIDER-MD connected successfully!");
        }

        if (connection === "close") {
            const statusCode =
                lastDisconnect?.error?.output?.statusCode;

            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("Reconnecting SPIDER-MD...");

                setTimeout(() => {
                    startSpider().catch(console.error);
                }, 3000);
            } else {
                console.log("WhatsApp session logged out.");
            }
        }
    });

    // Phone number pairing
    if (!state.creds.registered && PAIRING_MODE === "number") {
        if (!PAIRING_NUMBER) {
            throw new Error(
                "PAIRING_NUMBER is missing. Add your WhatsApp number with country code."
            );
        }

        if (PAIRING_NUMBER.length < 8 || PAIRING_NUMBER.length > 15) {
            throw new Error("Invalid PAIRING_NUMBER format.");
        }

        try {
            await new Promise(resolve => setTimeout(resolve, 1500));

            const code = await sock.requestPairingCode(PAIRING_NUMBER);

            console.log("\n================================");
            console.log("SPIDER-MD PAIRING CODE:", code);
            console.log("================================\n");
            console.log("Open WhatsApp > Linked Devices > Link with phone number.");
        } catch (error) {
            console.error("Pairing code generation failed:", error);
        }
    }

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const message of messages) {
            try {
                await handleMessage(sock, message);
            } catch (error) {
                console.error("Message error:", error);
            }
        }
    });
}

startSpider().catch((error) => {
    console.error("SPIDER-MD startup failed:", error);
    process.exitCode = 1;
});
