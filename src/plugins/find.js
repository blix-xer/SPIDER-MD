import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const ACR_CONFIG = path.join(process.cwd(), "data", "acrcloud.json");
const ACOUSTID_CONFIG = path.join(process.cwd(), "data", "acoustid.json");
const MAX_VIDEO_SIZE = 64 * 1024 * 1024;
const pending = new Map();
const PENDING_TIME = 2 * 60 * 1000;

function unwrap(content) {
    for (let i = 0; i < 10; i++) {
        const wrapped =
            content?.ephemeralMessage?.message ||
            content?.viewOnceMessage?.message ||
            content?.viewOnceMessageV2?.message ||
            content?.viewOnceMessageV2Extension?.message ||
            content?.documentWithCaptionMessage?.message;

        if (!wrapped) break;
        content = wrapped;
    }
    return content;
}

function getMedia(message) {
    const current = unwrap(message?.message);

    const isMedia = content =>
        content?.audioMessage ||
        content?.videoMessage ||
        (
            content?.documentMessage &&
            /^(audio|video)\//i.test(
                content.documentMessage.mimetype || ""
            )
        );

    if (isMedia(current)) return message;

    const context =
        current?.extendedTextMessage?.contextInfo ||
        current?.imageMessage?.contextInfo ||
        current?.videoMessage?.contextInfo;

    if (!context?.quotedMessage) return null;

    const quoted = {
        key: {
            remoteJid: message.key.remoteJid,
            id: context.stanzaId,
            participant: context.participant,
            fromMe: false
        },
        message: context.quotedMessage
    };

    return isMedia(unwrap(quoted.message)) ? quoted : null;
}

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", chunk => {
            stderr += chunk.toString();
        });

        child.on("error", reject);

        child.on("close", code => {
            if (code !== 0) {
                reject(new Error(
                    stderr.trim().slice(-1200) ||
                    `${command} exited with code ${code}`
                ));
                return;
            }

            resolve(stdout.trim());
        });
    });
}

async function getAcrConfig() {
    try {
        const data = JSON.parse(
            await fs.readFile(ACR_CONFIG, "utf8")
        );

        if (!data.accessKey || !data.secretKey || !data.host) {
            throw new Error("ACRCloud credentials are incomplete.");
        }

        return data;
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(
                "ACRCloud is not configured. Run the ACRCloud setup step first."
            );
        }
        throw error;
    }
}

async function prepareSample(sock, mediaMessage, directory) {
    const content = unwrap(mediaMessage.message);
    const media =
        content.audioMessage ||
        content.videoMessage ||
        content.documentMessage;

    const buffer = await downloadMediaMessage(
        mediaMessage,
        "buffer",
        {}
    );

    if (!buffer?.length) {
        throw new Error("Unable to download the replied media.");
    }

    if (buffer.length > 50 * 1024 * 1024) {
        throw new Error("The replied media exceeds the 50 MB limit.");
    }

    const input = path.join(directory, "input-media");
    const output = path.join(directory, "sample.mp3");

    await fs.writeFile(input, buffer);

    await run("ffmpeg", [
        "-y",
        "-i", input,
        "-t", "10",
        "-vn",
        "-ac", "1",
        "-ar", "8000",
        "-b:a", "64k",
        "-f", "mp3",
        output
    ]);

    const sample = await fs.readFile(output);

    if (!sample.length) {
        throw new Error("Could not prepare the audio sample.");
    }

    return { sample, input };
}

