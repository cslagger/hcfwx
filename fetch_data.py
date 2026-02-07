import requests
import gzip
import xml.etree.ElementTree as ET
import json
import math
import io
from datetime import datetime, timezone

# --- PIREP CONFIGURATION ---
PIREP_SOURCE = "https://aviationweather.gov/data/cache/aircraftreports.cache.xml.gz"
PHNL_LAT, PHNL_LON = 21.318, -157.922
MAX_DIST_NM = 250
MAX_AGE_MIN = 90

# --- HF CONFIGURATION (NEW API ENDPOINT) ---
# ARINC uses this hidden API to populate the table
HF_API_SOURCE = "https://radio.arinc.net/xml/pacific.json"

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def fetch_pireps():
    print("Fetching PIREPs...")
    try:
        response = requests.get(PIREP_SOURCE, timeout=60)
        response.raise_for_status()
        
        with gzip.GzipFile(fileobj=io.BytesIO(response.content)) as f:
            xml_content = f.read()
            
        root = ET.fromstring(xml_content)
        features = []
        now_utc = datetime.now(timezone.utc)
        
        for report in root.findall(".//AircraftReport"):
            try:
                lat = float(report.find("latitude").text)
                lon = float(report.find("longitude").text)
                obs_time_str = report.find("observation_time").text
                raw_text = report.find("raw_text").text
                report_type = report.find("report_type").text
                alt_elem = report.find("altitude_ft_msl")
                alt = int(alt_elem.text) if alt_elem is not None else 0

                obs_time = datetime.fromisoformat(obs_time_str.replace("Z", "+00:00"))
                age_min = (now_utc - obs_time).total_seconds() / 60
                
                if age_min > MAX_AGE_MIN: continue
                if haversine_distance(PHNL_LAT, PHNL_LON, lat, lon) > MAX_DIST_NM: continue

                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "type": report_type,
                        "rawOb": raw_text,
                        "alt": alt,
                        "age": round(age_min, 1)
                    }
                })
            except: continue

        output = {
            "generated_at": now_utc.strftime("%H%MZ %m/%d/%y"),
            "type": "FeatureCollection",
            "features": features
        }
        
        with open("pireps.json", "w") as f:
            json.dump(output, f)
        print(f"✅ Saved {len(features)} PIREPs.")
        
    except Exception as e:
        print(f"❌ PIREP Error: {e}")

def fetch_hf():
    print("Fetching HF Frequencies (Direct API)...")
    try:
        # 1. Fetch JSON from ARINC Backend
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://radio.arinc.net/pacific/'
        }
        response = requests.get(HF_API_SOURCE, headers=headers, timeout=30)
        response.raise_for_status()
        raw_data = response.json()
        
        # 2. Structure Data for our App
        # The JSON usually returns a list of objects like: {"route": "HAWAII-CALIFORNIA...", "primary": "...", "secondary": "..."}
        
        data = {
            "hwn_cal_major": [], "hwn_cal_other": [], "hwn_pacnw": [],
            "hwn_south": [], "hwn_alaska": [], "hwn_west": [], "notes": []
        }
        
        # Helper to format frequency strings
        def fmt_freq(row):
            freqs = []
            if row.get('primary'): freqs.append(row['primary'])
            if row.get('secondary'): freqs.append(row['secondary'])
            if row.get('family'): freqs.append(f"({row['family']})")
            return " | ".join(freqs)

        for row in raw_data:
            route = row.get('route', '').upper()
            freq_str = fmt_freq(row)
            line = f"{route}: {freq_str}"

            # Filtering Logic
            if "CALIFORNIA" in route:
                if "AAL" in route or "DAL" in route or "ACA" in route or "WJA" in route or "MILITARY" in route:
                    data["hwn_cal_major"].append(line)
                else:
                    data["hwn_cal_other"].append(line)
            
            elif "PAC NW" in route or "PACIFIC NW" in route:
                data["hwn_pacnw"].append(line)
            
            elif "SOUTHBOUND" in route:
                data["hwn_south"].append(line)
            
            elif "ALASKA" in route:
                data["hwn_alaska"].append(line)
                
            elif "WESTBOUND" in route:
                data["hwn_west"].append(line)
                
            # Notes are sometimes separate text fields or just generic rows
            elif "NOTE" in route:
                data["notes"].append(line)

        with open("hf_freqs.json", "w") as f:
            json.dump(data, f)
        print(f"✅ Saved HF Frequencies from API.")

    except Exception as e:
        print(f"❌ HF Error: {e}")

if __name__ == "__main__":
    fetch_pireps()
    fetch_hf()
