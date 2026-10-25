from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from .common import atomic_json, canonical, digest, read_json, relative_pattern, tactical_core, transform_point
from .historical import coordinates, parse_smith
from .rules import State, unconditional_life
from .solver import Limits, Solver, verify_certificate


class RuleProofTests(unittest.TestCase):
    def test_capture_tracks_original_target(self):
        initial = State.setup(3, [0,1,0,1,2,1,0,0,0], 1, [4])
        child = initial.play(7)
        self.assertEqual(child.stones[4], 0)
        self.assertFalse(child.targets)
        self.assertEqual(initial.stones[4], 2)

    def test_illegal_setup_and_suicide(self):
        with self.assertRaises(ValueError):
            State.setup(3, [2,1,0,1,0,0,0,0,0], 1)
        state = State.setup(3, [0,1,0,1,0,1,0,1,0], 2)
        with self.assertRaises(ValueError):
            state.play(4)

    def test_history_blocks_repetition(self):
        initial = State.setup(3, [0]*9, 1)
        child = initial.play(4)
        guarded = State(initial.size, initial.stones, initial.to_play, initial.targets,
                        initial.history | {bytes(child.stones)})
        with self.assertRaisesRegex(ValueError, "superko"):
            guarded.play(4)
        self.assertEqual(guarded.play(-1).passes, 1)

    def test_one_eye_not_life(self):
        board = tuple(0 if p == 0 else 1 for p in range(16))
        self.assertFalse(unconditional_life(board, 4, 1))

    def test_two_real_eyes_are_life(self):
        board = tuple(0 if p in (0,3) else 1 for p in range(16))
        self.assertEqual(len(unconditional_life(board, 4, 1)), 14)

    def test_horizon_exhaustion_not_loss(self):
        state = State.setup(3, [0,0,0,0,2,0,0,0,0], 1, [4])
        result = Solver("kill", 1, Limits(1, 500, 2)).solve(state)
        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["certificate"])

    def test_deadline_failure_is_distinct_and_checked(self):
        state = State.setup(3, [0,0,0,0,2,0,0,0,0], 1, [4])
        result = Solver("kill", 1, Limits(1, 500, 2), deadline=True).solve(state)
        self.assertEqual(result["status"], "deadline-failure")
        proof = result["certificate"]
        verify_certificate(state, proof)
        altered = copy.deepcopy(proof)
        altered["deadline_plies"] = None
        with self.assertRaises(ValueError):
            verify_certificate(state, altered)

    def test_all_defenses_including_pass_are_covered(self):
        state = State.setup(3, [2,1,0,0,1,0,1,0,0], 2, [0])
        result = Solver("kill", 1, Limits(1, 5000, 2)).solve(state)
        self.assertEqual(result["status"], "proven-win")
        proof = result["certificate"]
        root = proof["nodes"][proof["root"]]
        self.assertEqual({b["move"] for b in root["branches"]}, {m for m, _ in state.legal()})
        modified = copy.deepcopy(proof)
        modified["nodes"][proof["root"]]["branches"].pop()
        with self.assertRaisesRegex(ValueError, "omits"):
            verify_certificate(state, modified)

    def test_false_terminal_rejected(self):
        state = State.setup(3, [0]*4+[2]+[0]*4, 1, [4])
        fake = {"schema":"gostone.full-board-proof/1", "goal":"kill", "player":1,
                "root":"root", "nodes":{"root":{"terminal":True,"outcome":1}}}
        with self.assertRaises(ValueError):
            verify_certificate(state, fake)


