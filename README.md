# IMDb for Salvage

A [Salvage](https://github.com/aliyss/salvage-web) plugin that adds an
**Episodes** button to entries that link to an IMDb title. The list is read from
IMDb by the **Salvage Helper** on your own computer; nothing about it is stored
on your account, and there is nothing to sign in to.

## What it adds

- An **Episodes** button on the entry of any link to `imdb.com` — the series'
  episodes, numbered through the show, each with its air date, its synopsis and
  a still.
- Twenty rows at a time: the first page is drawn as soon as it arrives and
  scrolling reads the next one.
- A film has no episode list, and the entry says so rather than showing an empty
  one. Anything that is not a series answers the same way.

The stills are filed on this computer the first time they are seen, so a second
open of the same list draws its pictures without asking IMDb or the image host
for anything.

## Requirements

- Salvage with the desktop helper paired

No IMDb account, no client id and no token: the plugin reads the same episode
list a signed-out visitor to imdb.com is shown.

## Where the list comes from

`imdb.com` does not answer a plain request with a page at all — it answers a
challenge that only a browser's JavaScript can pass, so there is no HTML for a
plugin to read. What does answer is the endpoint imdb.com's own site calls,
`https://api.graphql.imdb.com/`, and it answers JSON when the request names one
of IMDb's web clients in a header (`x-imdb-client-name`). The plugin makes one
query there, for the title and its episodes:

```graphql
query { title(id: "tt0903747") { titleText { text } titleType { id }
  episodes { episodes(first: 250) { total pageInfo { hasNextPage endCursor }
    edges { node { id titleText { text } releaseDate { year month day }
      plot { plotText { plainText } } primaryImage { url } } } } } } }
```

Two things about that answer shape decide how a list is drawn:

- **Seasons.** An episode only reports its number inside its season, and there
  is no season field to ask for. The connection arrives in broadcast order
  across the whole show, though, so the rows are numbered through the show —
  the same absolute count AniList and SIMKL use — and the order they arrive in
  is the order they are drawn.
- **Films.** A film answers `episodes: null`. That is how the plugin knows to
  say the entry is not a series, instead of drawing an empty list.

Nothing is stored but the pictures: the list is read when it is opened, which is
also when it is worth being current.

## Paging

A page of twenty costs one request. The command reads only as far into the list
as the page reaches — one request covers up to 250 episodes — so a page deep
into a long-running show costs one request per 250 episodes before it, and no
more than 500 episodes are ever read for one page.

## Stills

Each still is kept in `SALVAGE_PLUGIN_DATA/media/`, named by a hash of its
address, and the helper serves it back from this computer. A picture is only
filed when it is an `https` address served as an image and smaller than 1.5 MB;
one that cannot be filed leaves its row without a picture, and is tried again on
the next open.

## Settings

None. The plugin has one button, and nothing about it is configurable.

## Development

```sh
bun install
bun run typecheck
bun test
bun run build     # writes dist/plugin.js
```

The plugin talks to the helper over stdin/stdout with the small SDK in
`src/sdk.ts`; `SALVAGE_PLUGIN_DATA` is the folder it may use for its own files.

## Publishing

`.github/workflows/release.yml` builds, typechecks and tests every push to
`master`, then publishes `manifest.json` and `dist/plugin.js` on a release
tagged `v<version>` from the manifest. Bump the manifest version to cut a new
release; the helper installs a plugin from a repository that publishes both
assets.

## Data

IMDb's own note on this API is that "public, commercial, and/or non-private use
of the IMDb data provided by this API is not allowed", with limited
non-commercial use covered by the terms at
[help.imdb.com](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX).
This plugin is a personal viewer for one person's own entries, and that is the
only use it is meant for.

IMDb and the IMDb logo are trademarks of IMDb.com, Inc. This plugin is not
affiliated with, endorsed by, or certified by IMDb.
