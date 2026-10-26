"""Solver-supervised training evidence, separate from historical and human data."""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from .common import atomic_json,canonical,digest,read_json,tactical_core
from .generate import proof_line
from .rules import State,terminal,normalize_anchors,group
from .solver import Solver,Limits,verify_certificate


def check_record(row):
    initial=State.setup(19,row["board"],row["to_play"],row["targets"])
    anchors=normalize_anchors(row["category"],row.get("anchor_groups",()),19)
    if anchors:
        if initial.targets != anchors[0] | anchors[1]:
            raise ValueError("Synthetic objective omits original anchor stones")
        for index,points in enumerate(anchors):
            color=3-row["to_play"] if row["category"] == "semeai" and index == 1 else row["to_play"]
            if any(initial.stones[p] != color for p in points) or group(initial.stones,19,next(iter(points)))[0] != points:
                raise ValueError("Synthetic anchor does not mark a complete original group")
    proof=row["win_certificate"]
    if (proof["goal"] != row["category"] or proof["player"] != row["to_play"]
            or proof.get("anchor_groups",[]) != row.get("anchor_groups",[])
            or proof.get("deadline_plies") is not None
            or proof["nodes"][proof["root"]]["outcome"] != 1):
        raise ValueError("Synthetic training proof does not establish this objective")
    verify_certificate(initial,proof)
    line=proof_line(initial,proof)
    if any(m["move"] < 0 for m in line) or not line or terminal(initial,row["category"],row["to_play"],row.get("anchor_groups",())) is not None:
        raise ValueError("Synthetic reference needs a nontrivial pass-free solution")
    own=sum(m["color"] == row["to_play"] for m in line)
    if type(row["minimum_own_moves"]) is not int or own != row["minimum_own_moves"] or row["solutions"] != [[m["move"] for m in line]]:
        raise ValueError("Synthetic solution differs from its independently replayed proof")
    if own > 1:
        lower=row["minimum_depth_certificate"]
        if (lower["goal"] != row["category"] or lower["player"] != row["to_play"]
                or lower.get("anchor_groups",[]) != row.get("anchor_groups",[])
                or lower.get("deadline_plies") != 2*(own-1)-1
                or lower["nodes"][lower["root"]]["outcome"] != -1):
            raise ValueError("Synthetic minimum depth has not been established")
        verify_certificate(initial,lower)


def harvest(root: Path):
    """Collect proved strategies; no visual quality, Kyu or human vote is invented."""
    rows=[];seen=set();cores=set();counts=Counter()
    for path in sorted((root/"experiments").rglob("candidates/*.json")):
        row=read_json(path);result=row.get("verification",{})
        if result.get("status") != "proven-win" or not result.get("certificate") or row.get("category") != "semeai":
            continue
        board=row["board"];key=canonical(board,19,row["to_play"])
        core=tactical_core(board,row["targets"],row["to_play"])
        if key in seen or core in cores:
            counts["duplicate-board-or-core"]+=1;continue
        if not 5 <= sum(bool(c) for c in board) <= 35:
            counts["outside-size-curriculum"]+=1;continue
        state=State.setup(19,board,row["to_play"],row["targets"])
        certificate=result["certificate"]
        verify_certificate(state,certificate)
        line=proof_line(state,certificate)
        if not line or any(m["move"] < 0 for m in line):
            counts["pass-or-empty-solution"]+=1;continue
        own=sum(m["color"] == row["to_play"] for m in line)
        if not 1 <= own <= 5:
            continue
        lower=result.get("minimum_depth_certificate")
        if own > 1 and (not lower or lower.get("deadline_plies") != 2*(own-1)-1):
            answer=Solver(row["category"],row["to_play"],Limits(own-1,30000,.3),deadline=True,
                          anchors=row.get("anchor_groups",())).solve(state)
            lower=answer.get("certificate") if answer["status"] == "deadline-failure" else None
            if lower is None:
                counts["minimum-depth-unknown"]+=1;continue
        record={"id":"solver-"+key[:24],"family":key,"board":board,"size":19,"to_play":row["to_play"],
                "category":row["category"],"targets":row["targets"],"anchor_groups":row.get("anchor_groups",[]),
                "solutions":[[m["move"] for m in line]],"minimum_own_moves":own,
                "parent_family":row["parent_family"],"parent_id":row["parent_id"],
                "win_certificate":certificate,"minimum_depth_certificate":lower,
                "origin":str(path.relative_to(root)).replace("\\","/"),"model_run":row.get("model_run"),
                "quality_approved":False,"human_feedback":False,"kyu":None}
        check_record(record)
        seen.add(key);cores.add(core);rows.append(record);counts[f"minimum-own-{own}"]+=1
    value={"schema":"gostone.solver-supervision/1","records":rows,"counts":dict(counts),
           "content_hash":digest(rows),"note":"Proved tactical strategies and depth; not puzzle quality, Kyu labels or human preferences."}
    atomic_json(root/"selfplay/verified.json",value)
    return {"records":len(rows),"counts":dict(counts),"content_hash":value["content_hash"]}


def training_records(root: Path,training_families,validation_families):
    data=read_json(root/"selfplay/verified.json")
    if not data or data.get("schema") != "gostone.solver-supervision/1" or digest(data["records"]) != data["content_hash"]:
        raise ValueError("A current verified solver-supervision dataset is required")
    selected=[];held_out=0;seen=set();cores=set()
    for row in data["records"]:
        if row["parent_family"] in validation_families or row["family"] in validation_families:
            held_out+=1;continue
        if row["parent_family"] not in training_families:
            continue
        check_record(row)
        family=canonical(row["board"],19,row["to_play"])
        core=tactical_core(row["board"],row["targets"],row["to_play"])
        if family != row["family"] or family in seen or core in cores:
            raise ValueError("Changed or duplicate solver-supervision family")
        seen.add(family);cores.add(core);selected.append(row)
    if not selected:
        raise ValueError("No proved synthetic records belong to the training split")
    manifest={"schema":"gostone.solver-training-manifest/1","dataset_hash":data["content_hash"],
              "records":[{"id":r["id"],"family":r["family"],"parent_family":r["parent_family"],
                          "minimum_own_moves":r["minimum_own_moves"],"sha256":digest(r)}for r in selected],
              "excluded_held_out_records":held_out,"human_feedback_examples":0}
    return selected,manifest
