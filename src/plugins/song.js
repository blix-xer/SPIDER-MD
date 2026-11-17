const SEARCH_URL = "https://www.youtube.com/results?search_query=";
const AUDIO_API = "https://api-aswin-sparky.koyeb.app/api/downloader/song";

function unwrap(content) {
    let current = content;

    for (let i = 0; i < 10 && current; i++) {
        const wrapped =
            current.ephemeralMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.viewOnceMessageV2Extension?.message ||
            current.documentWithCaptionMessage?.message;

        if (!wrapped) break;
        current = wrapped;
    }

    return current || {};
}

function getQuotedText(message) {
    const content = unwrap(message?.message);

    const context =
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo;

    const quoted = unwrap(context?.quotedMessage);

    return (
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        quoted.documentMessage?.caption ||
        ""
    ).trim();
}

function isYouTubeUrl(value) {
    try {
        const url = new URL(value);

        return [
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "music.youtube.com",
            "youtu.be",
            "www.youtu.be"
        ].includes(url.hostname);
    } catch {
        return false;
    }
}

function findVideoRenderers(data, results = []) {
    if (!data || typeof data !== "object") return results;

    if (data.videoRenderer) {
        const video = data.videoRenderer;

        const title =
            video.title?.runs?.map(item => item.text).join("") ||
            video.title?.simpleText ||
            "";

        if (video.videoId && title) {
            results.push({
                title,
                url: `https://www.youtube.com/watch?v=${video.videoId}`
            });
        }
    }

    for (const value of Object.values(data)) {
        if (value && typeof value === "object") {
            findVideoRenderers(value, results);
        }
    }

    return results;
}

function extractInitialData(html) {
    const marker = "var ytInitialData =";
    const start = html.indexOf(marker);

    if (start === -1) {
        throw new Error("YouTube search data was not found.");
    }

    const jsonStart = html.indexOf("{", start);

    if (jsonStart === -1) {
        throw new Error("Invalid YouTube search response.");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = jsonStart; i < html.length; i++) {
        const char = html[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === "{") {
            depth++;
        } else if (char === "}") {
            depth--;

            if (depth === 0) {
                return JSON.parse(html.slice(jsonStart, i + 1));
            }
        }
    }

    throw new Error("Could not parse YouTube search data.");
}

async function searchYouTube(query) {
    const response = await fetch(
        SEARCH_URL + encodeURIComponent(query),
        {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
            },
            signal: AbortSignal.timeout(25000)
        }
    );

    if (!response.ok) {
        throw new Error(`YouTube search failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    const data = extractInitialData(html);
    const results = findVideoRenderers(data);

    if (!results.length) {
        throw new Error("No YouTube results found.");
    }

    return results;
}

async function getAudioUrl(videoUrl) {
    const endpoint = new URL(AUDIO_API);
    endpoint.searchParams.set("search", videoUrl);

    const response = await fetch(endpoint, {
        headers: {
            "User-Agent": "Mozilla/5.0"
        },
        signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
        throw new Error(`Audio service failed: HTTP ${response.status}`);
    }

    const result = await response.json();
    const audioUrl = result?.data?.url;

    if (
        typeof audioUrl !== "string" ||
        !/^https?:\/\//i.test(audioUrl)
    ) {
        throw new Error(
            result?.message ||
            result?.error ||
            "Audio URL was not returned by the download service."
        );
    }

    return audioUrl;
}

function getFriendlyError(error) {
    const message = String(error?.message || "Unknown error.");

    if (/sign in to confirm|not a bot|visitor data|cookies-from-browser/i.test(message)) {
        return "YouTube is requesting bot verification for this connection. Please try again later.";
    }

    if (/HTTP Error 429|Too Many Requests/i.test(message)) {
        return "YouTube temporarily rate-limited this connection. Please try again later.";
    }

    if (/private video|members.only|age.restricted/i.test(message)) {
        return "This video is private, members-only, or age-restricted.";
    }

    if (/timed out/i.test(message)) {
        return "The download took too long. Please try again later.";
    }

    return message.slice(0, 1200);
}

async function sendReply(sock, jid, message, text) {
    return sock.sendMessage(
        jid,
        { text },
        { quoted: message }
    );
}

export const song = {
    name: "song",
    aliases: ["yta"],
    category: "DOWNLOAD",
    description: "YouTube audio downloader",

    async execute(sock, message, args) {
        const jid = message?.key?.remoteJid;
        if (!jid) return;

        const query = args.join(" ").trim() || getQuotedText(message);

        if (!query) {
            return sendReply(
                sock,
                jid,
                message,
                "_Give a YouTube video *Url* or *Query*_"
            );
        }

        try {
            let selected;

            if (isYouTubeUrl(query)) {
                selected = {
                    url: query,
                    title: query
                };
            } else {
                const results = await searchYouTube(query);
                selected = results[0];
            }

            if (!selected?.url) {
                throw new Error("No matching YouTube song was found.");
            }

            await sendReply(
                sock,
                jid,
                message,
                `_*downloading ${selected.title}*_`
            );

            const audioUrl = await getAudioUrl(selected.url);

            await sock.sendMessage(
                jid,
                {
                    audio: { url: audioUrl },
                    mimetype: "audio/mpeg",
                    ptt: false
                },
                { quoted: message }
            );

            console.log(
                `[SPIDER-MD] Song sent: ${selected.title}`
            );

        } catch (error) {
            console.error("[SPIDER-MD] Song error:", error);

            await sendReply(
                sock,
                jid,
                message,
                `❌ *SONG DOWNLOAD FAILED*\n\n${getFriendlyError(error)}`
            );
        }
    }
};
