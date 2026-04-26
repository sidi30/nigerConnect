import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";

// ─── PHOTO URLS (picsum placeholders) ───
const PFP = (id, s = 80) => `https://i.pravatar.cc/${s}?img=${id}`;
const PHOTO = (id, w = 400, h = 300) => `https://picsum.photos/seed/${id}/${w}/${h}`;

const FLAGS = { FR:"🇫🇷",TR:"🇹🇷",MA:"🇲🇦",CN:"🇨🇳",US:"🇺🇸",CA:"🇨🇦",DE:"🇩🇪",BE:"🇧🇪",CI:"🇨🇮",SN:"🇸🇳",BJ:"🇧🇯",TG:"🇹🇬",SA:"🇸🇦",AE:"🇦🇪",GB:"🇬🇧",NE:"🇳🇪" };
const CNAMES = { FR:"France",TR:"Turquie",MA:"Maroc",CN:"Chine",US:"États-Unis",CA:"Canada",DE:"Allemagne",BE:"Belgique",CI:"Côte d'Ivoire",SN:"Sénégal",BJ:"Bénin",TG:"Togo",SA:"Arabie Saoudite",AE:"Émirats",GB:"Royaume-Uni",NE:"Niger" };
const USER_LOC = { lat: 43.53, lon: 5.45 };

// ─── PEOPLE ───
const PEOPLE = [
  { id:1, name:"Amadou Hama", city:"Lyon", country:"FR", lat:45.76, lon:4.83, color:"#E05206", online:true, pfp:11, bio:"Ingénieur IT • Passionné de culture nigérienne", friends:156, photos:23, isSelf:true },
  { id:2, name:"Aminata Boubacar", city:"Paris", country:"FR", lat:48.86, lon:2.35, color:"#FF6D00", online:true, pfp:5, bio:"Juriste • Présidente ANF", friends:342, photos:45 },
  { id:3, name:"Moussa Keita", city:"Marseille", country:"FR", lat:43.30, lon:5.37, color:"#0DB02B", online:false, pfp:12, bio:"Étudiant en médecine", friends:89, photos:12 },
  { id:4, name:"Fatima Diallo", city:"Toulouse", country:"FR", lat:43.60, lon:1.44, color:"#1565C0", online:true, pfp:9, bio:"Entrepreneure • Mode africaine", friends:234, photos:67 },
  { id:5, name:"Issouf Moussa", city:"Lille", country:"FR", lat:50.63, lon:3.06, color:"#7B1FA2", online:false, pfp:15, bio:"Comptable", friends:45, photos:8 },
  { id:6, name:"Ramatou Sani", city:"Bordeaux", country:"FR", lat:44.84, lon:-0.58, color:"#E05206", online:true, pfp:25, bio:"Infirmière • Bénévole", friends:178, photos:34 },
  { id:7, name:"Ibrahim Mahamadou", city:"Istanbul", country:"TR", lat:41.01, lon:28.98, color:"#FF6D00", online:true, pfp:33, bio:"Étudiant en ingénierie", friends:120, photos:28 },
  { id:8, name:"Aïssa Garba", city:"Ankara", country:"TR", lat:39.93, lon:32.85, color:"#E05206", online:false, pfp:16, bio:"Doctorante en chimie", friends:67, photos:15 },
  { id:9, name:"Fatouma Issaka", city:"Casablanca", country:"MA", lat:33.57, lon:-7.59, color:"#0DB02B", online:true, pfp:20, bio:"Responsable associative", friends:289, photos:52 },
  { id:10, name:"Oumarou Garba", city:"New York", country:"US", lat:40.71, lon:-74.01, color:"#E05206", online:true, pfp:53, bio:"Finance • Wall Street", friends:201, photos:41 },
  { id:11, name:"Moussa Adamou", city:"Guangzhou", country:"CN", lat:23.13, lon:113.26, color:"#FF6D00", online:true, pfp:52, bio:"Import/Export textile", friends:156, photos:38 },
  { id:12, name:"Aïchatou Seyni", city:"Montréal", country:"CA", lat:45.50, lon:-73.57, color:"#7B1FA2", online:true, pfp:26, bio:"Étudiante MBA • Présidente JNC", friends:134, photos:29 },
  { id:13, name:"Garba Maïga", city:"Abidjan", country:"CI", lat:5.36, lon:-4.01, color:"#E05206", online:true, pfp:59, bio:"Commerçant • Leader communautaire", friends:456, photos:78 },
  { id:14, name:"Balkissa Hamidou", city:"Dakar", country:"SN", lat:14.72, lon:-17.47, color:"#1565C0", online:false, pfp:21, bio:"Enseignante", friends:98, photos:19 },
  { id:15, name:"Ousmane Djibo", city:"Londres", country:"GB", lat:51.51, lon:-0.13, color:"#0DB02B", online:true, pfp:57, bio:"Analyste data • Tech", friends:167, photos:33 },
  { id:16, name:"Nafissa Bello", city:"Dubaï", country:"AE", lat:25.20, lon:55.27, color:"#FF6D00", online:true, pfp:29, bio:"Business woman • Luxe", friends:312, photos:89 },
  { id:17, name:"Tahirou Waziri", city:"Berlin", country:"DE", lat:52.52, lon:13.41, color:"#E05206", online:false, pfp:55, bio:"Développeur full-stack", friends:78, photos:14 },
  { id:18, name:"Halima Toure", city:"Bruxelles", country:"BE", lat:50.85, lon:4.35, color:"#7B1FA2", online:true, pfp:24, bio:"Diplomate • ONG", friends:234, photos:45 },
  { id:19, name:"Zakaria Moussa", city:"Djeddah", country:"SA", lat:21.49, lon:39.19, color:"#0DB02B", online:false, pfp:60, bio:"Ingénieur pétrole", friends:56, photos:11 },
  { id:20, name:"Rachida Ali", city:"Cotonou", country:"BJ", lat:6.37, lon:2.39, color:"#1565C0", online:true, pfp:23, bio:"Sage-femme", friends:145, photos:27 },
];

const ASSOCIATIONS = [
  { id:101, name:"Assoc. Nigériens de France", country:"FR", members:3200, logo:"🏛️", lat:48.87, lon:2.33, isAssoc:true, verified:true },
  { id:102, name:"Étudiants Niger Turquie", country:"TR", members:890, logo:"🎓", lat:41.02, lon:28.96, isAssoc:true, verified:true },
  { id:103, name:"Communauté Niger Maroc", country:"MA", members:1450, logo:"🤝", lat:33.55, lon:-7.61, isAssoc:true, verified:true },
  { id:104, name:"Niger Diaspora USA", country:"US", members:2100, logo:"🗽", lat:40.73, lon:-73.99, isAssoc:true, verified:true },
  { id:105, name:"Nigériens Côte d'Ivoire", country:"CI", members:4200, logo:"🌴", lat:5.34, lon:-4.03, isAssoc:true, verified:true },
];

