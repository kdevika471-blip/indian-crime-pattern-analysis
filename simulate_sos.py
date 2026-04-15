import urllib.request
import urllib.parse
import json
import http.cookiejar

def simulate_sos():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    
    # 1. Register User
    reg_url = 'http://localhost:8001/login'
    reg_values = {
        'action': 'register',
        'username': 'verifyuser2',
        'email': 'verify2@example.com',
        'password': 'password123'
    }
    reg_data = urllib.parse.urlencode(reg_values).encode('utf-8')
    opener.open(reg_url, reg_data)
    
    # 2. Send SOS Alert
    sos_url = 'http://localhost:8001/api/sos'
    sos_values = {
        'latitude': 12.9716,
        'longitude': 77.5946,
        'message': 'Urgent SOS Verification from Python'
    }
    sos_data = json.dumps(sos_values).encode('utf-8')
    req = urllib.request.Request(sos_url, data=sos_data, headers={'Content-Type': 'application/json'})
    response = opener.open(req)
    print(f"SOS Response Status: {json.loads(response.read().decode('utf-8'))}")
    
    # 3. Verify in History
    history_url = 'http://localhost:8001/view-emergency'
    history_resp = opener.open(history_url)
    history_html = history_resp.read().decode('utf-8')
    if 'verifyuser2' in history_html and '12.9716' in history_html:
        print("Verification SUCCESS: Alert found in history view.")
    else:
        print("Verification FAILED: Alert not found in history.")

if __name__ == '__main__':
    simulate_sos()
