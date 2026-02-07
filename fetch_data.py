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
                        "type": report_type, "rawOb": raw_text, "alt": alt, "age": round(age_min, 1)
                    }
                })
            except: continue

        output = {"generated_at": now_utc.strftime("%H%MZ %m/%d/%y"), "type": "FeatureCollection", "features": features}
        with open("pireps.json", "w") as f: json.dump(output, f)
        print(f"✅ Saved {len(features)} PIREPs.")
    except Exception as e: print(f"❌ PIREP Error: {e}")

# --- HF FREQUENCY FUNCTIONS ---
def clean_text(text):
    # Removes special characters and excessive spacing
    return " ".join(text.replace('\xa0', ' ').split())

def fetch_hf():
    print("Fetching HF Frequencies (State Machine Mode)...")
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(HF_PAGE_URL, headers=headers, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        data = {
            "hwn_cal_major": [], "hwn_cal_other": [], "hwn_pacnw": [],
            "hwn_south": [], "hwn_alaska": [], "hwn_west": [], "notes": []
        }

        # STATE MACHINE VARS
        current_cat = None
        
        # Get EVERY row on the page, regardless of table nesting
        all_rows = soup.find_all('tr')
        
        for row in all_rows:
            # Get text from the whole row to check for Headers
            row_text = clean_text(row.get_text()).upper()
            
            # 1. DETECT HEADER / CATEGORY CHANGE
            if "HAWAII" in row_text and "CALIFORNIA" in row_text:
                current_cat = "CAL"
                continue # Skip the header row itself
            elif "PACIFIC NW" in row_text or "PAC NW" in row_text:
                current_cat = "PACNW"
                continue
            elif "SOUTHBOUND" in row_text:
                current_cat = "SOUTH"
                continue
            elif "ALASKA" in row_text:
                current_cat = "ALASKA"
                continue
            elif "WESTBOUND" in row_text:
                current_cat = "WEST"
                continue
            elif "NOTE" in row_text:
                # Capture the note immediately
                data["notes"].append(row_text)
                continue

            # 2. CAPTURE DATA (If we are in a valid category)
            if current_cat:
                cols = row.find_all(['td', 'th'])
                # Only care if we have distinct columns (Route | Pri | Sec | Fam)
                if len(cols) >= 2:
                    col_texts = [clean_text(c.get_text()) for c in cols]
                    
                    # Ignore header rows that got caught (e.g. "Route Primary Secondary")
                    if "PRIMARY" in col_texts[1].upper(): continue
                    
                    full_line = " | ".join(col_texts)
                    
                    # Sort into specific lists
                    if current_cat == "CAL":
                        if any(x in full_line.upper() for x in ["AAL", "DAL", "ACA", "WJA", "MILITARY"]):
                            data["hwn_cal_major"].append(full_line)
                        else:
                            data["hwn_cal_other"].append(full_line)
                    elif current_cat == "PACNW":
                        data["hwn_pacnw"].append(full_line)
                    elif current_cat == "SOUTH":
                        data["hwn_south"].append(full_line)
                    elif current_cat == "ALASKA":
                        data["hwn_alaska"].append(full_line)
                    elif current_cat == "WEST":
                        data["hwn_west"].append(full_line)

        # Clean duplicates
        for k in data:
            data[k] = list(set(data[k]))
            # Sort for cleanliness
            data[k].sort()

        with open("hf_freqs.json", "w") as f:
            json.dump(data, f)
            
        print(f"✅ Saved HF Frequencies.")
        # Debugging: Print counts to log
        for k, v in data.items():
            print(f"   - {k}: {len(v)} items")

    except Exception as e:
        print(f"❌ HF Error: {e}")

if __name__ == "__main__":
    fetch_pireps()
    fetch_hf()