// ─── POSTS WITH PHOTOS ───
const POSTS = [
  { id:1, uid:2, type:"photo", content:"Magnifique soirée culturelle nigérienne à Paris ! Musique, danse et dégustations 🎶🇳🇪", photos:[PHOTO("niger1",400,280), PHOTO("niger2",400,280)], likes:567, comments:89, shares:156, time:"2h" },
  { id:2, uid:4, type:"photo", content:"Ma nouvelle collection de mode africaine est disponible ! Tissus wax authentiques du Niger 👗✨", photos:[PHOTO("fashion1",400,350)], likes:342, comments:67, shares:98, time:"3h" },
  { id:3, uid:7, type:"text", content:"Besoin d'un traducteur turc-français à Istanbul pour mes documents universitaires. Si quelqu'un connaît un bon contact, merci de partager ! 🙏", likes:45, comments:23, shares:12, time:"4h", badge:"entraide" },
  { id:4, uid:9, type:"photo", content:"200 kits scolaires distribués aux enfants nigériens de Casablanca ! La solidarité de notre diaspora est magnifique 💪🇳🇪", photos:[PHOTO("school1",400,280), PHOTO("school2",400,280), PHOTO("school3",400,280)], likes:890, comments:134, shares:234, time:"5h", badge:"association" },
  { id:5, uid:11, type:"text", content:"📢 Opportunité business : Recherche partenaires nigériens pour import/export textile entre la Chine et le Niger. Conditions très intéressantes.", likes:123, comments:67, shares:34, time:"6h", badge:"business" },
  { id:6, uid:12, type:"photo", content:"Bienvenue aux 15 nouveaux étudiants nigériens arrivés à Montréal ! On vous accompagne 🇨🇦🇳🇪", photos:[PHOTO("students1",400,260)], likes:312, comments:56, shares:78, time:"8h", badge:"accueil" },
  { id:7, uid:13, type:"photo", content:"Le Tchoukou nigérien fait sensation à Abidjan ! Notre gastronomie conquiert l'Afrique de l'Ouest 🧀🔥", photos:[PHOTO("food1",400,300)], likes:456, comments:98, shares:167, time:"12h" },
];

// ─── SERVICE REQUESTS ───
const SERVICES = [
  { id:1, uid:3, title:"Cherche logement temporaire à Marseille", category:"🏠 Logement", urgency:"urgent", desc:"Arrivée prévue le 15 février. Besoin d'un studio ou chambre pour 2 mois le temps de trouver un logement permanent.", budget:"500-700€/mois", time:"1h", responses:3 },
  { id:2, uid:6, title:"Envoi groupé de colis vers Niamey", category:"✈️ Transport", urgency:"normal", desc:"Départ prévu fin janvier. On regroupe les colis pour réduire les frais. Contactez-moi !", budget:"15€/kg", time:"3h", responses:8 },
  { id:3, uid:8, title:"Traducteur turc-français pour dossier", category:"📋 Administratif", urgency:"normal", desc:"Besoin de traduire des documents pour l'équivalence de diplôme.", budget:"À discuter", time:"5h", responses:2 },
  { id:4, uid:5, title:"Médecin nigérien à Lille ?", category:"🏥 Santé", urgency:"urgent", desc:"Recherche un médecin parlant haoussa ou zarma pour ma mère qui ne parle pas bien français.", time:"6h", responses:5 },
  { id:5, uid:15, title:"Développeur React pour projet diaspora", category:"💼 Emploi", urgency:"normal", desc:"On recrute un dev front pour une app communautaire. Remote OK. CDI ou freelance.", budget:"45-55K€", time:"1j", responses:12 },
  { id:6, uid:16, title:"Partenaire import parfums depuis Dubaï", category:"💼 Business", urgency:"normal", desc:"Cherche distributeur en France ou Afrique de l'Ouest pour parfums orientaux.", time:"2j", responses:7 },
];

// ─── CONVERSATIONS ───
const CONVOS = [
  { id:1, uid:2, lastMsg:"Super ! On se voit samedi alors pour la réunion de l'ANF 👍", time:"14:32", unread:2 },
  { id:2, uid:9, lastMsg:"Les kits scolaires sont arrivés, merci pour ton aide !", time:"12:15", unread:0 },
  { id:3, uid:4, lastMsg:"Je t'envoie les photos de la collection demain", time:"Hier", unread:1 },
  { id:4, uid:13, lastMsg:"Bien reçu le colis, tout est en bon état 📦", time:"Hier", unread:0 },
  { id:5, uid:15, lastMsg:"On peut faire un call mardi pour le projet ?", time:"Lun", unread:0 },
  { id:6, uid:12, lastMsg:"Merci pour les conseils sur Montréal ! 🙏", time:"Dim", unread:3 },
];

const FRIEND_REQUESTS = [
  { uid:17, mutuals:3, time:"2h" },
  { uid:20, mutuals:7, time:"5h" },
  { uid:19, mutuals:1, time:"1j" },
];

const BADGE = { entraide:{ bg:"#E8F5E9",c:"#2E7D32",l:"Entraide" }, association:{ bg:"#E3F2FD",c:"#1565C0",l:"Association" }, business:{ bg:"#FFF8E1",c:"#F57F17",l:"Business" }, accueil:{ bg:"#F3E5F5",c:"#7B1FA2",l:"Accueil" } };

function V({ size=14 }) {
  return <span style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:size,height:size,borderRadius:"50%",background:"#0DB02B",marginLeft:3,flexShrink:0 }}><svg width={size*.6} height={size*.6} viewBox="0 0 10 10" fill="none"><path d="M2 5.5L4 7.5L8 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></span>;
}

function Avatar({ person, size=44, showOnline=true, style:extraStyle={} }) {
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0, ...extraStyle }}>
      <img src={PFP(person.pfp || person.id, size*2)} alt="" style={{ width:size, height:size, borderRadius:size*.35, objectFit:"cover", border:`2.5px solid ${person.color || "#E05206"}` }} />
      {showOnline && person.online && <div style={{ position:"absolute", bottom:0, right:0, width:size*.28, height:size*.28, borderRadius:"50%", background:"#0DB02B", border:"2px solid #FFF" }} />}
    </div>
  );
}

