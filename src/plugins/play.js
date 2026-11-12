
const SEARCH_URL = "https://www.youtube.com/results?search_query=";
const AUDIO_API = "https://api-aswin-sparky.koyeb.app/api/downloader/song";

function extractText(message) {
    let content = message;

    for (let i = 0; i < 10 && content; i++) {
        const wrapped =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message ||
            content.documentWithCaptionMessage?.message;

        if (!wrapped) break;
        content = wrapped;
    }

    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.imageMessage?.caption ||
        content?.videoMessage?.caption ||
        content?.documentMessage?.caption ||
        ""
    ).trim();
}

function getQuotedText(message) {
    const content = message?.message || {};

    const context =
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo;

    return extractText(context?.quotedMessage);
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
                videoId: video.videoId,
                url: `https://www.youtube.com/watch?v=${video.videoId}`,
                duration:
                    video.lengthText?.simpleText || "Unknown",
                author:
                    video.ownerText?.runs?.[0]?.text || "Unknown"
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
        throw new Error(
            `YouTube search failed: HTTP ${response.status}`
        );
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
        throw new Error(
            `Audio service failed: HTTP ${response.status}`
        );
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

async function react(sock, message, emoji) {
    try {
        await sock.sendMessage(
            message.key.remoteJid,
            {
                react: {
                    text: emoji,
                    key: message.key
                }
            }
        );
    } catch {}
}

export const play = {
    name: "play",
    aliases: [],
    category: "DOWNLOAD",
    description: "Search and download a song as audio",

    async execute(sock, message, args) {
        const jid = message.key.remoteJid;

        let query = args.join(" ").trim();

        if (!query) {
            query = getQuotedText(message);
        }

        if (!query) {
            return sock.sendMessage(
                jid,
                { text: "Please provide a song name or reply to a message containing one." },
                { quoted: message }
            );
        }

        try {
            await react(sock, message, "🔎");

            const results = await searchYouTube(query);
            const selected = results[0];

            if (!selected?.url) {
                throw new Error("No playable search result was found.");
            }

            await react(sock, message, "⬇️");

            await sock.sendMessage(
                jid,
                {
                    text: `Downloading ${selected.title}`
                },
                { quoted: message }
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

            await react(sock, message, "✅");

        } catch (error) {
            console.error("[SPIDER-MD] Play error:", error);

            await react(sock, message, "❌");

            await sock.sendMessage(
                jid,
                {
                    text: `Play failed: ${error.message || "Unknown error"}`
                },
                { quoted: message }
            );
        }
    }
};
