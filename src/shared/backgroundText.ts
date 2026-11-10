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
