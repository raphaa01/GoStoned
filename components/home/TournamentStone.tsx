"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type PointerEvent } from "react";

type Point = readonly [number, number, number];
type Face = { points: readonly [number, number, number]; normal: Point; shade: number };

const sides = 12;
const size = 288;
const tilt = .26;
const thickness = .83;
const tiltSin = Math.sin(tilt);
const tiltCos = Math.cos(tilt);
const points: Point[] = [[0, -thickness, 0]];
const faces: Face[] = [];

function addFace(a: number, b: number, c: number) {
  const [x, y, z] = points[a];
  const [ux, uy, uz] = points[b].map((value, axis) => value - points[a][axis]);
  const [vx, vy, vz] = points[c].map((value, axis) => value - points[a][axis]);
  let normal: Point = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  // Keep normals facing outwards on both caps and along the beveled edge.
  const direction = normal[0] * x + normal[1] * y + normal[2] * z < 0 ? -1 : 1;
  const magnitude = Math.hypot(...normal);
  normal = [normal[0] * direction / magnitude, normal[1] * direction / magnitude, normal[2] * direction / magnitude];
  faces.push({ points: [a, b, c], normal, shade: Math.sin((a + b * 3 + c * 7) * 2.17) * .035 });
}

const rings = 5;
for (let ring = 0; ring < rings; ring++) {
  const latitude = Math.PI * (ring + 1) / (rings + 1);
  for (let side = 0; side < sides; side++) {
    const longitude = (side + (ring % 2) / 2) * Math.PI * 2 / sides;
    const radius = Math.sin(latitude) * (1 + .023 * Math.sin((side + ring * sides) * 7));
    points.push([
      radius * Math.cos(longitude),
      -thickness * Math.cos(latitude) + .024 * Math.sin(side * 3 + ring * 2),
      radius * Math.sin(longitude),
    ]);
  }
}
const bottom = points.push([0, thickness, 0]) - 1;
for (let side = 0; side < sides; side++) {
  const next = (side + 1) % sides;
  addFace(0, 1 + side, 1 + next);
  for (let ring = 0; ring < rings - 1; ring++) {
    const start = 1 + ring * sides;
    const a = start + side;
    const b = start + next;
    const c = a + sides;
    const d = b + sides;
    if (ring % 2 === 0) {
      addFace(a, b, c);
      addFace(b, d, c);
    } else {
      addFace(a, b, d);
      addFace(a, d, c);
    }
  }
  addFace(bottom, bottom - sides + next, bottom - sides + side);
}

function drawStone(ctx: CanvasRenderingContext2D, angle: number, white: boolean) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const rotate = ([x, y, z]: Point): Point => {
    const depth = x * sin + z * cos;
    return [x * cos - z * sin, y * tiltCos - depth * tiltSin, y * tiltSin + depth * tiltCos];
  };
  const projected = points.map(rotate);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(150 + sin * 7, 240);
  ctx.scale(1, .22 + cos * .025);
  const shadow = ctx.createRadialGradient(0, 0, 5, 0, 0, 103);
  shadow.addColorStop(0, white ? "rgb(0 0 0 / .44)" : "rgb(46 35 24 / .26)");
  shadow.addColorStop(1, "transparent");
  ctx.fillStyle = shadow;
  ctx.fillRect(-103, -103, 206, 206);
  ctx.restore();

  for (const face of faces) {
    const [x, y, z] = rotate(face.normal);
    if (z <= .075) continue;
    const light = Math.max(0, -.47 * x - .63 * y + .61 * z);
    const tone = Math.round(white ? 146 + (light + face.shade) * 105 : 14 + (light + face.shade) * 77);
    ctx.beginPath();
    for (const index of face.points) {
      const [px, py, depth] = projected[index];
      const scale = 101 / (1 - depth * .075);
      ctx.lineTo(size / 2 + px * scale, 138 + py * scale);
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
  const rotation = useRef({ current: .48, target: .48 });
  const frame = useRef(0);
  const requestDraw = useRef<() => void>(() => {});
  const drag = useRef<{ id: number; startX: number; lastX: number; lastAt: number; speed: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

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
    dragged.current = false;
    drag.current = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, lastAt: event.timeStamp, speed: 0, moved: false };
  }

  function move(event: PointerEvent<HTMLAnchorElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.moved) {
      if (Math.abs(event.clientX - gesture.startX) < 7) return;
      gesture.moved = true;
      dragged.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const delta = event.clientX - gesture.lastX;
    gesture.speed = delta / Math.max(8, event.timeStamp - gesture.lastAt);
    gesture.lastX = event.clientX;
    gesture.lastAt = event.timeStamp;
    rotation.current.target += delta * .012;
    requestDraw.current();
  }

  function end(event: PointerEvent<HTMLAnchorElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    drag.current = null;
    if (gesture.moved && event.type === "pointerup" && event.timeStamp - gesture.lastAt < 85
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      rotation.current.target += Math.max(-.38, Math.min(.38, gesture.speed * .24));
      requestDraw.current();
    }
  }

  return (
    <Link
      className="home-tournament home-shortcut"
      draggable={false}
      href={href}
      onClick={(event) => {
        if (event.detail && dragged.current) event.preventDefault();
        dragged.current = false;
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
