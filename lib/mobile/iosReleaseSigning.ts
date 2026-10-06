export function iosReleaseSigning(team: string, profileUuid: string) {
  if (!/^[A-Z0-9]{10}$/.test(team)) {
    throw new Error("A valid GOSTONE_APPLE_TEAM_ID is required for App Store signing.");
  }
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(profileUuid)) {
    throw new Error("GOSTONE_IOS_PROFILE_UUID must identify an installed App Store provisioning profile.");
  }

  return {
    archiveSettings: [
      `DEVELOPMENT_TEAM=${team}`,
      "CODE_SIGN_STYLE=Manual",
      "CODE_SIGN_IDENTITY=Apple Distribution",
      `PROVISIONING_PROFILE_SPECIFIER=${profileUuid}`,
    ],
    exportOptions: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>signingStyle</key><string>manual</string>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>teamID</key><string>${team}</string>
<key>provisioningProfiles</key><dict><key>app.gostone</key><string>${profileUuid}</string></dict>
</dict></plist>
`,
  };
}
