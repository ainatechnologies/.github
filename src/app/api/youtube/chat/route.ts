import { NextRequest, NextResponse } from "next/server";
import {
  mapYoutubeError,
  MISSING_API_KEY_MESSAGE,
  resolveYoutubeApiKey,
  type ChatMessage,
} from "@/lib/youtube";

export async function GET(req: NextRequest) {
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

  const liveChatId = req.nextUrl.searchParams.get("liveChatId");
  const pageToken = req.nextUrl.searchParams.get("pageToken") || "";

  if (!liveChatId) {
    return NextResponse.json(
      { error: "API_ERROR", message: "liveChatId is required." },
      { status: 400 }
    );
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("maxResults", "200");
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

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

  const messages: ChatMessage[] = (data.items || [])
    .map((item: {
      id: string;
      snippet?: {
        type?: string;
        publishedAt?: string;
        displayMessage?: string;
        textMessageDetails?: { messageText?: string };
      };
      authorDetails?: {
        channelId?: string;
        displayName?: string;
        profileImageUrl?: string;
        isChatOwner?: boolean;
        isChatModerator?: boolean;
      };
    }) => {
      const type = item.snippet?.type || "";
      const messageText =
        item.snippet?.textMessageDetails?.messageText ??
        item.snippet?.displayMessage ??
        "";

      return {
        id: item.id,
        publishedAt: item.snippet?.publishedAt || "",
        messageText,
        type,
        authorChannelId: item.authorDetails?.channelId || "",
        displayName: item.authorDetails?.displayName || "Unknown",
        profileImageUrl: item.authorDetails?.profileImageUrl || "",
        isChatOwner: !!item.authorDetails?.isChatOwner,
        isChatModerator: !!item.authorDetails?.isChatModerator,
      } satisfies ChatMessage;
    })
    .filter((m: ChatMessage) => m.type === "textMessageEvent" && m.authorChannelId);

  return NextResponse.json({
    messages,
    nextPageToken: data.nextPageToken || "",
    pollingIntervalMillis: data.pollingIntervalMillis || 5000,
    offlineAt: data.offlineAt || null,
  });
}
