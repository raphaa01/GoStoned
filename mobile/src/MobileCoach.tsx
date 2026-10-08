import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { GoBoard } from "@/components/game/GoBoard";
import { LearnTeacher } from "@/components/learn/LearnTeacher";
import { getCoachCopy } from "@/lib/i18n/coach";
import { createTrainingPosition, applyTrainingAction, type TrainingPosition } from "@/lib/learn/trainingGame";
import { trainerAnalysisInput, trainerBestMove, trainerBlackLead, trainerOpponentMove, trainerStrength, undoTrainerTurn, type TrainerPositionAnalysis } from "@/lib/learn/aiTrainer";
import { buildCoachEvidence, coachInfluence, type CoachEvidence } from "@/lib/learn/coachEvidence";
import { createCoachClient, type CoachText } from "@/lib/mobile/coachClient";
import { trainerKataGo } from "@/lib/mobile/trainerKataGo";
import type { BoardSize, Position } from "@/lib/game/types";
import type { GoStoneBotMove } from "@/lib/bot/modelV1";

type Phase = "setup" | "human" | "analysis" | "reply" | "retry" | "ended" | "resigned" | "error";
type Comment = { text: CoachText | null; evidence: CoachEvidence };
type Baseline = { position: TrainingPosition; controller: AbortController; promise: Promise<TrainerPositionAnalysis> };

