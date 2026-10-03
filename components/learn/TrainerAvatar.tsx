// Reused from the locally saved AI trainer (38c8490, mobile/src/TrainerSpeech.tsx).
export function TrainerAvatar() {
  return <svg aria-hidden="true" className="learn-teacher__avatar" viewBox="0 0 72 80" fill="none">
    <path d="M8 80V67c0-12 12-20 28-20s28 8 28 20v13" fill="var(--mobile-accent, var(--color-moss-strong))" />
    <path d="M27 48v8c0 9 18 9 18 0v-8" fill="#DCA67F" />
    <path d="M18 21C18 6 54 5 54 23v17c0 14-10 20-18 20S18 51 18 39V21Z" fill="#EEC29B" />
    <path d="M16 28C10 5 31 0 42 4c15-1 21 10 13 27l-4-14c-9 6-20 7-30 4l-5 7Z" fill="#343A35" />
    <path d="M24 33h8m8 0h8" stroke="#343A35" strokeWidth="2" strokeLinecap="round" />
    <circle cx="28" cy="38" r="1.8" fill="#343A35" /><circle cx="44" cy="38" r="1.8" fill="#343A35" />
    <path d="M31 48c3 3 7 3 10 0" stroke="#9B6050" strokeWidth="2" strokeLinecap="round" />
    <path d="m23 61 13 8 13-8" stroke="var(--mobile-surface, var(--color-surface-raised))" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
