"use strict";
const $ = (id) => document.getElementById(id);
let state, signature = "", selectedTab = "candidates", scanImage, gridPoints = [], scannedBoard = Array(361).fill(0);
let displayedScan = null;
let scanProposals = [];
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function message(text) { $("message").textContent = text; $("message").style.display = "block"; }
async function post(path, body) {
  const response = await fetch(path, {method:"POST", headers:{"Content-Type":"application/json", "X-Lab-Token":state.token}, body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  await refresh();
  return result;
}
function board(canvas, stones, targets = [], moves = []) {
  const c = canvas.getContext("2d"), width = canvas.width, margin = width*.055, step = (width-2*margin)/18;
  c.fillStyle = "#cda76d"; c.fillRect(0,0,width,width); c.strokeStyle="#705735"; c.lineWidth=.7;
  for(let i=0;i<19;i++){const p=margin+i*step;c.beginPath();c.moveTo(p,margin);c.lineTo(p,width-margin);c.moveTo(margin,p);c.lineTo(width-margin,p);c.stroke();}
  for(const y of [3,9,15]) for(const x of [3,9,15]) {c.beginPath();c.arc(margin+x*step,margin+y*step,1.6,0,Math.PI*2);c.fillStyle="#634b2d";c.fill();}
  stones.forEach((color,p)=>{if(!color)return;const x=margin+(p%19)*step,y=margin+Math.floor(p/19)*step;c.beginPath();c.arc(x,y,step*.46,0,Math.PI*2);c.fillStyle=color===1?"#17201b":"#f4f2e8";c.fill();c.strokeStyle=color===1?"#070d09":"#8e8d7c";c.stroke();if(targets.includes(p)){c.beginPath();c.arc(x,y,step*.18,0,Math.PI*2);c.strokeStyle="#e3995c";c.lineWidth=2;c.stroke();c.lineWidth=.7;}});
  moves.forEach((move,index)=>{if(move.move<0)return;const x=margin+(move.move%19)*step,y=margin+Math.floor(move.move/19)*step;c.beginPath();c.arc(x,y,step*.45,0,Math.PI*2);c.fillStyle=move.color===1?"#17201b":"#f4f2e8";c.fill();c.fillStyle=move.color===1?"#fff":"#17201b";c.font=`bold ${step*.7}px sans-serif`;c.textAlign="center";c.textBaseline="middle";c.fillText(String(move.number||index+1),x,y);});
}
function replayControls(canvas,row,reference){
  const controls=el("div",undefined,"feedback"),start=el("button",reference?"Referenzfolge spielen":"Geprüfte Folge spielen"),previous=el("button","←"),next=el("button","→"),caption=el("span",""),variation=el("select");
  let snapshots=[],index=0;previous.hidden=next.hidden=true;
  function show(){const snapshot=snapshots[index];board(canvas,snapshot.board,snapshot.targets,snapshot.move?[snapshot.move]:[]);caption.textContent=`${index}/${snapshots.length-1}`;previous.disabled=index===0;next.disabled=index===snapshots.length-1;}
  start.onclick=async()=>{try{const response=await fetch(`/api/replay?id=${encodeURIComponent(row.id)}&reference=${reference?1:0}&variant=${variation.value||0}`);const data=await response.json();if(!response.ok)throw new Error(data.error);snapshots=data.snapshots;index=0;previous.hidden=next.hidden=false;show();}catch(error){message(error.message);}};
  previous.onclick=()=>{if(index>0){index--;show();}};next.onclick=()=>{if(index<snapshots.length-1){index++;show();}};
  controls.append(start,previous,caption,next);
  if(reference&&row.solutions.length>1){row.solutions.forEach((_,i)=>{const option=el("option",`Variante ${i+1}`);option.value=String(i);variation.append(option);});variation.setAttribute("aria-label",`Referenzvariante ${row.id}`);controls.append(variation);}
  return controls;
}
function makeCard(row, reference = false) {
  const card=el("article",undefined,"card"), canvas=el("canvas");canvas.width=canvas.height=440;
  const badge=el("span",reference?"Historische Referenz":({"proven-win":row.verification.export_eligible?"Vorgaben vollständig bewiesen":"Gewinn bewiesen · Anforderungen offen","proven-loss":"Ziel widerlegt","already-terminal":"Ziel schon entschieden","unknown":"Lösung ungeklärt"}[row.verification.status]||row.verification.status),"badge");
  card.append(badge,canvas);board(canvas,row.board,row.targets);
  card.append(el("h2",reference?row.id:`Kandidat ${row.id.slice(0,8)}`));
  card.append(el("p",`${row.to_play===1?"Schwarz":"Weiß"} beginnt · ${row.category} · ${reference?"historische Zugfolge":row.approach}`));
  if(reference){
    card.append(el("p",`${row.solutions.length} Referenzvariante(n) · Zielgruppe automatisch vorgeschlagen`));
    card.append(replayControls(canvas,row,true));
  }else{
    card.append(el("p",`Gewünschte Tiefe: ${row.requested_own_moves} eigene Züge · Kyu noch unbewertet`));
    if(row.verification.status==="proven-win")card.append(el("p",`Nachgewiesen: höchstens ${row.verification.within_own_moves} eigene Züge. ${row.verification.export_eligible?"Beweisvorgaben erfüllt.":"Noch keine freigegebene Aufgabe für deine Vorgaben."}`));
    if(row.verification.solution)card.append(replayControls(canvas,row,false));
    const note=el("textarea");note.placeholder="Was ist gut, ähnlich, unklar oder unschön?";note.value=row.feedback?.note||"";note.setAttribute("aria-label",`Feedback für ${row.id}`);
    const buttons=el("div",undefined,"feedback");for(const [rating,label] of [["good","Gute Idee"],["bad","Aussortieren"],["unsure","Unklar"]]){const button=el("button",label);if(row.feedback?.rating===rating)button.classList.add("selected");button.onclick=async()=>{try{await post("/api/feedback",{id:row.id,rating,note:note.value});message("Feedback gespeichert. Es wird beim Weiterlernen berücksichtigt.");}catch(error){message(error.message);}};buttons.append(button);}card.append(note,buttons);
  }
  return card;
}
function render() {
  $("connection").textContent=state.job.running?"Lokal · Lauf aktiv":"Lokal verbunden";
  const stats=[[state.references.length,"historische Referenzen"],[state.candidates.length,"sichtbare Kandidaten"],[state.candidates.filter(r=>r.verification.export_eligible).length,"vollständig passende Aufgaben"],[state.candidates.filter(r=>r.feedback?.rating==="good").length,"positive Qualitätsurteile"]];
  $("stats").replaceChildren(...stats.map(([count,label])=>{const n=el("div",undefined,"stat");n.append(el("strong",String(count)),el("span",label));return n;}));
  const nextSignature=JSON.stringify(state.candidates.map(r=>[r.id,r.feedback?.updated_at]));
  if(signature!==nextSignature){signature=nextSignature;$("candidate-list").replaceChildren(...state.candidates.slice(0,36).map(r=>makeCard(r)));if(!state.candidates.length)$("candidate-list").append(el("p","Noch keine Kandidaten. Trainiere zuerst ein Modell oder starte einen Vergleichslauf."));}
  if(!$("reference-list").children.length)$("reference-list").replaceChildren(...state.references.map(r=>makeCard(r,true)));
  const table=el("table"),head=el("tr");for(const title of ["Modell","Schritte","Parameter","Referenzzug Top 1","Brettrekonstruktion","Feedback"])head.append(el("th",title));table.append(head);
  for(const [name,report] of Object.entries(state.models)){if(!report)continue;const row=el("tr");for(const value of [name,report.steps,report.parameters,`${(report.validation.reference_move_top1*100).toFixed(1)} %`,report.validation.masked_cross_entropy.toFixed(3),report.feedback_examples])row.append(el("td",String(value)));table.append(row);}
  $("model-reports").replaceChildren(table,el("p","Diese Werte messen Nachahmung und Rekonstruktion auf getrennten Aufgabenfamilien. Sie messen noch keine Qualität neuer Puzzle."));
  $("job-log").textContent=state.job.log||"Noch kein Lauf über diese Oberfläche gestartet.";
  for(const id of ["generate","train","download-scans"])$(id).disabled=state.job.running;
  if(!$("scan-source").options.length){for(const source of state.scans.sources){const option=el("option",`${source.id} · ${source.pages||"?"} Seiten`);option.value=source.id;$("scan-source").append(option);}}
  const downloaded=state.scans.sources.filter(s=>s.download_status==="complete");
  $("scan-status").textContent=`${downloaded.length}/${state.scans.sources.length} Scans heruntergeladen · ${downloaded.reduce((n,s)=>n+(s.pages||0),0)} Quellseiten. ${state.recognition_progress?.diagram_proposals||0} automatische Diagrammvorschläge; noch keine geprüften Trainingsaufgaben daraus.`;
}
async function refresh(){const response=await fetch("/api/state");if(!response.ok)throw new Error("Lab nicht erreichbar");state=await response.json();render();}
document.querySelectorAll("nav button").forEach(button=>button.onclick=()=>{selectedTab=button.dataset.tab;document.querySelectorAll(".panel").forEach(panel=>panel.hidden=panel.id!==selectedTab);document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("selected",b===button));});
$("generate").onclick=()=>post("/api/job",{action:"generate",approach:$("approach").value,attempts:Number($("attempts").value),own_moves:Number($("depth").value)}).catch(e=>message(e.message));
$("train").onclick=()=>post("/api/job",{action:"train",approach:$("train-approach").value,steps:Number($("train-steps").value),resume:true}).catch(e=>message(e.message));
$("stop").onclick=()=>post("/api/stop",{}).then(()=>message("Anhalten angefordert. Der nächste Trainingscheckpoint wird gespeichert.")).catch(e=>message(e.message));
$("download-scans").onclick=()=>post("/api/job",{action:"download-scans"}).catch(e=>message(e.message));
function drawScan(){const canvas=$("scan-canvas"),context=canvas.getContext("2d");context.drawImage(scanImage,0,0);context.fillStyle="#d64b28";context.font="bold 25px sans-serif";gridPoints.forEach(([x,y],i)=>{context.beginPath();context.arc(x,y,7,0,Math.PI*2);context.fill();context.fillText(String(i+1),x+12,y);});}
$("load-page").onclick=()=>{displayedScan={source:$("scan-source").value,page:Number($("scan-page").value)};const image=new Image();image.onload=async()=>{scanImage=image;gridPoints=[];const canvas=$("scan-canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;drawScan();$("grid-status").textContent="Punkt 1: erste Kreuzung oben links anklicken.";try{const response=await fetch(`/api/scan-proposal?source=${encodeURIComponent(displayedScan.source)}&page=${displayedScan.page}`);const data=await response.json();scanProposals=data.diagrams||[];const manual=el("option","Gitter manuell wählen");manual.value="-1";$("scan-proposal").replaceChildren(manual);scanProposals.forEach((proposal,index)=>{const option=el("option",`Vorschlag ${index+1} · ${proposal.uncertain_points.length} unsichere Punkte`);option.value=String(index);$("scan-proposal").append(option);});}catch(error){message(error.message);}};image.onerror=()=>message("Seite konnte nicht geladen werden. Seitenzahl und Downloadstatus prüfen.");image.src=`/api/scan-image?source=${encodeURIComponent(displayedScan.source)}&page=${displayedScan.page}`;};
$("scan-proposal").onchange=()=>{const index=Number($("scan-proposal").value);if(index<0||!scanProposals[index])return;const proposal=scanProposals[index];gridPoints=proposal.grid.map(point=>[...point]);scannedBoard=[...proposal.diagram_board];drawScan();board($("scan-board"),scannedBoard);$("diagram-label").value=`Diagramm ${index+1}`;$("grid-status").textContent=`Gittervorschlag: ${proposal.uncertain_points.length} unsichere Punkte, ${proposal.possible_numbered_stones.length} mögliche Lösungsziffern. Zeilenlage und jeden Stein kontrollieren.`;};
$("scan-canvas").onclick=event=>{if(!scanImage)return;if(gridPoints.length===3)gridPoints=[];const canvas=event.currentTarget,rect=canvas.getBoundingClientRect();gridPoints.push([(event.clientX-rect.left)*canvas.width/rect.width,(event.clientY-rect.top)*canvas.height/rect.height]);drawScan();$("grid-status").textContent=["","Punkt 2: letzte Kreuzung oben rechts.","Punkt 3: erste Kreuzung unten links.","Erkennung vorgeschlagen. Jede belegte Kreuzung und die Lösungsziffern prüfen."][gridPoints.length];if(gridPoints.length===3)recognize();};
function recognize(){
  const scratch=document.createElement("canvas");scratch.width=scanImage.naturalWidth;scratch.height=scanImage.naturalHeight;const c=scratch.getContext("2d");c.drawImage(scanImage,0,0);const image=c.getImageData(0,0,scratch.width,scratch.height);
  const [a,b,d]=gridPoints,dx=[(b[0]-a[0])/18,(b[1]-a[1])/18],dy=[(d[0]-a[0])/18,(d[1]-a[1])/18];const radius=Math.min(Math.hypot(...dx),Math.hypot(...dy))*.4;
  const dark=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=image.width||y>=image.height)return false;const i=(y*image.width+x)*4;return (image.data[i]+image.data[i+1]+image.data[i+2])/3<145;};
  scannedBoard=Array(361).fill(0);for(let y=0;y<19;y++)for(let x=0;x<19;x++){const px=a[0]+x*dx[0]+y*dy[0],py=a[1]+x*dx[1]+y*dy[1];let interior=0,ring=0;for(let k=0;k<16;k++){const angle=(k+.5)*Math.PI/8;interior+=dark(px+Math.cos(angle)*radius*.65,py+Math.sin(angle)*radius*.65);ring+=dark(px+Math.cos(angle)*radius,py+Math.sin(angle)*radius);}scannedBoard[y*19+x]=interior>10?1:ring>6?2:0;}
  board($("scan-board"),scannedBoard);
}
$("scan-board").onclick=event=>{const canvas=event.currentTarget,rect=canvas.getBoundingClientRect(),margin=canvas.width*.055,step=(canvas.width-2*margin)/18,x=Math.round(((event.clientX-rect.left)*canvas.width/rect.width-margin)/step),y=Math.round(((event.clientY-rect.top)*canvas.height/rect.height-margin)/step);if(x>=0&&x<19&&y>=0&&y<19){const p=y*19+x;scannedBoard[p]=(scannedBoard[p]+1)%3;board(canvas,scannedBoard);}};
$("save-transcription").onclick=()=>{if(!displayedScan||gridPoints.length!==3)return message("Zuerst eine Seite und ein vollständiges Gitter auswählen.");try{const raw=$("scan-solution").value.trim();const solutions=raw?raw.split(";").map(line=>line.split(",").map(s=>{s=s.trim();if(!/^[a-s]{2}$/.test(s))throw new Error("Lösungszüge als SGF-Koordinaten aa bis ss eingeben.");return (s.charCodeAt(1)-97)*19+s.charCodeAt(0)-97;})):[];post("/api/transcription",{source_id:displayedScan.source,page:displayedScan.page,diagram_label:$("diagram-label").value,board:scannedBoard,to_play:Number($("scan-player").value),category:$("scan-category").value,solutions,grid:gridPoints,notes:$("scan-notes").value}).then(()=>message("Übertragung zur Prüfung gespeichert. Noch nicht als Trainingsdaten freigegeben.")).catch(e=>message(e.message));}catch(error){message(error.message);}};
refresh().catch(e=>message(e.message));setInterval(()=>refresh().catch(()=>{$("connection").textContent="Verbindung unterbrochen";}),5000);
