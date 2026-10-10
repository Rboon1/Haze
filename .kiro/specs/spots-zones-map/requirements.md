# Spots, effort zones and map

Extends the haze prototype using ideas from the "Boleh Lari?" project (Downloads/haze-run copy). GPS tracking and history are out of scope for this round.

## Requirements (acceptance criteria)

1. WHEN the page loads THEN the system SHALL fetch live air quality for all spots in ONE request and list them cleanest first (lowest US AQI), unavailable spots last.
2. WHEN a spot has no valid or fresh reading THEN the system SHALL show "Unavailable" for it and SHALL NOT show a number.
3. WHEN the user filters by state THEN the list and the map markers SHALL show only that state's spots.
4. WHEN the user selects a spot (list or map) THEN the air quality panel, 3D lungs, plan figures and run check SHALL switch to that spot, and the map SHALL move to it.
5. The system SHALL offer effort levels Rest and Z1-Z5, show air breathed per minute, breathing mode (nose / nose + mouth / mouth), assumed lung-retention share, and heart-rate range for the user's age (HRmax = 208 - 0.7 x age).
6. The system SHALL report PM2.5 breathed in, the estimated share that stays in the lungs, a cigarette equivalent, and the equivalent hours of sitting outside.
7. WHEN the sensitive-profile toggle is on THEN the maximum advised zone SHALL follow the stricter column of the AQI table.
8. The verdict SHALL be the stricter of (a) planned zone vs the AQI-advised maximum zone and (b) hourly PM2.5 vs WHO 15 / EPA 35 ug/m3, and SHALL list its reasons.
9. WHEN waiting would help THEN the system SHALL show the cleanest hour in the next 12 h between 05:00 and 21:00 local time, only if PM2.5 is at least 20% lower than now.
10. The plan (effort, minutes, age, sensitive) SHALL persist in localStorage; invalid stored values SHALL fall back to defaults.
11. Every spot distance SHALL be marked "sourced" (with links) or "typical, unverified".
12. All dynamic text SHALL be inserted as text, never as HTML.

## Edge cases
Partial batch failure; whole-batch failure; stale data; corrupt localStorage; age outside 10-90; distance outside 0.5-42 km; pace outside 3-15 min/km; geolocation denied.
