// Texts of Settings > Background (v1.9). The panel shows only titles and controls; these go behind the "i" buttons.

export const STARTUP_FACTS = {
  title: 'Start with Windows',
  lines: [
    'Starts the app hidden in the tray when you sign in to Windows.',
    'Windows Settings > Apps > Startup shows the same switch; this one always reads it from there.',
    'Only the installed app can do this. In a development build the switch is off and cannot be changed.',
  ],
} as const;

export const RAIN_ALERT_FACTS = {
  title: 'Rain alerts',
  lines: [
    'Uses the same city as the tray icon: Your location if it is on, else your first favorite, else the last city you viewed.',
    'Checks about every 12 minutes, also while the window is hidden, with the same weather requests the app already makes.',
    'The forecast is hourly, so an alert names the hour the rain is expected, not the minute.',
    'Windows can block notifications: check Notifications and Do not disturb in Windows Settings.',
  ],
} as const;

// Texts of Settings > Widget (v2.0), behind its "i" buttons.

export const WIDGET_BACKGROUND_FACTS = {
  title: 'Widget background',
  lines: [
    'Wallpaper: your desktop picture, blurred, cut to where the widget sits. The picture is read on this PC and is never saved or sent anywhere.',
    'Live: a blurred view of whatever is behind the widget, captured about once a second. The frames stay in memory only.',
    'While Live is on, the widget is hidden from screenshots and screen sharing (so it never captures itself).',
    'Live uses more power than Wallpaper.',
    'With a slideshow, Spotlight, a plain colour or a different picture on each monitor, the widget shows a plain dark card.',
  ],
} as const;

export const WIDGET_EFFECTS_FACTS = {
  title: 'Weather effects',
  lines: [
    'Draws the weather behind the widget: drifting clouds when it is cloudy, falling rain with splashes and drops that gather on the boxes when it rains, and a sun glow when it is sunny.',
    'Snow and clear nights have no effect.',
    'It stops while the widget is hidden or covered, and shows a still picture when Windows is set to reduce animations.',
    'It costs some power. Turn it off to save it.',
  ],
} as const;
