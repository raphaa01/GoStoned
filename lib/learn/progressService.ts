import { query, withTransaction } from "@/lib/db";
import { mergeLearnProgress, parseLearnProgress, type LearnProgress } from "./progress";

type LearnProgressRow = {
  completed_lesson_ids: unknown;
  current_lesson_id: unknown;
  completed_stages: unknown;
  last_step_by_lesson: unknown;
  challenge_results: unknown;
  updated_at: Date | string;
};

function serializeRow(row: LearnProgressRow): LearnProgress {
  return parseLearnProgress({
    completedLessonIds: row.completed_lesson_ids,
    currentLessonId: row.current_lesson_id,
    completedStages: row.completed_stages,
    lastStepByLesson: row.last_step_by_lesson,
    challengeResults: row.challenge_results,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  });
}

const COLUMNS = `completed_lesson_ids,current_lesson_id,completed_stages,
  last_step_by_lesson,challenge_results,updated_at`;

export async function getLearnProgress(userId: string): Promise<LearnProgress | null> {
  const result = await query<LearnProgressRow>(
    `SELECT ${COLUMNS} FROM learn_progress WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ? serializeRow(result.rows[0]) : null;
}

export async function saveLearnProgress(userId: string, input: LearnProgress): Promise<LearnProgress> {
  return withTransaction(async (client) => {
    // Serialize a user's concurrent devices, including the first insert.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`learn-progress:${userId}`]);
    const existing = await client.query<LearnProgressRow>(`SELECT ${COLUMNS} FROM learn_progress WHERE user_id = $1`, [userId]);
    const parsed = parseLearnProgress(input);
    const progress = existing.rows[0] ? mergeLearnProgress(parsed, serializeRow(existing.rows[0])) : parsed;
    const result = await client.query<LearnProgressRow>(
    `INSERT INTO learn_progress (
       user_id,completed_lesson_ids,current_lesson_id,completed_stages,
       last_step_by_lesson,challenge_results,updated_at
     ) VALUES ($1,$2::jsonb,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET
       completed_lesson_ids = EXCLUDED.completed_lesson_ids,
       current_lesson_id = EXCLUDED.current_lesson_id,
       completed_stages = EXCLUDED.completed_stages,
       last_step_by_lesson = EXCLUDED.last_step_by_lesson,
       challenge_results = EXCLUDED.challenge_results,
       updated_at = EXCLUDED.updated_at
     RETURNING ${COLUMNS}`,
      [
        userId,
        JSON.stringify(progress.completedLessonIds),
        progress.currentLessonId,
        JSON.stringify(progress.completedStages),
        JSON.stringify(progress.lastStepByLesson),
        JSON.stringify(progress.challengeResults),
        progress.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Learning progress could not be saved.");
    return serializeRow(row);
  });
}
