// ================= CONFIGURATION =================
const MAP_IMAGE = 'map.png';
const MAP_PGW   = 'map.pgw';
const MAP_PROJ  = 'EPSG:3857'; 
const CSV_FILE  = 'Designated_Point.csv';
const TARGET_FIXES = ["ZIGIE", "APACK", "BITTA", "CLUTS", "DENNS", "EBBER", "FITES", "SCOON", "DOVRR", "CARRP", "CHOKO", "KATHS", "HOOPA", "SYVAD", "CANON", "DANNO", "THOMA"];

const LEVELS = [
    { id: '10m', label: 'Surface' },
    { id: '1000hPa', label: '300 ft' },
    { id: '950hPa', label: '2,000 ft' },
    { id: '925hPa', label: '2,500 ft' },
    { id: '900hPa', label: '3,000 ft' },
    { id: '850hPa', label: '5,000 ft' },
    { id: '800hPa', label: '6,000 ft' },
    { id: '700hPa', label: '10,000 ft' },
    { id: '600hPa', label: '14,000 ft' },
    { id: '500hPa', label: 'FL 180' },
    { id: '400hPa', label: 'FL 240' },
    { id: '300hPa', label: 'FL 300' },
    { id: '250hPa', label: 'FL 340' },
    { id: '200hPa', label: 'FL 390' },
    { id: '150hPa', label: 'FL 450' },
    { id: '100hPa', label: 'FL 530' }
];

const sel = document.getElementById('altitudeSelect');
LEVELS.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id; opt.innerText = l.label;
    if(l.id === '250hPa') opt.selected = true;
    sel.appendChild(opt);
});

window.WAYPOINTS = [];
window.FULL_DATASET = [];
window.CURRENT_HOUR = 0;
const MAG_VAR = 9;

if(typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:3857","+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext  +no_defs");
}

const map = L.map('map', { center: [21.0, -157.0], zoom: 6, crs: L.CRS.EPSG3857 });

let windLayer = L.layerGroup().addTo(map);
let pirepLayer = L.layerGroup(); 

(async function initMap() {
    try {
        const resp = await fetch(MAP_PGW);
        if(!resp.ok) throw new Error("PGW Not Found");
        const txt = await resp.text();
        const img = new Image();
        img.onload = () => { applyGeo(txt, img.width, img.height); document.getElementById('statusMap').innerText = "OK"; document.getElementById('statusMap').style.color = "#0f0"; };
        img.src = MAP_IMAGE;
    } catch(e) { /* Err */ }
})();

function applyGeo(pgw, w, h) {
    const l = pgw.trim().split(/\s+/).map(Number);
    const dest = 'EPSG:4326'; 
    const nw = proj4(MAP_PROJ, dest, [l[4], l[5]]); 
    const se = proj4(MAP_PROJ, dest, [l[4] + (w * l[0]), l[5] + (h * l[3])]); 
    const bounds = [[nw[1], nw[0]], [se[1], se[0]]];
    L.imageOverlay(MAP_IMAGE, bounds, { opacity: 1.0 }).addTo(map);
    map.fitBounds(bounds);
}

(async function loadData() {
    try {
        const resp = await fetch(CSV_FILE);
        if(!resp.ok) throw new Error("CSV Not Found");
        const text = await resp.text();
        parseCSV(text);
        document.getElementById('statusCSV').innerText = "OK";
        document.getElementById('statusCSV').style.color = "#0f0";
    } catch (e) { document.getElementById('reportBox').innerText = "Error loading CSV"; }
})();

function parseCSV(text) {
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
    const idxName = headers.indexOf('IDENT');
    const idxLat = headers.indexOf('LATITUDE');
    const idxLon = headers.indexOf('LONGITUDE');
    const targets = new Set(TARGET_FIXES);

    for(let i=1; i<lines.length; i++) {
        const cols = lines[i].split(',');
        if(cols.length > idxLon && targets.has(cols[idxName].trim())) {
            window.WAYPOINTS.push({ 
                name: cols[idxName].trim(), 
                lat: parseDMS(cols[idxLat]), 
                lon: parseDMS(cols[idxLon]) 
            });
        }
    }
    window.WAYPOINTS.sort((a,b) => TARGET_FIXES.indexOf(a.name) - TARGET_FIXES.indexOf(b.name));
    if(window.WAYPOINTS.length) window.runBulkReport();
}

