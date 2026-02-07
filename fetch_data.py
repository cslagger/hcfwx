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
    return " ".join(text.split())

def fetch_hf():
    print("Fetching HF Frequencies (Header-Table Match)...")
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(HF_PAGE_URL, headers=headers, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Data Structure
        data = {
            "hwn_cal_major": [], "hwn_cal_other": [], "hwn_pacnw": [],
            "hwn_south": [], "hwn_alaska": [], "hwn_west": [], "notes": []
        }

        # Strategy: Find all Headers (h2, h3, h4, or strong/b tags)
        # Then check the *next* table that appears after them.
        elements = soup.find_all(['h2', 'h3', 'h4', 'h5', 'strong', 'b', 'p'])
        
        current_category = None
        
        for el in elements:
            text = clean_text(el.get_text()).upper()
            
            # Identify Category based on Header Text
            if "CALIFORNIA" in text: current_category = "CAL"
            elif "PACIFIC NW" in text or "PAC NW" in text: current_category = "PACNW"
            elif "SOUTHBOUND" in text: current_category = "SOUTH"
            elif "ALASKA" in text: current_category = "ALASKA"
            elif "WESTBOUND" in text: current_category = "WEST"
            elif "NOTE" in text: current_category = "NOTE"
            else: continue # Not a header we care about
            
            # Find the next table
            next_table = el.find_next('table')
            if not next_table: continue
            
            # Parse the table rows
            rows = next_table.find_all('tr')
            for row in rows:
                cols = [clean_text(c.get_text()) for c in row.find_all(['td', 'th'])]
                if not cols: continue
                
                full_line = " | ".join(cols)
                
                # Assign to correct JSON key
                if current_category == "CAL":
                    if any(x in full_line.upper() for x in ["AAL", "DAL", "ACA", "WJA", "MILITARY"]):
                        data["hwn_cal_major"].append(full_line)
                    else:
                        data["hwn_cal_other"].append(full_line)
                elif current_category == "PACNW":
                    data["hwn_pacnw"].append(full_line)
                elif current_category == "SOUTH":
                    data["hwn_south"].append(full_line)
                elif current_category == "ALASKA":
                    data["hwn_alaska"].append(full_line)
                elif current_category == "WEST":
                    data["hwn_west"].append(full_line)
                elif current_category == "NOTE":
                    data["notes"].append(full_line)

        # Remove Duplicates (sometimes headers repeat)
        for k in data:
            data[k] = list(set(data[k]))

        with open("hf_freqs.json", "w") as f:
            json.dump(data, f)
            
        print(f"✅ Saved HF Frequencies.")
        # Debug print
        print(f"DEBUG Sample: {str(data)[:200]}...")

    except Exception as e:
        print(f"❌ HF Error: {e}")

if __name__ == "__main__":
    fetch_pireps()
    fetch_hf()
