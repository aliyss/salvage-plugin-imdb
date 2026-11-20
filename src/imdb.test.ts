import { describe, expect, test } from "bun:test";

import {
  buildEpisodes,
  episodePage,
  imdbIdFrom,
  isSeries,
  parseTitleBlock,
} from "./imdb";

/** The shape IMDb answers a series with, cut down to the fields read here. */
const seriesBody = {
  data: {
    title: {
      id: "tt0903747",
      titleText: { text: "Breaking Bad" },
      titleType: { id: "tvSeries" },
      episodes: {
        episodes: {
          total: 62,
          pageInfo: { hasNextPage: true, endCursor: "dHQxMDU0NzI3" },
          edges: [
            {
              node: {
                id: "tt0959621",
                titleText: { text: "Pilot" },
                releaseDate: { year: 2008, month: 1, day: 20 },
                plot: { plotText: { plainText: "A chemistry teacher cooks." } },
                primaryImage: {
                  url: "https://m.media-amazon.com/images/M/pilot.jpg",
                },
              },
            },
            { node: null },
            {
              node: {
                id: "tt1054724",
                titleText: { text: "Cat's in the Bag..." },
                releaseDate: { year: 2008, month: 1, day: 27 },
                plot: { plotText: { plainText: "Walt and Jesse clean up." } },
                primaryImage: { url: "https://m.media-amazon.com/images/M/bag.jpg" },
              },
            },
          ],
        },
      },
    },
  },
};

describe("imdbIdFrom", () => {
  test("reads the title id out of the addresses IMDb links come in", () => {
    expect(imdbIdFrom("https://www.imdb.com/title/tt0903747/")).toBe(
      "tt0903747",
    );
    expect(imdbIdFrom("https://imdb.com/title/tt0111161")).toBe("tt0111161");
    expect(imdbIdFrom("http://m.imdb.com/title/tt0111161/?ref_=fn_al_tt_1")).toBe(
      "tt0111161",
    );
    expect(
      imdbIdFrom("https://www.imdb.com/title/tt0903747/episodes/?season=2"),
    ).toBe("tt0903747");
    expect(imdbIdFrom("https://www.imdb.com/title/tt0903747?ref_=x")).toBe(
      "tt0903747",
    );
    expect(imdbIdFrom("TT0903747")).toBe("tt0903747");
  });

  test("is not fooled by a host that only ends in the name", () => {
    expect(imdbIdFrom("https://imdb.com.evil.test/title/tt0903747/")).toBeNull();
    expect(imdbIdFrom("https://letterboxd.com/imdb/tt0903747/")).toBeNull();
    expect(imdbIdFrom("https://www.imdb.com/name/nm0000206/")).toBeNull();
    expect(imdbIdFrom("https://www.imdb.com/title/tt123/")).toBeNull();
    expect(imdbIdFrom("")).toBeNull();
    expect(imdbIdFrom(null)).toBeNull();
    expect(imdbIdFrom(undefined)).toBeNull();
  });
});

describe("isSeries", () => {
  test("knows the two kinds of series and nothing else", () => {
    expect(isSeries("tvSeries")).toBe(true);
    expect(isSeries("tvMiniSeries")).toBe(true);
    expect(isSeries("movie")).toBe(false);
    expect(isSeries("tvEpisode")).toBe(false);
    expect(isSeries(null)).toBe(false);
  });
});

describe("parseTitleBlock", () => {
  test("reads the title, its kind and its page of episodes", () => {
    const block = parseTitleBlock(seriesBody);
    expect(block?.title).toBe("Breaking Bad");
    expect(block?.type).toBe("tvSeries");
    expect(block?.page?.total).toBe(62);
    expect(block?.page?.hasNext).toBe(true);
    expect(block?.page?.cursor).toBe("dHQxMDU0NzI3");
    // An edge without a node is not an episode, and is dropped rather than
    // shifting the rows behind it.
    expect(block?.page?.nodes).toHaveLength(2);
  });

  test("a film answers no page at all, which is not a failure", () => {
    const block = parseTitleBlock({
      data: {
        title: {
          id: "tt0111161",
          titleText: { text: "The Shawshank Redemption" },
          titleType: { id: "movie" },
          episodes: null,
        },
      },
    });
    expect(block?.type).toBe("movie");
    expect(block?.page).toBeNull();
  });

  test("an answer with no title in it is no answer", () => {
    expect(parseTitleBlock(null)).toBeNull();
    expect(parseTitleBlock({})).toBeNull();
    expect(parseTitleBlock({ data: {} })).toBeNull();
    expect(parseTitleBlock({ data: { title: null } })).toBeNull();
  });
});

