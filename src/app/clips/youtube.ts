import { RemoteClipSchema, type RemoteClip } from './models.js';

const API_ROOT = 'https://www.googleapis.com/youtube/v3';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PLAYLIST_PAGES = 200;
const PAGE_SIZE = 50;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nested(object: JsonObject, ...keys: string[]): unknown {
  let value: unknown = object;
  for (const key of keys) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 86_400
    + Number(match[2] ?? 0) * 3_600
    + Number(match[3] ?? 0) * 60
    + Number(match[4] ?? 0);
  return Number.isInteger(seconds) ? seconds : null;
}

function preferredThumbnail(snippet: JsonObject): string | null {
  const thumbnails = nested(snippet, 'thumbnails');
  if (!isObject(thumbnails)) return null;
  for (const name of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const thumbnail = thumbnails[name];
    if (isObject(thumbnail)) {
      const url = string(thumbnail.url);
      if (url) return url;
    }
  }
  return null;
}

function sanitizedError(message: string): Error {
  return new Error(`YouTube sync failed: ${message}`);
}

export interface CollectedChannel {
  uploadsPlaylistId: string;
  lastSyncedVideoId: string | null;
  clips: RemoteClip[];
}

export class YouTubeClient {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    if (apiKey.trim().length === 0) throw sanitizedError('an API key is required');
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
  }

  async #get(resource: 'channels' | 'playlistItems' | 'videos', parameters: Record<string, string>): Promise<JsonObject> {
    const url = new URL(`${API_ROOT}/${resource}`);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    url.searchParams.set('key', this.#apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.#fetch(url, { method: 'GET', signal: controller.signal });
      if (!response.ok) throw sanitizedError(`${resource} request returned HTTP ${response.status}`);
      const body: unknown = await response.json();
      if (!isObject(body)) throw sanitizedError(`${resource} returned an invalid response`);
      return body;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('YouTube sync failed:')) throw error;
      if (controller.signal.aborted) throw sanitizedError(`${resource} request timed out`);
      throw sanitizedError(`${resource} request could not be completed`);
    } finally {
      clearTimeout(timer);
    }
  }

  async collectChannel(youtubeChannelId: string, lastSyncedVideoId: string | null): Promise<CollectedChannel> {
    if (!CHANNEL_ID.test(youtubeChannelId)) throw sanitizedError('a valid channel ID is required');

    const channelResponse = await this.#get('channels', {
      part: 'contentDetails',
      id: youtubeChannelId,
      maxResults: '1',
    });
    const channel = array(channelResponse.items)[0];
    if (channel && string(channel.id) !== undefined && string(channel.id) !== youtubeChannelId) {
      throw sanitizedError('the channel response did not match the requested channel');
    }
    const uploadsPlaylistId = channel && string(nested(channel, 'contentDetails', 'relatedPlaylists', 'uploads'));
    if (!uploadsPlaylistId) throw sanitizedError('the channel or its uploads playlist was not found');

    const videoIds: string[] = [];
    const seenVideoIds = new Set<string>();
    let pageToken: string | undefined;
    let watermarkFound = lastSyncedVideoId === null;

    for (let page = 0; page < MAX_PLAYLIST_PAGES; page += 1) {
      const parameters: Record<string, string> = {
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: String(PAGE_SIZE),
      };
      if (pageToken) parameters.pageToken = pageToken;
      const playlistResponse = await this.#get('playlistItems', parameters);

      for (const item of array(playlistResponse.items)) {
        const videoId = string(nested(item, 'contentDetails', 'videoId'));
        if (!videoId || !VIDEO_ID.test(videoId)) continue;
        if (lastSyncedVideoId !== null && videoId === lastSyncedVideoId) {
          watermarkFound = true;
          break;
        }
        if (!seenVideoIds.has(videoId)) {
          seenVideoIds.add(videoId);
          videoIds.push(videoId);
        }
      }
      if (watermarkFound && lastSyncedVideoId !== null) break;

      pageToken = string(playlistResponse.nextPageToken);
      if (!pageToken) break;
      if (page === MAX_PLAYLIST_PAGES - 1) {
        throw sanitizedError(`the uploads playlist exceeded the ${MAX_PLAYLIST_PAGES}-page safety limit`);
      }
    }

    const detailsById = new Map<string, RemoteClip>();
    for (let offset = 0; offset < videoIds.length; offset += PAGE_SIZE) {
      const ids = videoIds.slice(offset, offset + PAGE_SIZE);
      const videosResponse = await this.#get('videos', {
        part: 'snippet,contentDetails,statistics',
        id: ids.join(','),
      });
      for (const item of array(videosResponse.items)) {
        const youtubeVideoId = string(item.id);
        const snippet = item.snippet;
        const contentDetails = item.contentDetails;
        const statistics = item.statistics;
        if (!youtubeVideoId || !isObject(snippet) || !isObject(contentDetails)) continue;
        if (!ids.includes(youtubeVideoId)) {
          throw sanitizedError('the video response contained an unexpected video ID');
        }
        if (string(snippet.channelId) !== youtubeChannelId) {
          throw sanitizedError('a returned video did not belong to the requested channel');
        }

        const parsed = RemoteClipSchema.safeParse({
          youtubeVideoId,
          youtubeChannelId,
          title: string(snippet.title) ?? '',
          description: string(snippet.description) ?? '',
          publishedAt: string(snippet.publishedAt) ?? '',
          durationSeconds: parseDurationSeconds(string(contentDetails.duration)),
          thumbnailUrl: preferredThumbnail(snippet),
          viewCount: isObject(statistics) ? string(statistics.viewCount) ?? null : null,
          likeCount: isObject(statistics) ? string(statistics.likeCount) ?? null : null,
          commentCount: isObject(statistics) ? string(statistics.commentCount) ?? null : null,
        });
        if (!parsed.success) throw sanitizedError('a video returned invalid metadata');
        detailsById.set(youtubeVideoId, parsed.data);
      }
    }

    return {
      uploadsPlaylistId,
      lastSyncedVideoId: videoIds[0] ?? (watermarkFound ? lastSyncedVideoId : null),
      clips: videoIds.flatMap(videoId => {
        const clip = detailsById.get(videoId);
        return clip ? [clip] : [];
      }),
    };
  }
}
