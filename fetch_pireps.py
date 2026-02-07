import requests
import gzip
import xml.etree.ElementTree as ET
import json
import math
import io
from datetime import datetime, timezone, timedelta

# --- CONFIGURATION ---
SOURCE_URL = "https://aviationweather.gov/data/cache/aircraftreports.cache.xml.gz"
OUTPUT_FILE = "pireps.json"

# PHNL (Honolulu) Coordinates
CENTER_LAT = 21.318
CENTER_LON = -157.922
MAX_DIST_NM = 250
MAX_AGE_MIN = 90

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in Nautical Miles between two points."""
    R = 3440.065 # Radius of Earth in NM
    
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c

def fetch_and_process():
    print(f"Downloading cache from AWC...")
    
    try:
        # 1. Download the GZipped XML
        response = requests.get(SOURCE_URL, timeout=60)
        response.raise_for_status()
        
        # 2. Decompress in memory
        with gzip.GzipFile(fileobj=io.BytesIO(response.content)) as f:
            xml_content = f.read()
            
        # 3. Parse XML
        root = ET.fromstring(xml_content)
        
        features = []
        now_utc = datetime.now(timezone.utc)
        count_total = 0
        
        # 4. Iterate through reports
        for report in root.findall(".//AircraftReport"):
            count_total += 1
            
            try:
                # Extract basic data
                lat = float(report.find("latitude").text)
                lon = float(report.find("longitude").text)
                obs_time_str = report.find("observation_time").text # ISO8601 format
                raw_text = report.find("raw_text").text
                report_type = report.find("report_type").text # UA or UUA
                
                # Extract Altitude (if available)
                alt_elem = report.find("altitude_ft_msl")
                alt = int(alt_elem.text) if alt_elem is not None else 0

                # 5. Filter by Age (90 mins)
                # Parse time (handle Z as UTC)
                obs_time = datetime.fromisoformat(obs_time_str.replace("Z", "+00:00"))
                age_min = (now_utc - obs_time).total_seconds() / 60
                
                if age_min > MAX_AGE_MIN:
                    continue

                # 6. Filter by Distance (250 NM from PHNL)
                dist = haversine_distance(CENTER_LAT, CENTER_LON, lat, lon)
                if dist > MAX_DIST_NM:
                    continue

                # 7. Build GeoJSON Feature
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": {
                        "type": report_type,
                        "rawOb": raw_text,
                        "alt": alt,
                        "age": round(age_min, 1)
                    }
                }
                features.append(feature)

            except Exception:
                continue # Skip malformed reports

        # 8. Save to JSON
        geojson = {
            "type": "FeatureCollection",
            "features": features
        }
        
        with open(OUTPUT_FILE, "w") as f:
            json.dump(geojson, f)
            
        print(f"✅ Processed {count_total} reports.")
        print(f"✅ Saved {len(features)} reports for Hawaii sector.")

    except Exception as e:
        print(f"❌ Error: {e}")
        exit(1) # Fail the action so GitHub alerts you

if __name__ == "__main__":
    fetch_and_process()