function parseDMS(dmsStr) {
    if (!dmsStr) return NaN;
    const parts = dmsStr.trim().split(/[- ]+/);
    if(parts.length < 3) return parseFloat(dmsStr);
    let val = parseFloat(parts[0]) + (parseFloat(parts[1])/60) + (parseFloat(parts[2])/3600);
    if(dmsStr.includes('S') || dmsStr.includes('W')) val *= -1;
    return val;
}

window.runBulkReport = async function() {
    if(!window.WAYPOINTS.length) return;
    document.getElementById('reportBox').innerHTML = "<div style='color:orange'>Fetching ALL altitude data...</div>";
    
    const lats = window.WAYPOINTS.map(w => w.lat).join(',');
    const lons = window.WAYPOINTS.map(w => w.lon).join(',');
    
    let vars = [];
    LEVELS.forEach(l => {
        const s = (l.id === '10m') ? 'windspeed_10m' : `windspeed_${l.id}`;
        const d = (l.id === '10m') ? 'winddirection_10m' : `winddirection_${l.id}`;
        vars.push(s, d);
    });

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${vars.join(',')}&forecast_days=1&timezone=GMT`;
    
    try {
        const resp = await fetch(url);
        const json = await resp.json();
        const res = Array.isArray(json) ? json : [json];
        
        window.FULL_DATASET = res.map((item, i) => {
            const wpData = { wp: window.WAYPOINTS[i], levels: {} };
            LEVELS.forEach(l => {
                const sKey = (l.id === '10m') ? 'windspeed_10m' : `windspeed_${l.id}`;
                const dKey = (l.id === '10m') ? 'winddirection_10m' : `winddirection_${l.id}`;
                wpData.levels[l.id] = {
                    speeds: item.hourly[sKey],
                    dirs: item.hourly[dKey]
                };
            });
            wpData.times = item.hourly.time;
            return wpData;
        });
        renderReport();
        window.updateMapLayer();
    } catch(e) { document.getElementById('reportBox').innerText = "API Error: " + e; }
};

function getPirepConditions(raw) {
    if (!raw) return "Flight Info";
    const r = raw.toUpperCase();
    let c = [];
    if (r.includes("LLWS")) c.push("Wind Shear");
    if (r.includes("TS") || r.includes("TSRA")) c.push("Thunderstorm");
    if (r.includes("VA")) c.push("Volcanic Ash");
    if (/TB|TURB/.test(r)) c.push("Turbulence");
    if (/IC|ICG/.test(r)) c.push("Icing");
    if ((/OVC|BKN|SCT|FEW|SK/.test(r)) && c.length === 0) c.push("Sky Condition");
    if (c.length === 0) return "Routine Report";
    return c.join(", ");
}

function getPirepTimeData(raw) {
    const match = raw && raw.match(/(?:^|[\s/])TM\s+(\d{4})/);
    if (!match) return { displayTime: "N/A", age: null };
    
    const timeStr = match[1];
    const hours = parseInt(timeStr.slice(0, 2), 10);
    const mins = parseInt(timeStr.slice(2), 10);
    
    const now = new Date();
    const pirepDate = new Date();
    pirepDate.setUTCHours(hours, mins, 0, 0);
    
    if (pirepDate > now && (pirepDate - now) < 43200000) { } 
    else if (pirepDate > now) { pirepDate.setUTCDate(pirepDate.getUTCDate() - 1); }
    
    const diffMs = now - pirepDate;
    const ageMin = Math.floor(diffMs / 60000);
    
    return { displayTime: `${timeStr}Z`, age: ageMin >= 0 ? ageMin : 0 };
}

window.togglePIREPs = async function() {
    const btn = document.getElementById('btnPirep');
    
    if (map.hasLayer(pirepLayer)) {
        map.removeLayer(pirepLayer);
        btn.style.filter = "brightness(1)";
        btn.innerText = "✈️ Show PIREPs";
    } else {
        btn.innerText = "⏳ Loading...";
        const targetUrl = `pireps.json?t=${Date.now()}`;
        
        try {
            const resp = await fetch(targetUrl);
            if (!resp.ok) throw new Error("Missing pireps.json");
            const data = await resp.json();
            
            if (!data.features || data.features.length === 0) {
                alert("No PIREPs found.");
                btn.innerText = "✈️ Show PIREPs";
                return;
            }
            
            pirepLayer.clearLayers();

            L.circle([21.318, -157.922], {
                color: 'rgba(255, 255, 255, 0.3)',
                fillColor: 'transparent', weight: 1, dashArray: '5, 5', radius: 463000 
            }).addTo(pirepLayer);

            L.geoJSON(data, {
                pointToLayer: function (feature, latlng) {
                    const p = feature.properties;
                    const isUrgent = p.type === 'UUA';
                    const raw = (p.rawOb || "").toUpperCase();
                    const needsSolicit = /(TB|TURB).*(MDT|SEV|EXTRM)|(IC|ICG).*(LGT|MOD|SEV)|TS|LLWS|VA/.test(raw) || isUrgent;
                    const symbol = needsSolicit ? '!' : '';

                    const timeData = getPirepTimeData(p.rawOb);
                    const age = timeData.age !== null ? timeData.age : p.age; 
                    
                    let colorClass = 'pirep-green'; 
                    
                    if (isUrgent) { 
                        colorClass = 'pirep-urgent'; 
                    } else if (age > 90) {
                        colorClass = 'pirep-grey';   // NEW: Grey for > 90m
                    } else if (age > 60) {
                        colorClass = 'pirep-orange'; // Orange for 60-90m
                    }
                    // Default is green (<60m)

                    return L.marker(latlng, {
                        icon: L.divIcon({
                            className: `pirep-base ${colorClass}`,
                            html: symbol, iconSize: [14, 14], iconAnchor: [7, 7]
                        })
                    });
                },
                onEachFeature: function (feature, layer) {
                    const p = feature.properties;
                    const conditionText = getPirepConditions(p.rawOb);
                    const timeData = getPirepTimeData(p.rawOb);
                    const age = timeData.age !== null ? timeData.age : p.age;
                    
                    let ageClass = 'pirep-popup-age-fresh';
                    if (age > 90) {
                        ageClass = 'pirep-popup-age-expired'; // NEW: Red Text
                    } else if (age > 60) {
                        ageClass = 'pirep-popup-age-old';
                    }
                    
                    const headerClass = p.type === 'UUA' ? 'header-urgent' : 'header-routine';

                    const popupContent = `
                        <div style="font-family:monospace; font-size:12px; color:black; min-width: 220px;">
                            <strong class="${headerClass}">PIREP: ${conditionText}</strong><br>
                            <span style="color:#555;">Alt: ${p.alt > 0 ? p.alt + 'ft' : 'Unknown'}</span><br>
                            <div style="margin-top:2px;">
                                <span style="color:black; font-weight:bold;">${timeData.displayTime}</span>
                                <span style="color:#ccc;"> | </span>
                                <span class="${ageClass}">Age: ${age}m</span>
                            </div>
                            <hr style="margin:4px 0; border:0; border-top:1px solid #ccc;">
                            ${p.rawOb || "No raw text"}
                        </div>
                    `;
                    layer.bindPopup(popupContent);
                }
            }).addTo(pirepLayer);
            
            map.addLayer(pirepLayer);
            btn.style.filter = "brightness(1.3)"; 
            btn.innerText = "Hide PIREPs";
            
        } catch(e) {
            console.error(e);
            alert("Could not load PIREPs. Wait for GitHub Action.");
            btn.innerText = "✈️ Show PIREPs";
        }
    }
};

function renderReport() {
    const reportBox = document.getElementById('reportBox');
    reportBox.innerHTML = "";
    const now = new Date();
    const timeStr = `${String(now.getUTCHours()).padStart(2,'0')}${String(now.getUTCMinutes()).padStart(2,'0')}Z`;
    reportBox.innerHTML += `<div style="color:#0f0; margin-bottom:10px; font-weight:bold;">RETRIEVED: ${timeStr}</div>`;
    const currentMapAlt = document.getElementById('altitudeSelect').value;

    window.FULL_DATASET.forEach(data => {
        let html = `<table class="fix-table">
            <thead><tr><th colspan="2">${data.wp.name}</th></tr></thead><tbody>`;
        LEVELS.forEach(l => {
            const idx = Math.min(window.CURRENT_HOUR, data.levels[l.id].speeds.length-1);
            const k = Math.round(data.levels[l.id].speeds[idx] * 0.539957);
            const dir = data.levels[l.id].dirs[idx];
            const hlClass = (l.id === currentMapAlt) ? 'class="highlight-row"' : '';
            html += `<tr ${hlClass}><td>${l.label}</td><td style="text-align:right">${formatAv(dir, k)}</td></tr>`;
        });
        html += `</tbody></table>`;
        reportBox.innerHTML += html;
    });
}

window.updateMapLayer = function() {
    const altID = document.getElementById('altitudeSelect').value;
    renderReport(); 
    windLayer.clearLayers(); 
    window.FULL_DATASET.forEach(d => {
        if (!d.levels[altID]) return;
        const idx = Math.min(window.CURRENT_HOUR, d.levels[altID].speeds.length-1);
        const k = Math.round(d.levels[altID].speeds[idx] * 0.539957);
        const dir = d.levels[altID].dirs[idx];
        const svg = getBarbSVG(k, '#00bfff');
        const rotation = dir;
        const windStr = formatAv(dir, k);
        const html = `<div style="position:relative; width:45px; height:45px;"><div class="fix-label">${d.wp.name}</div><div style="transform: rotate(${rotation}deg); transform-origin: 22.5px 45px; width:45px; height:45px;">${svg}</div><div class="vector-label">${windStr}</div></div>`;
        L.marker([d.wp.lat, d.wp.lon], { zIndexOffset: 1000, icon: L.divIcon({ className: 'wind-vector-icon', html: html, iconSize: [45, 45], iconAnchor: [22.5, 45] }) }).addTo(windLayer);
    });
};

window.updateTime = (v) => { window.CURRENT_HOUR = parseInt(v); document.getElementById('timeLabel').innerText = v; window.updateMapLayer(); };
function formatAv(d,k) { let m = Math.round(d-MAG_VAR); if(m<0)m+=360; if(m>=360)m-=360; return `${String(m).padStart(3,'0')}°${String(k).padStart(3,'0')}KT`; }

function getBarbSVG(k,c) {
    let r=Math.round(k/5)*5, p="M 22.5 45 L 22.5 5 ", y=5;
    if(r>20)c='#00ff00'; if(r>40)c='#ffff00'; if(r>65)c='#ff4444';
    while(r>=50){p+=`M 22.5 ${y} L 38 ${y+5} L 22.5 ${y+10} `;y+=12;r-=50;}
    while(r>=10){p+=`M 22.5 ${y} L 38 ${y-5} `;y+=5;r-=10;}
    if(r>=5)p+=`M 22.5 ${y} L 30 ${y-2.5} `;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 45 45" style="overflow:visible;"><path d="${p}" stroke="black" stroke-width="4" fill="black" stroke-linecap="round" stroke-linejoin="round"/><path d="${p}" stroke="${c}" stroke-width="2" fill="${c}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22.5" cy="45" r="3" fill="black"/><circle cx="22.5" cy="45" r="1.5" fill="${c}"/></svg>`;
}

