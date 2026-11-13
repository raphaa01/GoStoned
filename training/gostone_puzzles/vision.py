from __future__ import annotations

from pathlib import Path
import hashlib
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .common import atomic_json, read_json, digest
from .scans import scan_inventory


def lattice(values, spacing, low, high):
    values = np.asarray(sorted(set(round(v, 1) for v in values)), dtype=np.float32)
    if len(values) < 10:
        return None
    best = None
    for step in np.linspace(spacing*.90, spacing*1.10, 17):
        tolerance = max(1.8, step*.16)
        offsets=np.unique(np.rint((values[:,None]-np.arange(19)[None,:]*step)/tolerance))*tolerance
        offsets=offsets[(offsets>=low)&(offsets+18*step<=high)]
        if not len(offsets):
            continue
        grids=offsets[:,None]+np.arange(19)[None,:]*step
        distances=np.abs(grids[:,:,None]-values[None,None,:]).min(axis=2)
        hits=(distances<tolerance).sum(axis=1)
        scores=hits-np.minimum(distances/tolerance,1).mean(axis=1)
        index=int(scores.argmax())
        if best is None or scores[index]>best[0]:
            best=(float(scores[index]),float(offsets[index]),float(step),int(hits[index]))
    return best if best and best[3] >= 12 else None


