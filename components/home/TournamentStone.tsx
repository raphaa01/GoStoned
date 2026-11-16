"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type PointerEvent } from "react";

type Point = readonly [number, number, number];
type Face = { points: readonly [number, number, number]; normal: Point; shade: number };

const size = 288;
const tilt = -.29;
const tiltSin = Math.sin(tilt);
const tiltCos = Math.cos(tilt);
const goldenRatio = (1 + Math.sqrt(5)) / 2;

function onStoneSurface([x, y, z]: Point): Point {
  const radius = Math.hypot(x, y, z);
  // Keep the face round and compress its depth to form a biconvex Go stone.
  return [x / radius, .985 * y / radius, .42 * z / radius];
}

function buildMesh() {
  const vertices: Point[] = [
    [-1, goldenRatio, 0], [1, goldenRatio, 0], [-1, -goldenRatio, 0], [1, -goldenRatio, 0],
    [0, -1, goldenRatio], [0, 1, goldenRatio], [0, -1, -goldenRatio], [0, 1, -goldenRatio],
    [goldenRatio, 0, -1], [goldenRatio, 0, 1], [-goldenRatio, 0, -1], [-goldenRatio, 0, 1],
  ];
  const seeds = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const points = vertices.map(onStoneSurface);
  const midpointIndices = new Map<number, number>();
  const faces: Face[] = [];

  function splitEdge(a: number, b: number) {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = low * vertices.length + high;
    const existing = midpointIndices.get(key);
    if (existing !== undefined) return existing;

    const start = vertices[low];
    const end = vertices[high];
    // Vary the split so neighboring facets stay irregular while sharing an edge.
    const fraction = .5 + Math.sin(key * 2.41) * .105;
    const point = (axis: number) => start[axis] + (end[axis] - start[axis]) * fraction;
    const index = points.push(onStoneSurface([point(0), point(1), point(2)])) - 1;
    midpointIndices.set(key, index);
    return index;
  }

  function addFace(a: number, b: number, c: number) {
    const [x, y, z] = points[a];
    const [u, v, w] = points[b];
    const [p, q, r] = points[c];
    const nx = (v - y) * (r - z) - (w - z) * (q - y);
    const ny = (w - z) * (p - x) - (u - x) * (r - z);
    const nz = (u - x) * (q - y) - (v - y) * (p - x);
    const magnitude = Math.hypot(nx, ny, nz);
    faces.push({
      points: [a, b, c],
      normal: [nx / magnitude, ny / magnitude, nz / magnitude],
      shade: Math.sin((a + 3 * b + 5 * c) * 1.613) * 3,
    });
  }

  for (const [a, b, c] of seeds) {
    const ab = splitEdge(a, b);
    const bc = splitEdge(b, c);
    const ca = splitEdge(c, a);
    addFace(a, ab, ca);
    addFace(ab, b, bc);
    addFace(ca, bc, c);
    addFace(ab, bc, ca);
  }

  return { points, faces };
}

const { points, faces } = buildMesh();

function drawStone(ctx: CanvasRenderingContext2D, angle: number, white: boolean) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const rotate = ([x, y, z]: Point): Point => {
    const depth = x * sin + z * cos;
    return [x * cos - z * sin, y * tiltCos - depth * tiltSin, y * tiltSin + depth * tiltCos];
  };
  const projected = points.map(rotate);
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = .75;
  ctx.save();
  ctx.translate(147 + sin * 4, 239);
  ctx.scale(1, .14 + cos * .018);
  const shadow = ctx.createRadialGradient(0, 0, 5, 0, 0, 87);
  shadow.addColorStop(0, white ? "rgb(0 0 0 / .29)" : "rgb(46 35 24 / .15)");
  shadow.addColorStop(1, "transparent");
  ctx.fillStyle = shadow;
  ctx.fillRect(-87, -87, 174, 174);
  ctx.restore();

  for (const face of faces) {
    const [x, y, z] = rotate(face.normal);
    if (z <= 0) continue;
    const light = Math.max(0, -.53 * x - .64 * y + .56 * z);
    const tone = Math.round((white ? 159 + 88 * light : 19 + 70 * light) + face.shade);
    ctx.beginPath();
    for (const index of face.points) {
      const [px, py] = projected[index];
      ctx.lineTo(size / 2 + px * 103, 137 + py * 103);
    }
    ctx.closePath();
    ctx.fillStyle = white ? `rgb(${tone + 3} ${tone + 2} ${tone})` : `rgb(${tone} ${tone} ${tone + 2})`;
    // Cover antialiasing gaps without outlining the individual facets.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
    ctx.fill();
  }
}

