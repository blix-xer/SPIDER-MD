import { SPIDER_API_URL, SPIDER_API_KEY } from "../spiderApiConfig.js";

export const ytv = {
  name: "ytv",
  aliases: ["ytvideo"],
  category: "DOWNLOAD",

  async execute(sock, message, args) {
    const jid = message.key.remoteJid;
    const MAX_VIDEO_SIZE = 64 * 1024 * 1024;



    const sendText = async (text) =>
      sock.sendMessage(jid, { text }, { quoted: message });

    const extractYouTubeUrl = (input) => {
      const match = input.match(
        /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i
      );

      if (!match) return null;

      try {
        const parsed = new URL(match[0]);
        let videoId = null;

        if (parsed.hostname.includes("youtu.be")) {
          videoId = parsed.pathname.split("/").filter(Boolean)[0];
        } else {
          videoId =
            parsed.searchParams.get("v") ||
            parsed.pathname.match(
              /\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/
            )?.[1];
        }

        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return null;
        }

        return `https://www.youtube.com/watch?v=${videoId}`;
      } catch {
        return null;
      }
    };

    const searchYouTube = async (query) => {
      const searchUrl =
        "https://www.youtube.com/results?search_query=" +
        encodeURIComponent(query);

      const response = await fetch(searchUrl, {
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
        throw new Error("No YouTube videos found.");
      }

      return `https://www.youtube.com/watch?v=${match[1]}`;
    };

    const getVideoTitle = async (url) => {
      try {
        const response = await fetch(
          "https://www.youtube.com/oembed?url=" +
            encodeURIComponent(url) +
            "&format=json",
          { signal: AbortSignal.timeout(20000) }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.title) return data.title;
        }
      } catch {
        // Use fallback title.
      }

      return "YouTube Video";
    };

    const downloadVideo = async (url) => {
      if (!SPIDER_API_KEY) {
        throw new Error(
          "SPIDER-API key is missing. Set SPIDER_API_KEY or API_KEY before starting SPIDER-MD."
        );
      }

      const endpoint =
        `${SPIDER_API_URL}/api/youtube/video?` +
        new URLSearchParams({ url });

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "x-api-key": SPIDER_API_KEY,
          "Accept": "video/mp4"
        },
        signal: AbortSignal.timeout(200000)
      });

      if (!response.ok) {
        let errorMessage = `SPIDER-API returned HTTP ${response.status}.`;

        try {
          const result = await response.json();
          errorMessage = result.error || result.message || errorMessage;
        } catch {
          // Keep HTTP error message.
        }

        if (/sign in to confirm|not a bot|bot verification|did not authorize/i.test(errorMessage)) {
          throw new Error(
            "🚫 *YouTube Download Restricted*\n\n" +
            "YouTube has blocked this automated download with its bot-verification check.\n\n" +
            "✅ SPIDER-API is online.\n" +
            "✅ API authentication is working.\n" +
            "❌ YouTube has not authorized this download.\n\n" +
            "This is a YouTube restriction, not a SPIDER-MD error. Try an authorized video source or a video file you have permission to use."
          );
        }

        throw new Error(errorMessage);
      }

      const contentType =
        response.headers.get("content-type") || "";

      if (
        contentType.includes("application/json") ||
        contentType.includes("text/html")
      ) {
        throw new Error(
          "SPIDER-API returned an error response instead of a video."
        );
      }

      const contentLength = Number(
        response.headers.get("content-length") || 0
      );

      if (contentLength > MAX_VIDEO_SIZE) {
        throw new Error("Video exceeds the 64 MB size limit.");
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (!buffer.length) {
        throw new Error("Downloaded video is empty.");
      }

      if (buffer.length > MAX_VIDEO_SIZE) {
        throw new Error("Video exceeds the 64 MB size limit.");
      }

      return buffer;
    };

    try {
      const input = String(args || "").trim();

      if (!input) {
        return sendText(
          "Give a YouTube video *URL* or *Query*."
        );
      }

      if (!SPIDER_API_KEY) {
        return sendText(
          "SPIDER-API key is missing. Configure SPIDER_API_KEY before starting SPIDER-MD."
        );
      }

      await sendText("🔎 Searching YouTube...");

      let videoUrl = extractYouTubeUrl(input);

      if (!videoUrl) {
        videoUrl = await searchYouTube(input);
      }

      const title = await getVideoTitle(videoUrl);

      await sendText(`_*downloading ${title}*_`);

      const videoBuffer = await downloadVideo(videoUrl);

      await sock.sendMessage(
        jid,
        {
          video: videoBuffer,
          mimetype: "video/mp4",
          fileName:
            `${title.replace(/[^\w\s.-]/g, "").trim() || "video"}.mp4`,
          caption: "*spider-md/blix-xer \u{1F90D}*"
        },
        { quoted: message }
      );

    } catch (error) {
      console.error("[SPIDER-MD] YTV error:", error);

      await sendText(
        error.message || "Download failed due to an unknown error."
      );
    }
  }
};