def detect_diagrams(path: Path):
    raw = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("Unreadable scan image")
    height,width = image.shape
    edges = cv2.Canny(image,65,160)
    lines = cv2.HoughLinesP(edges,1,np.pi/720,threshold=65,minLineLength=max(100,width//9),maxLineGap=20)
    if lines is None:
        return [], image
    horizontal, vertical = [], []
    for x1,y1,x2,y2 in lines.reshape(-1,4):
        if abs(y2-y1) < abs(x2-x1)*.035:
            horizontal.append((min(x1,x2),max(x1,x2),(y1+y2)/2))
        if abs(x2-x1) < abs(y2-y1)*.035:
            vertical.append(((x1+x2)/2,min(y1,y2),max(y1,y2)))
    diagrams,grids,seen_windows = [],[],set()
    # Long parallel lines define candidates. The 19-line lattice rejects chess
    # diagrams and most text blocks. It is still a recognition proposal only.
    for left,right,center_y in horizontal:
        span = right-left
        if span < width*.16 or span > width*.75:
            continue
        window=(round(left/(width*.035)),round(right/(width*.035)),int(center_y/(span*.85)))
        if window in seen_windows:
            continue
        seen_windows.add(window)
        similar = [(a,b,y) for a,b,y in horizontal if abs(a-left)<span*.07 and abs(b-right)<span*.07]
        ys = [y for _,_,y in similar if abs(y-center_y)<span*1.1]
        yfit = lattice(ys,span/18,max(0,center_y-span*1.1),min(height-1,center_y+span*1.1))
        if not yfit:
            continue
        _,top,dy,yhits = yfit
        bottom = top+18*dy
        xs = [x for x,a,b in vertical if left-span*.08<x<right+span*.08 and min(b,bottom)-max(a,top)>span*.40]
        xfit = lattice(xs,span/18,max(0,left-span*.08),min(width-1,right+span*.08))
        if not xfit:
            continue
        _,x0,dx,xhits = xfit
        grids.append((x0,top,dx,dy,xhits,yhits))
    # Historical editions also contain interrupted grid lines. Fit complete
    # 19-line lattices inside page panels rather than assuming unbroken borders.
    panels = ([(x*width/2,y*height/2,(x+1)*width/2,(y+1)*height/2) for y in range(2) for x in range(2)]
              if height>width else [(x*width/2,0,(x+1)*width/2,height) for x in range(2)])
    for left,upper,right,lower in panels:
        spacing=(right-left)*(.8 if height>width else .7)/18
        ys=[y for a,b,y in horizontal if left<(a+b)/2<right and upper<y<lower and b-a>spacing*3]
        yfit=lattice(ys,spacing,upper,lower)
        if not yfit:
            continue
        _,top,dy,yhits=yfit
        bottom=top+18*dy
        xs=[x for x,a,b in vertical if left<x<right and min(b,bottom)-max(a,top)>spacing*3]
        xfit=lattice(xs,spacing,left,right)
        if xfit:
            _,x0,dx,xhits=xfit
            grids.append((x0,top,dx,dy,xhits,yhits))
    for x0,top,dx,dy,xhits,yhits in grids:
        if any(abs(d["grid"][0][0]-x0)<dx*3 and abs(d["grid"][0][1]-top)<dy*3 for d in diagrams):
            continue
        board, numbered, uncertain = [], [], []
        angles = (np.arange(32)+.5)*np.pi/16
        for y in range(19):
            for x in range(19):
                px,py=x0+x*dx,top+y*dy
                def darkness(radius):
                    xx=np.clip(np.rint(px+np.cos(angles)*radius).astype(int),0,width-1)
                    yy=np.clip(np.rint(py+np.sin(angles)*radius).astype(int),0,height-1)
                    return float((image[yy,xx]<145).mean())
                interior=darkness(min(dx,dy)*.25)
                ring=darkness(min(dx,dy)*.43)
                color=1 if interior>.64 else 2 if ring>.36 else 0
                board.append(color)
                if color == 1 and interior < .91 or color == 2 and interior > .16:
                    numbered.append(y*19+x)
                if .40<interior<.75 or .22<ring<.48:
                    uncertain.append(y*19+x)
        if not 5 <= sum(bool(c) for c in board) <= 180:
            continue
        diagrams.append({"grid":[[x0,top],[x0+18*dx,top],[x0,top+18*dy]],
                         "diagram_board":board,"possible_numbered_stones":numbered,
                         "uncertain_points":uncertain,"lattice_matches":[xhits,yhits],
                         "solutions":[],"review_status":"pending","training_eligible":False,
                         "warning":"This includes numbered solution stones. It is NOT an initial puzzle position. Chinese numerals, captures and written variations still require transcription."})
    return diagrams,image


def recognize_scans(root: Path, selected=None, limit=0):
    cv2.setNumThreads(1)
    summary={"status":"running","processed_pages":0,"diagram_proposals":0,"approved_training_records":0,"errors":[]}
    started=time.monotonic()
    for source in scan_inventory(root)["sources"]:
        if selected and source["id"] not in selected:
            continue
        for path in sorted((root/"scans/pages"/source["id"]).glob("*.jpg")):
            if limit and summary["processed_pages"]>=limit:
                break
            if (root/"stop-scans.flag").exists():
                summary["status"]="stopped"
                atomic_json(root/"scans/recognition-progress.json",summary)
                return summary
            page=int(path.stem)
            output=root/"scans/recognition"/source["id"]/f"{page:04d}.json"
            try:
                payload=path.read_bytes()
                page_hash=hashlib.sha256(payload).hexdigest()
                data=read_json(output)
                legacy_hash=digest(payload.hex())
                if data and data.get("page_sha256") not in (page_hash,legacy_hash):
                    data=None
                if not data:
                    diagrams,image=detect_diagrams(path)
                    data={"source_id":source["id"],"page":page,"page_sha256":page_hash,
                          "rights_status":source["rights_status"],"diagrams":diagrams,
                          "status":"needs-transcription" if diagrams else "no-confident-19x19-grid",
                          "training_eligible":False}
                    atomic_json(output,data)
                    if diagrams:
                        preview=Image.fromarray(image).convert("RGB")
                        draw=ImageDraw.Draw(preview)
                        for diagram in diagrams:
                            a,b,c=diagram["grid"]
                            draw.rectangle((a[0],a[1],b[0],c[1]),outline="#d44823",width=3)
                        preview.save(output.with_suffix(".jpg"),quality=88)
                if data.get("page_sha256") != page_hash:
                    data["page_sha256"]=page_hash
                    atomic_json(output,data)
                summary["diagram_proposals"]+=len(data["diagrams"])
            except Exception as error:
                summary["errors"].append({"source":source["id"],"page":page,"error":str(error)[:200]})
            summary["processed_pages"]+=1
            if summary["processed_pages"]%5==0:
                summary["seconds"]=time.monotonic()-started
                atomic_json(root/"scans/recognition-progress.json",summary)
    summary.update(status="completed-proposals-only",seconds=time.monotonic()-started)
    atomic_json(root/"scans/recognition-progress.json",summary)
    return summary
