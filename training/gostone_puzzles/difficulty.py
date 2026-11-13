"""Feedback-calibrated Kyu estimator. No labels means no invented rank."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from .common import atomic_json, digest, read_json
from .rules import State, group


def cohort(row):
    return f"{row.get('model_run',row.get('approach'))}:{row.get('model_steps')}"


def features(row):
    line = row.get("verification",{}).get("solution",[])
    if not line or row["verification"].get("status") != "proven-win":
        raise ValueError("Kyu calibration requires a proved, playable solution")
    state = State.setup(19,row["board"],row["to_play"],row["targets"])
    own, opponent, sacrifice, captured, distances = 0,0,0,0,[]
    last = None
    for move in line:
        point = move["move"]
        if point < 0 or move["color"] != state.to_play:
            raise ValueError("Kyu calibration does not accept pass demonstrations")
        child = state.play(point)
        for old,new in zip(state.stones,child.stones):
            if old and not new:
                sacrifice += int(old == row["to_play"])
                captured += int(old != row["to_play"])
        own += int(move["color"] == row["to_play"])
        opponent += int(move["color"] != row["to_play"])
        if last is not None:
            distances.append(abs(point % 19-last % 19)+abs(point//19-last//19))
        state,last = child,point
    initial = tuple(row["board"])
    checked,chains = set(),[]
    for point,color in enumerate(initial):
        if color and point not in checked:
            chain,libs = group(initial,19,point)
            checked.update(chain)
            chains.append((color,len(chain),len(libs)))
    target_libs = len(group(initial,19,next(iter(row["targets"])))[1])
    return [own/8,opponent/8,math.log1p(sum(bool(c) for c in initial))/4.2,
            math.log1p(len(row["targets"]))/4.2,target_libs/12,
            len(chains)/12,sum(libs == 1 for _,_,libs in chains)/8,
            sacrifice/10,captured/20,(sum(distances)/max(1,len(distances)))/10]


def predict_vector(values, examples, scale, exclude_group=None):
    choices = [e for e in examples if e["group"] != exclude_group]
    if not choices:
        raise ValueError("No independent calibration families")
    distances = np.linalg.norm((np.asarray([e["features"] for e in choices])-values)/scale,axis=1)
    nearest = np.argsort(distances)[:min(5,len(choices))]
    weights = 1/(distances[nearest]+.15)
    prediction = float(np.dot(weights,[choices[i]["kyu"] for i in nearest])/weights.sum())
    return prediction,float(distances[nearest[0]])


def fit_examples(examples):
    groups = len({e["group"] for e in examples})
    result = {"status":"insufficient-reviewed-data","examples":examples,"independent_families":groups,
              "minimum_examples":30,"minimum_families":20,"minimum_label_span":10}
    if len(examples) < 30 or groups < 20 or max(e["kyu"] for e in examples)-min(e["kyu"] for e in examples) < 10:
        return result
    vectors = np.asarray([e["features"] for e in examples],dtype=float)
    scale = np.maximum(vectors.std(0),.1)
    errors,distances = [],[]
    for sample in examples:
        # All variants of the held-out family are excluded together.
        others = [e["features"] for e in examples if e["group"] != sample["group"]]
        fold_scale = np.maximum(np.asarray(others).std(0),.1)
        prediction,distance = predict_vector(sample["features"],examples,fold_scale,sample["group"])
        errors.append(abs(prediction-sample["kyu"]))
        distances.append(distance)
    mae = float(np.mean(errors))
    radius = max(1,int(math.ceil(float(np.quantile(errors,.9)))))
    result.update(status="calibrated-estimate" if mae <= 2.5 and radius <= 4 else "validation-too-inaccurate",
                  validation_mae=mae,error_radius_90pct=radius,feature_scale=scale.tolist(),
                  maximum_neighbor_distance=max(.5,float(np.quantile(distances,.95))*1.5),
                  label_range=[min(e["kyu"] for e in examples),max(e["kyu"] for e in examples)],
                  validation="leave-entire-family-out; estimated ranks, not exact human strength")
    return result


def calibrate(root: Path):
    cohorts = {}
    for path in (root/"reviews").glob("*.json"):
        review = read_json(path)
        kyu = review.get("kyu")
        if type(kyu) is not int or not 1 <= kyu <= 30 or review.get("rating") != "good":
            continue
        row = read_json(root/"candidates"/(review["candidate_id"]+".json"))
        if not row:
            continue
        try:
            vector = features(row)
        except ValueError:
            continue
        # Variants that retain seed stones stay in the seed's held-out family.
        # Fresh composition uses geometry only and is grouped by its new core.
        group_id = (row.get("parent_family") if row.get("reference_stones_fixed",True) else
                    row.get("core_fingerprint")) or row.get("core_fingerprint") or row["id"]
        cohorts.setdefault(cohort(row),[]).append({"id":row["id"],"group":group_id,"features":vector,"kyu":kyu})
    models = {key:fit_examples(examples) for key,examples in cohorts.items()}
    result = {"schema":"gostone.kyu-calibration/1","cohorts":models,
              "ready":any(m["status"] == "calibrated-estimate" for m in models.values())}
    result["id"] = digest(result)
    atomic_json(root/"models/difficulty.json",result)
    return result


def estimate(root: Path, row):
    calibration = read_json(root/"models/difficulty.json",{})
    model = calibration.get("cohorts",{}).get(cohort(row))
    if not model or model["status"] != "calibrated-estimate":
        return {"kyu":None,"status":"uncalibrated","requested_band_only":True}
    try:
        vector = features(row)
    except ValueError:
        return {"kyu":None,"status":"no-proved-demonstration"}
    prediction,distance = predict_vector(vector,model["examples"],np.asarray(model["feature_scale"]))
    if distance > model["maximum_neighbor_distance"]:
        return {"kyu":None,"status":"outside-reviewed-support"}
    value = int(round(prediction))
    lower,upper = max(1,value-model["error_radius_90pct"]),min(30,value+model["error_radius_90pct"])
    if lower < model["label_range"][0] or upper > model["label_range"][1]:
        return {"kyu":None,"status":"outside-reviewed-rank-range"}
    return {"kyu":value,"status":"calibrated-estimate","interval_90pct":[lower,upper],
            "validation_mae":model["validation_mae"],"calibration_id":calibration["id"]}
