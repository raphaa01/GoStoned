import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // iOS uses this identifier; the existing Android project overrides its
  // applicationId to app.gostone in android/app/build.gradle for Google Play.
  appId: "com.gostone.app",
  appName: "GoStone",
  webDir: "mobile-dist",
  backgroundColor: "#f4f0e7",
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    allowsLinkPreview: false,
  },
  android: {
    allowMixedContent: false,
  },
  server: {
    hostname: "localhost",
    iosScheme: "capacitor",
    androidScheme: "https",
  },
  plugins: {
    CapacitorCookies: { enabled: true },
    CapacitorHttp: { enabled: true },
    SystemBars: { insetsHandling: "css" },
  },
};

export default config;