export function TournamentStone({ href, label }: { href: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const rotation = useRef({ current: .68, target: .68 });
  const frame = useRef(0);
  const requestDraw = useRef<() => void>(() => {});
  const drag = useRef<{ id: number; startX: number; startY: number; startAt: number; lastX: number; lastAt: number; speed: number; moved: boolean } | null>(null);
  const suppressPointerClick = useRef(false);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previousFrame = 0;

    const animate = (time: number) => {
      frame.current = 0;
      const angles = rotation.current;
      const remaining = angles.target - angles.current;
      const elapsed = previousFrame ? Math.min(33, time - previousFrame) : 16;
      if (Math.abs(remaining) < .002 || reducedMotion.matches) {
        angles.current = angles.target % (2 * Math.PI);
        angles.target = angles.current;
        previousFrame = 0;
      } else {
        angles.current += remaining * (1 - Math.exp(-elapsed / 68));
        previousFrame = time;
        frame.current = requestAnimationFrame(animate);
      }
      drawStone(ctx, angles.current, (root.dataset.mobileTheme ?? root.dataset.theme) === "dark");
    };
    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(animate);
    };
    requestDraw.current = schedule;
    const observer = new MutationObserver(schedule);
    observer.observe(root, { attributes: true, attributeFilter: ["data-mobile-theme", "data-theme"] });
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, []);

  function start(event: PointerEvent<HTMLAnchorElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressPointerClick.current = false;
    drag.current = {
      id: event.pointerId, startX: event.clientX, startY: event.clientY, startAt: event.timeStamp,
      lastX: event.clientX, lastAt: event.timeStamp, speed: 0, moved: false,
    };
  }

  function move(event: PointerEvent<HTMLAnchorElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.moved) {
      const horizontal = Math.abs(event.clientX - gesture.startX);
      const vertical = Math.abs(event.clientY - gesture.startY);
      if (horizontal < 7 || horizontal < vertical) return;
      gesture.moved = true;
      suppressPointerClick.current = true;
      if (event.pointerType === "mouse") event.currentTarget.setPointerCapture(event.pointerId);
    }
    const delta = event.clientX - gesture.lastX;
    gesture.speed = delta / Math.max(8, event.timeStamp - gesture.lastAt);
    gesture.lastX = event.clientX;
    gesture.lastAt = event.timeStamp;
    rotation.current.target -= delta * .0105;
    requestDraw.current();
  }

  function end(event: PointerEvent<HTMLAnchorElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    drag.current = null;
    if (event.type !== "pointerup") return;

    const tap = !gesture.moved && event.timeStamp - gesture.startAt < 400
      && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 7;
    if (tap && event.pointerType === "touch") {
      // Some touch engines suppress a synthetic click immediately after a swipe.
      // Activate the link on release and consume any follow-up pointer click.
      suppressPointerClick.current = true;
      event.currentTarget.click();
      return;
    }
    if (gesture.moved && event.timeStamp - gesture.lastAt < 85
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      rotation.current.target -= Math.max(-.38, Math.min(.38, gesture.speed * .24));
      requestDraw.current();
    }
  }

  return (
    <Link
      className="home-tournament home-shortcut"
      draggable={false}
      href={href}
      onClick={(event) => {
        if (event.detail && suppressPointerClick.current) event.preventDefault();
      }}
      onPointerCancel={end}
      onPointerDown={start}
      onPointerLeave={(event) => { if (!drag.current?.moved) end(event); }}
      onPointerMove={move}
      onPointerUp={end}
    >
      <span className="home-tournament__art" aria-hidden="true">
        <canvas width={size} height={size} ref={canvas} />
      </span>
      <span className="home-shortcut__label"><strong>{label}</strong><ArrowRight aria-hidden="true" size={18} /></span>
    </Link>
  );
}