async function identifyAcrTrack(sample) {
    const config = await getAcrConfig();
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const stringToSign = [
        "POST",
        "/v1/identify",
        config.accessKey,
        "audio",
        "1",
        timestamp
    ].join("\n");

    const signature = crypto
        .createHmac("sha1", config.secretKey)
        .update(stringToSign)
        .digest("base64");

    const form = new FormData();

    form.append(
        "sample",
        new Blob([sample], { type: "audio/mpeg" }),
        "sample.mp3"
    );
    form.append("sample_bytes", String(sample.length));
    form.append("access_key", config.accessKey);
    form.append("data_type", "audio");
    form.append("signature_version", "1");
    form.append("signature", signature);
    form.append("timestamp", timestamp);

    const host = config.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");

    const response = await fetch(
        `https://${host}/v1/identify`,
        {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(60000)
        }
    );

    if (!response.ok) {
        throw new Error(`ACRCloud returned HTTP ${response.status}.`);
    }

    const result = await response.json();

    if (result.status?.code !== 0) {
        throw new Error(
            result.status?.msg || "ACRCloud could not identify this audio."
        );
    }

    const track = result.metadata?.music?.[0];

    if (!track) {
        throw new Error("No matching music was found.");
    }

    return track;
}


async function getAcoustidConfig() {
    const data = JSON.parse(
        await fs.readFile(ACOUSTID_CONFIG, "utf8")
    );

    if (!data.apiKey) {
        throw new Error("AcoustID API key is missing.");
    }

    return data;
}

async function identifyAcoustID(input) {
    const config = await getAcoustidConfig();

    const output = await run("fpcalc", [
        "-json",
        "-length", "120",
        input
    ]);

    let fingerprintData;

    try {
        fingerprintData = JSON.parse(output);
    } catch {
        throw new Error("Chromaprint returned invalid fingerprint data.");
    }

    if (
        !fingerprintData.fingerprint ||
        !Number.isFinite(Number(fingerprintData.duration))
    ) {
        throw new Error("Could not generate an audio fingerprint.");
    }

    const form = new URLSearchParams();

    form.append("client", config.apiKey);
    form.append("format", "json");
    form.append("duration", String(
        Math.round(Number(fingerprintData.duration))
    ));
    form.append("fingerprint", fingerprintData.fingerprint);

    for (const meta of [
        "recordings",
        "releases",
        "releasegroups",
        "isrcs"
    ]) {
        form.append("meta", meta);
    }

    const response = await fetch(
        "https://api.acoustid.org/v2/lookup",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: form.toString(),
            signal: AbortSignal.timeout(30000)
        }
    );

    if (!response.ok) {
        throw new Error(`AcoustID returned HTTP ${response.status}.`);
    }

    const result = await response.json();

    if (result.status !== "ok") {
        throw new Error(
            result.error?.message || "AcoustID lookup failed."
        );
    }

    const candidates = (result.results || [])
        .filter(item => item.recordings?.length)
        .sort((a, b) => (b.score || 0) - (a.score || 0));

    const best = candidates[0];

    if (!best || best.score < 0.5) {
        throw new Error("No reliable AcoustID match was found.");
    }

    const recording = best.recordings[0];

    const artists = (recording.artists || [])
        .map(item => item.name)
        .filter(Boolean);

    const releaseGroups = recording.releasegroups || [];
    const releases = recording.releases || [];

    const album =
        releaseGroups.find(item => item.type === "Album")?.title ||
        releaseGroups[0]?.title ||
        releases[0]?.title ||
        "";

    const date = releases.find(item => item.date)?.date;
    const releaseDate =
        typeof date === "string"
            ? date
            : date?.year
                ? [
                    date.year,
                    date.month,
                    date.day
                ].filter(Boolean).join("-")
                : "";

    if (!recording.title) {
        throw new Error("AcoustID returned incomplete track information.");
    }

    console.log(
        `[SPIDER-MD] AcoustID match: ${recording.title} | Score: ${best.score}`
    );

    return {
        title: recording.title,
        album: { name: album },
        artists: artists.map(name => ({ name })),
        release_date: releaseDate
    };
}

async function identifyTrack(sample, input) {
    let acrError;

    try {
        return await identifyAcrTrack(sample);
    } catch (error) {
        acrError = error;
        console.log(
            `[SPIDER-MD] ACRCloud did not identify the audio: ${error.message}`
        );
    }

    try {
        return await identifyAcoustID(input);
    } catch (error) {
        throw new Error(
            `ACRCloud: ${acrError?.message || "No match"}\n` +
            `AcoustID: ${error.message}`
        );
    }
}