function formatCode(dir, k) {
    let mDir = Math.round(dir - MAG_VAR); if (mDir < 0) mDir += 360; if (mDir >= 360) mDir -= 360;
    if (k < 5) return "9900"; 
    let d = Math.round(mDir / 10) * 10; if (d === 0) d = 360; 
    let dCode = Math.floor(d / 10);
    if (k >= 100 && k < 200) { dCode += 50; k -= 100; } else if (k >= 200) { dCode += 50; k = 99; }
    return `${String(dCode).padStart(2, '0')}${String(k).padStart(2, '0')}`;
}

window.openPrintView = function() {
    if(!window.FULL_DATASET.length) return alert("Please fetch data first.");
    const now = new Date();
    const timeStr = `${String(now.getUTCHours()).padStart(2,'0')}${String(now.getUTCMinutes()).padStart(2,'0')}Z`;
    const dateStr = `${String(now.getUTCMonth()+1).padStart(2,'0')}/${String(now.getUTCDate()).padStart(2,'0')}/${String(now.getUTCFullYear()).slice(-2)}`;
    const fcstHour = document.getElementById('timeLabel').innerText;
    const sector1 = ["ZIGIE", "APACK", "BITTA", "CLUTS", "DENNS", "EBBER", "FITES", "SCOON"];
    const sector2 = ["DOVRR", "CARRP", "CHOKO", "KATHS", "HOOPA", "SYVAD", "CANON", "DANNO", "THOMA"];
    const printLevels = LEVELS.slice(7); 

    function renderGroup(title, fixList) {
        let html = `<div class="page-section"><h1>${title} &nbsp; | &nbsp; Forecast: +${fcstHour}h &nbsp; | &nbsp; Retrieved: ${timeStr} ${dateStr}</h1><div class="grid-container">`;
        const sectorData = fixList.map(name => window.FULL_DATASET.find(d => d.wp.name === name)).filter(x => x);
        sectorData.forEach(data => {
            html += `<div class="fix-block"><div class="fix-header">${data.wp.name}</div><table>`;
            printLevels.forEach(l => {
                const idx = Math.min(window.CURRENT_HOUR, data.levels[l.id].speeds.length-1);
                const k = Math.round(data.levels[l.id].speeds[idx] * 0.539957);
                const dir = data.levels[l.id].dirs[idx];
                html += `<tr><td>${l.label}</td><td>${formatCode(dir, k)}</td></tr>`;
            });
            html += `</table></div>`;
        });
        html += `</div></div>`;
        return html;
    }

    let htmlContent = `<html><head><title>HCF Oceanic Winds Aloft Forecast - ${timeStr}</title><style>body { font-family: sans-serif; padding: 20px; font-size: 14px; } h1 { font-size: 18px; border-bottom: 2px solid #444; padding-bottom: 5px; margin-bottom: 15px; } .grid-container { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; } .fix-block { border: 1px solid #000; break-inside: avoid; } .fix-header { background: #333; color: white; font-weight: bold; text-align: center; padding: 5px; font-size: 16px; } table { width: 100%; border-collapse: collapse; font-size: 14px; } td { border-bottom: 1px solid #ccc; padding: 3px 6px; font-family: monospace; font-weight: bold; } td:last-child { text-align: right; } tr:nth-child(even) { background: #eee; } @media print { .page-break { page-break-after: always; display: block; height: 1px; } }</style></head><body>`;
    htmlContent += renderGroup("HCF Oceanic Winds Aloft Forecast - Sector 7/8", sector1);
    htmlContent += `<div class="page-break"></div>`;
    htmlContent += renderGroup("HCF Oceanic Winds Aloft Forecast - Sector 2/6", sector2);
    htmlContent += `<script>window.print();<\/script></body></html>`;
    const win = window.open("", "_blank");
    win.document.write(htmlContent);
    win.document.close();
};
