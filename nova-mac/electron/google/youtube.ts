import { google } from "googleapis";
import { getAuthenticatedOAuth2 } from "./auth-client";
import { getYoutubeTasteCacheTtlHours } from "./config";
import {
  isInsufficientScopeError,
  YOUTUBE_MISSING_SCOPE_ERROR,
  YOUTUBE_NOT_CONNECTED,
} from "./errors";
import {
  upsertYoutubeTasteCache,
  getYoutubeTasteCache,
  type YoutubeTasteProfile,
} from "./youtube-taste";

const NOT_CONNECTED_ERROR = YOUTUBE_NOT_CONNECTED;

function toYoutubeError(error: unknown): string {
  if (error instanceof Error && isInsufficientScopeError(error.message)) {
    return YOUTUBE_MISSING_SCOPE_ERROR;
  }
  return error instanceof Error ? error.message : "YouTube request failed.";
}

export interface YoutubeVideoResult {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  publishedAt: string;
  duration?: string;
}

async function getYoutubeClient(userId: string) {
  const auth = await getAuthenticatedOAuth2(userId, "youtube");
  if (!auth) return null;
  return google.youtube({ version: "v3", auth });
}

function extractTopics(titles: string[]): string[] {
  const words = titles
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4);
  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

export async function buildTasteProfile(
  userId: string,
): Promise<YoutubeTasteProfile> {
  const youtube = await getYoutubeClient(userId);
  if (!youtube) throw new Error(NOT_CONNECTED_ERROR);
  try {
    const subs = await youtube.subscriptions.list({
      part: ["snippet"],
      mine: true,
      maxResults: 50,
    });

    const topChannels = (subs.data.items ?? [])
      .map((item) => item.snippet?.title)
      .filter((t): t is string => Boolean(t))
      .slice(0, 15);

    const likedTitles: string[] = [];
    try {
      const likes = await youtube.playlistItems.list({
        part: ["snippet"],
        playlistId: "LL",
        maxResults: 30,
      });
      for (const item of likes.data.items ?? []) {
        if (item.snippet?.title) likedTitles.push(item.snippet.title);
      }
    } catch {
      // Liked playlist may be unavailable for some accounts.
    }
    const playlists = await youtube.playlists.list({
      part: ["snippet"],
      mine: true,
      maxResults: 25,
    });

    const playlistCount = playlists.data.pageInfo?.totalResults ?? 0;
    const likedTopics = extractTopics(likedTitles);
    const channelSample = topChannels.slice(0, 3).join(", ");
    const summary =
      topChannels.length > 0
        ? `Subscriptions include ${channelSample}${topChannels.length > 3 ? ", and more" : ""}.`
        : "Limited YouTube taste data available.";

    const profile: YoutubeTasteProfile = {
      topChannels,
      likedTopics,
      playlistCount,
      summary,
    };

    await upsertYoutubeTasteCache(userId, profile);
    return profile;
  } catch (error) {
    throw new Error(toYoutubeError(error));
  }
}

export async function getCachedTasteProfile(
  userId: string,
  options: { refreshIfStale?: boolean } = {},
): Promise<YoutubeTasteProfile | null> {
  const cached = await getYoutubeTasteCache(userId);
  const ttlMs = getYoutubeTasteCacheTtlHours() * 60 * 60 * 1000;

  if (cached) {
    const age = Date.now() - new Date(cached.refreshedAt).getTime();
    if (!options.refreshIfStale || age < ttlMs) {
      return cached.profile;
    }
  }

  if (!options.refreshIfStale) {
    return cached?.profile ?? null;
  }

  try {
    return await buildTasteProfile(userId);
  } catch {
    return cached?.profile ?? null;
  }
}

export async function searchYoutube(
  userId: string,
  query: string,
  options: {
    maxResults?: number;
    duration?: "short" | "medium" | "long";
  } = {},
): Promise<{ videos: YoutubeVideoResult[] } | { error: string }> {
  const youtube = await getYoutubeClient(userId);
  if (!youtube) return { error: NOT_CONNECTED_ERROR };

  try {
    const maxResults = Math.min(options.maxResults ?? 10, 15);
    const { data } = await youtube.search.list({
      part: ["snippet"],
      q: query,
      type: ["video"],
      maxResults,
      videoDuration: options.duration,
    });

    const videos: YoutubeVideoResult[] = (data.items ?? [])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        videoId: item.id!.videoId!,
        title: item.snippet?.title ?? "(no title)",
        channelTitle: item.snippet?.channelTitle ?? "",
        description: (item.snippet?.description ?? "").slice(0, 300),
        publishedAt: item.snippet?.publishedAt ?? "",
      }));

    return { videos };
  } catch (error) {
    return { error: toYoutubeError(error) };
  }
}

export async function recommendYoutube(
  userId: string,
  topic: string,
): Promise<{ videos: YoutubeVideoResult[]; tasteSummary: string } | { error: string }> {
  const taste = await getCachedTasteProfile(userId, { refreshIfStale: true });
  const tasteSummary = taste?.summary ?? "No taste profile cached.";

  const queryParts = [topic];
  if (taste?.topChannels[0]) {
    queryParts.push(taste.topChannels[0]);
  }

  const result = await searchYoutube(userId, queryParts.join(" "), {
    maxResults: 5,
    duration: "short",
  });

  if ("error" in result) return result;
  return { videos: result.videos, tasteSummary };
}

export function formatTastePreRetrieveLine(
  profile: YoutubeTasteProfile,
): string {
  const channels = profile.topChannels.slice(0, 5).join(", ");
  return `- [youtube taste] ${profile.summary} Channels: ${channels || "n/a"}`;
}