export function MobileCoach() {
  const { rating, ratingLoading } = useAuth();
  const { locale } = useI18n();
  const copy = getCoachCopy(locale);
  const [size, setSize] = useState<BoardSize>(9);
  const [position, setPosition] = useState(() => createTrainingPosition(9));
  const [phase, setPhase] = useState<Phase>("setup");
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState<Comment | null>(null);
  const [hint, setHint] = useState<Position | null>(null);
  const [showMarks, setShowMarks] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [estimate, setEstimate] = useState<{ position: TrainingPosition; result: TrainerPositionAnalysis } | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const live = useRef({ position, phase, revision: 0 });
  const gameId = useRef(crypto.randomUUID());
  const operation = useRef<AbortController | null>(null);
  const baseline = useRef<Baseline | null>(null);
  const decoder = useRef<ReturnType<typeof createCoachClient> | null>(null);
  const profile = trainerStrength(rating?.value);
  const retryReply = useRef<(() => void) | null>(null);
  const failedOperation = useRef<(() => void) | null>(null);

  function publish(next: TrainingPosition, nextPhase: Phase) {
    live.current.position = next; live.current.phase = nextPhase;
    setPosition(next); setPhase(nextPhase);
  }
  function invalidate() {
    live.current.revision++;
    operation.current?.abort(); operation.current = null;
    baseline.current?.controller.abort(); baseline.current = null;
    retryReply.current = null; failedOperation.current = null;
    setToolBusy(false); setError(null); setHint(null); setShowMarks(false); setEstimate(null);
  }
  function active(controller: AbortController, revision: number) {
    return !controller.signal.aborted && live.current.revision === revision;
  }
  function scan(snapshot: TrainingPosition, controller: AbortController, visits = 12, maxTime = .65, ownership = false) {
    return trainerKataGo.analyze(trainerAnalysisInput(snapshot, gameId.current, live.current.revision), { visits, maxTime, ownership, signal: controller.signal });
  }
  function prefetch(snapshot: TrainingPosition) {
    baseline.current?.controller.abort();
    const controller = new AbortController();
    const promise = scan(snapshot, controller);
    // Record failure without an unhandled rejection; a user move can retry it.
    void promise.catch(() => undefined);
    baseline.current = { position: snapshot, promise, controller };
  }

  useEffect(() => {
    let mounted = true;
    const sessionState = live.current;
    const warmController = new AbortController();
    const client = createCoachClient(); decoder.current = client;
    const nativeReady = trainerKataGo.status().then(async status => {
      if (status.available && !warmController.signal.aborted) await scan(createTrainingPosition(9), warmController, 2, .1);
      return status;
    });
    void Promise.all([nativeReady, client.warm()]).then(([status]) => {
      if (!mounted) return;
      setReady(status.available); setPreparing(false);
    }).catch(() => { if (mounted) { setError(copy.error); setPreparing(false); } });
    return () => {
      mounted = false; sessionState.revision++;
      warmController.abort();
      operation.current?.abort(); baseline.current?.controller.abort(); client.dispose();
    };
  // Language affects UI copy only; the supplied decoder is German.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fail(controller: AbortController, revision: number, again: () => void) {
    if (!active(controller, revision)) return;
    failedOperation.current = again;
    publish(live.current.position, "error"); setError(copy.error);
  }

  async function reply(snapshot: TrainingPosition, controller: AbortController, revision: number) {
    if (!active(controller, revision)) return;
    operation.current = controller;
    if (snapshot.consecutivePasses >= 2) { publish(snapshot, "ended"); return; }
    publish(snapshot, "reply");
    try {
      const analysis = await scan(snapshot, controller, profile.visits, 7);
      if (!active(controller, revision)) return;
      const move = trainerOpponentMove(snapshot, analysis, profile);
      const applied = applyTrainingAction(snapshot, move);
      if (!applied.ok) throw new Error("Illegal opponent move.");
      setEstimate(null); setHint(null); setShowMarks(false);
      publish(applied.position, applied.position.consecutivePasses >= 2 ? "ended" : "human");
      if (applied.position.consecutivePasses < 2) prefetch(applied.position);
    } catch { fail(controller, revision, () => void reply(snapshot, controller, revision)); }
  }

  async function explain(before: TrainingPosition, after: TrainingPosition, cached: Baseline | null, controller: AbortController, revision: number) {
    try {
      const previous = cached?.position === before ? await cached.promise.catch(() => scan(before, controller)) : await scan(before, controller);
      if (!active(controller, revision)) return;
      const current = await scan(after, controller);
      if (!active(controller, revision)) return;
      let evidence = buildCoachEvidence(before, after, previous, current);
      setEstimate({ position: after, result: current });
      // Surface the quick, grounded comment before the opponent's longer search.
      const text = await decoder.current!.comment(evidence, controller.signal);
      if (!active(controller, revision)) return;
      setComment({ text, evidence });
      const ranked = [...previous.moveInfos].sort((a, b) => a.order - b.order);
      const exceptionalCandidate = evidence.judgement === "good" && ranked[1]?.visits >= 2 && ranked[0].scoreLead - ranked[1].scoreLead >= 2;
      if (evidence.judgement === "blunder" || evidence.loss >= 8 || exceptionalCandidate) {
        const refinedBefore = await scan(before, controller, 32, 1.2);
        const refinedAfter = await scan(after, controller, 32, 1.2, true);
        if (!active(controller, revision)) return;
        const refined = buildCoachEvidence(before, after, refinedBefore, refinedAfter, true);
        const agrees = evidence.stable && evidence.judgement !== "uncertain"
          && Math.abs(refined.loss - evidence.loss) <= Math.max(2, evidence.loss * .3);
        evidence = refined;
        const refinedText = await decoder.current!.comment(evidence, controller.signal);
        if (!active(controller, revision)) return;
        setComment({ text: refinedText, evidence }); setEstimate({ position: after, result: refinedAfter });
        if (agrees && evidence.stable && evidence.judgement === "blunder") {
          retryReply.current = () => void reply(after, controller, revision);
          publish(after, "retry"); return;
        }
      }
      await reply(after, controller, revision);
    } catch { fail(controller, revision, () => void explain(before, after, null, controller, revision)); }
  }

  function humanMove(move: GoStoneBotMove) {
    const snapshot = live.current.position;
    if (live.current.phase !== "human" || snapshot.turn !== "black" || toolBusy) return;
    const applied = applyTrainingAction(snapshot, move);
    if (!applied.ok) { setError(copy.invalidMove); return; }
    const cached = baseline.current;
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    const revision = ++live.current.revision;
    setComment(null); setHint(null); setShowMarks(false); setEstimate(null); setError(null);
    publish(applied.position, "analysis");
    void explain(snapshot, applied.position, cached, controller, revision);
  }

  function start() {
    invalidate(); gameId.current = crypto.randomUUID(); setComment(null);
    const next = createTrainingPosition(size); publish(next, "human"); prefetch(next);
  }
  function undo() {
    const next = undoTrainerTurn(live.current.position);
    invalidate(); setComment(null); publish(next, "human"); prefetch(next);
  }
  async function tool(kind: "help" | "estimate") {
    if (toolBusy || !["human", "retry", "ended", "resigned"].includes(live.current.phase)) return;
    setToolBusy(true); setError(null);
    const snapshot = live.current.position;
    const controller = new AbortController(); operation.current = controller;
    const revision = live.current.revision;
    try {
      const cached = estimate?.position === snapshot ? estimate.result : null;
      const result = cached && (kind === "help" || cached.ownership) ? cached : await scan(snapshot, controller, 24, 1.2, kind === "estimate");
      if (!active(controller, revision)) return;
      setEstimate({ position: snapshot, result });
      if (kind === "help" && snapshot.turn === "black") {
        const best = trainerBestMove(snapshot, result);
        setHint(best.kind === "play" ? best : null);
        if (best.kind === "pass") setError(copy.pass);
      }
      if (kind === "estimate") setExpanded(true);
    } catch { if (active(controller, revision)) setError(copy.error); }
    finally { if (active(controller, revision)) setToolBusy(false); }
  }

  const judgement = comment?.evidence.judgement;
  const tone = judgement === "blunder" || judgement === "mistake" ? "correction" : comment?.evidence.extraordinary ? "success" : "neutral";
  const status = phase === "analysis" ? copy.analysing : phase === "reply" ? copy.thinking : phase === "ended" ? copy.ended : phase === "resigned" ? copy.resigned : phase === "human" ? copy.yourTurn : "";
  const last = position.moves.at(-1);
  const marks = showMarks && comment?.text ? comment.evidence.marks[comment.text.reason] ?? [] : [];
  const lead = estimate?.position === position ? trainerBlackLead(estimate.result) : null;
  const territory = expanded && estimate?.position === position && estimate.result.ownership ? coachInfluence(position, estimate.result) : undefined;

  return <section className="mobile-coach" aria-label={copy.title}>
    <header className="mobile-coach-heading"><h1>{copy.title}</h1><span className="mobile-coach-beta">{copy.beta}</span></header>
    {phase === "setup" ? <div className="mobile-coach-setup">
      <LearnTeacher><p>{copy.ready}</p></LearnTeacher>
      <fieldset><legend>{copy.size}</legend><div className="mobile-coach-sizes">{([9, 13, 19] as const).map(value => <button aria-pressed={size === value} className="button" key={value} onClick={() => setSize(value)} type="button">{value} × {value}</button>)}</div></fieldset>
      <p>{copy.rating}: {profile.rating}</p><p className="mobile-coach-muted">{copy.ratingApproximate}</p>
      {locale !== "de" ? <p className="mobile-coach-muted">{copy.language}</p> : null}
      {preparing ? <p role="status">{copy.preparing}</p> : !ready ? <p role="status">{copy.unavailable}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button className="button button--primary" disabled={!ready || preparing || ratingLoading} onClick={start} type="button">{copy.start}</button>
    </div> : <>
      <LearnTeacher announce tone={tone}>
        <p>{comment?.text?.text ?? (phase === "analysis" ? copy.analysing : comment ? copy.noComment : copy.initial)}</p>
        {phase === "retry" ? <><p>{copy.retryPrompt}</p><div className="mobile-coach-actions"><button className="button button--primary" disabled={toolBusy} onClick={undo} type="button">{copy.retry}</button><button className="button" disabled={toolBusy} onClick={() => retryReply.current?.()} type="button">{copy.continue}</button></div></> : null}
        {comment?.text && ((comment.evidence.marks[comment.text.reason]?.length ?? 0) > 0 || comment.evidence.alternative) ? <button className="mobile-coach-show" onClick={() => { setShowMarks(!showMarks); setHint(showMarks ? null : comment.evidence.alternative); }} type="button">{showMarks ? copy.hide : copy.show}</button> : null}
      </LearnTeacher>
      <p className="mobile-coach-status" role="status">{status}</p>
      <GoBoard boardSize={size} boardState={position.board} disabled={phase !== "human" || toolBusy} hintMove={hint} lastMove={last && !last.isPass ? { x: last.x!, y: last.y! } : null} markedIntersections={marks} onIntersectionClick={(x, y) => humanMove({ kind: "play", x, y })} precisionRevision={`${gameId.current}:${live.current.revision}:${position.moves.length}`} previewColor="black" targetStones={marks} territory={territory} />
      <div className="mobile-coach-tools">
        <button className="button" disabled={phase !== "human" || toolBusy} onClick={() => void tool("help")} type="button">{copy.help}</button>
        <button className="button" disabled={!position.moves.some(m => m.color === "black")} onClick={undo} type="button">{copy.undo}</button>
        <button className="button" disabled={phase !== "human" || toolBusy} onClick={() => humanMove({ kind: "pass" })} type="button">{copy.pass}</button>
        <button className="button" disabled={phase === "ended" || phase === "resigned"} onClick={() => { invalidate(); publish(live.current.position, "resigned"); }} type="button">{copy.resign}</button>
      </div>
      <div className="mobile-coach-estimate">
        <button aria-expanded={expanded} className="mobile-coach-estimate-toggle" disabled={toolBusy || phase === "analysis" || phase === "reply" || phase === "error"} onClick={() => expanded ? setExpanded(false) : void tool("estimate")} type="button"><span>{copy.estimate}</span>{judgement ? <span data-judgement={judgement}>{comment?.evidence.extraordinary ? copy.exceptional : copy.labels[judgement]}</span> : null}<span aria-hidden="true">{expanded ? "−" : "+"}</span></button>
        {expanded ? <div><div aria-label={lead === null ? copy.estimate : `${lead > 0 ? copy.black : copy.white}: ${Math.abs(lead).toFixed(1)} ${copy.points}`} className="mobile-coach-scorebar"><span style={{ width: `${lead === null ? 50 : Math.max(8, Math.min(92, 50 + lead * 2))}%` }} /></div><p>{lead === null ? "…" : Math.abs(lead) < .2 ? copy.even : `${lead > 0 ? copy.black : copy.white} +${Math.abs(lead).toFixed(1)} ${copy.points}`}</p><p className="mobile-coach-muted">{copy.estimateNote}</p></div> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {phase === "error" ? <button className="button" onClick={() => { setError(null); failedOperation.current?.(); }} type="button">{copy.retryAnalysis}</button> : null}
      {phase === "ended" || phase === "resigned" ? <button className="button button--primary" onClick={() => { invalidate(); setComment(null); publish(createTrainingPosition(size), "setup"); }} type="button">{copy.newGame}</button> : null}
    </>}
  </section>;
}
