"""Assisted transcription of numbered original scans, always pending review.

This reader recognizes printed symbols, not Go strength. Neither a high optical
score nor a legal replay certifies a historical answer or an optimal defense.
"""
from __future__ import annotations

import hashlib
import heapq
import math
from pathlib import Path
import shutil
import subprocess
import time

import numpy as np

from .common import ROOT, atomic_json, digest, read_json
from .rules import State


def glyph_network():
    from torch import nn
    return nn.Sequential(
        nn.Conv2d(1, 24, 5, padding=2), nn.ReLU(), nn.MaxPool2d(2),
        nn.Conv2d(24, 40, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
        nn.Conv2d(40, 64, 3, padding=1), nn.ReLU(), nn.AdaptiveAvgPool2d(4),
        nn.Flatten(), nn.Linear(1024, 128), nn.ReLU(), nn.Linear(128, 25),
    )


def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while chunk := stream.read(1024*1024):
            value.update(chunk)
    return value.hexdigest()


def validate_cells(cells):
    seen = set()
    for row in cells:
        point, probs = row["point"], row["probabilities"]
        if not isinstance(point, int) or not 0 <= point < 361 or point in seen:
            raise ValueError("Unique full 19x19 scan coordinates are required")
        if len(probs) != 25 or any(not math.isfinite(p) or not 0 <= p <= 1 for p in probs):
            raise ValueError("Expected 25 finite optical class probabilities")
        if abs(sum(probs)-1) > .001:
            raise ValueError("Optical class probabilities must sum to one")
        seen.add(point)
    if not seen:
        raise ValueError("No optical cells to decode")


def decode_sequence(cells, max_plies=11, beam_width=64):
    """Rank consecutive, alternating numbered lines by optical evidence.

    Length and starting color are inferred rather than supplied from an answer.
    A bounded beam can miss the correct reading, so outputs remain drafts. The
    score is an uncalibrated log-likelihood ratio, never a correctness probability.
    """
    validate_cells(cells)
    if not 1 <= max_plies <= 11 or not 1 <= beam_width <= 512:
        raise ValueError("This reader supports 1-11 printed plies and beam width 1-512")
    baseline = {r["point"]: max(range(3), key=lambda c: r["probabilities"][c]) for r in cells}
    base_log = {r["point"]: math.log(max(1e-20, r["probabilities"][baseline[r["point"]]])) for r in cells}
    candidates = []
    for to_play in (1, 2):
        beam = [(0., [])]
        for number in range(1, max_plies+1):
            color = to_play if number % 2 else 3-to_play
            label = 3+2*(number-1)+color-1
            choices = sorted([
                (math.log(max(r["probabilities"][label], 1e-20))-base_log[r["point"]], r["point"])
                for r in cells
            ], reverse=True)[:8]
            beam = sorted([
                (score+gain, line+[point]) for score, line in beam
                for gain, point in choices if point not in line
            ], key=lambda row: row[0], reverse=True)[:beam_width]
            for score, line in beam:
                if score <= 0:
                    continue
                board = [0]*361
                chosen = set(line)
                for point, setup_color in baseline.items():
                    board[point] = setup_color if point not in chosen else 0
                try:
                    state = State.setup(19, board, to_play)
                    for point in line:
                        state = state.play(point)
                except ValueError:
                    continue
                candidates.append({"score": score, "board": board, "to_play": to_play,
                                   "solutions": [line], "legal_replay": True})
                break
    candidates.sort(key=lambda row: row["score"], reverse=True)
    if not candidates:
        return {"status": "no-consecutive-legal-reading", "training_eligible": False}
    best = candidates[0]
    line = best["solutions"][0]
    selected = {point: 3+2*i+(best["to_play"] if i % 2 == 0 else 3-best["to_play"])-1
                for i, point in enumerate(line)}
    flags = []
    for row in cells:
        point, probs = row["point"], row["probabilities"]
        label = selected.get(point, best["board"][point])
        raw = max(range(25), key=probs.__getitem__)
        if raw != label or probs[label] < .8:
            flags.append({"point": point, "raw_label": raw, "reading_label": label,
                          "optical_probability": probs[label], "reason": "sequence-correction-or-uncertain-symbol"})
    return {**best, "status": "pending-visual-review", "training_eligible": False,
            "review_flags": flags, "model_max_printed_plies": 11,
            "length_ceiling_reached": len(line) == 11,
            "alternatives": [{"score": row["score"], "to_play": row["to_play"],
                              "solutions": row["solutions"]} for row in candidates[1:4]],
            "warning": "A legal optical reading is not a verified solution. Check every setup stone, all numbered moves, missing/captured repetitions, and figure boundaries against the original."}


def components(cells, radius=2):
    """Spatial proposals only: nearby independent tasks can still be merged."""
    occupied = {r["point"] for r in cells if 1-r["probabilities"][0] >= .6}
    result = []
    while occupied:
        todo = [min(occupied)]
        occupied.remove(todo[0])
        component = set(todo)
        while todo:
            point = todo.pop()
            nearby = [q for q in occupied if max(abs(q % 19-point % 19), abs(q//19-point//19)) <= radius]
            component.update(nearby)
            occupied.difference_update(nearby)
            todo.extend(nearby)
        if len(component) >= 5:
            result.append(component)
    # Two nearby tasks may be linked by a single support stone. Start separate
    # spatial hypotheses at well-separated printed 1s instead of silently using
    # one task's 1 and the other task's 2. This remains a review proposal.
    by_point = {r["point"]: r for r in cells}
    partitions = []
    for component in result:
        ranked = sorted([p for p in component if max(by_point[p]["probabilities"][3:5]) >= .6],
                        key=lambda p: max(by_point[p]["probabilities"][3:5]), reverse=True)
        seeds = []
        for point in ranked:
            if all(max(abs(point % 19-q % 19), abs(point//19-q//19)) > 4 for q in seeds):
                seeds.append(point)
        if len(seeds) < 2:
            partitions.append(component)
            continue
        owners = {p: (0., p) for p in seeds}
        todo = [(0., p, p) for p in seeds]
        heapq.heapify(todo)
        while todo:
            cost, owner, point = heapq.heappop(todo)
            if owners.get(point) != (cost, owner):
                continue
            for other in component:
                dx, dy = abs(point % 19-other % 19), abs(point//19-other//19)
                distance = max(dx, dy)
                if not 0 < distance <= radius:
                    continue
                candidate = (cost+(1 if distance == 1 else 8)+.001*math.hypot(dx, dy), owner)
                if other not in owners or candidate < owners[other]:
                    owners[other] = candidate
                    heapq.heappush(todo, (candidate[0], owner, other))
        for seed in seeds:
            part = {p for p in component if owners.get(p, (None, None))[1] == seed}
            if len(part) >= 5:
                partitions.append(part)
    return sorted(partitions, key=min)


def fit_line_family(lines, axis, start, step, center):
    observations = []
    for x1, y1, x2, y2 in lines:
        along = (x1, x2) if axis == 0 else (y1, y2)
        across = (y1, y2) if axis == 0 else (x1, x2)
        distance = along[1]-along[0]
        if abs(distance) < step*3 or abs(across[1]-across[0]) > abs(distance)*.08:
            continue
        slope = (across[1]-across[0])/distance
        position = across[0]+slope*(center-along[0])
        index = round((position-start)/step)
        if not -1 <= index < 20 or abs(position-start-index*step) > step*.46:
            continue
        for a, b in zip(along, across):
            observations.append(([1, index, (a-center)/500, index*(a-center)/500], b))
    if len(observations) < 30:
        return None
    x = np.array([r[0] for r in observations])
    y = np.array([r[1] for r in observations])
    keep = np.ones(len(x), bool)
    for _ in range(4):
        if keep.sum() < 20:
            return None
        coef = np.linalg.lstsq(x[keep], y[keep], rcond=None)[0]
        keep = abs(x@coef-y) < max(3, step*.08)
    if keep.sum() < 20:
        return None
    return coef, len(set(int(i) for i in x[keep, 1]))


def refine_grid(image, grid):
    import cv2
    a, b, c = np.array(grid)
    dx, dy = (b[0]-a[0])/18, (c[1]-a[1])/18
    if min(dx, dy) < 5:
        raise ValueError("Grid spacing is too small")
    cx, cy = (a[0]+b[0])/2, (a[1]+c[1])/2
    left, right = max(0, int(a[0]-dx*.4)), min(image.shape[1], int(b[0]+dx*.4))
    top, bottom = max(0, int(a[1]-dy*.4)), min(image.shape[0], int(c[1]+dy*.4))
    fallback = [a.tolist(), b.tolist(), (b+c-a).tolist(), c.tolist()]
    if left >= right or top >= bottom:
        return fallback, "unresolved-grid"
    edges = cv2.Canny(image[top:bottom, left:right], 65, 160)
    lines = cv2.HoughLinesP(edges, 1, np.pi/1440, threshold=70,
                            minLineLength=int(min(dx, dy)*3), maxLineGap=12)
    if lines is None:
        return fallback, "unresolved-grid"
    lines = lines.reshape(-1, 4)+np.array([left, top, left, top])
    horizontal = fit_line_family(lines, 0, a[1], dy, cx)
    vertical = fit_line_family(lines, 1, a[0], dx, cy)
    if horizontal is None or vertical is None or min(horizontal[1], vertical[1]) < 13:
        return fallback, "unresolved-grid"
    corners = []
    for i, j in ((0, 0), (18, 0), (18, 18), (0, 18)):
        v, h = vertical[0], horizontal[0]
        sx, sy = (v[2]+v[3]*i)/500, (h[2]+h[3]*j)/500
        x, y = np.linalg.solve([[1, -sx], [-sy, 1]],
                               [v[0]+v[1]*i-sx*cy, h[0]+h[1]*j-sy*cx])
        corners.append([float(x), float(y)])
    # A 19-line fit can be shifted by one whole line. Outer printed page frames
    # are not board edges. Never silently 'correct' the index from that border.
    return corners, "fitted-grid-indices-need-review"


def infer_cells(model, image, corners):
    import cv2
    import torch
    warp = cv2.warpPerspective(image, cv2.getPerspectiveTransform(np.float32(corners),
                               np.float32([(25, 25), (925, 25), (925, 925), (25, 925)])),
                               (950, 950), borderValue=255)
    patches = np.stack([cv2.resize(warp[y*50:y*50+50, x*50:x*50+50], (64, 64))
                        for y in range(19) for x in range(19)])
    probs = []
    with torch.inference_mode():
        for offset in range(0, 361, 64):
            values = torch.tensor(patches[offset:offset+64, None]/255, dtype=torch.float32)
            probs.extend(model(values).softmax(1).tolist())
    return [{"point": point, "probabilities": values} for point, values in enumerate(probs)], warp


def pinned_grid(source_id, source_sha1, page, image_shape, grid):
    """Use previously read board intersections only for that exact source page."""
    x = sum(p[0] for p in grid)/len(grid)
    y = sum(p[1] for p in grid)/len(grid)
    panel = ("A" if x < image_shape[1]/2 else "B") if y < image_shape[0]/2 else (
        "C" if x < image_shape[1]/2 else "D")
    for path in sorted((ROOT/"transcriptions").glob("*.json")):
        document = read_json(path)
        if document.get("source_pdf_sha1") != source_sha1:
            continue
        if not any(r["source_id"] == source_id and r["page"] == page for r in document["records"]):
            continue
        corners = document.get("frames", {}).get(panel)
        dimensions = document.get("render_dimensions")
        if corners and dimensions:
            scale = np.array([image_shape[1]/dimensions[0], image_shape[0]/dimensions[1]])
            return (np.array(corners)*scale).tolist()
    return None


def read_batch(root, checkpoint, first_page=100, last_page=223, target_drafts=1000):
    import cv2
    import torch
    from .scans import scan_inventory
    if not 1 <= first_page <= last_page or target_drafts < 1:
        raise ValueError("Specify a nonempty page range and positive draft target")
    source = next(s for s in scan_inventory(root)["sources"] if s["id"] == "guanzipu-anthology")
    if source["rights_status"] != "old-original-pd-scan" or last_page > source["pages"]:
        raise ValueError("The requested original source is unavailable or not cleared")
    original = root/source["relative_path"]
    if hashlib.sha1(original.read_bytes()).hexdigest() != source["sha1"]:
        raise ValueError("Original scan edition checksum mismatch")
    payload = torch.load(checkpoint, map_location="cpu", weights_only=True)
    if payload.get("architecture") != "scan-glyph-cnn-v3":
        raise ValueError("Unsupported optical model")
    model = glyph_network()
    model.load_state_dict(payload["state_dict"])
    model.eval()
    torch.set_num_threads(4)
    cv2.setNumThreads(1)
    model_hash = file_hash(checkpoint)
    # Preserve earlier experiments and prevent reuse after a decoding change.
    reader_hash = file_hash(Path(__file__))
    pins_hash = digest([read_json(p) for p in sorted((ROOT/"transcriptions").glob("*.json"))])
    config_hash = digest({"reader_sha256": reader_hash, "pinned_grids_hash": pins_hash,
                          "beam_width": 64, "max_printed_plies": 11})
    destination = root/"scans/assisted"/f"guanzipu-{model_hash[:12]}-{config_hash[:8]}"
    destination.mkdir(parents=True, exist_ok=True)
    report = {"schema": "gostone.assisted-scan-batch/1", "status": "running",
              "source_id": source["id"], "source_pdf_sha1": source["sha1"],
              "reader_sha256": reader_hash, "configuration_hash": config_hash,
              "model_sha256": model_hash, "target_drafts": target_drafts,
              "page_range": [first_page, last_page], "pages": 0, "frames": 0,
              "drafts_with_legal_reading": 0, "approved_training_records": 0,
              "no_reading_components": 0, "errors": [], "training_eligible": False}
    started = time.monotonic()
    renderer = shutil.which("pdftoppm")
    for page in range(first_page, last_page+1):
        if (root/"stop-reader.flag").exists():
            report["status"] = "stopped"
            break
        page_file = destination/f"{page:04d}.json"
        old = read_json(page_file)
        low_path = root/f"scans/pages/{source['id']}/{page:04d}.jpg"
        recognition_path = root/f"scans/recognition/{source['id']}/{page:04d}.json"
        high_path = destination/f"{page:04d}.png"
        if (old and old.get("configuration_hash") == config_hash
                and old.get("model_sha256") == model_hash and old.get("source_pdf_sha1") == source["sha1"]
                and high_path.is_file() and old.get("page_sha256") == file_hash(high_path)
                and recognition_path.is_file() and old.get("recognition_sha256") == file_hash(recognition_path)
                and low_path.is_file() and old.get("low_page_sha256") == file_hash(low_path)):
            result = old
        else:
            try:
                low = cv2.imdecode(np.fromfile(low_path, dtype=np.uint8), 0)
                if low is None:
                    raise ValueError("Render the original low-resolution inventory page first")
                recognition = read_json(recognition_path, {})
                if recognition.get("page_sha256") != file_hash(low_path):
                    raise ValueError("Low-resolution grid proposals need a matching page checksum")
                if not high_path.exists():
                    if not renderer:
                        raise ValueError("Poppler pdftoppm is required for high-resolution source reading")
                    subprocess.run([renderer, "-f", str(page), "-l", str(page), "-scale-to", "3200",
                                    "-singlefile", "-png", str(original), str(high_path.with_suffix(""))],
                                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=45)
                image = cv2.imdecode(np.fromfile(high_path, dtype=np.uint8), 0)
                if image is None:
                    raise ValueError("Unreadable high-resolution source page")
                scale = [image.shape[1]/low.shape[1], image.shape[0]/low.shape[0]]
                result = {"page": page, "source_id": source["id"], "source_pdf_sha1": source["sha1"],
                          "configuration_hash": config_hash, "reader_sha256": reader_hash,
                          "recognition_sha256": file_hash(recognition_path), "low_page_sha256": file_hash(low_path),
                          "model_sha256": model_hash, "page_sha256": file_hash(high_path),
                          "image": high_path.name, "frames": [], "training_eligible": False}
                for index, diagram in enumerate(recognition.get("diagrams", [])):
                    grid = (np.array(diagram["grid"])*scale).tolist()
                    corners = pinned_grid(source["id"], source["sha1"], page, image.shape, grid)
                    if corners:
                        grid_status = "visually-pinned-grid-context-still-needs-review"
                    else:
                        corners, grid_status = refine_grid(image, grid)
                    cells, warp = infer_cells(model, image, corners)
                    cv2.imencode(".png", warp)[1].tofile(destination/f"{page:04d}-{index}.png")
                    frame = {"index": index, "corners": corners, "grid_status": grid_status,
                             "cells": cells, "drafts": [], "no_reading_components": 0}
                    for component in components(cells):
                        subset = [r for r in cells if r["point"] in component]
                        if max(max(r["probabilities"][3:5]) for r in subset) < .2:
                            continue
                        reading = decode_sequence(subset)
                        if reading["status"] == "no-consecutive-legal-reading":
                            frame["no_reading_components"] += 1
                            continue
                        reading.update(id=digest((source["id"], page, index, sorted(component)))[:24],
                                       source_id=source["id"], page=page, frame=index,
                                       printed_points=sorted(component), category="tesuji",
                                       context_status="component-boundaries-and-nearby-stones-need-review",
                                       grid_status=grid_status,
                                       reviewer=None)
                        frame["drafts"].append(reading)
                    result["frames"].append(frame)
                atomic_json(page_file, result)
            except Exception as error:
                report["errors"].append({"page": page, "error": str(error)[:300]})
                atomic_json(destination/"progress.json", {**report, "seconds": time.monotonic()-started})
                continue
        report["pages"] += 1
        report["frames"] += len(result["frames"])
        report["drafts_with_legal_reading"] += sum(len(f["drafts"]) for f in result["frames"])
        report["no_reading_components"] += sum(f["no_reading_components"] for f in result["frames"])
        report["seconds"] = time.monotonic()-started
        report["last_page"] = page
        atomic_json(destination/"progress.json", report)
        atomic_json(root/"scans/reader-progress.json", {**report, "directory": str(destination)})
        print(f"Read source page {page}: {report['drafts_with_legal_reading']} pending readings, 0 automatic approvals", flush=True)
        if report["drafts_with_legal_reading"] >= target_drafts:
            report["status"] = "draft-target-reached-needs-review"
            break
    if report["status"] == "running":
        report["status"] = "page-range-read-needs-review"
    report["seconds"] = time.monotonic()-started
    atomic_json(destination/"progress.json", report)
    atomic_json(root/"scans/reader-progress.json", {**report, "directory": str(destination)})
    return report
