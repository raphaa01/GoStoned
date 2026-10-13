import { Capacitor, registerPlugin } from "@capacitor/core";

const nativeClock = registerPlugin<{ setActive(options: { active: boolean }): Promise<void> }>("GoStoneClock");

export async function setNativeGoClockActive(active: boolean): Promise<void> {
  if (Capacitor.isNativePlatform()) await nativeClock.setActive({ active });
}
