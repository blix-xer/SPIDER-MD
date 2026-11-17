import { SPIDER_API_URL, SPIDER_API_KEY } from "../spiderApiConfig.js";


const pendingSelections = new Map();

const SPARKY_API =
    "https://api-aswin-sparky.koyeb.app/api/downloader";

const SELECTION_TIMEOUT = 5 * 60 * 1000;

function getInput(args, message) {
    if (Array.isArray(args) && args.length) {
        return args.join(" ").trim();
    }

    const content = message?.message || {};

    return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        ""
    ).replace(/^\.spotify\s*/i, "").trim();
}

function isSpotifyUrl(value) {
    try {
        const url = new URL(value);

        return (
            ["open.spotify.com", "spotify.link"].includes(
                url.hostname.toLowerCase()
            ) &&
            ["https:", "http:"].includes(url.protocol)
        );
    } catch {
        return false;
    }
}

function decodeHtml(value) {
    return String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function getMeta(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
        new RegExp(
            `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
            "i"
        )
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);

        if (match) {
            return decodeHtml(match[1]);
        }
    }

    return "";
}

function upgradeSpotifyArtwork(url) {
    if (!url) return "";

    try {
        const parsed = new URL(url);

        if (parsed.hostname.includes("scdn.co")) {
            parsed.searchParams.set("width", "1200");
            parsed.searchParams.set("height", "1200");
        }

        return parsed.toString();
    } catch {
        return url;
    }
}

async function getSpotifyInfo(url) {
    const response = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
    );

    if (!response.ok) {
        throw new Error("Couldn't fetch Spotify information.");
    }

    const data = await response.json();

    let html = "";

    try {
        const page = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "en",
                "Accept": "text/html"
            }
        });

        if (page.ok) {
            html = await page.text();
        }
    } catch (error) {
        console.log("[SPOTIFY METADATA]", error.message);
    }

    const title =
        getMeta(html, "og:title") ||
        data.title ||
        "";

    const description =
        getMeta(html, "og:description") ||
        "";

    const thumbnail =
        getMeta(html, "og:image") ||
        data.thumbnail_url ||
        "";

    return {
        title,
        description,
        artwork: upgradeSpotifyArtwork(thumbnail)
    };
}

function getText(value) {
    if (!value) return "";

    if (typeof value === "string") return value;

    if (value.simpleText) return value.simpleText;

    if (Array.isArray(value.runs)) {
        return value.runs.map(item => item.text || "").join("");
    }

    return "";
}

function extractJson(html, marker) {
    const markerIndex = html.indexOf(marker);

    if (markerIndex === -1) return null;

    const start = html.indexOf("{", markerIndex);

    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < html.length; i++) {
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
                return JSON.parse(html.slice(start, i + 1));
            }
        }
    }

    return null;
}

function searchRenderers(data, results = []) {
    if (!data || typeof data !== "object") {
        return results;
    }

    if (Array.isArray(data)) {
        for (const item of data) {
            searchRenderers(item, results);
        }

        return results;
    }

    if (data.videoRenderer?.videoId) {
        const video = data.videoRenderer;
        const thumbnails = video.thumbnail?.thumbnails || [];

        results.push({
            title: getText(video.title),
            videoId: video.videoId,
            url: `https://www.youtube.com/watch?v=${video.videoId}`,
            artwork: thumbnails.at(-1)?.url || "",
            author: getText(video.ownerText),
            duration: getText(video.lengthText),
            publishedTime: getText(video.publishedTimeText)
        });
    }

    for (const value of Object.values(data)) {
        searchRenderers(value, results);
    }

    return results;
}

