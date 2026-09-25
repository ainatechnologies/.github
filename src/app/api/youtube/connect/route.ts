import { NextRequest, NextResponse } from "next/server";
import {
  extractVideoId,
  mapYoutubeError,
  MISSING_API_KEY_MESSAGE,
  resolveYoutubeApiKey,
} from "@/lib/youtube";

export async function POST(req: NextRequest) {
  const apiKey = resolveYoutubeApiKey(req);
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "MISSING_API_KEY",
        message: MISSING_API_KEY_MESSAGE,
      },
      { status: 500 }
    );
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_URL", message: "Invalid request body." },
      { status: 400 }
    );
  }

  const videoId = extractVideoId(body.url || "");
  if (!videoId) {
    return NextResponse.json(
      {
        error: "INVALID_URL",
        message:
          "Could not parse a YouTube video ID. Paste a watch, youtu.be, or /live/ URL.",
      },
      { status: 400 }
    );
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    return NextResponse.json(
      {
        error: "API_ERROR",
        message: "Could not reach YouTube API. Check your network and try again.",
      },
      { status: 502 }
    );
  }

  const data = await res.json();

  if (!res.ok) {
    const mapped = mapYoutubeError(res.status, data);
    return NextResponse.json(
      { error: mapped.code, message: mapped.message },
      { status: res.status }
    );
  }

  const item = data.items?.[0];
  if (!item) {
    return NextResponse.json(
      { error: "VIDEO_NOT_FOUND", message: "Video not found. Check the livestream URL." },
      { status: 404 }
    );
  }

  const liveChatId = item.liveStreamingDetails?.activeLiveChatId as string | undefined;
  if (!liveChatId) {
    const hasLiveDetails = !!item.liveStreamingDetails;
    return NextResponse.json(
      {
        error: hasLiveDetails ? "CHAT_DISABLED" : "NOT_LIVE",
        message: hasLiveDetails
          ? "This stream has no active live chat (chat may be disabled)."
          : "This video is not currently live. Open a live stream URL.",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    videoId,
    liveChatId,
    title: item.snippet?.title || "Untitled stream",
    channelTitle: item.snippet?.channelTitle || "",
    channelId: item.snippet?.channelId || "",
    thumbnail:
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url ||
      "",
  });
}
