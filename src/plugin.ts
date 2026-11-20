import { episodePage, fetchEpisodes, imdbIdFrom } from "./imdb";
import { PluginError, serve } from "./sdk";
import { keepStills } from "./still";

/** The most rows one page of the app's list holds. */
const PAGE_LIMIT = 20;
/** The most rows one command will read, however far the list is scrolled. */
const MAX_LIMIT = 250;

/** The page the app asked for: where it starts, and how much it holds. */
function pageOf(paging: { offset?: number; limit?: number } | undefined): {
  /** Null when the request carried no paging at all, which is an old helper. */
  paged: boolean;
  offset: number;
  limit: number;
} {
  if (!paging) {
    // A helper too old to pass `paging` on must not be handed a first page that
    // claims there is more, so it is given the first rows and told that is it.
    return { paged: false, offset: 0, limit: MAX_LIMIT };
  }
  const offset = Math.max(0, Math.round(paging.offset ?? 0));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.round(paging.limit ?? PAGE_LIMIT)),
  );
  return { paged: true, offset, limit };
}

/**
 * The episodes of one series, for the button the app draws on an IMDb entry.
 * One command per open, and nothing kept but the stills: the list itself is
 * read again each time, because IMDb's answer is the only copy of it there is.
 */
async function episodes(
  subject: { link?: { url?: string } | null } | undefined,
  paging: { offset?: number; limit?: number } | undefined,
): Promise<{ kind: string; text: string }> {
  const id = imdbIdFrom(subject?.link?.url);
  if (!id) {
    throw new PluginError(
      "bad_subject",
      "This entry does not link to an IMDb title.",
    );
  }

  const page = pageOf(paging);
  const series = await fetchEpisodes(id, {
    offset: page.offset,
    limit: page.limit,
  });

  // The stills are filed on this computer before the rows are answered, so the
  // browser asks the helper for them rather than m.media-amazon.com.
  const stills = await keepStills(series.episodes.map((episode) => episode.image));
  const drawn = series.episodes.map((episode, index) => ({
    ...episode,
    still: stills[index] ?? null,
  }));

  return {
    kind: "episodes",
    text: episodePage(drawn, page.paged ? series.hasMore : false),
  };
}

export default () =>
  serve(async ({ command, params }) => {
    if (command === "episodes") {
      return await episodes(params.subject, params.paging);
    }

    throw new PluginError("unsupported", `Unknown command ${command}.`);
  });
