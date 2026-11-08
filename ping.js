export default {
  name: "ping",
  aliases: ["p"],
  description: "Check whether SPIDER-MD is responding.",
  async execute({ sock, message }) {
    await sock.sendMessage(
      message.key.remoteJid,
      { text: "🕷️ SPIDER-MD is online!" },
      { quoted: message }
    );
  }
};
