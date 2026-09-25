export type ChatMessage = {
  id: string;
  publishedAt: string;
  messageText: string;
  type: string;
  authorChannelId: string;
  displayName: string;
  profileImageUrl: string;
  isChatOwner: boolean;
  isChatModerator: boolean;
};

export function extractVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "live" || parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "v") {
        const id = parts[1];
        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function matchesKeyword(message: string, keyword: string): boolean {
  return message.trim().toLowerCase() === keyword.trim().toLowerCase();
}

export type YoutubeApiErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_URL"
  | "VIDEO_NOT_FOUND"
  | "NOT_LIVE"
  | "CHAT_DISABLED"
  | "QUOTA"
  | "API_ERROR"
  | "STREAM_ENDED";

export function mapYoutubeError(status: number, body: unknown): {
  code: YoutubeApiErrorCode;
  message: string;
} {
  const err = body as {
    error?: { message?: string; errors?: Array<{ reason?: string }> };
  };
  const reason = err?.error?.errors?.[0]?.reason || "";
  const msg = err?.error?.message || "YouTube API error";

  if (status === 403 && (reason === "quotaExceeded" || reason === "dailyLimitExceeded")) {
    return {
      code: "QUOTA",
      message: "YouTube API quota exceeded. Try again later or use a different API key.",
    };
  }

  if (status === 403 || status === 400) {
    if (reason === "liveChatEnded" || /live chat.*(ended|disabled)/i.test(msg)) {
      return {
        code: "STREAM_ENDED",
        message: "Live chat has ended or is no longer available.",
      };
    }
  }

  if (status === 404) {
    return { code: "VIDEO_NOT_FOUND", message: "Video not found. Check the livestream URL." };
  }

  return { code: "API_ERROR", message: msg };
}