async function searchYouTube(query) {
    const url =
        "https://www.youtube.com/results?search_query=" +
        encodeURIComponent(query);

    const response = await fetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
        }
    });

    if (!response.ok) {
        throw new Error("YouTube search is unavailable.");
    }

    const html = await response.text();

    const data =
        extractJson(html, "var ytInitialData =") ||
        extractJson(html, "ytInitialData =");

    if (!data) {
        throw new Error("Couldn't read YouTube search results.");
    }

    return searchRenderers(data);
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function scoreResult(result, query) {
    const requested = normalizeText(query);
    const title = normalizeText(result.title);

    if (!requested || !title) return 0;

    if (title === requested) return 100;

    const words = requested.split(/\s+/).filter(Boolean);

    let matched = 0;

    for (const word of words) {
        if (title.includes(word)) matched++;
    }

    return Math.round((matched / words.length) * 100);
}

function rankResults(results, query) {
    return results
        .map(result => ({
            ...result,
            matchScore: scoreResult(result, query)
        }))
        .sort((a, b) => b.matchScore - a.matchScore);
}

function selectBestResult(results, query) {
    return rankResults(results, query)[0] || null;
}

async function getApiResult(url) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(200000)
    });

    const body = await response.text();

    let result;

    try {
        result = JSON.parse(body);
    } catch {
        throw new Error(
            `Aswin Sparky returned invalid JSON (HTTP ${response.status}): ${body.slice(0, 1000)}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `Aswin Sparky HTTP ${response.status}: ${body.slice(0, 1000)}`
        );
    }

    const downloadUrl = result?.data?.url;

    if (
        typeof downloadUrl !== "string" ||
        !/^https?:\/\//i.test(downloadUrl)
    ) {
        console.error(
            "[SPOTIFY API RESPONSE]",
            JSON.stringify(result).slice(0, 1500)
        );

        throw new Error(
            `Download URL missing. API response: ${JSON.stringify(result).slice(0, 1000)}`
        );
    }

    return downloadUrl;
}

async function getAudioUrl(query) {
    const url =
        `${SPARKY_API}/song?search=${encodeURIComponent(query)}`;

    return getApiResult(url);
}

async function getVideoBuffer(videoUrl) {
    if (!SPIDER_API_KEY) {
        throw new Error("SPIDER-API key is missing from the shared configuration.");
    }

    const url =
        `${SPIDER_API_URL}/api/youtube/video?url=${encodeURIComponent(videoUrl)}`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "x-api-key": SPIDER_API_KEY,
            "Accept": "video/mp4"
        },
        signal: AbortSignal.timeout(200000)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `SPIDER-API HTTP ${response.status}: ${body.slice(0, 1000)}`
        );
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    const maxSize = 64 * 1024 * 1024;

    if (contentLength > maxSize) {
        throw new Error("Video exceeds the 64 MB WhatsApp sending limit.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
        throw new Error("SPIDER-API returned an empty video.");
    }

    if (buffer.length > maxSize) {
        throw new Error("Video exceeds the 64 MB WhatsApp sending limit.");
    }

    return buffer;
}

async function editStatus(sock, jid, key, text) {
    if (!key) return;

    return sock.sendMessage(
        jid,
        { text },
        { edit: key }
    );
}

function getSender(message) {
    return (
        message?.key?.participant ||
        message?.key?.remoteJid ||
        ""
    );
}

function getContextInfo(message) {
    let content = message?.message;

    if (!content) return null;

    for (let i = 0; i < 10; i++) {
        const wrapped =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message ||
            content.viewOnceMessageV2Extension?.message ||
            content.documentWithCaptionMessage?.message;

        if (!wrapped) break;

        content = wrapped;
    }

    return (
        content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.documentMessage?.contextInfo ||
        null
    );
}

function getPendingKey(message) {
    const jid = message?.key?.remoteJid;
    const stanzaId = getContextInfo(message)?.stanzaId;

    if (!jid || !stanzaId) return null;

    return `${jid}:${stanzaId}`;
}

function getCaption(track) {
    return (
        `*_${track.title}_*\n` +
        `*_${track.description}_*\n\n\n` +
        `\`\`\`1.⬢\`\`\` *audio*\n` +
        `\`\`\`2.⬢\`\`\` *video*\n\n` +
        `_*Send a number as a reply to download*_`
    );
}

