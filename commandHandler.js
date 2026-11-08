import { config } from "../config.js";
import { plugins } from "../plugins/index.js";

function getMessageText(message) {
  const content = message.message;
  if (!content) return "";

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ""
  ).trim();
}

export async function handleMessage(sock, message) {
  if (!message?.message || message.key?.fromMe) return;

  const text = getMessageText(message);
  if (!text.startsWith(config.prefix)) return;

  const withoutPrefix = text.slice(config.prefix.length).trim();
  if (!withoutPrefix) return;

  const [commandName, ...args] = withoutPrefix.split(/\s+/);
  const command = plugins.find((plugin) =>
    plugin.name === commandName.toLowerCase() ||
    plugin.aliases?.includes(commandName.toLowerCase())
  );

  if (!command) return;

  await command.execute({
    sock,
    message,
    args,
    text,
    commandName: command.name
  });
}
