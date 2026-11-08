
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import qrcode from "qrcode-terminal";
import { handleMessage } from "./handlers/commandHandler.js";

async function startSpider() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR using WhatsApp > Linked devices:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("SPIDER-MD connected successfully.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      console.log("WhatsApp connection closed.", {
        statusCode,
        reconnecting: shouldReconnect
      });

      if (shouldReconnect) {
        setTimeout(() => {
          startSpider().catch(console.error);
        }, 3000);
      } else {
        console.log(
          "Session logged out. Remove the session folder only if you intend to pair again."
        );
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const message of messages) {
      try {
        await handleMessage(sock, message);
      } catch (error) {
        console.error("Message handler error:", error);
      }
    }
  });
}

startSpider().catch((error) => {
  console.error("SPIDER-MD startup failed:", error);
  process.exitCode = 1;
});
