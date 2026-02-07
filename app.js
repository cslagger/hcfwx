window.openPrintView = async function() {
    if(!window.FULL_DATASET.length) return alert("Please fetch data first.");
    
    // Fetch HF Frequencies
    let hfData = {};
    try {
        const resp = await fetch(`hf_freqs.json?t=${Date.now()}`);
        if(resp.ok) hfData = await resp.json();
    } catch(e) { console.log("No HF Data found"); }

    const now = new Date();
    const timeStr = `${String(now.getUTCHours()).padStart(2,'0')}${String(now.getUTCMinutes()).padStart(2,'0')}Z`;
    const dateStr = `${String(now.getUTCMonth()+1).padStart(2,'0')}/${String(now.getUTCDate()).padStart(2,'0')}/${String(now.getUTCFullYear()).slice(-2)}`;
    const fcstHour = document.getElementById('timeLabel').innerText;
    
    const sector1 = ["ZIGIE", "APACK", "BITTA", "CLUTS", "DENNS", "EBBER", "FITES", "SCOON"];
    const sector2 = ["DOVRR", "CARRP", "CHOKO", "KATHS", "HOOPA", "SYVAD", "CANON", "DANNO", "THOMA"];
    const printLevels = LEVELS.slice(7); 

    // Helper to generate HF HTML list
    function getHfHtml(keys) {
        let html = '<div class="hf-box">';
        let hasData = false;
        keys.forEach(key => {
            if(hfData[key] && hfData[key].length > 0) {
                hasData = true;
                hfData[key].forEach(line => {
                    // Simple styling to separate header from freqs
                    const parts = line.split('|');
                    const head = parts[0];
                    const tail = parts.slice(1).join(' | ');
                    html += `<div style="margin-bottom:2px;"><strong>${head}</strong> ${tail}</div>`;
                });
            }
        });
        html += '</div>';
        return hasData ? html : ''; 
    }

    function renderGroup(title, fixList, hfKeys) {
        let html = `<div class="page-section"><h1>${title} &nbsp; | &nbsp; Forecast: +${fcstHour}h &nbsp; | &nbsp; Retrieved: ${timeStr} ${dateStr}</h1>`;
        
        // Add HF Data if present
        const hfContent = getHfHtml(hfKeys);
        if (hfContent) {
            html += `<div style="margin-bottom:10px; border:1px solid #444; padding:8px; font-size:11px; background:#f9f9f9;">
                <div style="font-weight:bold; border-bottom:1px solid #ccc; margin-bottom:4px;">PACIFIC HF ASSIGNMENTS</div>
                ${hfContent}
            </div>`;
        }

        html += `<div class="grid-container">`;
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

    let htmlContent = `<html><head><title>HCF Oceanic Winds Aloft Forecast - ${timeStr}</title><style>
        body { font-family: sans-serif; padding: 20px; font-size: 14px; }
        h1 { font-size: 18px; border-bottom: 2px solid #444; padding-bottom: 5px; margin-bottom: 15px; }
        .grid-container { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
        .fix-block { border: 1px solid #000; break-inside: avoid; }
        .fix-header { background: #333; color: white; font-weight: bold; text-align: center; padding: 5px; font-size: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        td { border-bottom: 1px solid #ccc; padding: 3px 6px; font-family: monospace; font-weight: bold; }
        td:last-child { text-align: right; }
        tr:nth-child(even) { background: #eee; }
        .hf-box { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-family: monospace; }
        @media print { .page-break { page-break-after: always; display: block; height: 1px; } }
    </style></head><body>`;

    // Page 1: Sector 7/8
    htmlContent += renderGroup("HCF Oceanic Winds Aloft Forecast - Sector 7/8", sector1, ["hwn_cal_major", "hwn_cal_other", "hwn_pacnw", "hwn_south", "hwn_alaska", "notes"]);
    
    htmlContent += `<div class="page-break"></div>`;
    
    // Page 2: Sector 2/6
    htmlContent += renderGroup("HCF Oceanic Winds Aloft Forecast - Sector 2/6", sector2, ["hwn_west", "hwn_south", "notes"]);
    
    htmlContent += `<script>window.print();<\/script></body></html>`;
    const win = window.open("", "_blank");
    win.document.write(htmlContent);
    win.document.close();
};
