from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import random
from unittest.mock import patch
import unittest
import urllib.error
import urllib.request

from .common import atomic_json, canonical, digest, read_json, relative_pattern, tactical_core, transform_point
from .historical import coordinates, parse_smith
from .rules import State, unconditional_life
from .solver import Limits, Solver, verify_certificate


class RuleProofTests(unittest.TestCase):
    def test_capture_bound_cannot_hide_an_opponents_life_refutation(self):
        state=State.setup(2,[2,0,0,0],2,[0])
        result=Solver("kill",1,Limits(1,5000,2),seek=-1).solve(state)
        self.assertEqual(result["status"],"proven-loss")
        verify_certificate(state,result["certificate"])
    def test_static_diagram_construction_does_not_capture_setup_stones(self):
        from .rules import static_placement_allowed
        board=[2,1,0,0,0,0,0,0,0]
        self.assertFalse(static_placement_allowed(board,3,3,1))
        self.assertTrue(static_placement_allowed(board,3,3,2))
        self.assertEqual(board,[2,1,0,0,0,0,0,0,0])
    def test_deadline_bound_agrees_with_unpruned_small_board_oracle(self):
        from .rules import terminal
        def brute(state, depth):
            outcome=terminal(state,"kill",1)
            if outcome is not None:
                return outcome
            if depth == 0 or state.passes >= 2:
                return -1
            values=(brute(child,depth-1) for _,child in state.legal())
            return max(values) if state.to_play == 1 else min(values)
        rng=random.Random(872)
        resolved=0
        for _ in range(120):
            state=State.setup(3,[0]*9,1)
            for _ in range(rng.randrange(2,9)):
                state=rng.choice(list(state.legal()))[1]
            targets=[p for p,c in enumerate(state.stones) if c == 2]
            if not targets:
                continue
            state=State(state.size,state.stones,state.to_play,frozenset([targets[0]]),state.history)
            result=Solver("kill",1,Limits(2,100000,2),deadline=True).solve(state)
            if result["status"] != "unknown":
                resolved+=1
                self.assertEqual(result["status"] == "deadline-success",brute(state,3 if state.to_play == 1 else 4) == 1)
        self.assertGreater(resolved,60)

    def test_capture_liberty_bound_is_only_a_deadline_loss(self):
        state = State.setup(3, [0,0,0,0,2,0,0,0,0], 1, [4])
        bounded = Solver("kill", 1, Limits(2, 500, 2), deadline=True).solve(state)
        self.assertEqual(bounded["status"], "deadline-failure")
        verify_certificate(state, bounded["certificate"])
        proof = copy.deepcopy(bounded["certificate"])
        proof["deadline_plies"] = 9
        with self.assertRaisesRegex(ValueError, "liberty bound"):
            verify_certificate(state, proof)
        result = Solver("kill", 1, Limits(2, 500, 2), seek=1).solve(state)
        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["certificate"])

    def test_transposition_key_retains_history_targets_and_player(self):
        state = State.setup(3, [0,0,0,0,2,0,0,0,0], 1, [4])
        solver = Solver("kill", 1)
        variants = [state, State(3,state.stones,2,state.targets,state.history),
                    State(3,state.stones,1,frozenset(),state.history),
                    State(3,state.stones,1,state.targets,state.history|{bytes([0]*9)}),
                    State(3,state.stones,1,state.targets,state.history,1)]
        self.assertEqual(len({solver._key(s,3) for s in variants}), len(variants))
        self.assertNotEqual(solver._key(state,3),solver._key(state,2))

    def test_unhelpful_neural_prior_cannot_change_proved_result(self):
        state = State.setup(3, [2,1,0,0,1,0,1,0,0], 2, [0])
        # Prefer the worst-ordered coordinates and pass; counteranswers remain mandatory.
        result = Solver("kill", 1, Limits(1,5000,2), policy=lambda s:{-1:100,8:50},seek=1).solve(state)
        self.assertEqual(result["status"], "proven-win")
        verify_certificate(state,result["certificate"])

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
    def test_generated_objective_does_not_chase_a_stray_stone(self):
        from .historical import infer_targets
        board=[0]*361
        for point in [0,100,101,120]:
            board[point]=2
        self.assertEqual(infer_targets(board,1,"kill",1),[0])
        self.assertEqual(set(infer_targets(board,1,"kill",1,prefer_main=True)),{100,101,120})
    def test_reviewed_transcriptions_replay_and_merge_symmetry_variants(self):
        from .corpus import import_reviewed, audit_corpus
        import hashlib
        original = b"fixture source identity"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            specs = root/"fixture"/"transcriptions"
            specs.mkdir(parents=True)
            source = {"id":"guanzipu-anthology","sha1":hashlib.sha1(original).hexdigest(),
                      "pages":100,"relative_path":"original.pdf","rights_status":"old-original-pd-scan"}
            (root/"original.pdf").write_bytes(original)
            a = {"label":"a","source_id":source["id"],"page":100,"black":"ba",
                 "white":"aa","to_play":1,"category":"tesuji","solutions":["bb"],
                 "note":"fixture","review":{"reviewer":"test","position":True,"solution":True,"source":True}}
            b = {**a,"label":"b","black":"ra","white":"sa","solutions":["rb sc"]}
            atomic_json(specs/"test.json",{"schema":"gostone.reviewed-scan-transcriptions/1",
                                          "source_pdf_sha1":source["sha1"],"records":[a,b]})
            with patch("training.gostone_puzzles.corpus.ROOT",root/"fixture"), \
                 patch("training.gostone_puzzles.corpus.scan_inventory",return_value={"sources":[source]}), \
                 patch("training.gostone_puzzles.scans.scan_inventory",return_value={"sources":[source]}):
                result = import_reviewed(root)
                self.assertEqual(result["audit"]["records"],1)
                self.assertEqual(len(result["merged_same_family"]),1)
                self.assertEqual(result["audit"]["move_examples"],3)
                self.assertEqual(import_reviewed(root)["audit"]["records"],1)
                self.assertEqual(audit_corpus(root)["families"],1)
                (root/"original.pdf").write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError,"original changed"):
                    import_reviewed(root)

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

    def test_solution_fingerprint_detects_shift_rotation_and_color_swap(self):
        from .common import solution_fingerprint
        first=[{"move":20,"color":1},{"move":21,"color":2},{"move":40,"color":1}]
        shifted=[{"move":8*19+8,"color":2},{"move":9*19+8,"color":1},{"move":9*19+7,"color":2}]
        self.assertEqual(solution_fingerprint(first,1),solution_fingerprint(shifted,2))
        self.assertIsNone(solution_fingerprint(first[:1],1))
        changed=[dict(move) for move in first]
        changed[2]["move"]=42
        self.assertNotEqual(solution_fingerprint(first,1),solution_fingerprint(changed,1))

    def test_puzzle_numbers_survive_subsets_reordering_and_later_exports(self):
        from .export_puzzles import allocate_numbers,export_registry
        def row(identifier,offset):
            board=[0]*361
            board[offset],board[offset+1]=2,1
            return {"id":identifier,"size":19,"board":board,"to_play":1,"targets":[offset],
                    "verification":{"solution":[{"move":offset+19,"color":1}]}}
        a,b,c=row("a",0),row("b",20),row("c",40)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.assertEqual([r["puzzle_number"] for r in allocate_numbers(root,[a,b])],[1,2])
            self.assertEqual([r["puzzle_number"] for r in allocate_numbers(root,[b,c,a])],[2,3,1])
            altered=copy.deepcopy(a)
            altered["board"][360]=1
            with self.assertRaisesRegex(ValueError,"changed"):
                allocate_numbers(root,[altered])
            registry=export_registry(root)
            registry["entries"]["b"]["number"]=1
            atomic_json(root/"data/export-registry.json",registry)
            with self.assertRaisesRegex(ValueError,"conflicting"):
                allocate_numbers(root,[a])

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


