// ELF program-header verification works on every build host, without an NDK tool.
export function assertElf16kbAlignment(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => { throw new Error("Native Android engine must be a 16 KB aligned ELF64 binary."); };
  if (bytes.length < 64 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46 || bytes[4] !== 2 || bytes[5] !== 1) invalid();
  const offset = Number(view.getBigUint64(32, true));
  const size = view.getUint16(54, true); const count = view.getUint16(56, true);
  if (!Number.isSafeInteger(offset) || size < 56 || count < 1 || offset + size * count > bytes.length) invalid();
  let loads = 0;
  for (let index = 0; index < count; index++) {
    const at = offset + index * size;
    if (view.getUint32(at, true) !== 1) continue;
    loads++;
    const alignment = view.getBigUint64(at + 48, true);
    const fileOffset = view.getBigUint64(at + 8, true); const virtualAddress = view.getBigUint64(at + 16, true);
    if (alignment < BigInt(16384) || (alignment & (alignment - BigInt(1))) !== BigInt(0) || fileOffset % BigInt(16384) !== virtualAddress % BigInt(16384)) invalid();
  }
  if (!loads) invalid();
}