// ─── MAP ───
function SnapMap({ people, associations, onSelect, selected, filter }) {
  const cRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const projRef = useRef(null);
  const [zK, setZK] = useState(1);
  const [ready, setReady] = useState(false);
  const [dims, setDims] = useState({ w:800, h:500 });

  const items = useMemo(() => {
    if (filter === "people") return people.filter(p => !p.isSelf);
    if (filter === "assos") return associations;
    return [...people.filter(p => !p.isSelf), ...associations];
  }, [filter, people, associations]);

  useEffect(() => {
    if (!cRef.current) return;
    setDims({ w:cRef.current.clientWidth, h:cRef.current.clientHeight });
  }, []);

  useEffect(() => {
    if (!svgRef.current || !dims.w) return;
    const svg = d3.select(svgRef.current);
    const { w, h } = dims;
    const proj = d3.geoMercator().center([USER_LOC.lon, USER_LOC.lat]).scale(w*1.2).translate([w/2, h/2]);
    projRef.current = proj;
    const path = d3.geoPath().projection(proj);
    const g = svg.select(".mg");

    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json")
      .then(r => r.json()).then(world => {
        const land = decodeTopo(world);
        g.select(".oc").selectAll("*").remove();
        g.select(".oc").append("rect").attr("width",w*10).attr("height",h*10).attr("x",-w*5).attr("y",-h*5).attr("fill","#E8F4F8");
        const grat = d3.geoGraticule().step([20,20]);
        g.select(".gr").selectAll("*").remove();
        g.select(".gr").append("path").datum(grat()).attr("d",path).attr("fill","none").attr("stroke","rgba(150,200,220,0.35)").attr("stroke-width",0.4);
        g.select(".la").selectAll("*").remove();
        g.select(".la").append("path").datum(land).attr("d",path).attr("fill","#C8E6C0").attr("stroke","#A5D6A0").attr("stroke-width",0.5);
        setReady(true);
      }).catch(() => { drawFallback(g, path, w, h); setReady(true); });

    const zoom = d3.zoom().scaleExtent([0.3,25]).on("zoom", e => { g.attr("transform", e.transform); setZK(e.transform.k); });
    zoomRef.current = zoom;
    svg.call(zoom);
    svg.on("dblclick.zoom", null);
    return () => svg.on(".zoom", null);
  }, [dims]);

  function drawFallback(g, path, w, h) {
    g.select(".oc").selectAll("*").remove();
    g.select(".oc").append("rect").attr("width",w*10).attr("height",h*10).attr("x",-w*5).attr("y",-h*5).attr("fill","#E8F4F8");
    [[[- 17,15],[-17,37],[12,37],[42,12],[51,-1],[35,-27],[18,-35],[8,-5],[-8,10],[-17,15]],
     [[-10,36],[5,46],[8,55],[25,55],[45,62],[55,60],[40,45],[20,36],[-10,36]],
     [[-130,55],[-80,73],[-55,50],[-75,38],[-100,25],[-125,40],[-130,55]],
     [[-80,10],[-50,0],[-38,-10],[-50,-30],[-75,-50],[-80,0],[-80,10]],
     [[30,42],[55,37],[85,28],[115,23],[135,35],[160,60],[180,75],[55,60],[25,48],[30,42]],
     [[115,-34],[140,-15],[153,-27],[140,-38],[115,-34]]
    ].forEach(coords => {
      g.select(".la").append("path").datum({type:"Polygon",coordinates:[coords]}).attr("d",path).attr("fill","#C8E6C0").attr("stroke","#A5D6A0").attr("stroke-width",0.5);
    });
  }

  const flyTo = useCallback((lat, lon, sc=6) => {
    if (!projRef.current || !zoomRef.current) return;
    const [x,y] = projRef.current([lon,lat]);
    d3.select(svgRef.current).transition().duration(800).ease(d3.easeCubicInOut)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(dims.w/2-x*sc, dims.h/2-y*sc).scale(sc));
  }, [dims]);

  const clusters = useMemo(() => {
    if (!projRef.current) return [];
    const thr = zK < 1 ? 70 : zK < 2 ? 45 : zK < 4 ? 25 : 12;
    const pts = items.map(p => { const [px,py] = projRef.current([p.lon,p.lat]); return {...p, px, py}; });
    if (zK > 5) return pts.map(p => ({ ...p, cluster:false, items:[p] }));
    const used = new Set(); const res = [];
    for (let i=0; i<pts.length; i++) {
      if (used.has(i)) continue;
      const grp = [pts[i]]; used.add(i);
      for (let j=i+1; j<pts.length; j++) {
        if (used.has(j)) continue;
        const d = Math.hypot(pts[i].px-pts[j].px, pts[i].py-pts[j].py);
        if (d < thr/zK) { grp.push(pts[j]); used.add(j); }
      }
      const cx = grp.reduce((s,g)=>s+g.px,0)/grp.length;
      const cy = grp.reduce((s,g)=>s+g.py,0)/grp.length;
      res.push({ px:cx, py:cy, cluster:grp.length>1, items:grp, country:grp[0].country });
    }
    return res;
  }, [zK, items]);

  const sc = Math.max(0.45, Math.min(1.4, 1/Math.sqrt(zK)));

  return (
    <div ref={cRef} style={{ width:"100%", height:"100%", position:"relative", background:"#E8F4F8", overflow:"hidden" }}>
      <svg ref={svgRef} width={dims.w} height={dims.h} style={{ display:"block", touchAction:"none", cursor:"grab" }}>
        <defs>
          <filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2"/></filter>
          <filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="5" floodColor="#E05206" floodOpacity="0.25"/></filter>
        </defs>
        <g className="mg">
          <g className="oc"/><g className="gr"/><g className="la"/>
          {ready && clusters.map((it, i) => {
            if (it.cluster) {
              const sz = Math.min(26, 14+it.items.length*1.3)*sc;
              const ppl = it.items.filter(x=>!x.isAssoc).length;
              const asc = it.items.filter(x=>x.isAssoc).length;
              return (
                <g key={`c${i}`} style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation(); flyTo(it.items[0].lat, it.items[0].lon, Math.min(zK*3,20));}}>
                  <circle cx={it.px} cy={it.py} r={sz*1.5} fill="none" stroke="#E05206" strokeWidth={.6*sc} opacity={.3}>
                    <animate attributeName="r" from={sz*1.1} to={sz*2} dur="2s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" from=".35" to="0" dur="2s" repeatCount="indefinite"/>
                  </circle>
                  <circle cx={it.px} cy={it.py} r={sz} fill="#FFF" stroke="#E05206" strokeWidth={2*sc} filter="url(#gl)"/>
                  <text x={it.px} y={it.py-1*sc} textAnchor="middle" style={{fontSize:11*sc,fontWeight:900,fill:"#E05206",fontFamily:"'DM Sans'"}}>{it.items.length}</text>
                  <text x={it.px} y={it.py+9*sc} textAnchor="middle" style={{fontSize:6*sc,fill:"#8B7355",fontFamily:"'DM Sans'"}}>{FLAGS[it.country]}</text>
                  {zK > .7 && <g><rect x={it.px-28*sc} y={it.py+sz+3*sc} width={56*sc} height={14*sc} rx={7*sc} fill="rgba(0,0,0,.7)"/>
                    <text x={it.px} y={it.py+sz+13*sc} textAnchor="middle" fill="#FFF" style={{fontSize:6.5*sc,fontFamily:"'DM Sans'",fontWeight:600}}>{ppl} 👤 {asc > 0 ? `• ${asc} 🏛️` : ""}</text></g>}
                </g>
              );
            } else {
              const p = it.items[0];
              const sz = (p.isAssoc ? 20 : 16)*sc;
              const isSel = selected?.id === p.id;
              return (
                <g key={`p${p.id}${p.isAssoc?"a":""}`} style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation(); onSelect(p);}}>
                  {p.online && !p.isAssoc && <circle cx={it.px} cy={it.py} r={sz*1.6} fill="none" stroke={p.color} strokeWidth={.5*sc} opacity={.25}>
                    <animate attributeName="r" from={sz*1.1} to={sz*1.8} dur="2.5s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" from=".3" to="0" dur="2.5s" repeatCount="indefinite"/>
                  </circle>}
                  <circle cx={it.px} cy={it.py} r={sz+3*sc} fill="#FFF" filter="url(#sh)" stroke={isSel?"#E05206":"transparent"} strokeWidth={isSel?2.5*sc:0}/>
                  {p.isAssoc ? (
                    <><circle cx={it.px} cy={it.py} r={sz} fill="#1565C0"/><text x={it.px} y={it.py+5*sc} textAnchor="middle" style={{fontSize:12*sc}}>{p.logo}</text></>
                  ) : (
                    <><clipPath id={`clip${p.id}`}><circle cx={it.px} cy={it.py} r={sz}/></clipPath>
                    <image href={PFP(p.pfp,80)} x={it.px-sz} y={it.py-sz} width={sz*2} height={sz*2} clipPath={`url(#clip${p.id})`} preserveAspectRatio="xMidYMid slice"/></>
                  )}
                  {p.online && !p.isAssoc && <circle cx={it.px+sz*.65} cy={it.py-sz*.65} r={3.5*sc} fill="#0DB02B" stroke="#FFF" strokeWidth={1.5*sc}/>}
                  {zK > 2.5 && <g>
                    <rect x={it.px-32*sc} y={it.py+sz+5*sc} width={64*sc} height={p.isAssoc?24*sc:20*sc} rx={6*sc} fill="rgba(0,0,0,.78)" rx={8*sc}/>
                    <text x={it.px} y={it.py+sz+15*sc} textAnchor="middle" fill="#FFF" style={{fontSize:6.5*sc,fontWeight:700,fontFamily:"'DM Sans'"}}>{(p.name||"").substring(0,14)}</text>
                    <text x={it.px} y={it.py+sz+(p.isAssoc?23:20)*sc} textAnchor="middle" fill="rgba(255,255,255,.6)" style={{fontSize:5.5*sc,fontFamily:"'DM Sans'"}}>{p.isAssoc?`👥 ${p.members}`:`📍 ${p.city}`}</text>
                  </g>}
                </g>
              );
            }
          })}
        </g>
      </svg>
      {/* Controls */}
      <div style={{ position:"absolute",bottom:16,right:12,display:"flex",flexDirection:"column",gap:6,zIndex:10 }}>
        {[{l:"+",fn:()=>d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy,2)},
          {l:"−",fn:()=>d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy,.5)},
          {l:"⌖",fn:()=>flyTo(USER_LOC.lat,USER_LOC.lon,8)},
          {l:"🌍",fn:()=>d3.select(svgRef.current).transition().duration(600).call(zoomRef.current.transform,d3.zoomIdentity)}
        ].map((b,i) => <button key={i} onClick={b.fn} style={{ width:40,height:40,borderRadius:14,border:"none",background:"rgba(255,255,255,.93)",backdropFilter:"blur(12px)",boxShadow:"0 2px 10px rgba(0,0,0,.1)",cursor:"pointer",fontSize:b.l.length>1?17:20,color:"#1A0F0A",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontFamily:"'DM Sans'" }}>{b.l}</button>)}
      </div>
    </div>
  );
}