class DataTests(unittest.TestCase):
    def test_historical_coordinates_carry_column_and_skip_i(self):
        self.assertEqual(coordinates("Q 18, R 18, S 16, 17, 18."), [34,35,74,55,36])
        self.assertEqual(coordinates("A 1, T 19", carry=False), [342,18])

    def test_changed_source_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "source structure"):
            parse_smith("A modern replacement page")

    def test_board_family_color_and_symmetry_invariant(self):
        board = [0]*361
        board[0], board[1], board[21] = 1,2,1
        moved = [0]*361
        for p, c in enumerate(board):
            moved[transform_point(p,19,5)] = 3-c if c else 0
        self.assertEqual(canonical(board,19,1),canonical(moved,19,2))

    def test_move_pattern_ignores_shift_but_retains_order(self):
        self.assertEqual(relative_pattern([(1,2),(2,2)], [1,2]), relative_pattern([(8,9),(8,10)], [1,2]))
        self.assertNotEqual(relative_pattern([(1,2),(2,2),(2,3)], [1,2,1]), relative_pattern([(2,2),(1,2),(2,3)], [1,2,1]))

    def test_irrelevant_far_stone_does_not_create_new_core(self):
        board = [0]*361
        board[0], board[1], board[19] = 2,1,1
        key = tactical_core(board,[0],1)
        board[360] = 1
        self.assertEqual(key,tactical_core(board,[0],1))

    def test_atomic_json_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"state.json"
            atomic_json(path,{"a":[1,2]})
            self.assertEqual(read_json(path),{"a":[1,2]})
            self.assertEqual(digest(read_json(path)),digest({"a":[1,2]}))

    def test_writer_lock_rejects_parallel_cli_jobs_and_releases(self):
        from .common import workspace_lock
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with workspace_lock(root):
                with self.assertRaises(ValueError):
                    with workspace_lock(root):
                        self.fail("Second writer acquired the same root")
            self.assertFalse((root/"writer.lock").exists())

    def test_bundle_integrity_detects_changed_and_escaped_files(self):
        from .portable import verify_bundle,file_hash
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            payload=root/"weights.txt"
            payload.write_text("test",encoding="utf-8")
            manifest={"schema":"gostone.puzzle-lab-bundle/1","runtime":{},"files":[{"path":"weights.txt","sha256":file_hash(payload)}]}
            atomic_json(root/"manifest.json",manifest)
            self.assertEqual(verify_bundle(root)["verified_files"],1)
            payload.write_text("altered",encoding="utf-8")
            with self.assertRaises(ValueError):
                verify_bundle(root)
            manifest["files"][0]["path"]="../weights.txt"
            atomic_json(root/"manifest.json",manifest)
            with self.assertRaises(ValueError):
                verify_bundle(root)

    def test_runtime_trimming_preserves_nested_third_party_licenses(self):
        from .portable import runtime_file
        self.assertTrue(runtime_file(Path("numpy-2.dist-info/licenses/numpy/_core/include/numpy/libdivide/LICENSE.txt")))
        self.assertTrue(runtime_file(Path("numpy/_core/include/numpy/random/LICENSE.txt")))
        self.assertFalse(runtime_file(Path("torch/include/ATen/Functions.h")))
        self.assertFalse(runtime_file(Path("../private.env")))


