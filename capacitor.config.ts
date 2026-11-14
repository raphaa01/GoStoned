import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.gostone",
  appName: "GoStone",
  webDir: "mobile-dist",
  backgroundColor: "#F5F1E9",
  ios: {
    contentInset: "never",
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