async function getHighQualityYouTubeArtwork(video) {
    if (!video?.videoId) return video?.artwork || "";

    const maxResolution =
        `https://i.ytimg.com/vi/${video.videoId}/maxresdefault.jpg`;

    try {
        const response = await fetch(maxResolution, {
            method: "HEAD"
        });

        const type = response.headers.get("content-type") || "";

        if (response.ok && type.includes("image")) {
            return maxResolution;
        }
    } catch (error) {
        console.log("[SPOTIFY ARTWORK]", error.message);
    }

    return video.artwork || "";
}

async function sendSelection(sock, message, track, video, videoCandidates = [video]) {
    const jid = message.key.remoteJid;

    const caption = getCaption(track);

    let artwork = track.artwork;

    if (!artwork) {
        artwork = await getHighQualityYouTubeArtwork(video);
    }

    let menuMessage;

    if (artwork) {
        try {
            menuMessage = await sock.sendMessage(
                jid,
                {
                    image: { url: artwork },
                    caption
                },
                { quoted: message }
            );
        } catch (error) {
            console.log("[SPOTIFY ARTWORK]", error.message);
        }
    }

    if (!menuMessage) {
        menuMessage = await sock.sendMessage(
            jid,
            { text: caption },
            { quoted: message }
        );
    }

    if (!menuMessage?.key?.id) {
        throw new Error("Couldn't create the Spotify selection menu.");
    }

    const pendingKey =
        `${jid}:${menuMessage.key.id}`;

    pendingSelections.set(pendingKey, {
        sender: getSender(message),
        jid,
        track,
        video,
        videoCandidates,
        expires: Date.now() + SELECTION_TIMEOUT
    });

    return menuMessage;
}

