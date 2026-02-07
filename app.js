// ================= CONFIGURATION =================
const MAP_IMAGE = 'map.png';
const MAP_PGW   = 'map.pgw';
const MAP_PROJ  = 'EPSG:3857'; 
const CSV_FILE  = 'Designated_Point.csv';
const TARGET_FIXES = ["ZIGIE", "APACK", "BITTA", "CLUTS", "DENNS", "EBBER", "FITES", "SCOON", "DOVRR", "CARRP", "CHOKO", "KATHS", "HOOPA", "SYVAD", "CANON", "DANNO", "THOMA"];

const LEVELS = [
    { id: '10m', label: 'Surface' }, { id: '1000hPa', label: '300 ft' }, { id: '950hPa', label: '2,000 ft' },
    { id: '925hPa', label: '2,500 ft' }, { id: '900hPa', label: '3,000 ft' }, { id: '850hPa', label: '5,000 ft' },
    { id: '800hPa', label: '6,000 ft' }, { id: '700hPa', label: '10,000 ft' }, { id: '600hPa', label: '14,000 ft' },
    { id: '500hPa', label: 'FL 180' }, { id: '400hPa', label: 'FL 240' }, { id: '300hPa', label: 'FL 300' },
    { id: '250hPa', label: 'FL 340' }, { id: '200hPa', label: 'FL 390' }, { id: '150hPa', label: 'FL 450' },
    { id: '100hPa', label: 'FL 530' }
];

// Initialize Altitude Dropdown
const sel = document.getElementById('altitudeSelect');
if (sel) {
    LEVELS.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id; opt.innerText = l.label;
        if(l.id === '250hPa') opt.selected = true;
        sel.appendChild(opt);
    });
}

// ================= GLOBALS =================
window.WAYPOINTS = [];
window.FULL_DATASET = [];
window.CURRENT_HOUR = 0;
const MAG_VAR = 9;

// --- MAP SETUP ---
if(typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:3857","+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext  +no_defs");
}

const map = L.map('map', { center: [21.0, -157.0], zoom: 6, crs: L.CRS.EPSG3857 });
let windLayer = L.layerGroup().addTo(map);
let pirepLayer = L.layerGroup(); 

// --- INITIALIZATION ---
(async function initMap() {
    try {
        const resp = await fetch(MAP_PGW);
        if(!resp.ok) throw new Error("PGW Not Found");
        const txt = await resp.text();
        const img = new Image();
        img.onload = () => { applyGeo(txt, img.width, img.height); document.getElementById('statusMap').innerText = "OK"; document.getElementById('statusMap').style.color = "#0f0"; };
        img.src = MAP_IMAGE;
    } catch(e) { /* Silent fail for map img */ }
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
    } catch (e) { document.getElementById('reportBox').innerText = "Error loading CSV: " + e.message; }
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
                wpData.levels[l.id] = { speeds: item.hourly[sKey], dirs: item.hourly[dKey] };
            });
            wpData.times = item.hourly.time;
            return wpData;
