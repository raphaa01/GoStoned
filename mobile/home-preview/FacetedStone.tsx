import { useRef, useState, type PointerEvent } from "react";

type Point = [x: number, y: number, z: number];
type Face = { vertices: Point[]; normal: Point };

const sides = 12;
const initialAngle = 23;
const maxAngle = 68;
const light = direction([-0.46, 0.6, 0.65]);

function direction([x, y, z]: Point): Point {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function normalOf([a, b, c]: Point[]): Point {
  const [ux, uy, uz] = b.map((value, index) => value - a[index]);
  const [vx, vy, vz] = c.map((value, index) => value - a[index]);
  return direction([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
}

function ring(radius: number, depth: number, offset = 0): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = ((index + offset) / sides) * Math.PI * 2;
    return [48 * radius * Math.cos(angle), 51 * radius * Math.sin(angle), depth];
  });
}

function makeFaces(): Face[] {
  const rim = ring(1, 0);
  const faces: Face[] = [];

  for (const side of [1, -1]) {
    const shoulder = ring(0.9, side * 10, 0.5);
    const bevel = ring(0.68, side * 17);
    const center = ring(0.45, side * 20);

    function add(points: Point[]) {
      const vertices = side === 1 ? points : points.slice().reverse();
      faces.push({ vertices, normal: normalOf(vertices) });
    }

    for (let index = 0; index < sides; index++) {
      const next = (index + 1) % sides;
      const previous = (index + sides - 1) % sides;
      add([rim[index], rim[next], shoulder[index]]);
      add([rim[index], shoulder[index], shoulder[previous]]);
      add([shoulder[previous], shoulder[index], bevel[index]]);
      add([shoulder[index], bevel[next], bevel[index]]);
      add([bevel[index], bevel[next], center[next], center[index]]);
    }
    const crown: Point = [-3, 3, side * 21.8];
    for (let index = 0; index < sides; index++) {
      add([center[index], center[(index + 1) % sides], crown]);
    }
  }

  return faces;
}

const mesh = makeFaces();

function Facets({ angle }: { angle: number }) {
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  function rotate([x, y, z]: Point): Point {
    return [x * cosine + z * sine, y, -x * sine + z * cosine];
  }

  return mesh.map(({ vertices, normal }, index) => {
    const [x, y, z] = rotate(normal);
    if (z <= 0) return null;

    const diffuse = Math.max(0, x * light[0] + y * light[1] + z * light[2]);
    const shade = Math.round(172 + 72 * diffuse + 5 * Math.max(0, x));
    const color = `rgb(${shade - 3} ${shade} ${shade + 3})`;
    const points = vertices.map((vertex) => {
      const [px, py] = rotate(vertex);
      return `${64 + px},${58 - py}`;
    }).join(" ");

    // A fine stroke in the same color closes antialiasing seams between faces.
    return <polygon key={index} points={points} fill={color} stroke={color} strokeWidth=".45" strokeLinejoin="round" />;
  });
}

export function FacetedStone() {
  const [angle, setAngle] = useState(initialAngle);
  const drag = useRef<{ pointer: number; x: number; angle: number } | null>(null);

  function rotateTo(value: number) {
    setAngle(Math.min(maxAngle, Math.max(-maxAngle, value)));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, angle };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    if (origin?.pointer !== event.pointerId) return;
    rotateTo(origin.angle + (event.clientX - origin.x) * 0.85);
  }

  return (
    <div
      className="stone-control"
      role="slider"
      tabIndex={0}
      aria-label="Rotate Go stone"
      aria-valuemin={-maxAngle}
      aria-valuemax={maxAngle}
      aria-valuenow={Math.round(angle)}
      aria-valuetext={`${Math.abs(Math.round(angle))} degrees ${angle < 0 ? "left" : "right"}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const angles: Partial<Record<string, number>> = {
          ArrowLeft: angle - 5, ArrowDown: angle - 5,
          ArrowRight: angle + 5, ArrowUp: angle + 5,
          Home: -maxAngle, End: maxAngle,
        };
        const next = angles[event.key];
        if (next === undefined) return;
        event.preventDefault();
        rotateTo(next);
      }}
    >
      <svg viewBox="0 0 128 122" aria-hidden="true">
        <ellipse className="stone-shadow" cx="65" cy="111" rx="30" ry="4" />
        <Facets angle={angle} />
      </svg>
    </div>
  );
}
