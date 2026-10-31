import test from "node:test";
import assert from "node:assert/strict";
import { assertElf16kbAlignment } from "./elfAlignment";
function elf(alignment: bigint, offset = BigInt(0)) {
  const b = Buffer.alloc(120); b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  b.writeBigUInt64LE(BigInt(64), 32); b.writeUInt16LE(56, 54); b.writeUInt16LE(1, 56);
  b.writeUInt32LE(1, 64); b.writeBigUInt64LE(offset, 72); b.writeBigUInt64LE(BigInt(0), 80); b.writeBigUInt64LE(alignment, 112); return b;
}
test("Android engine verification rejects 4 KB, misaligned offsets and truncated ELF headers", () => {
  assert.doesNotThrow(() => assertElf16kbAlignment(elf(BigInt(16384))));
  assert.throws(() => assertElf16kbAlignment(elf(BigInt(4096))), /16 KB/);
  assert.throws(() => assertElf16kbAlignment(elf(BigInt(16384), BigInt(4096))), /16 KB/);
  assert.throws(() => assertElf16kbAlignment(elf(BigInt(16384)).subarray(0, 100)), /16 KB/);
});