async function performDownload(sock, message, pending, choice) {
    const jid = pending.jid;
    const track = pending.track;

    let status;

    try {
        const mediaTitle = pending.video?.title || track.title;

        status = await sock.sendMessage(
            jid,
            {
                text: `_*Now playing : ${mediaTitle} 🎶*_`
            },
            { quoted: message }
        );

        if (choice === "1") {
            const mediaUrl = await getAudioUrl(
                `${track.title} ${track.description || ""}`.trim()
            );

            await sock.sendMessage(
                jid,
                {
                    audio: { url: mediaUrl },
                    mimetype: "audio/mpeg",
                    fileName: `${track.title}.mp3`,
                    ptt: false
                },
                {
                    quoted: status
                }
            );

        } else {
            const candidates = (
                pending.videoCandidates?.length
                    ? pending.videoCandidates
                    : [pending.video]
            ).filter(video => video?.url);

            let videoBuffer;
            let lastError;

            for (const candidate of candidates) {
                try {
                    console.log(
                        "[SPOTIFY VIDEO] Trying:",
                        candidate.videoId,
                        candidate.title
                    );

                    videoBuffer = await getVideoBuffer(candidate.url);
                    if (videoBuffer) break;

                } catch (error) {
                    lastError = error;
                    console.log(
                        "[SPOTIFY VIDEO] Candidate failed:",
                        candidate.videoId,
                        error.message
                    );
                }
            }

            if (!videoBuffer) {
                throw new Error(
                    `All ${candidates.length} YouTube results failed. ${
                        lastError?.message || "No video data was returned."
                    }`
                );
            }

            await sock.sendMessage(
                jid,
                {
                    video: videoBuffer,
                    mimetype: "video/mp4",
                    fileName: `${track.title}.mp4`,
                    caption: "*spider-md/blix-xer \u{1F90D}*"
                },
                {
                    quoted: status
                }
            );
        }

    } catch (error) {
        console.error("[SPOTIFY DOWNLOAD]", error);

        await sock.sendMessage(
            jid,
            {
                text: `*Download failed!*
${error.message || "Please try again later."}`
            },
            { quoted: message }
        );
    }
}
export const spotify = {
    name: "spotify",
    aliases: ["sp"],
    category: "DOWNLOAD",
    description: "Search music and choose audio or video",

    hasPendingReply(message) {
        const key = getPendingKey(message);

        return Boolean(key && pendingSelections.has(key));
    },

    async handleReply(sock, message, text) {
        const contextInfo = getContextInfo(message);

        // Only accept an actual WhatsApp reply to the selection menu.
        if (!contextInfo?.stanzaId || !contextInfo?.quotedMessage) {
            return false;
        }

        const key = getPendingKey(message);

        if (!key) return false;

        const pending = pendingSelections.get(key);

        if (!pending || pending.processing) return false;

        if (Date.now() > pending.expires) {
            pendingSelections.delete(key);

            await sock.sendMessage(
                pending.jid,
                {
                    text: "*This Spotify selection has expired. Please search again.*"
                },
                { quoted: message }
            );

            return true;
        }

        // Read the actual incoming WhatsApp reply, not a parsed command value.
        const actualReply =
            message?.message?.extendedTextMessage?.text;

        const choice = String(actualReply ?? "").trim();

        if (!["1", "2"].includes(choice)) {
            return false;
        }

        // Lock and remove this selection before starting the download.
        pending.processing = true;
        pendingSelections.delete(key);

        await performDownload(
            sock,
            message,
            pending,
            choice
        );

        return true;
    },

    async execute(sock, message, args) {
        const jid = message.key.remoteJid;
        let statusKey = null;

        try {
            const input = getInput(args, message);

            if (!input) {
                return sock.sendMessage(
                    jid,
                    {
                        text:
                            "*Please provide a song name or Spotify link!*\n\n" +
                            "*Examples:*\n" +
                            ".spotify Shape of You Ed Sheeran\n" +
                            ".spotify https://open.spotify.com/track/..."
                    },
                    { quoted: message }
                );
            }

            const status = await sock.sendMessage(
                jid,
                { text: "*Fetching Spotify info...*" },
                { quoted: message }
            );

            statusKey = status?.key;

            let track;
            let query = input;

            if (isSpotifyUrl(input)) {
                track = await getSpotifyInfo(input);

                if (!track.title) {
                    throw new Error("Couldn't identify the Spotify track.");
                }

                query = `${track.title} ${track.description || ""}`.trim();

            } else {
                track = {
                    title: input,
                    description: "",
                    artwork: ""
                };
            }

            const results = await searchYouTube(query);

            if (!results.length) {
                throw new Error("No matching YouTube results were found.");
            }

            const rankedVideos = rankResults(results, query);
            const video = rankedVideos[0] || null;

            if (!video) {
                throw new Error("Couldn't select a YouTube result.");
            }

            if (!isSpotifyUrl(input)) {
                track.title = video.title || input;
                track.description = video.author || "";
                track.artwork = await getHighQualityYouTubeArtwork(video);
            } else if (!track.artwork) {
                track.artwork = await getHighQualityYouTubeArtwork(video);
            }

            await editStatus(
                sock,
                jid,
                statusKey,
                "*Preparing download...*"
            );

            await sendSelection(
                sock,
                message,
                track,
                video,
                rankedVideos.slice(0, 5)
            );

            await editStatus(
                sock,
                jid,
                statusKey,
                ""
            ).catch(() => {});

        } catch (error) {
            console.error("[SPOTIFY]", error);

            const errorText =
                `*Download failed!*\n${error.message || "Please try again later."}`;

            if (statusKey) {
                await editStatus(
                    sock,
                    jid,
                    statusKey,
                    errorText
                ).catch(async () => {
                    await sock.sendMessage(
                        jid,
                        { text: errorText },
                        { quoted: message }
                    );
                });
            } else {
                await sock.sendMessage(
                    jid,
                    { text: errorText },
                    { quoted: message }
                );
            }
        }
    }
};
