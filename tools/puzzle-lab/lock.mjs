import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function acquireLock(root) {
  mkdirSync(root, { recursive: true });
  const path = join(root, 'writer.lock'), owner = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor;
    try {
      descriptor = openSync(path, 'wx');
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, owner }));
      closeSync(descriptor); descriptor = undefined;
      return () => {
        try { if (JSON.parse(readFileSync(path, 'utf8')).owner === owner) unlinkSync(path); } catch { /* already released */ }
      };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Der lokale Schreib-Lock ist unlesbar. Lab-Prozesse schließen und writer.lock prüfen.'); }
      if (!Number.isInteger(previous.pid) || previous.pid < 1) throw new Error('Ungültiger lokaler Schreib-Lock.');
      try { process.kill(previous.pid, 0); } catch (probe) {
        if (probe.code === 'ESRCH' && attempt === 0) { unlinkSync(path); continue; }
      }
      throw new Error('Dieses Datenverzeichnis wird bereits von einem Puzzle-Lab-Prozess verwendet. Vorhandenes Lab öffnen oder einen anderen --root verwenden.');
    }
  }
  throw new Error('Schreib-Lock konnte nicht angelegt werden.');
}
