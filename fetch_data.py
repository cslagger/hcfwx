import requests
import gzip
import xml.etree.ElementTree as ET
import json
import math
import io
import re
from datetime import datetime, timezone
from bs4 import BeautifulSoup

# --- CONFIGURATION ---
PIREP_SOURCE = "https://aviationweather.gov/data/cache/aircraftreports.cache.xml.gz"
HF_PAGE_URL = "https://radio.arinc.net/pacific/"
PHNL_LAT, PHNL_LON = 21.318, -157.922
MAX_DIST_NM = 250
MAX_AGE_MIN = 90

# --- PIREP FUNCTIONS ---
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def fetch_pireps():
    print("Fetching PIREPs (Streaming Mode)...")
    try:
        response = requests.get(PIREP_SOURCE, timeout=20, stream=True)
        response.raise_for_status()

        features = []
        now_utc = datetime.now(timezone.utc)
        
        with gzip.GzipFile(fileobj=response.raw) as f:
            context = ET.iterparse(f, events=("end",))
            for event, elem in context:
                if elem.tag == "AircraftReport":
                    try:
                        lat = float(elem.find("latitude").text)
                        lon = float(elem.find("longitude").text)
                        
                        if haversine_distance(PHNL_LAT, PHNL_LON, lat, lon) > MAX_DIST_NM:
                            elem.clear()
                            continue

                        obs_time_str = elem.find("observation_time").text
                        obs_time = datetime.fromisoformat(obs_time_str.replace("Z", "+00:00"))
                        age_min = (now_utc - obs_time).total_seconds() / 60
                        
                        if age_min > MAX_AGE_MIN:
                            elem.clear()
                            continue

                        features.append({
                            "type": "Feature",
                            "geometry": {"type": "Point", "coordinates": [lon, lat]},
                            "properties": {
                                "type": elem.find("report_type").text, 
                                "rawOb": elem.find("raw_text").text, 
                                "alt": int(elem.find("altitude_ft_msl").text) if elem.find("altitude_ft_msl") is not None else 0, 
                                "age": round(age_min, 1)
                            }
                        })
                    except: pass
                    elem.clear()

        output = {"generated_at": now_utc.strftime("%H%MZ %m/%d/%y"), "type": "FeatureCollection", "features": features}
        with open("pireps.json", "w") as f: json.dump(output, f)
        print(f"✅ Saved {len(features)} PIREPs.")
        
    except Exception as e:
        print(f"❌ PIREP Error: {e}")

# --- HF FREQUENCY FUNCTIONS ---
def clean_text(text):
    """Remove special characters like &nbsp; and trim whitespace."""
    return " ".join(text.replace('\xa0', ' ').split())

def fetch_hf():
    print("Fetching HF Frequencies...")
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(HF_PAGE_URL, headers=headers, timeout=15)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        data = {
            "hwn_cal_major": [], "hwn_cal_other": [], "hwn_pacnw": [],
            "hwn_south": [], "hwn_alaska": [], "hwn_west": [], "notes": []
        }

        all_rows = soup.find_all('tr')
        
        for row in all_rows:
            cols = row.find_all(['td', 'th'])
            row_text_list = [clean_text(c.get_text()) for c in cols]
            
            if not row_text_list: continue
            
            # Use specific columns for stricter checking
            route_name = row_text_list[0].upper() # e.g. "HAWAII -> CALIFORNIA"
            
            # 1. NOTES Logic (Usually a header row or spanning cell)
            full_line_text = " ".join(row_text_list).upper()
            if "SWA" in full_line_text and "CIVIL" in full_line_text:
                data["notes"].append(clean_text(row.get_text()))
                continue

            # 2. Skip non-data rows
            if "PRIMARY" in full_line_text or len(row_text_list) < 2: continue
            
            # --- STRICT FILTER: MUST START WITH HAWAII ---
            # This filters out "California -> Hawaii"
            if not route_name.startswith("HAWAII"):
                continue

            freqs = " | ".join(row_text_list[1:])
            display_str = f"{row_text_list[0]}: {freqs}"
            
            # 3. Categorize Hawaii Departures
            if "CALIFORNIA" in route_name:
                if any(x in route_name for x in ["AAL", "DAL", "ACA", "WJA", "MILITARY"]):
                    data["hwn_cal_major"].append(display_str)
                else:
                    data["hwn_cal_other"].append(display_str)
            
            elif "PACIFIC NW" in route_name or "PAC NW" in route_name:
                data["hwn_pacnw"].append(display_str)
            
            elif "SOUTHBOUND" in route_name:
                data["hwn_south"].append(display_str)
                
            elif "WESTBOUND" in route_name:
                data["hwn_west"].append(display_str)
                
            elif "ALASKA" in route_name:
                data["hwn_alaska"].append(display_str)

        # De-duplicate
        for k in data:
            data[k] = sorted(list(set(data[k])))

        with open("hf_freqs.json", "w") as f:
            json.dump(data, f)
            
        print(f"✅ Saved HF Frequencies. Found {sum(len(v) for v in data.values())} items.")

    except Exception as e:
        print(f"❌ HF Error: {e}")

if __name__ == "__main__":
    fetch_pireps()
    fetch_hf()