class ExportTests(unittest.TestCase):
    def test_actual_proofs_export_both_colors_and_resist_forgery_and_relabeling(self):
        from .generate import certify,review
        from .export_puzzles import export_puzzles,approved_puzzles
        # Deliberately artificial unit fixture, never a training or candidate
        # quality example. Capturing the top chain is the sole winning move;
        # otherwise it connects to a pre-existing two-eye chain in one reply.
        board=[0]*361
        for x in range(13):
            board[x]=2
        board[13]=1
        for x in range(1,13):
            board[19+x]=1
        for y in range(2,5):
            for x in range(5):
                if (x,y) not in ((1,3),(3,3)):
                    board[y*19+x]=2
        verification=certify({"board":board,"to_play":1,"targets":list(range(13)),"category":"kill"},1,10,100000)
        self.assertTrue(verification["export_eligible"])
        for player in (1,2):
            with self.subTest(player=player),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                actual=board if player == 1 else [3-c if c else 0 for c in board]
                proof=verification if player == 1 else certify({"board":actual,"to_play":player,
                    "targets":list(range(13)),"category":"kill"},1,10,100000)
                parent_board=[0]*361
                parent_board[180],parent_board[181]=1,2
                atomic_json(root/"data/corpus.json",{"sources":[{"id":"test-fixture-only",
                    "reviewed_territories":["DE"],
                    "commercial_use_of_original_content_in_reviewed_territories":True,
                    "attribution_required_for_original_content_in_reviewed_territories":False}],
                    "records":[{"id":"parent","source_id":"test-fixture-only","board":parent_board,
                        "to_play":1,"family":canonical(parent_board,19,1),"solutions":[[0]]}]})
                row={"id":"a"*24,"size":19,"board":actual,"to_play":player,"targets":list(range(13)),
                    "category":"kill","parent_id":"parent","parent_family":"test-family",
                    "requested_kyu":[10,20],"requested_own_moves":1,"verification":proof}
                candidate=root/"candidates"/(row["id"]+".json")
                atomic_json(candidate,row)
                review(root,row["id"],"good",kyu=15)
                exported=export_puzzles(root,root/"output")
                payload=read_json(Path(exported["json"]))["puzzles"][0]
                self.assertEqual(payload["puzzle_number"],1)
                self.assertEqual(payload["starting_color"],"black" if player == 1 else "white")
                self.assertEqual(payload["difficulty"]["kyu"],15)
                self.assertEqual(len(payload["verification"]["wrong_variations"]),2)
                sgf=Path(exported["sgf"]).read_text()
                self.assertIn("GN[Puzzle 1]",sgf)
                self.assertIn("PL[B]" if player == 1 else "PL[W]",sgf)
                self.assertEqual(sgf.count("incorrect;"),4)
                broken=copy.deepcopy(row)
                certificate=broken["verification"]["certificate"]
                certificate["nodes"][certificate["root"]]["branches"][0]["move"]=14
                atomic_json(candidate,broken)
                with self.assertRaises(ValueError):
                    approved_puzzles(root)
                candidate.unlink()
                row["id"]="b"*24
                atomic_json(root/"candidates"/(row["id"]+".json"),row)
                review(root,row["id"],"good",kyu=15)
                self.assertEqual(approved_puzzles(root),[])


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

    def test_generation_preserves_kyu_depth_budget_and_rejects_external_writer(self):
        def request(payload):
            req=urllib.request.Request(self.url+"/api/job",data=json.dumps(payload).encode(),
                headers={"Origin":self.url,"X-Lab-Token":self.server.token})
            with urllib.request.urlopen(req) as response:
                return json.load(response)
        settings={"action":"generate","approach":"mutation","attempts":150,"own_moves":5,
                  "kyu_min":8,"kyu_max":17,"proof_seconds":2.5}
        with patch.object(self.server,"start_job",return_value={"pid":123}) as start:
            self.assertEqual(request(settings),{"pid":123})
            arguments=start.call_args.args[0]
            for option,value in (("--attempts","150"),("--own-moves","5"),("--kyu-min","8"),
                                 ("--kyu-max","17"),("--proof-seconds","2.5")):
                self.assertEqual(arguments[arguments.index(option)+1],value)
            with self.assertRaises(urllib.error.HTTPError):
                request({**settings,"kyu_min":25,"kyu_max":5})
            self.assertEqual(start.call_count,1)
        atomic_json(Path(self.directory.name)/"writer.lock",{"pid":123})
        with urllib.request.urlopen(self.url+"/api/state") as response:
            self.assertTrue(json.load(response)["job"]["running"])
        with self.assertRaisesRegex(ValueError,"writer lock"):
            self.server.start_job(["generate"])

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
    def test_kyu_calibration_needs_independent_labels_and_generalizes_by_family(self):
        from .difficulty import fit_examples,predict_vector
        import numpy as np
        examples=[{"group":str(i),"features":[i/30],"kyu":i+1} for i in range(30)]
        fitted=fit_examples(examples)
        self.assertEqual(fitted["status"],"calibrated-estimate")
        self.assertLess(fitted["validation_mae"],2.5)
        repeated=[{**e,"group":"same-core"} for e in examples]
        self.assertEqual(fit_examples(repeated)["status"],"insufficient-reviewed-data")
        selected=[{"group":"a","features":[0],"kyu":1},{"group":"a","features":[0],"kyu":30},
                  {"group":"b","features":[1],"kyu":15}]
        self.assertEqual(predict_vector([0],selected,np.array([1]),exclude_group="a")[0],15)

    def test_missing_kyu_cannot_pass_export_and_boolean_is_not_a_rank(self):
        from .generate import review
        from .export_puzzles import approved_puzzles
        identifier="e"*24
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            atomic_json(root/"candidates"/(identifier+".json"),{"id":identifier,"verification":{"export_eligible":True}})
            review(root,identifier,"good")
            self.assertEqual(approved_puzzles(root),[])
            with self.assertRaisesRegex(ValueError,"Kyu"):
                review(root,identifier,"good",kyu=True)
            review(root,identifier,"good",kyu=15)
            self.assertEqual(read_json(root/"reviews"/(identifier+".json"))["kyu"],15)
            review(root,identifier,"good",kyu=None)
            self.assertIsNone(read_json(root/"reviews"/(identifier+".json"))["kyu"])
            self.assertFalse(read_json(root/"models/difficulty.json")["ready"])
    def test_fresh_composition_never_copies_parent_stones(self):
        import numpy as np
        import torch
        from .generate import draw_board
        from .model import Config
        class EmptyPredictor:
            config=Config()
            def __call__(self,x):
                self.inputs=getattr(self,"inputs",[])+[x.clone()]
                logits=torch.full((1,3,19,19),-100.)
                logits[:,0]=100.
                return logits,torch.zeros((1,362)),torch.zeros(1)
        board=[0]*361
        board[0],board[1],board[19]=1,2,1
        parent={"board":board,"to_play":1,"category":"kill","targets":[1]}
        model=EmptyPredictor()
        result,_=draw_board(model,parent,np.random.default_rng(3),mode="fresh")
        self.assertEqual(result,[0]*361)
        self.assertFalse(model.inputs[0][0,1:3].any())
        self.assertFalse(model.inputs[0][0,13].any())

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
        x = torch.randn(1,model.config.input_planes,19,19)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"model.pt"
            torch.save(checkpoint_metadata(model),path)
            restored,_ = load_model(path)
            with torch.inference_mode():
                self.assertTrue(torch.equal(model(x)[0],restored(x)[0]))

    def test_goal_features_retain_defending_role_and_legacy_loading(self):
        from .model import encode
        board=[0]*361
        board[20]=2
        features,_=encode(board,1,"kill",input_planes=15,targets=[20],goal_player=2)
        self.assertEqual(features.shape,(15,19,19))
        self.assertEqual(features[13].sum(),1)
        self.assertEqual(features[14].sum(),0)
        features,_=encode(board,2,"tesuji",input_planes=15)
        self.assertEqual(features[12].sum(),361)
        self.assertEqual(encode(board,1,"kill")[0].shape,(12,19,19))
        with self.assertRaisesRegex(ValueError,"predates"):
            encode(board,1,"tesuji",input_planes=12)

    def test_new_training_run_cannot_overwrite_existing_checkpoint(self):
        from .train import train
        rows=[]
        for i in range(20):
            board=[0]*361;board[180+i]=2
            rows.append({"id":str(i),"family":str(i),"board":board,"to_play":1,"category":"kill","solutions":[[0]]})
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            atomic_json(root/"data/corpus.json",{"records":rows})
            train(root,steps=1,channels=8,blocks=1,batch_size=2,run_name="experiment")
            path=root/"models/experiment/checkpoint.pt"
            before=path.read_bytes()
            with self.assertRaisesRegex(ValueError,"already exists"):
                train(root,steps=1,channels=8,blocks=1,batch_size=2,run_name="experiment")
            self.assertEqual(path.read_bytes(),before)
            self.assertTrue((root/"models/experiment/best.pt").exists())
            manifest=read_json(root/"models/experiment/corpus-manifest.json")
            self.assertEqual(manifest["total_records"],20)

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