function decodeTopo(t) {
  if (t.type !== "Topology") return {type:"MultiPolygon",coordinates:[]};
  const k = Object.keys(t.objects)[0], o = t.objects[k], a = t.arcs, tr = t.transform;
  const dA = idx => { const rv=idx<0, arc=a[rv?~idx:idx], pts=[]; let x=0,y=0;
    for (const [dx,dy] of arc){x+=dx;y+=dy;pts.push([x*(tr?.scale?.[0]||1)+(tr?.translate?.[0]||0),y*(tr?.scale?.[1]||1)+(tr?.translate?.[1]||0)]);}
    if(rv)pts.reverse();return pts;};
  const dR=ids=>{let r=[];for(const id of ids)r=r.concat(dA(id));return r;};
  const cs=[];const gs=o.type==="GeometryCollection"?o.geometries:[o];
  for(const g of gs){if(g.type==="Polygon")cs.push(g.arcs.map(dR));else if(g.type==="MultiPolygon")for(const p of g.arcs)cs.push(p.map(dR));}
  return {type:"MultiPolygon",coordinates:cs};
}

// ─── MAIN APP ───
export default function NigerConnect() {
  const [page,setPage]=useState("landing");
  const [tab,setTab]=useState("map");
  const [sel,setSel]=useState(null);
  const [mapF,setMapF]=useState("all");
  const [liked,setLiked]=useState(new Set());
  const [friendReqs,setFriendReqs]=useState(FRIEND_REQUESTS);
  const [chatOpen,setChatOpen]=useState(null);
  const [chatMsg,setChatMsg]=useState("");
  const [chatMsgs,setChatMsgs]=useState({});
  const [regStep,setRegStep]=useState(1);
  const [regData,setRegData]=useState({});
  const [svcDetail,setSvcDetail]=useState(null);
  const [photoViewer,setPhotoViewer]=useState(null);
  const me = PEOPLE.find(p=>p.isSelf);

  const login=()=>{setPage("app");setTab("map");};
  const toggleLike=id=>{setLiked(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});};
  const acceptFriend=uid=>{setFriendReqs(f=>f.filter(r=>r.uid!==uid));};
  const sendChat=()=>{
    if(!chatMsg.trim()||!chatOpen)return;
    setChatMsgs(p=>({...p,[chatOpen]:[...(p[chatOpen]||[]),{from:"me",text:chatMsg,time:"Maint."}]}));
    setChatMsg("");
  };

  // ─── LANDING ───
  if(page==="landing") return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0A1628,#1A0F0A 40%,#2D1810)",fontFamily:"'DM Sans'",overflow:"hidden"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,700;0,900;1,700&display=swap" rel="stylesheet"/>
      <div style={{position:"fixed",inset:0,pointerEvents:"none"}}><div style={{position:"absolute",top:"10%",left:"50%",transform:"translateX(-50%)",width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(224,82,6,.12),transparent 60%)"}}/></div>
      <div style={{position:"relative",zIndex:1,maxWidth:420,margin:"0 auto",padding:"0 28px"}}>
        <div style={{paddingTop:64,textAlign:"center",animation:"fs .8s ease"}}>
          <div style={{width:68,height:68,borderRadius:20,background:"linear-gradient(135deg,#E05206,#FF8A50)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 18px",boxShadow:"0 8px 30px rgba(224,82,6,.4)"}}>🇳🇪</div>
          <h1 style={{fontSize:34,fontFamily:"'Playfair Display',serif",fontWeight:900,color:"#FFF",margin:0}}>Niger<span style={{color:"#E05206"}}>Connect</span></h1>
          <p style={{color:"rgba(255,255,255,.4)",fontSize:13,letterSpacing:4,textTransform:"uppercase",margin:"8px 0 0"}}>Le réseau de la diaspora</p>
        </div>
        {/* Avatar bubbles */}
        <div style={{position:"relative",height:140,margin:"36px 0 24px",animation:"fs .8s ease .2s both"}}>
          {[{x:"8%",y:"15%",s:50,p:5},{x:"72%",y:"8%",s:42,p:12},{x:"38%",y:"45%",s:56,p:33},{x:"82%",y:"52%",s:38,p:26},{x:"18%",y:"68%",s:44,p:20},{x:"58%",y:"72%",s:40,p:53}].map((b,i)=>(
            <img key={i} src={PFP(b.p,120)} alt="" style={{position:"absolute",left:b.x,top:b.y,width:b.s,height:b.s,borderRadius:b.s*.35,objectFit:"cover",border:"3px solid rgba(255,255,255,.85)",boxShadow:"0 4px 16px rgba(0,0,0,.3)",animation:`fl ${2+i*.3}s ease-in-out infinite alternate`,animationDelay:`${i*.15}s`}}/>
          ))}
        </div>
        <div style={{background:"rgba(255,255,255,.05)",backdropFilter:"blur(20px)",borderRadius:22,border:"1px solid rgba(255,255,255,.08)",padding:"22px 20px",animation:"fs .8s ease .3s both"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            {[{n:"62K+",l:"Membres",c:"#E05206"},{n:"15",l:"Pays",c:"#0DB02B"},{n:"173",l:"Associations",c:"#FFB74D"}].map((s,i)=>(
              <div key={i} style={{textAlign:"center"}}><div style={{fontSize:22,fontWeight:900,color:s.c}}>{s.n}</div><div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>{s.l}</div></div>
            ))}
          </div>
        </div>
        <div style={{marginTop:28,display:"flex",flexDirection:"column",gap:12,animation:"fs .8s ease .5s both"}}>
          <button onClick={()=>{setPage("register");setRegStep(1);}} style={{width:"100%",padding:18,borderRadius:16,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",color:"#FFF",fontSize:17,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'",boxShadow:"0 6px 28px rgba(224,82,6,.45)"}}>Rejoindre la communauté</button>
          <button onClick={login} style={{width:"100%",padding:18,borderRadius:16,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.04)",color:"#FFF",fontSize:17,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans'"}}>Se connecter</button>
        </div>
        <div style={{marginTop:32,paddingBottom:40,textAlign:"center",animation:"fs .8s ease .7s both"}}>
          <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:6}}>{Object.entries(FLAGS).filter(([k])=>k!=="NE").map(([k,v])=><span key={k} style={{fontSize:18,opacity:.7}}>{v}</span>)}</div>
        </div>
      </div>
      <style>{`@keyframes fs{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes fl{from{transform:translateY(0)}to{transform:translateY(-6px)}}`}</style>
    </div>
  );

  // ─── REGISTER (simplified) ───
  if(page==="register") return (
    <div style={{minHeight:"100vh",background:"#FDFBF7",fontFamily:"'DM Sans'"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Playfair+Display:wght@700;800;900&display=swap" rel="stylesheet"/>
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,borderBottom:"1px solid #F0E6D6"}}>
        <button onClick={()=>regStep>1?setRegStep(regStep-1):setPage("landing")} style={{background:"none",border:"none",fontSize:20,cursor:"pointer"}}>←</button>
        <span style={{fontSize:15,fontWeight:700}}>Inscription</span>
        <span style={{marginLeft:"auto",fontSize:13,color:"#8B7355"}}>{regStep}/3</span>
      </div>
      <div style={{padding:"0 20px",marginTop:12}}><div style={{display:"flex",gap:6}}>{[1,2,3].map(s=><div key={s} style={{flex:1,height:4,borderRadius:2,background:s<=regStep?"linear-gradient(90deg,#E05206,#FF8A50)":"#E8E0D4"}}/>)}</div></div>
      <div style={{padding:"32px 24px",maxWidth:480,margin:"0 auto",animation:"fs .5s"}}>
        {regStep===1&&<div>
          <h2 style={{fontSize:24,fontFamily:"'Playfair Display',serif",fontWeight:800,margin:"0 0 24px"}}>📸 Votre profil</h2>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{width:100,height:100,borderRadius:30,background:"#F5EDE0",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",fontSize:36,cursor:"pointer",border:"3px dashed #E8E0D4"}}>📷</div>
            <div style={{fontSize:13,color:"#8B7355",marginTop:8}}>Ajouter une photo</div>
          </div>
          {[{l:"Prénom",k:"fn"},{l:"Nom",k:"ln"},{l:"Ville",k:"city"},{l:"Bio",k:"bio"}].map(f=><div key={f.k} style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:13,fontWeight:600,marginBottom:5}}>{f.l}</label>
            <input placeholder={f.l} value={regData[f.k]||""} onChange={e=>setRegData({...regData,[f.k]:e.target.value})} style={{width:"100%",padding:"13px 16px",borderRadius:14,border:"1.5px solid #E8E0D4",background:"#FFF",fontSize:15,fontFamily:"'DM Sans'",outline:"none",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor="#E05206"} onBlur={e=>e.target.style.borderColor="#E8E0D4"}/>
          </div>)}
          <button onClick={()=>setRegStep(2)} style={{width:"100%",padding:18,borderRadius:16,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",color:"#FFF",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'",marginTop:8}}>Continuer →</button>
        </div>}
        {regStep===2&&<div>
          <h2 style={{fontSize:24,fontFamily:"'Playfair Display',serif",fontWeight:800,margin:"0 0 8px"}}>🌍 Votre pays</h2>
          <p style={{color:"#8B7355",fontSize:14,marginBottom:20}}>Où vivez-vous actuellement ?</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {Object.entries(FLAGS).filter(([k])=>k!=="NE").map(([c,f])=><button key={c} onClick={()=>setRegData({...regData,country:c})} style={{padding:14,borderRadius:14,border:regData.country===c?"2px solid #E05206":"1.5px solid #E8E0D4",background:regData.country===c?"#FFF5F0":"#FFF",cursor:"pointer",fontFamily:"'DM Sans'",textAlign:"left"}}>
              <span style={{fontSize:20}}>{f}</span><div style={{fontSize:13,fontWeight:600,marginTop:4}}>{CNAMES[c]}</div>
            </button>)}
          </div>
          <button onClick={()=>setRegStep(3)} style={{width:"100%",padding:18,borderRadius:16,border:"none",background:regData.country?"linear-gradient(135deg,#E05206,#FF6D00)":"#E8E0D4",color:regData.country?"#FFF":"#8B7355",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'",marginTop:24}}>Continuer →</button>
        </div>}
        {regStep===3&&<div>
          <h2 style={{fontSize:24,fontFamily:"'Playfair Display',serif",fontWeight:800,margin:"0 0 8px"}}>✅ Vérification</h2>
          <p style={{color:"#8B7355",fontSize:14,marginBottom:20}}>Prouvez votre identité nigérienne</p>
          <div style={{border:"2px dashed #E8E0D4",borderRadius:16,padding:32,textAlign:"center",cursor:"pointer",marginBottom:20}}>
            <div style={{fontSize:40,marginBottom:8}}>📤</div>
            <div style={{fontSize:14,fontWeight:600}}>Passeport, CNI ou carte consulaire</div>
          </div>
          <button onClick={login} style={{width:"100%",padding:18,borderRadius:16,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",color:"#FFF",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'"}}>Valider & Entrer →</button>
        </div>}
      </div>
      <style>{`@keyframes fs{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );

  // ─── PHOTO VIEWER MODAL ───
  if(photoViewer) return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans'"}} onClick={()=>setPhotoViewer(null)}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;800&display=swap" rel="stylesheet"/>
      <button onClick={()=>setPhotoViewer(null)} style={{position:"absolute",top:16,right:16,width:40,height:40,borderRadius:20,border:"none",background:"rgba(255,255,255,.15)",color:"#FFF",fontSize:20,cursor:"pointer",zIndex:1000}}>✕</button>
      <img src={photoViewer} alt="" style={{maxWidth:"95%",maxHeight:"85vh",borderRadius:12,objectFit:"contain"}} onClick={e=>e.stopPropagation()}/>
    </div>
  );

  // ─── CHAT VIEW ───
  if(chatOpen) {
    const peer = PEOPLE.find(p=>p.id===chatOpen);
    const msgs = chatMsgs[chatOpen] || [
      {from:"them",text:"Salut ! Comment ça va ?",time:"14:20"},
      {from:"me",text:"Ça va bien merci ! Et toi ?",time:"14:22"},
      {from:"them",text:CONVOS.find(c=>c.uid===chatOpen)?.lastMsg || "...",time:"14:32"},
    ];
    return (
      <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#FDFBF7",fontFamily:"'DM Sans'"}}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
        {/* Chat header */}
        <div style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:12,borderBottom:"1px solid #F0E6D6",background:"rgba(253,251,247,.95)",backdropFilter:"blur(12px)"}}>
          <button onClick={()=>setChatOpen(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer"}}>←</button>
          {peer && <Avatar person={peer} size={38}/>}
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:15,fontWeight:700}}>{peer?.name}</span><V/></div>
            <div style={{fontSize:11,color:peer?.online?"#0DB02B":"#8B7355"}}>{peer?.online?"En ligne":"Hors ligne"} • {FLAGS[peer?.country]} {peer?.city}</div>
          </div>
          <button style={{width:34,height:34,borderRadius:10,border:"none",background:"#F5EDE0",cursor:"pointer",fontSize:15}}>📞</button>
        </div>
        {/* Messages */}
        <div style={{flex:1,overflowY:"auto",padding:"16px 12px",display:"flex",flexDirection:"column",gap:8}}>
          {msgs.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:m.from==="me"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"75%",padding:"11px 16px",borderRadius:m.from==="me"?"18px 18px 4px 18px":"18px 18px 18px 4px",background:m.from==="me"?"linear-gradient(135deg,#E05206,#FF6D00)":"#FFF",color:m.from==="me"?"#FFF":"#1A0F0A",fontSize:14,boxShadow:m.from==="me"?"none":"0 1px 4px rgba(0,0,0,.06)",border:m.from==="me"?"none":"1px solid #F0E6D6"}}>
                {m.text}
                <div style={{fontSize:10,marginTop:4,opacity:.6,textAlign:"right"}}>{m.time}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Input */}
        <div style={{padding:"12px 12px env(safe-area-inset-bottom,12px)",borderTop:"1px solid #F0E6D6",display:"flex",gap:8,alignItems:"center"}}>
          <button style={{width:38,height:38,borderRadius:12,border:"none",background:"#F5EDE0",cursor:"pointer",fontSize:16,flexShrink:0}}>📷</button>
          <input value={chatMsg} onChange={e=>setChatMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Message..." style={{flex:1,padding:"12px 16px",borderRadius:20,border:"1.5px solid #E8E0D4",background:"#FFF",fontSize:14,fontFamily:"'DM Sans'",outline:"none"}} onFocus={e=>e.target.style.borderColor="#E05206"} onBlur={e=>e.target.style.borderColor="#E8E0D4"}/>
          <button onClick={sendChat} style={{width:38,height:38,borderRadius:12,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",cursor:"pointer",fontSize:16,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{color:"#FFF",fontSize:16}}>➤</span>
          </button>
        </div>
      </div>
    );
  }

  // ─── APP ───
  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#FDFBF7",fontFamily:"'DM Sans'",overflow:"hidden"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Playfair+Display:wght@700;800;900&display=swap" rel="stylesheet"/>

      {/* ══ MAP ══ */}
      {tab==="map"&&<div style={{flex:1,position:"relative",display:"flex",flexDirection:"column"}}>
        <div style={{flex:1,position:"relative"}}>
          <SnapMap people={PEOPLE} associations={ASSOCIATIONS} onSelect={setSel} selected={sel} filter={mapF}/>
          {/* Filters */}
          <div style={{position:"absolute",top:14,left:14,right:60,display:"flex",gap:6,zIndex:10,overflowX:"auto"}}>
            <div style={{flex:1,display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,.95)",borderRadius:14,padding:"9px 14px",boxShadow:"0 2px 16px rgba(0,0,0,.08)",backdropFilter:"blur(12px)"}}>
              <span>🔍</span><input placeholder="Rechercher..." style={{border:"none",outline:"none",background:"transparent",flex:1,fontSize:13,fontFamily:"'DM Sans'"}}/>
            </div>
          </div>
          <div style={{position:"absolute",top:58,left:14,display:"flex",gap:6,zIndex:10}}>
            {[{id:"all",l:"Tous",ic:"🌍"},{id:"people",l:"Personnes",ic:"👤"},{id:"assos",l:"Associations",ic:"🏛️"}].map(f=>(
              <button key={f.id} onClick={()=>setMapF(f.id)} style={{padding:"7px 12px",borderRadius:10,border:"none",background:mapF===f.id?"#1A0F0A":"rgba(255,255,255,.92)",color:mapF===f.id?"#FFF":"#5D4E37",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'",backdropFilter:"blur(8px)",boxShadow:"0 1px 6px rgba(0,0,0,.06)",display:"flex",alignItems:"center",gap:3}}>
                {f.ic} {f.l}
              </button>
            ))}
          </div>
        </div>
        {/* Selected bottom sheet */}
        {sel&&<div style={{position:"absolute",bottom:68,left:0,right:0,background:"#FFF",borderRadius:"22px 22px 0 0",boxShadow:"0 -4px 30px rgba(0,0,0,.1)",padding:"18px 18px 22px",zIndex:20,animation:"su .35s ease",maxHeight:"50%",overflowY:"auto"}}>
          <div style={{width:32,height:4,borderRadius:2,background:"#E8E0D4",margin:"0 auto 14px"}}/>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            {sel.isAssoc?<div style={{width:52,height:52,borderRadius:16,background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>{sel.logo}</div>
            :<Avatar person={sel} size={52}/>}
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:16,fontWeight:800}}>{sel.name}</span><V size={16}/>{sel.online&&!sel.isAssoc&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:6,background:"#E8F5E9",color:"#2E7D32",fontWeight:700,marginLeft:4}}>En ligne</span>}</div>
              <div style={{fontSize:13,color:"#8B7355",marginTop:2}}>{FLAGS[sel.country]} {sel.city}, {CNAMES[sel.country]}</div>
              {sel.bio&&<div style={{fontSize:12,color:"#5D4E37",marginTop:4}}>{sel.bio}</div>}
            </div>
            <button onClick={()=>setSel(null)} style={{width:32,height:32,borderRadius:10,border:"none",background:"#F5EDE0",cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
          </div>
          {!sel.isAssoc&&!sel.isSelf&&<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,margin:"14px 0",background:"#F8F3EB",borderRadius:14,padding:12}}>
              {[{n:sel.friends,l:"Amis"},{n:sel.photos,l:"Photos"},{n:FLAGS[sel.country],l:CNAMES[sel.country]}].map((s,i)=>(
                <div key={i} style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:"#E05206"}}>{s.n}</div><div style={{fontSize:10,color:"#8B7355"}}>{s.l}</div></div>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setChatOpen(sel.id)} style={{flex:1,padding:13,borderRadius:14,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",color:"#FFF",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'"}}>💬 Message</button>
              <button style={{flex:1,padding:13,borderRadius:14,border:"1.5px solid #E05206",background:"#FFF",color:"#E05206",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'"}}>👤 Ajouter</button>
            </div>
            {/* Mini photo gallery */}
            <div style={{display:"flex",gap:6,marginTop:12,overflowX:"auto"}}>
              {[1,2,3,4].map(i=><img key={i} src={PHOTO(`user${sel.id}p${i}`,120,120)} alt="" onClick={()=>setPhotoViewer(PHOTO(`user${sel.id}p${i}`,600,600))} style={{width:70,height:70,borderRadius:12,objectFit:"cover",cursor:"pointer",flexShrink:0}}/>)}
            </div>
          </>}
          {sel.isAssoc&&<div style={{display:"flex",gap:8,marginTop:14}}>
            <button style={{flex:1,padding:13,borderRadius:14,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",color:"#FFF",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'"}}>Rejoindre • {sel.members} 👥</button>
            <button style={{padding:"13px 20px",borderRadius:14,border:"1.5px solid #E8E0D4",background:"#FFF",fontSize:14,cursor:"pointer"}}>📄</button>
          </div>}
        </div>}
      </div>}

      {/* ══ FEED ══ */}
      {tab==="feed"&&<div style={{flex:1,overflowY:"auto",paddingBottom:4}}>
        <div style={{position:"sticky",top:0,zIndex:10,background:"rgba(253,251,247,.92)",backdropFilter:"blur(12px)",padding:"12px 16px",borderBottom:"1px solid #F0E6D6"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>🇳🇪</span><span style={{fontSize:16,fontWeight:800,fontFamily:"'Playfair Display',serif"}}>Niger<span style={{color:"#E05206"}}>Connect</span></span>
            <div style={{marginLeft:"auto",display:"flex",gap:6}}>
              <button style={{width:34,height:34,borderRadius:10,border:"none",background:"#F5EDE0",cursor:"pointer",fontSize:15}}>🔔</button>
              <Avatar person={me} size={34} showOnline={false}/>
            </div>
          </div>
        </div>
        {/* Stories */}
        <div style={{display:"flex",gap:12,padding:"14px 16px",overflowX:"auto"}}>
          <div style={{textAlign:"center",flexShrink:0}}>
            <div style={{width:58,height:58,borderRadius:18,border:"2.5px dashed #E05206",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,background:"#FFF5F0"}}>+</div>
            <div style={{fontSize:10,marginTop:4,fontWeight:600,color:"#8B7355"}}>Ma story</div>
          </div>
          {PEOPLE.filter(p=>!p.isSelf&&p.online).slice(0,8).map(p=>(
            <div key={p.id} style={{textAlign:"center",flexShrink:0}}>
              <div style={{padding:2.5,borderRadius:20,background:"linear-gradient(135deg,#E05206,#FF6D00,#0DB02B)"}}>
                <img src={PFP(p.pfp,120)} alt="" style={{width:55,height:55,borderRadius:17,objectFit:"cover",border:"2.5px solid #FDFBF7"}}/>
              </div>
              <div style={{fontSize:10,marginTop:3,fontWeight:600,color:"#5D4E37",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name.split(" ")[0]}</div>
            </div>
          ))}
        </div>
        {/* Friend requests banner */}
        {friendReqs.length>0&&<div style={{margin:"0 12px 12px",background:"#FFF5F0",borderRadius:16,padding:14,border:"1px solid #FFDCC8"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#E05206",marginBottom:10}}>👋 Demandes d'amitié ({friendReqs.length})</div>
          {friendReqs.map(fr=>{const p=PEOPLE.find(x=>x.id===fr.uid);return p&&(
            <div key={fr.uid} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <Avatar person={p} size={40}/>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{p.name}</div><div style={{fontSize:11,color:"#8B7355"}}>{FLAGS[p.country]} {p.city} • {fr.mutuals} amis en commun</div></div>
              <button onClick={()=>acceptFriend(fr.uid)} style={{padding:"7px 14px",borderRadius:10,border:"none",background:"#E05206",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'"}}>Accepter</button>
              <button onClick={()=>acceptFriend(fr.uid)} style={{padding:"7px 10px",borderRadius:10,border:"1px solid #E8E0D4",background:"#FFF",fontSize:12,cursor:"pointer"}}>✕</button>
            </div>
          );})}
        </div>}
        {/* Posts */}
        <div style={{maxWidth:540,margin:"0 auto",padding:"0 12px"}}>
          {POSTS.map((post,idx)=>{const author=PEOPLE.find(p=>p.id===post.uid);const badge=post.badge?BADGE[post.badge]:null;const isLiked=liked.has(post.id);return(
            <div key={post.id} style={{background:"#FFF",borderRadius:18,border:"1px solid #F0E6D6",marginBottom:12,overflow:"hidden",animation:`fs .4s ease ${idx*.06}s both`}}>
              {/* Author */}
              <div style={{display:"flex",gap:10,padding:"14px 14px 0"}}>
                {author&&<Avatar person={author} size={42}/>}
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:3,flexWrap:"wrap"}}>
                    <span style={{fontSize:14,fontWeight:700}}>{author?.name}</span><V/>
                    {badge&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:badge.bg,color:badge.c,fontWeight:700,marginLeft:3}}>{badge.l}</span>}
                  </div>
                  <div style={{fontSize:12,color:"#8B7355",marginTop:1}}>{FLAGS[author?.country]} {author?.city} • {post.time}</div>
                </div>
                <button style={{background:"none",border:"none",fontSize:16,color:"#C4B8A6",cursor:"pointer"}}>⋯</button>
              </div>
              {/* Content */}
              <p style={{fontSize:14,lineHeight:1.5,color:"#2D1810",margin:"10px 14px 12px"}}>{post.content}</p>
              {/* Photos */}
              {post.photos&&<div style={{display:"flex",gap:2,padding:"0 2px",overflowX:"auto"}}>
                {post.photos.map((ph,i)=><img key={i} src={ph} alt="" onClick={()=>setPhotoViewer(ph.replace(/\/\d+\/\d+$/,"/800/600"))} style={{flex:post.photos.length===1?1:undefined,width:post.photos.length===1?"100%":post.photos.length===2?"50%":"45%",height:post.photos.length===1?220:180,objectFit:"cover",cursor:"pointer",borderRadius:post.photos.length===1?0:4,flexShrink:0}}/>)}
              </div>}
              {/* Actions */}
              <div style={{display:"flex",justifyContent:"space-around",padding:"10px 14px",borderTop:"1px solid #F0E6D6",marginTop:post.photos?0:0}}>
                {[{ic:isLiked?"❤️":"🤍",n:isLiked?post.likes+1:post.likes,fn:()=>toggleLike(post.id)},{ic:"💬",n:post.comments},{ic:"🔄",n:post.shares},{ic:"📤",n:""}].map((b,i)=>(
                  <button key={i} onClick={b.fn} style={{display:"flex",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#8B7355",fontFamily:"'DM Sans'",padding:"4px 8px",borderRadius:8}}>
                    <span style={{fontSize:15}}>{b.ic}</span>{b.n}
                  </button>
                ))}
              </div>
            </div>
          );})}
        </div>
      </div>}

      {/* ══ SERVICES ══ */}
      {tab==="services"&&<div style={{flex:1,overflowY:"auto"}}>
        <div style={{position:"sticky",top:0,zIndex:10,background:"rgba(253,251,247,.92)",backdropFilter:"blur(12px)",padding:"14px 16px",borderBottom:"1px solid #F0E6D6"}}>
          <h2 style={{fontSize:20,fontFamily:"'Playfair Display',serif",fontWeight:800,margin:0}}>🤝 Services & Entraide</h2>
        </div>
        <div style={{maxWidth:540,margin:"0 auto",padding:"12px 12px"}}>
          {/* Quick categories */}
          <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:12}}>
            {["🏠 Logement","✈️ Transport","📋 Admin","🏥 Santé","💼 Emploi","💰 Business"].map((c,i)=><button key={i} style={{flexShrink:0,padding:"8px 14px",borderRadius:12,border:"1px solid #F0E6D6",background:"#FFF",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans'",boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>{c}</button>)}
          </div>
          {SERVICES.map((svc,idx)=>{const author=PEOPLE.find(p=>p.id===svc.uid);return(
            <div key={svc.id} style={{background:"#FFF",borderRadius:16,border:"1px solid #F0E6D6",padding:16,marginBottom:10,animation:`fs .3s ease ${idx*.05}s both`}}>
              <div style={{display:"flex",gap:12}}>
                {author&&<Avatar person={author} size={42}/>}
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#1A0F0A",marginBottom:3}}>{svc.title}</div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:12,color:"#8B7355"}}>{author?.name}</span>
                    <span style={{fontSize:12}}>{FLAGS[author?.country]}</span>
                    <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:svc.urgency==="urgent"?"#FFF3E0":"#F5EDE0",color:svc.urgency==="urgent"?"#E65100":"#8B7355",fontWeight:700}}>{svc.urgency==="urgent"?"🔴 Urgent":"Normal"}</span>
                    <span style={{fontSize:11,color:"#C4B8A6"}}>{svc.time}</span>
                  </div>
                  <p style={{fontSize:13,color:"#5D4E37",margin:"8px 0 0",lineHeight:1.4}}>{svc.desc}</p>
                  {svc.budget&&<div style={{fontSize:12,fontWeight:600,color:"#E05206",marginTop:6}}>💰 {svc.budget}</div>}
                  <div style={{display:"flex",gap:8,marginTop:10}}>
                    <button onClick={()=>author&&setChatOpen(author.id)} style={{padding:"8px 18px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'"}}>💬 Répondre</button>
                    <span style={{fontSize:12,color:"#8B7355",display:"flex",alignItems:"center"}}>{svc.responses} réponses</span>
                  </div>
                </div>
              </div>
            </div>
          );})}
          <button style={{width:"100%",padding:16,borderRadius:14,border:"none",background:"linear-gradient(135deg,#E05206,#FF6D00)",color:"#FFF",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans'",marginTop:8,boxShadow:"0 4px 20px rgba(224,82,6,.3)"}}>+ Publier une demande</button>
        </div>
      </div>}

      {/* ══ MESSAGES ══ */}
      {tab==="messages"&&<div style={{flex:1,overflowY:"auto"}}>
        <div style={{position:"sticky",top:0,zIndex:10,background:"rgba(253,251,247,.92)",backdropFilter:"blur(12px)",padding:"14px 16px",borderBottom:"1px solid #F0E6D6",display:"flex",alignItems:"center"}}>
          <h2 style={{fontSize:20,fontFamily:"'Playfair Display',serif",fontWeight:800,margin:0,flex:1}}>💬 Messages</h2>
          <button style={{width:34,height:34,borderRadius:10,border:"none",background:"#F5EDE0",cursor:"pointer",fontSize:15}}>✏️</button>
        </div>
        <div style={{maxWidth:540,margin:"0 auto",padding:"8px 12px"}}>
          {/* Online now */}
          <div style={{display:"flex",gap:14,padding:"8px 0 16px",overflowX:"auto",borderBottom:"1px solid #F0E6D6",marginBottom:8}}>
            {PEOPLE.filter(p=>p.online&&!p.isSelf).slice(0,7).map(p=>(
              <div key={p.id} onClick={()=>setChatOpen(p.id)} style={{textAlign:"center",flexShrink:0,cursor:"pointer"}}>
                <Avatar person={p} size={48}/>
                <div style={{fontSize:10,marginTop:3,fontWeight:600,color:"#5D4E37",maxWidth:52,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name.split(" ")[0]}</div>
              </div>
            ))}
          </div>
          {/* Conversations */}
          {CONVOS.map(conv=>{const peer=PEOPLE.find(p=>p.id===conv.uid);return peer&&(
            <div key={conv.id} onClick={()=>setChatOpen(conv.uid)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 4px",cursor:"pointer",borderBottom:"1px solid #F8F3EB",transition:"background .15s",borderRadius:12}}
              onMouseEnter={e=>e.currentTarget.style.background="#F8F3EB"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <Avatar person={peer} size={50}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:14,fontWeight:conv.unread?800:600}}>{peer.name}</span><V size={12}/></div>
                  <span style={{fontSize:11,color:conv.unread?"#E05206":"#C4B8A6",fontWeight:conv.unread?700:400}}>{conv.time}</span>
                </div>
                <div style={{fontSize:13,color:conv.unread?"#1A0F0A":"#8B7355",fontWeight:conv.unread?600:400,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{conv.lastMsg}</div>
              </div>
              {conv.unread>0&&<div style={{width:22,height:22,borderRadius:11,background:"#E05206",display:"flex",alignItems:"center",justifyContent:"center",color:"#FFF",fontSize:11,fontWeight:800,flexShrink:0}}>{conv.unread}</div>}
            </div>
          );})}
        </div>
      </div>}

      {/* ══ PROFILE ══ */}
      {tab==="profile"&&<div style={{flex:1,overflowY:"auto"}}>
        <div style={{maxWidth:540,margin:"0 auto",padding:"20px 16px"}}>
          <div style={{background:"linear-gradient(135deg,#1A0F0A,#2D1810)",borderRadius:24,padding:24,color:"#FFF",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18}}>
              <Avatar person={me} size={68} style={{border:"none"}}/>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:20,fontWeight:800,fontFamily:"'Playfair Display',serif"}}>{me.name}</span><V size={18}/></div>
                <div style={{fontSize:13,color:"rgba(255,255,255,.6)",marginTop:3}}>{FLAGS[me.country]} {me.city}, {CNAMES[me.country]}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,.45)",marginTop:2}}>{me.bio}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,background:"rgba(255,255,255,.06)",borderRadius:16,padding:14}}>
              {[{n:me.friends,l:"Amis"},{n:me.photos,l:"Photos"},{n:"3",l:"Assos"}].map((s,i)=>(
                <div key={i} style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:800}}>{s.n}</div><div style={{fontSize:10,color:"rgba(255,255,255,.5)"}}>{s.l}</div></div>
              ))}
            </div>
          </div>
          {/* My photos grid */}
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:15,fontWeight:700}}>📸 Mes photos</span>
              <span style={{fontSize:13,color:"#E05206",fontWeight:600,cursor:"pointer"}}>Voir tout</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}>
              {[1,2,3,4,5,6].map(i=><img key={i} src={PHOTO(`myphoto${i}`,200,200)} alt="" onClick={()=>setPhotoViewer(PHOTO(`myphoto${i}`,600,600))} style={{width:"100%",aspectRatio:"1",borderRadius:10,objectFit:"cover",cursor:"pointer"}}/>)}
            </div>
          </div>
          <div style={{background:"#E8F5E9",borderRadius:14,padding:14,marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:38,height:38,borderRadius:12,background:"#0DB02B",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>✓</div>
            <div><div style={{fontSize:13,fontWeight:700,color:"#2E7D32"}}>Identité vérifiée</div><div style={{fontSize:11,color:"#4CAF50"}}>Diaspora certifiée</div></div>
          </div>
          {[{ic:"✏️",l:"Modifier profil"},{ic:"🏛️",l:"Mes associations"},{ic:"📋",l:"Mes demandes"},{ic:"🔔",l:"Notifications"},{ic:"🔒",l:"Confidentialité"},{ic:"🌍",l:"Langue"}].map((it,i)=>(
            <div key={i} style={{background:"#FFF",borderRadius:14,border:"1px solid #F0E6D6",padding:"13px 16px",marginBottom:7,display:"flex",alignItems:"center",gap:14,cursor:"pointer"}}>
              <div style={{width:38,height:38,borderRadius:12,background:"#FFF5F0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{it.ic}</div>
              <span style={{flex:1,fontSize:14,fontWeight:600}}>{it.l}</span>
              <span style={{color:"#C4B8A6"}}>›</span>
            </div>
          ))}
          <button onClick={()=>setPage("landing")} style={{width:"100%",padding:14,borderRadius:14,border:"1px solid #E57373",background:"#FFF",color:"#D32F2F",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans'",marginTop:12}}>Se déconnecter</button>
        </div>
      </div>}

      {/* ══ BOTTOM NAV ══ */}
      <nav style={{background:"rgba(255,255,255,.97)",backdropFilter:"blur(16px)",borderTop:"1px solid #F0E6D6",padding:"6px 0 env(safe-area-inset-bottom,8px)",zIndex:100,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-around",maxWidth:500,margin:"0 auto"}}>
          {[{id:"map",ic:"🌍",l:"Carte"},{id:"feed",ic:"📰",l:"Fil"},{id:"services",ic:"🤝",l:"Services"},{id:"messages",ic:"💬",l:"Messages",badge:CONVOS.reduce((s,c)=>s+c.unread,0)},{id:"profile",ic:"👤",l:"Profil"}].map(t=>(
            <button key={t.id} onClick={()=>{setTab(t.id);setSel(null);}} style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:1,background:"none",border:"none",cursor:"pointer",padding:"4px 10px",fontFamily:"'DM Sans'"}}>
              <span style={{fontSize:22,filter:tab===t.id?"none":"grayscale(.6) opacity(.45)",transition:"filter .2s"}}>{t.ic}</span>
              <span style={{fontSize:9,fontWeight:tab===t.id?700:500,color:tab===t.id?"#E05206":"#8B7355"}}>{t.l}</span>
              {tab===t.id&&<div style={{width:16,height:2.5,borderRadius:2,background:"#E05206",marginTop:1}}/>}
              {t.badge>0&&<div style={{position:"absolute",top:0,right:4,minWidth:16,height:16,borderRadius:8,background:"#E05206",display:"flex",alignItems:"center",justifyContent:"center",color:"#FFF",fontSize:9,fontWeight:800,padding:"0 4px"}}>{t.badge}</div>}
            </button>
          ))}
        </div>
      </nav>

      <style>{`@keyframes fs{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@keyframes su{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