async function searchYouTube(query) {
    const url =
        "https://www.youtube.com/results?search_query=" +
        encodeURIComponent(query);

    const response = await fetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
        },
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error("YouTube search is temporarily unavailable.");
    }

    const html = await response.text();

    const match = html.match(
        /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"/
    );

    if (!match?.[1]) {
        throw new Error("No matching YouTube video was found.");
    }

    const videoId = match[1];
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    let title = query;
    let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    try {
        const infoResponse = await fetch(
            "https://www.youtube.com/oembed?url=" +
                encodeURIComponent(videoUrl) +
                "&format=json",
            { signal: AbortSignal.timeout(20000) }
        );

        if (infoResponse.ok) {
            const info = await infoResponse.json();
            title = info.title || title;
            thumbnail = info.thumbnail_url || thumbnail;
        }
    } catch {
        // Keep the search title and standard thumbnail.
    }

    return { videoUrl, title, thumbnail };
}

async function downloadAudio(url, directory) {
    const template = path.join(
        directory,
        "%(title).80s [%(id)s].%(ext)s"
    );

    const output = await run("yt-dlp", [
        "--js-runtimes", "node",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--output", template,
        "--print", "after_move:filepath",
        url
    ]);

    const lines = output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const filePath = lines[lines.length - 1];

    if (!filePath) {
        throw new Error("The audio file was not created.");
    }

    const stats = await fs.stat(filePath);

    if (!stats.isFile() || !stats.size) {
        throw new Error("The downloaded audio is empty.");
    }

    if (stats.size > 40 * 1024 * 1024) {
        throw new Error("Audio exceeds the 40 MB sending limit.");
    }

    return filePath;
}

