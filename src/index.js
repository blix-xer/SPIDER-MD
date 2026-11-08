
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";
import { handleMessage } from "./commandHandler.js";

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

    if (qr) {
      console.log("Scan QR using WhatsApp Linked devices:");
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
        setTimeout(() => startSpider().catch(console.error), 3000);
      } else {
        console.log("WhatsApp session logged out.");
      }
    }
  });

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
