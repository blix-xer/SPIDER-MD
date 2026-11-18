const TTS_URL =
    "https://translate.google.com/translate_tts";

const SUPPORTED_LANGUAGES = new Set([
    "en", "hi", "ml", "ta", "te", "kn",
    "bn", "mr", "gu", "pa", "ur",
    "es", "fr", "de", "it", "pt",
    "ru", "ja", "ko", "zh-CN", "ar"
]);

export const tts = {
    name: "tts",
    aliases: [],
    category: "TOOLS",
    description: "Convert text into spoken audio",

    async execute(sock, message, args) {
        const jid = message.key.remoteJid;

        if (!args.length) {
            await sock.sendMessage(
                jid,
                {
                    text:
                        "❌ *TTS TEXT REQUIRED*\n\n" +
                        "Example:\n" +
                        ".tts Hello bro\n" +
                        ".tts en Hello bro\n" +
                        ".tts hi Namaste\n" +
                        ".tts ml സുഖമാണോ?\n" +
                        ".tts ta Vanakkam"
                },
                { quoted: message }
            );
            return;
        }

        let language = "en";
        let text = args.join(" ");

        const firstArg = args[0];

        if (SUPPORTED_LANGUAGES.has(firstArg)) {
            language = firstArg;
            text = args.slice(1).join(" ");
        } else if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(firstArg)) {
            await sock.sendMessage(
                jid,
                {
                    text:
                        `❌ Unsupported language code: ${firstArg}\n\n` +
                        "Supported codes:\n" +
                        "en, hi, ml, ta, te, kn, bn, mr, gu, pa, ur, " +
                        "es, fr, de, it, pt, ru, ja, ko, zh-CN, ar"
                },
                { quoted: message }
            );
            return;
        }

        if (!text.trim()) {
            await sock.sendMessage(
                jid,
                {
                    text: "❌ Please enter the text to convert."
                },
                { quoted: message }
            );
            return;
        }

        if (text.length > 200) {
            await sock.sendMessage(
                jid,
                {
                    text:
                        "❌ Text is too long.\n\n" +
                        "Please keep each TTS message under 200 characters."
                },
                { quoted: message }
            );
            return;
        }

        try {
            const url = new URL(TTS_URL);

            url.search = new URLSearchParams({
                ie: "UTF-8",
                client: "tw-ob",
                tl: language,
                q: text
            }).toString();

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
                },
                signal: AbortSignal.timeout(25000)
            });

            if (!response.ok) {
                throw new Error(
                    `TTS service returned HTTP ${response.status}`
                );
            }

            const contentType =
                response.headers.get("content-type") || "";

            if (!contentType.toLowerCase().includes("audio")) {
                throw new Error("TTS service did not return audio.");
            }

            const audio = Buffer.from(
                await response.arrayBuffer()
            );

            if (!audio.length) {
                throw new Error("Empty audio response.");
            }

            await sock.sendMessage(
                jid,
                {
                    audio,
                    mimetype: "audio/mpeg",
                    ptt: false
                },
                { quoted: message }
            );

        } catch (error) {
            console.error(
                "[SPIDER-MD TTS] Error:",
                error.message
            );

            await sock.sendMessage(
                jid,
                {
                    text:
                        "❌ *TTS CONVERSION FAILED*\n\n" +
                        "The speech service may be temporarily unavailable. " +
                        "Please try again later."
                },
                { quoted: message }
            );
        }
    }
};
