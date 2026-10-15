# tubetag

tubetag is a local app that downloads audio from YouTube and YouTube Music and edits the tags of the files in batch.

- **Clipboard watch**: copy a YouTube or YouTube Music link (video, Short, or playlist). tubetag downloads it immediately as `.m4a` with the cover and metadata embedded. You can also paste links into the app. For a link to a video in a playlist, tubetag asks if you want the video only or the whole playlist. From a YouTube mix (a playlist that YouTube generates), tubetag downloads only the first 25 songs.
- **Downloads page**: the clipboard watch switch, a field to paste links, and the list of download jobs.
- **Library page**: shows every `.m4a` and `.mp3` file in the output folder, grouped by folder. The search field filters by title, artist, album and file name. Use click, Shift-click and Cmd/Ctrl-click to select files. The editor opens next to the list when files are selected.
- **Player**: double-click a song to play it. The bar at the bottom plays the songs of that folder in list order and works with the media keys of your system.
- **Unavailable songs**: when videos of a playlist cannot be downloaded, the folder shows a "Not downloaded" list with their titles and a YouTube search link for each.
- **Replace an unavailable song**: click "Replace" or "Search on YouTube" on a "Not downloaded" row to select it. The next video link that you copy or paste replaces that row. tubetag downloads the video into the playlist folder as `<position> - <title>.m4a`, or moves the library file that already has that video ID. Then it sets the album and the track number and records the video in the download archive.
- **Tag editor**: edits artist, album, album artist, year, genre and track numbers for many files at once. The title field shows only when one file is selected. Sets the cover from an upload, an image URL or another file, and can crop it to a square.
- **Rename**: renames files from a pattern such as `{album} - {title}`. You see a preview first, and name conflicts block the rename.
- **MusicBrainz lookup**: finds the recording or release in [MusicBrainz](https://musicbrainz.org), the open music database, and applies its tags and front cover.

tubetag runs on your computer at `http://127.0.0.1:4317` and opens your browser when it starts.

## Disclaimer

tubetag is for audio that you have the right to download: copyright-free music, music under a license that allows downloads, or your own uploads. Downloading copyrighted content without permission can break copyright law and the YouTube Terms of Service. You are responsible for what you download with tubetag. The authors do not support or accept liability for any other use.

## Requirements

tubetag calls `yt-dlp`, `ffmpeg` and `ffprobe` from your `PATH`. yt-dlp needs a JavaScript runtime to run the YouTube player code. tubetag gives yt-dlp its own Bun runtime, so you do not install one. On Linux it also needs `wl-paste` (Wayland) or `xclip` (X11) to read the clipboard. The app does not start until these programs are installed.

| OS | Install |
| --- | --- |
| macOS | `brew install yt-dlp ffmpeg` |
| Linux | `pipx install yt-dlp`, then `ffmpeg` and `wl-clipboard` or `xclip` from your distribution (for example `sudo apt install ffmpeg wl-clipboard`) |
| Windows | `winget install yt-dlp.yt-dlp Gyan.FFmpeg` |

To run from source, you also need [Bun](https://bun.sh).

## Run

```sh
bun install
bun run dev
```

## Build standalone executables

```sh
bun run compile
```

This writes one executable per platform to `dist/` (macOS arm64 and x64, Linux x64, Windows x64). The executables include the web UI. They still need the programs listed in [Requirements](#requirements).

## Settings and data

| OS | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/tubetag` |
| Linux | `$XDG_CONFIG_HOME/tubetag` or `~/.config/tubetag` |
| Windows | `%APPDATA%\tubetag` |

- `settings.json` holds the output folder (default `~/Music/tubetag`), the clipboard watch status, the square cover option and the MusicBrainz contact. You can change these in the Settings dialog.
- `archive.txt` is the yt-dlp download archive. yt-dlp skips videos that are listed in it.
- `missing.json` holds the playlist videos that could not be downloaded, per playlist folder.

Playlists download to `<output folder>/<playlist title>/<position> - <title>.m4a`. tubetag uses the playlist title as the album and the playlist position as the track number. Single videos download to `<output folder>/Singles/<title> [<video ID>].m4a`. Use the rename tool to set the final file names.

MusicBrainz asks each app to identify itself with a contact. tubetag sends `tubetag/<version>` as the User-Agent. If you enter an email address or URL in the Settings dialog, tubetag adds it to the User-Agent.

## License

[GPL-3.0](LICENSE)