describe("buildEpisodes", () => {
  test("numbers the episodes through the show, not through the season", () => {
    const nodes = (seriesBody.data.title.episodes.episodes.edges ?? []).flatMap(
      (edge) => (edge.node ? [edge.node] : []),
    );
    const episodes = buildEpisodes(nodes);
    expect(episodes.map((episode) => episode.number)).toEqual([1, 2]);
    expect(episodes[0]?.title).toBe("Pilot");
    expect(episodes[0]?.date).toBe("2008-01-20");
    expect(episodes[0]?.url).toBe("https://www.imdb.com/title/tt0959621/");
    expect(episodes[0]?.image).toBe(
      "https://m.media-amazon.com/images/M/pilot.jpg",
    );
  });

  test("a row without an id is skipped, and the run of the show closes up", () => {
    const episodes = buildEpisodes([
      { id: "tt0959621", titleText: { text: "Pilot" } },
      { id: "not an id", titleText: { text: "Nope" } },
      { titleText: { text: "No id at all" } },
      { id: "tt1054724", titleText: { text: "Cat's in the Bag..." } },
    ]);
    expect(episodes.map((episode) => episode.number)).toEqual([1, 2]);
    expect(episodes.map((episode) => episode.title)).toEqual([
      "Pilot",
      "Cat's in the Bag...",
    ]);
  });

  test("a row with no title of its own is named by its number", () => {
    const episodes = buildEpisodes([{ id: "tt0959621" }, { id: "tt1054724" }]);
    expect(episodes.map((episode) => episode.title)).toEqual([
      "Episode 1",
      "Episode 2",
    ]);
  });

  test("a date only counts when all of it is there", () => {
    const episodes = buildEpisodes([
      { id: "tt0000001", releaseDate: { year: 2008, month: 1, day: 20 } },
      { id: "tt0000002", releaseDate: { year: 2008, month: 11, day: 2 } },
      { id: "tt0000003", releaseDate: { year: 2008, month: 1 } },
      { id: "tt0000004", releaseDate: { year: 2008 } },
      { id: "tt0000005", releaseDate: { year: 2008, month: 13, day: 1 } },
      { id: "tt0000006", releaseDate: { year: 12, month: 1, day: 1 } },
      { id: "tt0000007", releaseDate: null },
    ]);
    expect(episodes.map((episode) => episode.date)).toEqual([
      "2008-01-20",
      "2008-11-02",
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test("only an https picture is used, and the plot is flattened", () => {
    const [episode] = buildEpisodes([
      {
        id: "tt0959621",
        titleText: { text: "Pilot" },
        primaryImage: { url: "http://m.media-amazon.com/images/M/pilot.jpg" },
        plot: {
          plotText: { plainText: "A teacher<br>cooks   meth &amp; lies." },
        },
      },
    ]);
    expect(episode?.image).toBeNull();
    expect(episode?.description).toBe("A teacher cooks meth &amp; lies.");
  });

  test("a long plot is cut to what a row can hold", () => {
    const [episode] = buildEpisodes([
      {
        id: "tt0959621",
        plot: { plotText: { plainText: "x".repeat(900) } },
      },
    ]);
    expect(episode?.description).toHaveLength(400);
  });

  test("nothing in, nothing out", () => {
    expect(buildEpisodes([])).toEqual([]);
    expect(buildEpisodes([null, "tt0959621", 7])).toEqual([]);
  });
});

describe("episodePage", () => {
  test("answers the rows and whether more follow", () => {
    const episodes = buildEpisodes([
      { id: "tt0959621", titleText: { text: "Pilot" } },
    ]);
    expect(JSON.parse(episodePage(episodes, true))).toEqual({
      episodes: [
        {
          number: 1,
          title: "Pilot",
          date: null,
          image: null,
          description: null,
          url: "https://www.imdb.com/title/tt0959621/",
        },
      ],
      hasMore: true,
    });
  });
});
