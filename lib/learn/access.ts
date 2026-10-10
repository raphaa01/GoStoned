// A test entitlement changes navigation, never completion or challenge results.
export function canOpenLearnLesson(
  complete: boolean,
  lessonIndex: number,
  currentIndex: number,
  developerAccess: boolean,
): boolean {
  return lessonIndex >= 0 && (developerAccess || complete || lessonIndex <= currentIndex);
}
