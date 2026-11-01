from __future__ import annotations

import copy
import hashlib
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .common import atomic_json, canonical, digest, read_json
from .scan_reader import components, decode_sequence, validate_cells


def cell(point, likely, alternatives=None):
    probs = [1e-10]*25
    probs[likely] = 1.
    for label, value in (alternatives or {}).items():
        probs[label] = value
    total = sum(probs)
    return {"point": point, "probabilities": [p/total for p in probs]}


def sample(to_play=2):
    # Symbols sit at actual full-board coordinates. A line need not be a good
    # tactical puzzle for testing optical transcription and legal replay.
    line = [21, 22, 41, 42, 61]
    cells = [cell(1, 1), cell(2, 2), cell(60, 1), cell(79, 2), cell(80, 0)]
    for index, point in enumerate(line):
        color = to_play if index % 2 == 0 else 3-to_play
        cells.append(cell(point, 3+2*index+color-1))
    return cells, line


class OpticalReaderTests(unittest.TestCase):
    def test_reviewed_correction_archives_prior_record_and_requires_its_exact_hash(self):
        from .corpus import revise_reference
        item = {"source_id": "fixture-only", "page": 1, "label": "fixture",
                "to_play": 1, "category": "tesuji", "revision": 2,
                "revision_reason": "Fixture-only visual correction test", "note": "No actual human review",
                "review": {"reviewer": "unit-test fixture", "position": True, "solution": True, "source": True}}
        identifier = digest((item["source_id"], item["page"], item["label"]))[:24]
        old_board = [0]*361
        old_board[40] = 2
        old = {"id": "scan-"+identifier, "source_id": "fixture-only", "board": old_board,
               "to_play": 1, "family": canonical(old_board, 19, 1), "solutions": [[0, 1, 19]]}
        item["replaces_record_sha256"] = digest(old)
        board = old_board.copy()
        board[41] = 1
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            atomic_json(root/"data/corpus.json", {"records": [old]})
            stale = {**item, "replaces_record_sha256": "wrong"}
            with self.assertRaisesRegex(ValueError, "exact previous record hash"):
                revise_reference(root, old, stale, board, [[0, 1, 19]], "fixture-sha1")
            self.assertEqual(read_json(root/"data/corpus.json")["records"], [old])
            revise_reference(root, old, item, board, [[0, 1, 19]], "fixture-sha1")
            current = read_json(root/"data/corpus.json")["records"][0]
            self.assertEqual(current["board"], board)
            self.assertEqual(current["reviewed_revision"], 2)
            self.assertEqual(read_json(root/current["revision_archive"])["record"], old)
            with self.assertRaises(ValueError):
                revise_reference(root, current, item, old_board, [[0, 1, 19]], "fixture-sha1")

    def test_correction_merges_a_revealed_duplicate_only_with_its_exact_reviewed_target(self):
        from .corpus import revise_reference
        item = {"source_id": "fixture-only", "page": 1, "label": "fixture",
                "to_play": 1, "category": "tesuji", "revision": 2,
                "revision_reason": "Fixture duplicate correction", "note": "Unit test only",
                "review": {"reviewer": "unit-test fixture", "position": True, "solution": True, "source": True}}
        identifier = digest((item["source_id"], item["page"], item["label"]))[:24]
        original = [0]*361
        original[40] = 2
        corrected = original.copy()
        corrected[41] = 1
        old = {"id": "scan-"+identifier, "source_id": "fixture-only", "board": original,
               "to_play": 1, "family": canonical(original, 19, 1), "solutions": [[0, 1, 19]]}
        target = {"id": "scan-"+"b"*24, "source_id": "fixture-only", "board": corrected,
                  "to_play": 1, "family": canonical(corrected, 19, 1), "solutions": [[0, 2, 19]]}
        item["replaces_record_sha256"] = digest(old)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            atomic_json(root/"data/corpus.json", {"records": [old, target]})
            with self.assertRaisesRegex(ValueError, "exact merge target"):
                revise_reference(root, old, item, corrected, [[0, 1, 19]], "fixture-sha1")
            item.update(merge_into_reference=target["id"], merge_target_sha256=digest(target))
            revise_reference(root, old, item, corrected, [[0, 1, 19]], "fixture-sha1")
            result = read_json(root/"data/corpus.json")["records"]
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["id"], target["id"])
            self.assertEqual(result[0]["solutions"], [[0, 2, 19], [0, 1, 19]])
            evidence = result[0]["additional_source_evidence"][0]
            archived = read_json(root/evidence["revision_archive"])
            self.assertEqual(archived["record"], old)
            self.assertEqual(archived["merge_target_before"], target)

    def test_infers_consecutive_line_and_both_start_colors(self):
        for color in (1, 2):
            cells, line = sample(color)
            result = decode_sequence(cells)
            self.assertEqual(result["to_play"], color)
            self.assertEqual(result["solutions"], [line])
            self.assertEqual(sum(bool(c) for c in result["board"]), 4)
            self.assertTrue(all(result["board"][p] == 0 for p in line))
            self.assertFalse(result["training_eligible"])
            self.assertEqual(result["status"], "pending-visual-review")

    def test_sequence_recovers_damaged_five_and_rejects_phantom_ten(self):
        cells, line = sample()
        cells[-1] = cell(line[-1], 16, {12: .4})  # White 7 resembles White 5.
        cells[2] = cell(60, 21, {1: .02})  # Plain Black resembles Black 10.
        result = decode_sequence(cells)
        self.assertEqual(result["solutions"], [line])
        self.assertEqual(result["board"][60], 1)
        self.assertEqual({f["point"] for f in result["review_flags"]}, {60, line[-1]})

    def test_damaged_plain_color_is_flagged_without_claiming_it_was_solved(self):
        cells, line = sample()
        cells[0] = cell(1, 6, {2: .025, 1: .00001})
        result = decode_sequence(cells)
        self.assertEqual(result["solutions"], [line])
        self.assertEqual(result["board"][1], 2)  # The reader still gets this wrong.
        self.assertIn(1, [r["point"] for r in result["review_flags"]])
        self.assertFalse(result["training_eligible"])

    def test_input_constraints_reject_nan_duplicate_and_normalization_errors(self):
        cells, _ = sample()
        for bad in ([], cells+[cells[0]], [{"point": -1, "probabilities": [1/25]*25}],
                    [{"point": 2, "probabilities": [math.nan]+[1/24]*24}],
                    [{"point": 2, "probabilities": [1.]*25}]):
            with self.assertRaises(ValueError):
                validate_cells(bad)

    def test_only_supported_number_range_is_accepted(self):
        cells, _ = sample()
        for number in (0, 12):
            with self.assertRaises(ValueError):
                decode_sequence(cells, max_plies=number)

    def test_components_keep_real_coordinates_and_do_not_wrap_board_edges(self):
        cells = [cell(p, 1) for p in [15, 16, 17, 18, 37, 19, 20, 21, 38, 39]]
        values = components(cells, radius=1)
        self.assertEqual(len(values), 2)
        self.assertEqual(values[0], {15, 16, 17, 18, 37})
        self.assertEqual(values[1], {19, 20, 21, 38, 39})

    def test_separate_printed_ones_split_tasks_linked_by_support_stones(self):
        cells = [cell(19+x, 4 if x in (1, 12) else 1) for x in range(1, 14)]
        result = components(cells)
        self.assertEqual(len(result), 2)
        self.assertTrue(any(20 in region for region in result))
        self.assertTrue(any(31 in region for region in result))
        self.assertFalse(any(20 in region and 31 in region for region in result))

    def test_probabilities_and_source_cells_are_not_changed_by_decoding(self):
        cells, _ = sample()
        original = copy.deepcopy(cells)
        decode_sequence(cells)
        self.assertEqual(cells, original)

    def test_pinned_grid_requires_the_exact_original_page_and_source(self):
        from .scan_reader import pinned_grid
        grid = [[200, 600], [1100, 600], [200, 1450]]
        actual = pinned_grid("guanzipu-anthology", "09beedab2e75febdebc589fd6dcf18ef53cce799",
                             100, (3200, 2218), grid)
        self.assertEqual(actual[0], [220, 596])
        self.assertIsNone(pinned_grid("guanzipu-anthology", "other", 100, (3200, 2218), grid))
        self.assertIsNone(pinned_grid("guanzipu-anthology", "09beedab2e75febdebc589fd6dcf18ef53cce799",
                                     102, (3200, 2218), grid))

    def test_batch_resume_rechecks_inputs_and_gallery_does_not_import_drafts(self):
        import cv2
        import numpy as np
        import torch
        from .scan_reader import file_hash, glyph_network, read_batch
        from .scan_review import write_reader_review
        cells, _ = sample()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root/"original.pdf"
            source.write_bytes(b"unit test original placeholder")
            inventory = {"sources": [{"id": "guanzipu-anthology", "rights_status": "old-original-pd-scan",
                                      "pages": 1, "relative_path": source.name,
                                      "sha1": hashlib.sha1(source.read_bytes()).hexdigest()}]}
            low = root/"scans/pages/guanzipu-anthology/0001.jpg"
            low.parent.mkdir(parents=True)
            cv2.imencode(".jpg", np.full((100, 100), 255, np.uint8))[1].tofile(low)
            recognition = root/"scans/recognition/guanzipu-anthology/0001.json"
            atomic_json(recognition, {"page_sha256": file_hash(low), "diagrams": [
                {"grid": [[0, 0], [90, 0], [0, 90]]}]})
            checkpoint = root/"fixture-reader.pt"
            torch.save({"architecture": "scan-glyph-cnn-v3", "state_dict": glyph_network().state_dict()}, checkpoint)

            def render(command, **kwargs):
                output = Path(command[-1]+".png")
                cv2.imencode(".png", np.full((100, 100), 255, np.uint8))[1].tofile(output)

            with patch("training.gostone_puzzles.scans.scan_inventory", return_value=inventory), \
                    patch("training.gostone_puzzles.scan_reader.shutil.which", return_value="fixture-renderer"), \
                    patch("training.gostone_puzzles.scan_reader.subprocess.run", side_effect=render) as renderer, \
                    patch("training.gostone_puzzles.scan_reader.refine_grid", return_value=(
                        [[0, 0], [90, 0], [90, 90], [0, 90]], "fixture-grid")), \
                    patch("training.gostone_puzzles.scan_reader.infer_cells", return_value=(
                        cells, np.full((950, 950), 255, np.uint8))) as inference:
                report = read_batch(root, checkpoint, 1, 1, 10)
                self.assertEqual(report["drafts_with_legal_reading"], 1)
                self.assertEqual(report["approved_training_records"], 0)
                self.assertFalse((root/"data/corpus.json").exists())
                directory = Path(read_json(root/"scans/reader-progress.json")["directory"])
                before = read_json(directory/"0001.json")
                self.assertEqual(before["recognition_sha256"], file_hash(recognition))
                renderer.reset_mock()
                inference.reset_mock()
                read_batch(root, checkpoint, 1, 1, 10)
                renderer.assert_not_called()
                inference.assert_not_called()
                high = directory/"0001.png"
                cv2.imencode(".png", np.full((100, 100), 240, np.uint8))[1].tofile(high)
                read_batch(root, checkpoint, 1, 1, 10)
                inference.assert_called_once()
                after = read_json(directory/"0001.json")
                self.assertNotEqual(before["page_sha256"], after["page_sha256"])
                gallery = write_reader_review(directory)
                self.assertEqual(gallery["drafts"], 1)
                review = read_json(directory/"review/review.json")
                self.assertEqual(review["approved_training_records"], 0)
                self.assertFalse((root/"data/corpus.json").exists())

    def test_portable_export_includes_optical_weights_and_pending_data_with_optional_images(self):
        from .portable import export_environment, verify_bundle
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root = parent/"workspace"
            fixture = {
                "scans/assisted/run/0001.PNG": b"unit test source image placeholder",
                "scans/assisted/run/0001.json": b'{"training_eligible": false}',
                "scans/assisted/run/review/index.html": b"<p>Pending review</p>",
                "scans/assisted/run/review/crop.png": b"unit test crop placeholder",
                "models/scan-glyph-v3/checkpoint.pt": b"unit test optical weight placeholder",
            }
            for name, payload in fixture.items():
                path = root/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(payload)
            for include in (False, True):
                destination = parent/("with-images" if include else "without-images")
                export_environment(root, destination, include_scans=include)
                self.assertGreater(verify_bundle(destination)["verified_files"], 0)
                copied = destination/"workspace"
                self.assertTrue((copied/"models/scan-glyph-v3/checkpoint.pt").exists())
                self.assertTrue((copied/"scans/assisted/run/0001.json").exists())
                self.assertEqual((copied/"scans/assisted/run/0001.PNG").exists(), include)
                self.assertEqual((copied/"scans/assisted/run/review/crop.png").exists(), include)
                self.assertFalse((copied/"data/corpus.json").exists())


if __name__ == "__main__":
    unittest.main()
