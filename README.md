<div align="center">

# 🌦️ Weather Dashboard

**A dark, modern Windows desktop weather app: live conditions, a 7-day forecast, rain and temperature charts, and favorite cities. Built with Electron, Express and TypeScript.**

![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![Node](https://img.shields.io/badge/Node-22%20LTS-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)
![API key](https://img.shields.io/badge/API%20key-none%20needed-success?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)
![Release](https://img.shields.io/badge/release-v1.4.7-orange?style=for-the-badge)

| ![Clear day theme](docs/theme-clear.png) | ![Night theme](docs/theme-night.png) | ![Rain theme](docs/theme-rain.png) |
|:---:|:---:|:---:|
| Clear day | Night | Rain |

</div>

---

## Install

1. Download `Weather-Dashboard-Setup-<version>.exe` from the [latest release](https://github.com/MooreHaww/weather-dashboard/releases/latest).
2. Windows may say **"Windows protected your PC"** because the installer is not code-signed. Click **More info**, then **Run anyway**.
3. Pick an install folder. You get Start Menu and desktop shortcuts.

No Node.js needed. Installed copies (1.4.0 and later) update themselves from the GitHub releases.

## 💡 Why this project exists

Most weather apps are cluttered, full of ads, or need an account. I wanted one clean window that answers the questions I actually have: what is it like now, will it rain today, and what does the week look like, for any city I care about.

It is also **project #2** of my build plan. The goal was to ship something real: not a script, but an app that installs on another person's PC, updates itself, works offline, and has tests.

## 🔎 What it does

- **Current conditions:** temperature, feels like, wind, humidity, rain chance, sunrise and sunset.
- **Live local clock** for the selected city, using that city's own timezone (for example `UTC+5:45` for Kathmandu).
- **7-day forecast:** click a day (or use ←/→) and the rain and temperature charts switch to it.
- **Rain chart** with a one-line summary such as *"Rain likely at 4 PM (70%)"* (or *"16:00"* in 24-hour mode).
- **Temperature chart** with a dashed feels-like line and an hourly icon strip.
- **City search** with keyboard shortcuts (`Ctrl+K` or `/`).
- **Favorites and recent cities**, shown as cards with live weather. Recent cities can be cleared.
- **Settings panel (v1.2):** a full-window liquid-glass panel with temperature (°C/°F) and wind-speed units (km/h, mph, m/s) and a 12-hour or 24-hour clock that updates everywhere at once.
- **Live data and chart (v1.3):** refreshes itself every 5 minutes with no flicker, and the temperature chart covers the whole day (12 AM to 11 PM in the city's own time): hours that have passed are grey, the rest is coloured, and a pulsing dot marks the current time ("Current time" in the legend). The hourly strip is evenly spaced and can show every 3 hours, every 2 hours or every hour.
- **Auto-update (v1.4):** checks GitHub Releases 10 seconds after start and then every 4 hours, downloads a new version in the background and installs it when you close the app.
- **Update now (v1.4.6):** when an update is ready, the gear shows a red dot and Settings has an **Update now** button. After you confirm, the app closes, updates and opens again.
- **v1.4.5:** remembers the window's size, position and maximized state; `F5` or `Ctrl+R` refreshes.
- **Updates in Settings (v1.4.7):** the **Updates** section always shows the app version and where updating stands: up to date (and when it was last checked), downloading, or ready with the **Update now** button.
- **Works at any window size**, down to 480×400.
- **Offline-friendly:** if the internet drops, it shows the last data it fetched and says so.
- **Accessible:** every chart has a screen-reader data table.

Weather data comes from [Open-Meteo](https://open-meteo.com/), which is free and needs no API key.

### 📊 Measured result: the cache really helps

`npm run bench` replays one realistic session (38 requests) against live Open-Meteo. Measured on 2026-10-24:

| | Requests | Median | 95th percentile |
|---|---:|---:|---:|
| Served from cache | 23 | **0.6 ms** | 1.5 ms |
| Fetched from Open-Meteo | 15 | 48.1 ms | 210.8 ms |

**Cache hit rate: 60.5%.** A cached answer is about **79× faster**. Your numbers will vary with your network.

## ⚙️ Setup

### Want to run it from the code?

You need **Node.js 22 LTS**.

```bash
git clone https://github.com/MooreHaww/weather-dashboard.git
cd weather-dashboard
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite (hot reload) + Electron |
| `npm run dev:server` | API + Vite only, open `http://127.0.0.1:5173` in a browser |
| `npm test` | Unit and API tests (218 tests, no internet needed) |
| `npm run test:e2e` | Launches the real app and checks the UI (171 tests, needs internet) |
| `npm run test:update` | Builds the installer, then checks auto-update and "Update now" in the packaged app against a local test feed (7 tests) |
| `npm run lint` | ESLint and type-check |
| `npm run bench` | Cache hit rate and response times |
| `npm run dist` | Builds the Windows installer |

There are no secrets anywhere. Copy `.env.example` to `.env` only if you want to change the dev port or cache times.

## 🎯 What I wanted to learn

- How to build a **desktop app with Electron** and package it into a real installer.
- How to put a small **Express server inside the app** so the UI talks to a clean local API.
- How to write a **cache** (10-minute TTL for weather, 24 hours for city search) and prove it with numbers instead of guessing.
- How to deal with **time zones** properly: the clock must follow the city, not my PC.
- How to **test a GUI app end to end**, including checking that the charts actually drew pixels.
- How to make an Electron app **secure** and **accessible**.
- Why a **local JSON file** beats a cloud database for an app that other people install.

## What I learned

- **Library defaults are objects you change, not replace.** I assigned a new object to `Chart.defaults.animation`. That broke Chart.js animations ("this._fn is not a function") and left both charts empty. Setting single fields fixed it.
- **A test setting can hide a bug.** The end-to-end tests once forced reduced motion, so the animation bug above never showed up in them. They now run with animations on and count the pixels each chart painted.
- **`min-height` on a flex child changes how it shrinks.** An explicit `min-height` replaced flexbox's "not smaller than the content" rule. The top card got squeezed and cards overlapped when the window was resized or docked. Now there are no fixed heights and one scroll container.
- **Drag regions ignore what is drawn on top.** The title bar is a window drag region, and Electron combines drag and no-drag areas regardless of what is drawn over them. Every clickable thing in the title bar needs `no-drag`.
- **File names must survive the upload.** GitHub renames uploaded files with spaces, so 1.3.0's `latest.yml` named an installer file that did not exist on the release. The installer name now has no spaces, and `npm run release-files` checks that `latest.yml` and the files agree.
- **A cache changes what "refresh" means.** Weather is cached for 10 minutes, so a 5-minute refresh would have been answered from the cache. The refresh and the Refresh button now ask the server to skip the cache, and the answer still refills it.
- **"Loading" and "showing" are two different cities.** When a city failed to load, the next redraw put the new city's name over the old city's weather and clock, and the star saved the wrong city. The app now keeps track of the city being loaded and the city on screen separately.

## ⚙️ Settings panel

The gear in the title bar opens a liquid-glass panel that covers the whole window: the dashboard behind it stays visible but frosted. `Esc`, the close button (in the gear's spot) or the gear itself closes it, and keyboard focus stays inside while it is open. Its content scrolls when the window is short. With "reduce animations" on in Windows it fades instead of sliding.

| Section | Options |
|---|---|
| **Updates** | Always first. The installed version and the state: "Version 1.4.7 · Up to date · checked 10:42" after a check that found nothing newer (the time follows the 12/24-hour setting), "Version X is downloading…", or "Version X is ready" with **Update now**. It asks "Restart now?" first; **Later** or `Esc` changes nothing, and the update still installs when you close the app. Before the first check, in a build that does not update itself, or after a failed check ("Couldn't check for updates") it shows only the version, never "Up to date" |
| **Units** | Temperature °C / °F, wind speed km/h / mph / m/s |
| **Time format** | 12-hour or 24-hour, shown with examples from the current time (for example "12-hour (4:00 PM)" and "24-hour (16:00)"); used by the live clock, hourly strip, chart labels, sunrise and sunset, and the rain line |
| **Temperature chart** | Time labels under the temperature chart: every 3 hours (default), every 2 hours, or every hour. A narrow card shows fewer, evenly spaced |

Settings are saved in the local JSON file and checked by the server; older files without the new fields load with the defaults (12-hour, km/h, every 3 hours). Sections are plain data in `SETTINGS_SECTIONS` (`src/renderer/components/settings.ts`), built with `settingsRow` and `segmentedControl`. Later releases add their own sections (startup, close behavior, widget) the same way. The Updates section is built with the same helpers in `src/renderer/components/updateNote.ts` and is added at the top. It only displays the state the main process sends it (`src/main/updateTracker.ts`); the page cannot set it. Every time on screen goes through one function, `formatTime` in `src/shared/time.ts`.

## 🏗️ How it was built

```text
Electron main process
 ├─ starts Express on 127.0.0.1 (random free port, never reachable from the network)
 │    ├─ /api/geocode   → Open-Meteo geocoding   (cached 24 h)
 │    ├─ /api/weather   → Open-Meteo forecast    (cached 10 min)
 │    ├─ /api/state, /api/favorites, /api/recent, /api/settings
 │    ├─ /api/stats     → cache hit rate and response times
 │    └─ the built UI
 ├─ the window loads http://127.0.0.1:<port>
 └─ electron-updater checks GitHub Releases (installed app only)
      └─ preload: "update ready" and the update state to the page, "Update now" back (the page's only message)
```

| Folder | Purpose |
|---|---|
| `src/main/` | Electron entry: starts the server, opens a hardened window, auto-update, window size and position |
| `src/server/` | Express app, cache, Open-Meteo client, JSON storage, routes |
| `src/shared/` | Types, weather codes, time helpers (used by server and UI) |
| `src/renderer/` | The UI: HTML/CSS, components, Chart.js charts, SVG icons |
| `tests/` | Vitest unit/API tests, the end-to-end tests and the packaged-app update test |
| `scripts/` | App launcher for tests, benchmark, screenshot, icon and release-file tools |

**Key decisions**

- **Local JSON file, not MongoDB Atlas.** A cloud database needs a connection string, and anyone can unpack an Electron app and read it. It would also send each user's private data to a shared database and need internet just to show favorites. A local file needs no account, works offline and uninstalls cleanly. Writes are atomic, so a crash cannot leave a half-written file.
- **Security.** The window runs sandboxed with context isolation and no Node access. A strict Content Security Policy blocks outside scripts. The server only answers requests addressed to `127.0.0.1` or `localhost` (this blocks DNS-rebinding attacks). All API text is HTML-escaped. The page can send one message to the main process ("Update now", with no arguments); it is ignored unless an update has been downloaded and it comes from the app's own window and top frame, loaded from the local server.
- **Cache.** Coordinates are rounded to about 1 km so the same city always reuses one entry, and two identical simultaneous requests share one call to Open-Meteo.

**How it is tested**

- **Unit and API tests** (Vitest) run offline: cache, storage, time and rain helpers, settings, auto-update scheduling, the update state shown in Settings and the "Update now" checks in the main process.
- **End-to-end tests** start the real built app in its own Electron window, with its own profile and a throwaway data folder, and drive it over the Chrome DevTools Protocol with real clicks and key presses. They resize the real window and measure the layout: no overlapping cards, the stat dividers every 50 px from 480 to 1400 px, the hourly strip's spacing, the current-time dot's position. They count the pixels each chart painted and fail on any page error. Animations stay on.
- **The update test** builds the installer, runs the packaged app and points its updater at a local fake feed (a `latest.yml` and a fake installer). It checks the Updates section in each state (before the first check, up to date, downloading, ready, and a feed that returns 503), the download, the note, the red dot, "Update now" and the restart path. The fake installer never runs.

**Releases and auto-update**

1. Bump `version` in `package.json`. It must be higher than the version people have installed, or nothing updates.
2. `npm run dist` builds the installer and checks the release files.
3. Create a GitHub release tagged `vX.Y.Z` (the same version), published (not a draft or prerelease), and upload exactly three files: `Weather-Dashboard-Setup-X.Y.Z.exe`, its `.blockmap` and `latest.yml`.
4. Installed copies find it within 10 seconds of starting or within 4 hours while running, download it and install it when closed, or right away with **Update now**.

**The v1.4.5 code review.** The whole app was reviewed for bugs. A problem only counted once it was reproduced, in the packaged app or in a test. Each fix came with a test that failed before it. Problems that could not be reproduced were written down and left alone, and there were no refactors. See [Code review (v1.4.5)](#code-review-v145).

## Code review (v1.4.5)

**What was reviewed:** the Electron main process, the local server (cache, storage, routes) and the UI.

**Fixed (each with a test that failed first):**

- A city name was shown over another city's weather after a failed load (and the star saved the wrong city).
- Screen readers read the clock every second.
- Keyboard focus was lost after clearing recent cities.

**Left alone:** the hour labels around a daylight-saving change. Open-Meteo labels the whole 7-day forecast with the city's *current* UTC offset, so in the week before a clock change, the hours after the change are one hour off. It corrects itself at the first refresh after the change. A real fix would give those days 23 or 25 hours and break the strip's even spacing, so it is not a small change.

## Privacy

- No account, no sign-in, no analytics.
- Favorites, recent cities and settings are saved in `%APPDATA%\Weather Dashboard\weather-dashboard.json`, and the window size and position in `window-state.json` next to it. Uninstalling keeps them; you can delete the folder.
- The app connects to two services:
  - **Open-Meteo**, for the forecast (the coordinates of the city on screen and of your favorite and recent cities) and for city search (what you type in the search box);
  - **GitHub**, to check this repository's releases for updates and download them (installed app only).
- The window itself can only talk to the app's own local server. Links you click open in your browser.

## Data and credits

Weather data by [Open-Meteo.com](https://open-meteo.com/), under [CC BY 4.0](https://open-meteo.com/en/licence). Open-Meteo's licence asks for a link next to wherever its data is shown (the app's footer has one), a link to the licence (the footer has that too), and a note if changes were made. Its [terms](https://open-meteo.com/en/terms) allow the free API "only for non-commercial purposes", for example "Private or non-profit websites or apps that do not have subscriptions or advertising", with fewer than 10,000 calls per day, 5,000 per hour and 600 per minute.

Charts by [Chart.js](https://www.chartjs.org/) (MIT); app shell by [Electron](https://www.electronjs.org/) (MIT).

## Known limitations

- **Unsigned installer:** Windows SmartScreen warns on install (**More info**, then **Run anyway**).
- **Windows only:** there is only a Windows installer.
- **Daylight-saving hour labels:** in the week before a clock change, the hours after the change are labelled one hour off (see [Code review (v1.4.5)](#code-review-v145)).

## 🗺️ Roadmap

### v1.0
- [x] Current weather with a live clock in the city's own timezone
- [x] 7-day forecast, rain and temperature charts
- [x] City search, favorites, recent cities, °C/°F
- [x] Offline fallback and cache with a measured hit rate
- [x] Windows installer

#### v1.0 (Fixes)
- [x] Fix the empty rain and temperature charts
- [x] Fix cards overlapping when the window is resized or docked
- [x] Fix day cards not clickable

### v1.1
- [x] Selectable days in the 7-day forecast
- [x] Temperature box with feels-like and hourly icons
- [x] Bigger refresh button
- [x] Recent cities as full cards, favorites with a gold bar
- [x] Stats without boxes
- [x] Empty settings sheet
- [x] 103 automated tests, MIT license
- [x] v1.1.0 released

#### v1.1 (Fixes)
- [x] One automatic retry when Open-Meteo returns a server error

### v1.2 - Settings
- [x] Settings overhaul: turn the settings sheet into a full-screen liquid-glass panel that blurs everything behind it
- [x] A settings page for units, startup, close behavior and widget options
- [x] An option for 12 am/pm format and 24 one

#### v1.2 (Fixes)
- [x] Remove the duplicate °C/°F toggle from the title bar
- [x] Fix the missing divider lines in the narrow layout

### v1.3 - Live data and chart
- [x] Refresh / update every 5m by itself
- [x] Make the temperature box cover all 24h of the day; the time that has passed has no colours in it, plus a dot to show the time we are in
- [x] Choose how detailed the temperature box times are: every 3 hours, every 2 hours, or every hour
- [x] Clear 12-hour / 24-hour choice with examples

#### v1.3 (Fixes)
- [x] Hourly labels evenly spaced, no empty gaps
- [x] Removed the "Now" label; the dot pulses and the legend says "Current time"

### v1.4 - Auto-update
- [x] Auto-update through GitHub Releases

#### v1.4 (Fixes)

##### v1.4.5
- [x] Full code review, fixes only for proven problems
- [x] Version shown in Settings
- [x] Remember window size and position
- [x] Offline note
- [x] F5 / Ctrl+R refresh
- [x] Clear recent button

###### v1.4.5 (Fixes)
- [x] City name no longer shown over another city's weather after a failed load
- [x] Screen readers no longer read the clock every second
- [x] Keyboard focus no longer lost after clearing recent cities

##### v1.4.6
- [x] Red dot on the settings gear when an update is ready
- [x] Update now button in Settings: asks to confirm, then updates and restarts by itself

###### v1.4.6 (Fixes)
- [x] Removed the box around the gear icon

##### v1.4.7
- [x] Settings shows the version and whether it is up to date
- [x] Update available shows in Settings with a button to restart
- [x] "Up to date" shows when the last check happened
- [x] Link to the Open-Meteo license next to the credit in the footer

###### v1.4.7 (Fixes)
- [x] Remove favorite and Clear recent show a message when the app cannot save, instead of doing nothing
- [x] The version in package-lock.json now matches the app (it said 1.3.0)

### v1.5 - Location
- [ ] Auto-detect my location on first launch
- [ ] Add (your location) and it stays on top

#### v1.5 (Fixes)

### v1.6 - Liquid glass look
- [ ] Make the full background 100% liquid glass with blur, and anything that needs a box gets extra blur behind it

#### v1.6 (Fixes)

### v1.7 - Background mode
- [ ] Close-button choice: exit completely, or keep running in the background (which keeps the widget alive)
- [ ] Start with Windows: option to launch the app on PC startup
- [ ] Tray icon that shows the current temperature

#### v1.7 (Fixes)

### v1.8 - Rain alerts
- [ ] Rain alerts, e.g. a notification "Rain starting in about 30 minutes"

#### v1.8 (Fixes)

### v1.9 - Desktop widget
- [ ] Desktop widget: an option in the app to add a weather widget to the Windows desktop

#### v1.9 (Fixes)

### v2.0 - History
- [ ] Optional long-term history (SQLite, still local)

#### v2.0 (Fixes)

### Later
- [ ] More themes (still an idea)

## License

MIT, see [LICENSE](LICENSE).
