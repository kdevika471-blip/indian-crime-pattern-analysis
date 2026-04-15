from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash
from functools import wraps
import sqlite3
import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from twilio.rest import Client
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
import webbrowser
import threading

# Load environment variables
load_dotenv()

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = 'super_secret_crime_key' # Required for sessions
DB_NAME = 'crime_data.db'

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    # Feedback Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT,
            contact_number TEXT,
            address TEXT,
            rating INTEGER,
            insights_feedback TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Users Table with Email column
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT,
            password TEXT
        )
    ''')
    # Emergency Alerts Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS emergency_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            latitude REAL,
            longitude REAL,
            message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Migration: Check for feedback columns
    try:
        c.execute('ALTER TABLE feedback ADD COLUMN contact_number TEXT')
        c.execute('ALTER TABLE feedback ADD COLUMN address TEXT')
    except sqlite3.OperationalError:
        pass # Columns already exist

    conn.commit()
    conn.close()

# Decorator to enforce login
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash("Please log in to access this page.", "warning")
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function


# Context processor to inject user into all templates
@app.context_processor
def inject_user():
    return dict(user_id=session.get('user_id'), username=session.get('username'))


# General Routes
@app.route('/')
def home():
    return render_template('index.html')


# Auth Routes
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        action = request.form.get('action')
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()

        if action == 'register':
            # Create Account Flow
            try:
                hashed_pw = generate_password_hash(password)
                c.execute('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', (username, email, hashed_pw))
                conn.commit()
                # Auto-login after signup
                user_id = c.lastrowid
                session['user_id'] = user_id
                session['username'] = username
                conn.close()
                flash("Account created successfully! Welcome to the portal.", "success")
                return redirect(url_for('dashboard'))
            except sqlite3.IntegrityError:
                flash("Username already exists. Please choose another one or login.", "error")
                conn.close()
                return redirect(url_for('login'))
                
        elif action == 'login':
            # Login Flow
            c.execute('SELECT id, username, password FROM users WHERE username = ? OR email = ?', (username, username))
            user = c.fetchone()
            conn.close()
            
            if user and check_password_hash(user[2], password):
                session['user_id'] = user[0]
                session['username'] = user[1]
                flash("Login successful!", "success")
                return redirect(url_for('dashboard'))
            else:
                flash("Invalid username or password.", "error")
                return redirect(url_for('login'))

    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    flash("Logged out successfully!", "success")
    return redirect(url_for('home'))


# Protected Application Routes
@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')

@app.route('/insights')
@login_required
def insights():
    return render_template('insights.html')

@app.route('/investigation')
@login_required
def investigation():
    return render_template('investigation.html')

@app.route('/emergency')
@login_required
def emergency():
    return render_template('emergency.html')

# Twilio & Email Configuration from .env
TWILIO_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_FROM_SMS = os.getenv('TWILIO_PHONE_NUMBER')
TWILIO_FROM_WA = os.getenv('TWILIO_WHATSAPP_NUMBER')
SMTP_SERVER = os.getenv('SMTP_SERVER')
SMTP_PORT = os.getenv('SMTP_PORT', 587)
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
ADMIN_EMAIL = os.getenv('ADMIN_EMAIL')

# Initialize Twilio Client
try:
    twilio_client = Client(TWILIO_SID, TWILIO_TOKEN) if TWILIO_SID and TWILIO_TOKEN else None
except Exception as e:
    logger.error(f"Twilio initialization error: {e}")
    twilio_client = None

def retry_alert(attempts=3, delay=1):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            for i in range(attempts):
                try:
                    return f(*args, **kwargs)
                except Exception as e:
                    logger.warning(f"Attempt {i+1} failed for {f.__name__}: {e}")
                    if i < attempts - 1:
                        time.sleep(delay)
            logger.error(f"All {attempts} attempts failed for {f.__name__}")
            return False
        return wrapper
    return decorator

@retry_alert()
def send_sms(to_number, message):
    if not twilio_client:
        logger.info(f"SIMULATED SMS to {to_number}: {message}")
        return True
    twilio_client.messages.create(body=message, from_=TWILIO_FROM_SMS, to=to_number)
    logger.info(f"SMS sent to {to_number}")
    return True

@retry_alert()
def send_whatsapp(to_number, message):
    if not twilio_client:
        logger.info(f"SIMULATED WhatsApp to {to_number}: {message}")
        return True
    formatted_to = f"whatsapp:{to_number}" if not to_number.startswith('whatsapp:') else to_number
    twilio_client.messages.create(body=message, from_=f"whatsapp:{TWILIO_FROM_WA}", to=formatted_to)
    logger.info(f"WhatsApp sent to {to_number}")
    return True

@retry_alert()
def make_call(to_number, message):
    if not twilio_client:
        logger.info(f"SIMULATED Call to {to_number}: {message}")
        return True
    # Simplified XML for the call
    twiml = f'<Response><Say voice="alice">{message}</Say></Response>'
    twilio_client.calls.create(twiml=twiml, to=to_number, from_=TWILIO_FROM_SMS)
    logger.info(f"Call initiated to {to_number}")
    return True

@retry_alert()
def send_email(to_email, subject, body):
    if not (SMTP_USER and SMTP_PASS):
        logger.info(f"SIMULATED Email to {to_email}: {subject}")
        return True
    msg = MIMEMultipart()
    msg['From'] = SMTP_USER
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))
    
    with smtplib.SMTP(SMTP_SERVER, int(SMTP_PORT)) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
    logger.info(f"Email sent to {to_email}")
    return True

@app.route('/send_sos', methods=['POST'])
@app.route('/api/sos', methods=['POST'])
def api_sos():
    user_id = session.get('user_id')
    if not user_id:
         return jsonify({'status': 'error', 'message': 'Authentication required.'}), 401
        
    username = session.get('username', 'Anonymous')
    data = request.json
    lat = data.get('latitude')
    lon = data.get('longitude')
    contacts = data.get('contacts', []) # Expecting list of {phone, email}
    
    # Live location link
    maps_link = f"https://www.google.com/maps?q={lat},{lon}"
    alert_msg = f"🚨 EMERGENCY ALERT: {username} is in danger! Live Location: {maps_link}"

    # Database logging
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('INSERT INTO emergency_alerts (user_id, username, latitude, longitude, message) VALUES (?, ?, ?, ?, ?)',
              (user_id, username, lat, lon, alert_msg))
    conn.commit()
    conn.close()

    # Parallel Alert Execution (WhatsApp + Email for EACH contact)
    with ThreadPoolExecutor(max_workers=10) as executor:
        for contact in contacts:
            phone = contact.get('phone', '').strip()
            email = contact.get('email', '').strip()
            
            if phone:
                executor.submit(send_whatsapp, phone, alert_msg)
            if email:
                executor.submit(send_email, email, "🚨 EMERGENCY ALERT", alert_msg)
        
        # Also notify administrative email if configured
        if ADMIN_EMAIL:
            executor.submit(send_email, ADMIN_EMAIL, "🚨 EMERGENCY ALERT (ADMIN)", alert_msg)

    return jsonify({
        'status': 'success', 
        'message': 'Emergency alerts dispatched successfully to all contacts.',
        'location': {'lat': lat, 'lon': lon}
    })


@app.route('/alert', methods=['POST'])
def smart_alert():
    user_id = session.get('user_id')
    username = session.get('username', 'Anonymous User')
    
    data = request.json
    lat = data.get('latitude')
    lon = data.get('longitude')
    msg = data.get('message', 'Emergency Alert Detected')

    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('INSERT INTO emergency_alerts (user_id, username, latitude, longitude, message) VALUES (?, ?, ?, ?, ?)',
              (user_id, username, lat, lon, msg))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'message': 'Alert received and stored.'})

@app.route('/view-emergency')
@login_required
def view_emergency():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('SELECT id, username, latitude, longitude, message, created_at FROM emergency_alerts ORDER BY id DESC')
    alerts = c.fetchall()
    conn.close()
    return render_template('view_emergency.html', alerts=alerts)

@app.route('/awareness')
def awareness():
    return render_template('awareness.html')

@app.route('/dashboard1')
@login_required
def dashboard1():
    url = "https://public.tableau.com/views/CrimeOverviewAnalysisDashboard/Dashboard1?:embed=y&:showVizHome=no&:publish=yes"
    return render_template('tableau_viewer.html', dashboard_url=url, title="Dashboard 1")

@app.route('/dashboard2')
@login_required
def dashboard2():
    url = "https://public.tableau.com/views/CaseStatusInvestigationAnalysisDashboarfd/Dashboard1?:embed=y&:showVizHome=no&:publish=yes"
    return render_template('tableau_viewer.html', dashboard_url=url, title="Dashboard 2")

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/feedback', methods=['GET', 'POST'])
def feedback():
    if request.method == 'POST':
        data = request.json
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        c.execute('INSERT INTO feedback (name, email, contact_number, address, rating, insights_feedback) VALUES (?, ?, ?, ?, ?, ?)',
                  (data.get('name'), data.get('email'), data.get('contact_number'), data.get('address'), data.get('rating'), data.get('insights_feedback')))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Feedback stored successfully'})
    return render_template('feedback.html')

@app.route('/delete-feedback/<int:fb_id>', methods=['POST'])
@login_required
def delete_feedback(fb_id):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('DELETE FROM feedback WHERE id = ?', (fb_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'message': 'Feedback deleted successfully'})

@app.route('/view-feedback')
def view_feedback():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('SELECT id, name, email, contact_number, address, rating, insights_feedback, created_at FROM feedback ORDER BY id DESC')
    feedbacks = c.fetchall()
    conn.close()
    return render_template('view_feedback.html', feedbacks=feedbacks)


# API Data Route
@app.route('/api/crime-data')
def crime_data():
    state = request.args.get('state', 'All States')
    crime_type = request.args.get('type', 'All Crime Types')
    year = request.args.get('year', 'All Years')

    # Base Data
    states = ["Delhi", "Karnataka", "Odisha", "Haryana", "Rajasthan", "Uttar Pradesh", "Maharashtra", "Gujarat", "Tamil Nadu", "Kerala", "Telangana", "Bihar", "Punjab", "Andhra Pradesh", "West Bengal"]
    base_cases = [12500, 8900, 4500, 6700, 5200, 15000, 11200, 8000, 9100, 4200, 7500, 10500, 4800, 6200, 8100]
    crime_types = ["Kidnapping", "Domestic Violence", "Theft", "Burglary", "Murder", "Assault", "Drug Offense", "Fraud", "Cyber Crime", "Robbery"]
    base_distribution = [10, 12, 25, 8, 5, 12, 6, 8, 10, 4]
    years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
    base_trends = [42000, 45000, 46000, 49000, 50000, 48000, 52000, 56000, 53000, 58000, 60000]
    
    # Simple deterministic multiplier based on filters to ensure consistency
    import hashlib
    def get_multiplier(seed_str):
        h = hashlib.md5(seed_str.encode()).hexdigest()
        return 0.5 + (int(h[:2], 16) / 255.0) # Scale between 0.5 and 1.5

    seed = f"{state}-{crime_type}-{year}"
    main_multiplier = get_multiplier(seed)

    # Dynamic adjustment logic
    res_cases_by_state = [int(v * main_multiplier * (0.85 + (i % 4) * 0.08)) for i, v in enumerate(base_cases)]
    res_type_dist = [int(v * main_multiplier * (0.75 + (i % 3) * 0.15)) for i, v in enumerate(base_distribution)]
    res_trends = [int(v * (0.9 + (i % 5) * 0.05) if year == 'All Years' or str(y) == year else v * 0.05) for i, (y, v) in enumerate(zip(years, base_trends))]
    
    if state != 'All States':
        state_idx = states.index(state)
        # If a state is selected, other states show lower values (simulating a "focus" on that state)
        res_cases_by_state = [int(v * 0.2) for v in res_cases_by_state]
        res_cases_by_state[state_idx] = int(base_cases[state_idx] * main_multiplier)

    if crime_type != 'All Crime Types':
        type_idx = crime_types.index(crime_type)
        res_type_dist = [int(v * 0.1) for v in res_type_dist]
        res_type_dist[type_idx] = int(base_distribution[type_idx] * 5 * main_multiplier)
        res_cases_by_state = [int(v * 0.15) for v in res_cases_by_state]

    total_cases = sum(res_cases_by_state)
    pending_cases = int(total_cases * 0.34)
    crime_rate = round(42.5 * main_multiplier, 1)

    # Demographics shift based on crime type for realism
    demographics = {"Male": 4200, "Female": 6100, "Child": 2800, "Senior Citizen": 2330}
    if crime_type == 'Kidnapping':
        demographics = {"Male": 800, "Female": 1200, "Child": 9500, "Senior Citizen": 200}
    elif crime_type == 'Domestic Violence':
        demographics = {"Male": 500, "Female": 11500, "Child": 1500, "Senior Citizen": 800}
    elif crime_type in ['Fraud', 'Cyber Crime']:
        demographics = {"Male": 4200, "Female": 3800, "Child": 500, "Senior Citizen": 12500}
    elif crime_type in ['Theft', 'Burglary', 'Robbery', 'Assault', 'Murder', 'Drug Offense']:
        demographics = {"Male": 11000, "Female": 4500, "Child": 1200, "Senior Citizen": 1400}
    
    demographics = {k: int(v * main_multiplier) for k, v in demographics.items()}

    # Scatter and Monthly Trend data
    scatter = [{"x": 30000000 * (i+1), "y": int(res_cases_by_state[min(i, len(res_cases_by_state)-1)] * 1.2)} for i in range(len(states))]
    monthly_trend = [int(1500 * main_multiplier * (0.6 + (i % 7) * 0.12)) for i in range(12)]

    return jsonify({
        "states": states,
        "crime_cases_by_state": res_cases_by_state,
        "crime_types": crime_types,
        "crime_type_distribution": res_type_dist,
        "trends_years": years,
        "trends_data": res_trends,
        "scatter": scatter,
        "monthly_trend": monthly_trend,
        "total_cases": total_cases,
        "crime_rate": crime_rate,
        "pending_cases": pending_cases,
        "demographics": demographics,
        "alerts": [
            f"Filter Active: Displaying data for {state}" if state != 'All States' else "Real-time Monitoring Active",
            f"Crime Focus: {crime_type}" if crime_type != 'All Crime Types' else "General Crime Trends Loading...",
            f"Yearly Overview: {year}" if year != 'All Years' else "Historical Spikes Detected"
        ]
    })


def open_browser():
    # Microsoft Edge path for Windows
    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    url = "http://127.0.0.1:8001"
    
    try:
        # Register and open Edge
        webbrowser.register('edge', None, webbrowser.BackgroundBrowser(edge_path))
        webbrowser.get('edge').open(url)
    except Exception:
        # Fallback to default if Edge is not found at that specific path
        webbrowser.open(url)

if __name__ == '__main__':
    init_db()
    # Timer to wait for Flask to initialize before opening browser
    threading.Timer(1.5, open_browser).start()
    app.run(debug=True, port=8001)