class ServerTests(unittest.TestCase):
    def setUp(self):
        from .server import Lab
        self.directory = tempfile.TemporaryDirectory()
        self.server = Lab(("127.0.0.1",0),Path(self.directory.name))
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def test_state_local_only_and_static_no_traversal(self):
        with urllib.request.urlopen(self.url+"/api/state") as response:
            self.assertIn("token",json.load(response))
        request=urllib.request.Request(self.url+"/api/state",headers={"Host":"attacker.example"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(self.url+"/../../.env")

    def test_cross_origin_mutation_rejected(self):
        request = urllib.request.Request(self.url+"/api/stop",data=b"{}",headers={"Origin":"https://other.example","X-Lab-Token":self.server.token})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code,403)
        self.assertFalse((Path(self.directory.name)/"stop-training.flag").exists())

    def test_replay_removes_captured_stones(self):
        board=[0]*361
        board[180]=2
        for point in (161,179,181):
            board[point]=1
        atomic_json(Path(self.directory.name)/"data/corpus.json",{"records":[{"id":"capture-test",
            "board":board,"to_play":1,"targets":[180],"solutions":[[199]]}]})
        with urllib.request.urlopen(self.url+"/api/replay?id=capture-test&reference=1") as response:
            snapshots=json.load(response)["snapshots"]
        self.assertEqual(snapshots[0]["board"][180],2)
        self.assertEqual(snapshots[1]["board"][180],0)
        self.assertEqual(snapshots[1]["board"][199],1)
        self.assertEqual(snapshots[1]["targets"],[])


class TranscriptionTests(unittest.TestCase):
    def test_unreviewed_scan_never_enters_corpus(self):
        from .scans import register_transcription, approve_transcription
        board=[0]*361
        board[180],board[181]=1,2
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            item=register_transcription(root,{"source_id":"guanzipu-anthology","page":140,
                "diagram_label":"test","board":board,"to_play":1,"category":"life","solutions":[[0]]})
            self.assertFalse(item["training_eligible"])
            with self.assertRaises(ValueError):
                approve_transcription(root,item["id"],"test-reviewer",{"position":True,"solution":False,"source":True})
            self.assertFalse((root/"data/corpus.json").exists())
            result=approve_transcription(root,item["id"],"test-reviewer",{"position":True,"solution":True,"source":True})
            self.assertEqual(result["corpus_records"],1)
            with self.assertRaisesRegex(ValueError,"Duplicate"):
                approve_transcription(root,item["id"],"test-reviewer",{"position":True,"solution":True,"source":True})

    def test_unresolved_source_cannot_be_approved(self):
        from .scans import register_transcription,approve_transcription
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            item=register_transcription(root,{"source_id":"gokyo-answers-1","page":1,"diagram_label":"test"})
            with self.assertRaisesRegex(ValueError,"rights"):
                approve_transcription(root,item["id"],"test-reviewer",{"position":True,"solution":True,"source":True})


@unittest.skipUnless(importlib.util.find_spec("cv2"),"Optional scan runtime not installed")
class VisionTests(unittest.TestCase):
    def test_lattice_rejects_nine_line_chess_grid(self):
        from .vision import lattice
        self.assertIsNone(lattice([20+i*30 for i in range(9)],15,0,400))

    def test_noisy_nineteen_line_lattice(self):
        from .vision import lattice
        result=lattice([20+i*20+(i%3-1)*.5 for i in range(19)],20,0,400)
        self.assertIsNotNone(result)
        self.assertGreaterEqual(result[3],18)


@unittest.skipUnless(importlib.util.find_spec("torch"),"PyTorch not installed")
class ModelTests(unittest.TestCase):
    def test_feedback_training_and_optimizer_resume(self):
        from .train import train,split_records
        from .generate import review
        from .model import load_model
        rows=[]
        for i in range(20):
            board=[0]*361
            board[180+i]=2
            rows.append({"id":f"test-{i}","family":f"test-family-{i}","size":19,"board":board,
                         "to_play":1,"category":"kill","solutions":[[0]]})
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            atomic_json(root/"data/corpus.json",{"records":rows})
            training,_=split_records(rows)
            for i,rating in enumerate(("good","bad")):
                identifier=f"{i:024x}"
                atomic_json(root/"candidates"/(identifier+".json"),{**training[i],"id":identifier,"parent_family":training[i]["family"],"verification":{"status":"unknown"}})
                review(root,identifier,rating)
            first=train(root,steps=1,channels=8,blocks=1,batch_size=2)
            self.assertEqual(first["feedback_examples"],2)
            checkpoint=root/"models/joint/checkpoint.pt"
            second=train(root,steps=1,batch_size=2,resume=checkpoint)
            self.assertEqual(second["steps"],2)
            _,metadata=load_model(checkpoint)
            self.assertTrue(metadata["optimizer"]["state"])
            self.assertIn("record_hashes",metadata)
            self.assertFalse(metadata["production_ready"])

    def test_checkpoint_roundtrip_and_split_family_isolation(self):
        import torch
        from .model import PuzzleNet,Config,checkpoint_metadata,load_model
        from .train import split_records
        rows = [{"family":str(i)} for i in range(30)]*2
        training, validation = split_records(rows)
        self.assertFalse({r["family"] for r in training}&{r["family"] for r in validation})
        model = PuzzleNet(Config(channels=8,blocks=1)).eval()
        x = torch.randn(1,12,19,19)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"model.pt"
            torch.save(checkpoint_metadata(model),path)
            restored,_ = load_model(path)
            with torch.inference_mode():
                self.assertTrue(torch.equal(model(x)[0],restored(x)[0]))

    def test_positive_feedback_cannot_export_unproved_candidate(self):
        from .generate import review
        from .export_puzzles import approved_puzzles
        identifier="a"*24
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            atomic_json(root/"candidates"/(identifier+".json"),{"id":identifier,"verification":{"status":"unknown"}})
            review(root,identifier,"good","A nice shape, not a proof")
            self.assertEqual(approved_puzzles(root),[])


if __name__ == "__main__":
    unittest.main()
