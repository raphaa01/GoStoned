import { Capacitor, registerPlugin, SystemBars, SystemBarType } from "@capacitor/core";

const nativeClock = registerPlugin<{ setActive(options: { active: boolean }): Promise<void> }>("GoStoneClock");

export async function setNativeGoClockActive(active: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await nativeClock.setActive({ active });
  if (Capacitor.getPlatform() === "ios") {
    const options = { bar: SystemBarType.NavigationBar };
    if (active) await SystemBars.hide(options);
    else await SystemBars.show(options);
  }
}
