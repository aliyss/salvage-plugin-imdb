/**
 * Reads one series' episode list from IMDb's own web API.
 *
 * imdb.com answers a plain request with a challenge page rather than the title:
 * the only way in is the endpoint its own site calls, `api.graphql.imdb.com`,
 * which answers JSON to a request that names one of IMDb's web clients — the
 * header below. That one endpoint is all this plugin reads, so there is no
 * HTML to parse and nothing to keep in step with a page's markup.
 *
 * The answer has no season number: an episode only knows its number inside its
 * season, and the connection arrives in broadcast order across the whole show.
 * The list is therefore numbered through the show — as AniList and SIMKL are —
 * and the order the rows arrive in is the order they are drawn.
 */

import { PluginError } from "./sdk";

const GRAPHQL = "https://api.graphql.imdb.com/";
const USER_AGENT = "Mozilla/5.0 (compatible; salvage-plugin-imdb)";
const TIMEOUT_MS = 12_000;
/** An answer is a page of episodes with a line of plot each; a big page. */
const MAX_BYTES = 8_000_000;
/** The most IMDb answers in one request, which is also how a deep page is read. */
const PAGE = 250;
/** How far into a list one command will reach, however far it is scrolled. */
const MAX_OFFSET = 500;
const MAX_TITLE = 160;
const MAX_DESCRIPTION = 400;
const MIN_YEAR = 1800;
const MAX_YEAR = 2100;
/** A title page: `imdb.com/title/tt0903747/`, with or without the `www`. */
const TITLE_PAGE =
  /^https?:\/\/(?:www\.|m\.)?imdb\.com\/title\/(tt\d{7,10})(?:[/?#]|$)/i;
const TITLE_ID = /^tt\d{7,10}$/i;
/** A cursor IMDb gave back: base64 of the last title's id, and nothing else. */
const CURSOR = /^[A-Za-z0-9+/=_-]{1,128}$/;

/** One episode, as the app's list draws it. */
export type Episode = {
  /** Its place in the run of the show, not in its season. */
  number: number;
  title: string;
  date: string | null;
  image: string | null;
  description: string | null;
  url: string | null;
  /** The name of the still kept on this computer, once it has been filed. */
  still?: string | null;
};

/** One page of the episode connection, read out of a GraphQL answer. */
export type EpisodesPage = {
  total: number | null;
  hasNext: boolean;
  cursor: string | null;
  nodes: Record<string, unknown>[];
};

/** The title an answer is about, and the page of episodes it carried. */
export type TitleBlock = {
  title: string | null;
  type: string | null;
  /** Null when IMDb has no episode list for the title — which is what a film is. */
  page: EpisodesPage | null;
};

/** One series' episodes, and where the page of them starts and stops. */
export type Episodes = {
  title: string | null;
  total: number;
  episodes: Episode[];
  hasMore: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** The id of the title an entry links to, or null for any other link. */
export function imdbIdFrom(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const trimmed = url.trim();
  const page = TITLE_PAGE.exec(trimmed);
  if (page) {
    return page[1]?.toLowerCase() ?? null;
  }
  return TITLE_ID.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Whether a title is a run of episodes rather than a single film. */
export function isSeries(type: string | null): boolean {
  return type === "tvSeries" || type === "tvMiniSeries";
}

const EPISODE_FIELDS = `
          id
          titleText { text }
          releaseDate { year month day }
          plot { plotText { plainText } }
          primaryImage { url }`;

/**
 * The one query this plugin makes. `first` is capped by the caller; a cursor is
 * only ever one IMDb gave back, so nothing else can be put in the query.
 */
function episodesQuery(
  id: string,
  first: number,
  after: string | null,
): string {
  const cursor = after && CURSOR.test(after) ? `, after: ${JSON.stringify(after)}` : "";
  return `query Episodes {
  title(id: ${JSON.stringify(id)}) {
    id
    titleText { text }
    titleType { id }
    episodes {
      episodes(first: ${String(Math.min(PAGE, Math.max(1, first)))}${cursor}) {
        total
        pageInfo { hasNextPage endCursor }
        edges {
          node {${EPISODE_FIELDS}
          }
        }
      }
    }
  }
}`;
}

/** The first refusal IMDb wrote, if the answer carries one. */
function refusalIn(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.errors)) {
    return null;
  }
  for (const error of body.errors) {
    if (isRecord(error)) {
      const message = textOf(error.message, 200);
      if (message) {
        return message;
      }
    }
  }
  return null;
}

/**
 * One request to IMDb's web API. The client name is what makes the endpoint
 * answer at all; without it the request is refused at the edge, not by the API.
 */
export async function readGraphql(query: string): Promise<unknown> {
  const response = await fetch(GRAPHQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/graphql+json, application/json",
      "x-imdb-client-name": "imdb-web-next-localized",
      "x-imdb-user-country": "US",
      "x-imdb-user-language": "en-US",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);

  if (!response) {
    throw new PluginError("refused", "IMDb could not be reached.");
  }
  if (response.status === 429) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginError(
      "refused",
      "IMDb is rate limiting this computer. Try again in a minute.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginError(
      "refused",
      "IMDb refused this computer's request. Try again in a moment.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginError(
      "refused",
      `IMDb answered ${String(response.status)}.`,
    );
  }

  const raw = await new Response(response.body).text();
  if (raw.length > MAX_BYTES) {
    throw new PluginError("refused", "IMDb answered with too much data.");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new PluginError(
      "refused",
      "IMDb answered with something unreadable.",
    );
  }

  const refusal = refusalIn(body);
  if (refusal) {
    throw new PluginError("refused", refusal);
  }
  return body;
}

function parseConnection(value: Record<string, unknown>): EpisodesPage {
  const edges = Array.isArray(value.edges) ? value.edges : [];
  const nodes = edges.flatMap((edge) =>
    isRecord(edge) && isRecord(edge.node) ? [edge.node] : [],
  );
  const info = isRecord(value.pageInfo) ? value.pageInfo : null;
  return {
    total: wholeNumber(value.total),
    hasNext: info?.hasNextPage === true,
    cursor: info ? textOf(info.endCursor, 128) : null,
    nodes,
  };
}

/**
 * The title a page of the answer is about. A film carries `episodes: null`,
 * which is the one difference between "no episodes" and "no answer".
 */
export function parseTitleBlock(body: unknown): TitleBlock | null {
  if (!isRecord(body) || !isRecord(body.data)) {
    return null;
  }
  const title = isRecord(body.data.title) ? body.data.title : null;
  if (!title) {
    return null;
  }
  const holder = isRecord(title.episodes) ? title.episodes : null;
  const connection = holder && isRecord(holder.episodes) ? holder.episodes : null;
  return {
    title: isRecord(title.titleText)
      ? textOf(title.titleText.text, MAX_TITLE)
      : null,
    type: isRecord(title.titleType) ? textOf(title.titleType.id, 40) : null,
    page: connection ? parseConnection(connection) : null,
  };
}

/** A date IMDb gave as three numbers, or null when it gave nothing usable. */
function dateOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const year = wholeNumber(value.year);
  const month = wholeNumber(value.month);
  const day = wholeNumber(value.day);
  if (
    !year ||
    year < MIN_YEAR ||
    year > MAX_YEAR ||
    !month ||
    month < 1 ||
    month > 12 ||
    !day ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/** A picture is only used when it is an https address. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("https://") && trimmed.length <= 2_048
    ? trimmed
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

/**
 * The episodes an answer holds, in the order they were broadcast.
 *
 * Every request starts at the first episode of the show, so an episode's place
 * in the rows read so far is also its place in the run of the show: that is the
 * number the list shows. A row that names no title falls back to its number,
 * and a row without an id is not an episode anyone can open.
 */
export function buildEpisodes(nodes: readonly unknown[]): Episode[] {
  const episodes: Episode[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const id = textOf(node.id, 16);
    if (!id || !TITLE_ID.test(id)) {
      continue;
    }
    const number = episodes.length + 1;
    episodes.push({
      number,
      title:
        (isRecord(node.titleText)
          ? cleanText(node.titleText.text, MAX_TITLE)
          : null) ?? `Episode ${String(number)}`,
      date: dateOf(node.releaseDate),
      image: httpsUrl(
        isRecord(node.primaryImage) ? node.primaryImage.url : null,
      ),
      description: cleanText(
        isRecord(node.plot) && isRecord(node.plot.plotText)
          ? node.plot.plotText.plainText
          : null,
        MAX_DESCRIPTION,
      ),
      url: `https://www.imdb.com/title/${id}/`,
    });
  }
  return episodes;
}

/**
 * One page of a series' episodes.
 *
 * The app asks for a page at a time, so only as far into the list as that page
 * reaches is read: a page of twenty costs one request, and a page deep into a
 * long show costs one request per 250 episodes before it. Nothing is stored —
 * a list is read when it is opened, which is also when it is worth being
 * current.
 */
export async function fetchEpisodes(
  id: string,
  options: { offset: number; limit: number },
): Promise<Episodes> {
  const offset = Math.min(MAX_OFFSET, Math.max(0, Math.round(options.offset)));
  const limit = Math.max(1, Math.round(options.limit));
  const want = Math.min(MAX_OFFSET, offset + limit);

  const nodes: Record<string, unknown>[] = [];
  let title: string | null = null;
  let total: number | null = null;
  let cursor: string | null = null;
  let hasNext = true;

  while (nodes.length < want && hasNext) {
    const body = await readGraphql(
      episodesQuery(id, Math.min(PAGE, want - nodes.length), cursor),
    );
    const block = parseTitleBlock(body);
    if (!block) {
      throw new PluginError("no_data", "IMDb has no title at that link.");
    }
    title ??= block.title;
    if (!block.page) {
      // `episodes: null` is what a film answers.
      throw new PluginError(
        "bad_subject",
        isSeries(block.type)
          ? "IMDb has no episode list for that series yet."
          : "That IMDb entry is not a series, so it has no episodes to list.",
      );
    }
    total = block.page.total ?? total;
    nodes.push(...block.page.nodes);
    cursor = block.page.cursor;
    hasNext = block.page.hasNext && block.page.nodes.length > 0;
  }

  const all = buildEpisodes(nodes);
  const episodes = all.slice(offset, offset + limit);
  const known = total ?? all.length;
  return {
    title,
    total: known,
    episodes,
    hasMore: offset + episodes.length < known,
  };
}

/** What a link preview needs from a title: its name, its plot and its poster. */
export type Preview = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

/** The one query a preview costs, and the fields it reads. */
function previewQuery(id: string): string {
  return `query Preview {
  title(id: ${JSON.stringify(id)}) {
    id
    titleText { text }
    plot { plotText { plainText } }
    primaryImage { url }
  }
}`;
}

/**
 * The description and picture of one title, for a link whose page the app read
 * without either. IMDb's own preview is sparse, so a card is filled from the
 * title itself: the plot it publishes and its poster.
 */
export async function fetchPreview(id: string): Promise<Preview> {
  const body = await readGraphql(previewQuery(id));
  const title =
    isRecord(body) && isRecord(body.data) && isRecord(body.data.title)
      ? body.data.title
      : null;
  if (!title) {
    throw new PluginError("no_data", "IMDb has no title at that link.");
  }

  return {
    title: isRecord(title.titleText)
      ? cleanText(title.titleText.text, MAX_TITLE)
      : null,
    description: cleanText(
      isRecord(title.plot) && isRecord(title.plot.plotText)
        ? title.plot.plotText.plainText
        : null,
      MAX_DESCRIPTION,
    ),
    imageUrl: httpsUrl(
      isRecord(title.primaryImage) ? title.primaryImage.url : null,
    ),
  };
}

/** One page of the list, as the answer text the app reads. */
export function episodePage(episodes: Episode[], hasMore: boolean): string {
  return JSON.stringify({ episodes, hasMore });
}