async function downloadVideo(url) {
    const api = (
        process.env.SPIDER_API_URL || "http://127.0.0.1:3000"
    ).replace(/\/+$/, "");

    const key =
        process.env.SPIDER_API_KEY ||
        process.env.API_KEY ||
        "";

    if (!key) {
        throw new Error("SPIDER-API key is missing.");
    }

    const endpoint =
        `${api}/api/youtube/video?` +
        new URLSearchParams({ url });

    const response = await fetch(endpoint, {
        headers: {
            "x-api-key": key,
            "Accept": "video/mp4"
        },
        signal: AbortSignal.timeout(200000)
    });

    if (!response.ok) {
        let reason = `SPIDER-API returned HTTP ${response.status}.`;

        try {
            const result = await response.json();
            reason = result.error || result.message || reason;
        } catch {}

        throw new Error(reason);
    }

    const type = response.headers.get("content-type") || "";

    if (/application\/json|text\/html/i.test(type)) {
        throw new Error("SPIDER-API returned an error instead of a video.");
    }

    const length = Number(
        response.headers.get("content-length") || 0
    );

    if (length > MAX_VIDEO_SIZE) {
        throw new Error("Video exceeds the 64 MB sending limit.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length || buffer.length > MAX_VIDEO_SIZE) {
        throw new Error("Invalid video size returned by SPIDER-API.");
    }

    return buffer;
}

function getSender(message) {
    return (
        message.key.participant ||
        message.key.remoteJid
    );
}

function getPendingKey(message) {
    return `${message.key.remoteJid}:${getSender(message)}`;
}

function cleanName(value) {
    return String(value || "SPIDER-MD")
        .replace(/[^\w\s.-]/g, "")
        .trim()
        .slice(0, 90) || "SPIDER-MD";
}

export const find = {
    name: "find",
    aliases: [],
    category: "SEARCH",
    description: "Identify music from audio or video",

    hasPendingReply(message) {
        const key = getPendingKey(message);
        const item = pending.get(key);

        if (!item) return false;

        if (Date.now() > item.expires) {
            pending.delete(key);
            return false;
        }

        return true;
    },

    async handleReply(sock, message, text) {
        const key = getPendingKey(message);
        const item = pending.get(key);

        if (!item || Date.now() > item.expires) {
            pending.delete(key);
            return false;
        }

        const choice = String(text).trim();

        if (choice !== "1" && choice !== "2") {
            return false;
        }

        pending.delete(key);

        const jid = message.key.remoteJid;
        const reply = value =>
            sock.sendMessage(jid, { text: value }, { quoted: message });

        let directory;

        try {
            await reply(
                choice === "1"
                    ? `_*downloading ${item.title}*_`
                    : `_*downloading ${item.title}*_`
            );

            directory = await fs.mkdtemp(
                path.join(os.tmpdir(), "spider-find-")
            );

            if (choice === "1") {
                const audioPath = await downloadAudio(
                    item.videoUrl,
                    directory
                );

                const audio = await fs.readFile(audioPath);

                await sock.sendMessage(
                    jid,
                    {
                        audio,
                        mimetype: "audio/mpeg",
                        fileName: `${cleanName(item.title)}.mp3`,
                        ptt: false
                    },
                    { quoted: message }
                );
            } else {
                const video = await downloadVideo(item.videoUrl);

                await sock.sendMessage(
                    jid,
                    {
                        video,
                        mimetype: "video/mp4",
                        fileName: `${cleanName(item.title)}.mp4`
                    },
                    { quoted: message }
                );
            }
        } catch (error) {
            console.error("[SPIDER-MD] Find download error:", error);
            await reply(
                `❌ *DOWNLOAD FAILED*\n\n${error.message || "Unknown error."}`
            );
        } finally {
            if (directory) {
                await fs.rm(directory, {
                    recursive: true,
                    force: true
                }).catch(() => {});
            }
        }

        return true;
    },

    async execute(sock, message) {
        const jid = message.key.remoteJid;
        const reply = text =>
            sock.sendMessage(jid, { text }, { quoted: message });

        const mediaMessage = getMedia(message);

        if (!mediaMessage) {
            return reply("Reply to an audio or video with .find");
        }

        let directory;

        try {

            directory = await fs.mkdtemp(
                path.join(os.tmpdir(), "spider-find-")
            );

            const prepared = await prepareSample(
                sock,
                mediaMessage,
                directory
            );

            const track = await identifyTrack(
                prepared.sample,
                prepared.input
            );

            const title = track.title || "Unknown Song";
            const album = track.album?.name || "";
            const artists = Array.isArray(track.artists)
                ? track.artists.map(item => item.name).filter(Boolean).join(", ")
                : "";
            const releaseDate = track.release_date || "";

            const query = [title, artists].filter(Boolean).join(" ");
            const result = await searchYouTube(query);

            const caption =
                `*_${result.title}_*\n\n` +
                `*Album :* ${album}\n` +
                `*Artists :* ${artists}\n` +
                `*Release Date :* ${releaseDate}\n\n` +
                "```1.⬢``` *audio*\n" +
                "```2.⬢``` *video*\n\n" +
                "_*Send a number as a reply to download*_";

            try {
                await sock.sendMessage(
                    jid,
                    {
                        image: { url: result.thumbnail },
                        caption
                    },
                    { quoted: message }
                );
            } catch {
                await reply(caption);
            }

            pending.set(getPendingKey(message), {
                videoUrl: result.videoUrl,
                title: result.title || title,
                expires: Date.now() + PENDING_TIME
            });

            console.log(
                `[SPIDER-MD] Find identified: ${title} | ${artists}`
            );

        } catch (error) {
            console.error("[SPIDER-MD] Find error:", error);

            await reply(
                `❌ *FIND FAILED*\n\n${error.message || "Unable to identify this audio."}`
            );
        } finally {
            if (directory) {
                await fs.rm(directory, {
                    recursive: true,
                    force: true
                }).catch(() => {});
            }
        }
    }
};
