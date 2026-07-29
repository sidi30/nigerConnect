// Single source of truth for the app-store links used by the landing page and
// the invitation page.
//
// The Android build has not been submitted yet (iOS only so far), so the Play
// Store URL 404s. Pointing a "Disponible sur Google Play" button at a Google
// error page is worse than saying nothing: Android is the dominant platform in
// the target audience, so that dead end is where most invited people drop off.
// Until the app ships, the Android call-to-action sends visitors to the launch
// waiting list instead.
//
// The day the Play Store listing goes live: flip ANDROID_AVAILABLE to true.
// Nothing else to change.

export const IOS_STORE_URL = "https://apps.apple.com/fr/app/nigerconnect/id6775895189";

export const ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.sidi30.nigerconnect";

export const ANDROID_AVAILABLE = false;
