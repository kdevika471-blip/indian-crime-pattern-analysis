// --- Global Emergency State ---
let isTracking = false;
let isSilentMode = false;
let watchId = null;
let lastInteractionTime = Date.now();
let sirenActive = false;
let userInteracted = false;
let lastKnownLocation = { latitude: 28.6139, longitude: 77.2090 }; // Default/Fallback
let trackingInterval = null;
const activeToasts = new Set();

// Track user interaction for autoplay policies and Smart Detection
const trackInteraction = () => { 
    userInteracted = true; 
    lastInteractionTime = Date.now(); 
};
document.addEventListener('mousedown', trackInteraction);
document.addEventListener('keydown', trackInteraction);
document.addEventListener('touchstart', trackInteraction);

// Refined Toast Logic
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Prevent identical toast stacking
    if (activeToasts.has(message)) return;
    activeToasts.add(message);

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconClass = 'fa-info-circle';
    if(type === 'success') iconClass = 'fa-check';
    if(type === 'error') iconClass = 'fa-times';
    if(type === 'warning') iconClass = 'fa-exclamation-triangle';

    toast.innerHTML = `
        <i class="fas ${iconClass}"></i>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);
    
    // Smooth transition
    requestAnimationFrame(() => toast.classList.add('show'));

    // Automatic teardown
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (container.contains(toast)) container.removeChild(toast);
            activeToasts.delete(message);
        }, 400); 
    }, duration);
}

// Emergency Call Logic
function directCall(number) {
    // ❌ Removed all intermediate notifications/delays to ensure instant dialing
    window.location.href = `tel:${number}`;
}

// Geolocation with Promise and Feedback
async function getGPSLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject({ code: 0, message: "Geolocation Unvailable" });
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });
    });
}

function handleSafetyError(error) {
    let msg = "❌ Safety System Error. Please call 112.";
    let type = 'error';

    if (error.code === 1) msg = "Please enable location for emergency services";
    else if (error.code === 3) msg = "GPS Signal timeout. Please check your network.";
    else if (error.message) msg = error.message;

    showToast(msg, type, 5000);
    console.warn("Safety Error:", error);
}

// 🔹 2. Share Live Location (Standalone feature)
async function shareLiveLocation() {
    try {
        showToast("Fetching live location...", "info");
        const position = await getGPSLocation();
        const { latitude, longitude } = position.coords;
        
        const success = await sendAlert("Standalone Location Sharing", latitude, longitude);
        if (success) {
            showToast("✅ Location shared successfully", 'success');
        } else {
            throw new Error("Failed to share location with server.");
        }
    } catch (error) {
        handleSafetyError(error);
    }
}

// 🔹 13. SOS Flow Logic: Parallel Alerts, Siren, & tracking
async function sos() {
    try {
        // 🚨 1. Activate Siren IMMEDIATELY (Highest Priority)
        triggerAlarm(true); 

        if (!isSilentMode) {
            const mainDanger = document.getElementById('emergencyDetectedSection');
            if(mainDanger) mainDanger.style.display = 'flex';
            showToast("🚨 EMERGENCY ALERT TRIGGERED: Sending alerts to all channels...", 'error', 5000);
        }

        // 2. Get Live Location with Fallback
        let latitude = lastKnownLocation.latitude;
        let longitude = lastKnownLocation.longitude;
        try {
            const position = await getGPSLocation();
            latitude = position.coords.latitude;
            longitude = position.coords.longitude;
            lastKnownLocation = { latitude, longitude }; // Update last known
        } catch (err) {
            console.warn("GPS precision lost, using last known:", err);
            showToast("⚠️ Signal Weak: Using last known location", "warning");
        }

        // 3. Dispatch Parallel Alerts to Backend (Handles both Phone/WhatsApp and Email)
        const rawContacts = JSON.parse(localStorage.getItem('emergencyContacts') || '[]');
        // Normalize contacts (ensure they are objects)
        const contacts = rawContacts.map(c => typeof c === 'string' ? { phone: c, email: '' } : c);

        const sosDispatch = fetch('/send_sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude, contacts })
        });

        // 4. Start Continuous Tracking (Every 10 seconds)
        if (!trackingInterval) {
            trackingInterval = setInterval(async () => {
                try {
                    const pos = await getGPSLocation();
                    await sendAlert("Live SOS Tracking Update", pos.coords.latitude, pos.coords.longitude);
                    console.log("SOS tracking update sent.");
                } catch (e) { console.error("Tracking update failed", e); }
            }, 10000);
        }

        // 5. Trigger Direct Phone Call (Optional/Secondary fallback)
        setTimeout(() => {
            if (!isSilentMode) window.location.href = 'tel:112';
        }, 3000);

        const response = await sosDispatch;
        const result = await response.json();
        if (result.status === 'success') {
            showToast("✅ Multi-channel alerts dispatched successfully", 'success', 3000);
        }

    } catch (error) {
        handleSafetyError(error);
        window.location.href = 'tel:112';
    }
}

// 🔹 14. Shake Detection Logic
let lastShake = 0;
function initShakeDetection() {
    if (window.DeviceMotionEvent) {
        window.addEventListener('devicemotion', (event) => {
            const acceleration = event.accelerationIncludingGravity;
            if (!acceleration) return;

            const threshold = 15; // Sensitivity threshold
            const deltaX = Math.abs(acceleration.x);
            const deltaY = Math.abs(acceleration.y);
            const deltaZ = Math.abs(acceleration.z);

            if (deltaX > threshold || deltaY > threshold || deltaZ > threshold) {
                const now = Date.now();
                if (now - lastShake > 5000) { // Throttle: Once every 5s
                    lastShake = now;
                    console.log("Shake detected! Triggering SOS...");
                    showToast("📳 Shake Detected: Activating SOS!", "error");
                    sos();
                }
            }
        });
        console.log("Shake detection initialized.");
    }
}

// Backend Communications Helper
async function sendAlert(message, lat, lon) {
    try {
        const response = await fetch('/alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lon, message: message })
        });
        const result = await response.json();
        return result.status === 'success';
    } catch (e) { return false; }
}


// 🔹 4. Live Location Tracking Workflow
function toggleTracking(checkbox) {
    isTracking = checkbox.checked;
    const indicator = document.getElementById('trackingStatus');
    const textStatus = document.getElementById('trackingText');

    if (isTracking) {
        showToast("📍 Tracking Active", "success", 2000);
        indicator.classList.add('active');
        if (textStatus) textStatus.textContent = "Tracking Active";

        watchId = navigator.geolocation.watchPosition(
            async pos => {
                const { latitude, longitude } = pos.coords;
                // Update UI Map (🔹 11. Google Maps Integration)
                const map = document.getElementById("incidentMap");
                if(map) map.src = `https://maps.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`;
                
                await sendAlert("Continuous Tracking Update", latitude, longitude);
            },
            err => {
                checkbox.checked = false;
                indicator.classList.remove('active');
                if (textStatus) textStatus.textContent = "Tracking Inactive";
                handleSafetyError(err);
            },
            { enableHighAccuracy: true }
        );
    } else {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        indicator.classList.remove('active');
        if (textStatus) textStatus.textContent = "Tracking Inactive";
        showToast("Tracking Stopped", "info", 2000);
    }
}

// 🔹 7. Silent SOS Mode Management
function toggleSilentMode(checkbox) {
    isSilentMode = checkbox.checked;
    const msg = isSilentMode ? "🔕 Silent Mode Active: UI alerts suppressed" : "🔔 Standard Mode Enabled";
    showToast(msg, isSilentMode ? "success" : "info", 3000);
}

// 🔹 8. Alarm Mode (Siren)
function triggerAlarm(forceStart = false) {
    const audio = document.getElementById('sirenAudio');
    const btn = document.getElementById('alarmBtn');
    if(!audio) return;
    
    if (forceStart || !sirenActive) {
        audio.play()
            .then(() => {
                sirenActive = true;
                if(btn) {
                    btn.innerHTML = 'STOP ALARM';
                    btn.style.background = 'linear-gradient(45deg, #e74c3c, #c0392b)';
                }
                showToast("🔊 SIREN ACTIVATED!", "error", 3000);
            })
            .catch(() => {
                if(!forceStart) showToast("Audio blocked. Click anywhere on page first.", "warning", 4000);
            });
    } else {
        audio.pause();
        audio.currentTime = 0;
        sirenActive = false;
        if(btn) {
            btn.innerHTML = 'ACTIVATE';
            btn.style.background = 'linear-gradient(45deg, #f39c12, #e67e22)';
        }
        showToast("Siren Stopped.", "info", 2000);
    }
}

// 🔹 9. Dangerous Zone Detection Simulation
async function checkDangerZone(isForced = false) {
    // If isForced is true, we trigger the detection immediately for UI feedback
    if (isForced || Math.random() > 0.99) { 
        showToast("⚠️ WARNING: You are entering a dangerous zone", "error", 8000);
        showToast("✅ Automatic alerts sent successfully", "success");
        
        // Auto-report danger zone entry
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async pos => {
                await sendAlert("System Warning: Danger Zone Entry", pos.coords.latitude, pos.coords.longitude);
            });
        }
    }
}

// 🔹 10. Smart Detection (Inactivity Trigger)
function smartDetection() {
    const inactiveSeconds = (Date.now() - lastInteractionTime) / 1000;
    // If tracking is active and user is inactive, trigger SOS
    if (isTracking && inactiveSeconds > 60) { 
        showToast("🧠 Smart Detection: Unusual activity (no response). Auto-triggering SOS...", "error");
        sos();
        lastInteractionTime = Date.now(); 
    }
}

// Initializers
function loadMap() {
    const mapIframe = document.getElementById("incidentMap");
    if(!mapIframe) return;

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            p => { mapIframe.src = `https://maps.google.com/maps?q=${p.coords.latitude},${p.coords.longitude}&z=13&output=embed`; },
            e => { mapIframe.src = `https://maps.google.com/maps?q=New+Delhi&z=11&output=embed`; }
        );
    }
}

setInterval(checkDangerZone, 45000); 
setInterval(smartDetection, 30000); 

let globalCrimeData = null;

// Advanced Chart Initialization
const dashboardCharts = {};

// Advanced Chart Initialization & Update
async function initializeDashboard(filters = {}) {
    const barCanvas = document.getElementById('barChart');
    if(!barCanvas) return; 

    try {
        const queryParams = new URLSearchParams(filters).toString();
        const response = await fetch(`/api/crime-data?${queryParams}`);
        const data = await response.json();
        globalCrimeData = data; 

        // Update Summary Cards
        if(document.getElementById('totalCasesVal')) {
            document.getElementById('totalCasesVal').textContent = data.total_cases.toLocaleString();
            document.getElementById('crimeRateVal').textContent = data.crime_rate;
            document.getElementById('pendingCasesVal').textContent = data.pending_cases.toLocaleString();
            updateMostAffectedGroup(data.demographics);
        }

        // Update Ticker
        const ticker = document.getElementById('alertText');
        if(ticker) ticker.textContent = data.alerts.join('  |  ');

        // Chart.js Configuration
        Chart.defaults.color = '#a0a0b0'; 
        Chart.defaults.font.family = "'Outfit', sans-serif";
        Chart.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';

        // 1. Bar Chart
        if (!dashboardCharts.bar) {
            dashboardCharts.bar = new Chart(barCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: data.states,
                    datasets: [{
                        label: 'Crime Cases',
                        data: data.crime_cases_by_state,
                        backgroundColor: 'rgba(0, 240, 255, 0.7)',
                        borderColor: '#00f0ff',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, animation: { duration: 1500 } }
            });
        } else {
            dashboardCharts.bar.data.labels = data.states;
            dashboardCharts.bar.data.datasets[0].data = data.crime_cases_by_state;
            dashboardCharts.bar.update();
        }

        // 2. Pie Chart
        const pieCanvas = document.getElementById('pieChart');
        if (!dashboardCharts.pie) {
            dashboardCharts.pie = new Chart(pieCanvas.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: data.crime_types,
                    datasets: [{
                        data: data.crime_type_distribution,
                        backgroundColor: ['#00f0ff', '#ff003c', '#fce100', '#00ff66', '#a200ff', '#ff009d', '#0073ff', '#ff6600', '#00ffcc', '#ffcc00'],
                        borderWidth: 0
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { color: '#f8f8f8', font: {size: 10} } } } }
            });
        } else {
            dashboardCharts.pie.data.labels = data.crime_types;
            dashboardCharts.pie.data.datasets[0].data = data.crime_type_distribution;
            dashboardCharts.pie.update();
        }

        // 3. Line Chart
        const lineCanvas = document.getElementById('lineChart');
        if (!dashboardCharts.line) {
            const lineCtx = lineCanvas.getContext('2d');
            const gradient = lineCtx.createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(255, 0, 60, 0.5)');   
            gradient.addColorStop(1, 'rgba(255, 0, 60, 0.0)');

            dashboardCharts.line = new Chart(lineCtx, {
                type: 'line',
                data: {
                    labels: data.trends_years,
                    datasets: [{
                        label: 'Total Incidents',
                        data: data.trends_data,
                        borderColor: '#ff003c',
                        backgroundColor: gradient,
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        } else {
            dashboardCharts.line.data.labels = data.trends_years;
            dashboardCharts.line.data.datasets[0].data = data.trends_data;
            dashboardCharts.line.update();
        }

        // 4. Scatter Chart
        const scatterCanvas = document.getElementById('scatterChart');
        if (!dashboardCharts.scatter) {
            dashboardCharts.scatter = new Chart(scatterCanvas.getContext('2d'), {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Density',
                        data: data.scatter,
                        backgroundColor: '#fce100',
                        pointRadius: 8
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        } else {
            dashboardCharts.scatter.data.datasets[0].data = data.scatter;
            dashboardCharts.scatter.update();
        }

        // 5. Monthly Trend Chart
        const monthlyCanvas = document.getElementById('monthlyTrendChart');
        if (!dashboardCharts.monthly) {
            dashboardCharts.monthly = new Chart(monthlyCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                    datasets: [{
                        label: 'Monthly Trend',
                        data: data.monthly_trend,
                        backgroundColor: 'rgba(0, 255, 102, 0.3)',
                        borderColor: '#00ff66',
                        borderWidth: 1.5
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        } else {
            dashboardCharts.monthly.data.datasets[0].data = data.monthly_trend;
            dashboardCharts.monthly.update();
        }

    } catch (e) {
        console.error("Dashboard Load Error:", e);
        showToast("Error loading analytics data.", "error");
    }
}


// Feedback logic
async function submitFeedback(event) {
    if(event) event.preventDefault();
    
    const fbRating = document.getElementById('fbRating').value;
    if(fbRating === "0") {
        showToast("Please provide a rating before submitting.", "warning");
        return;
    }

    const payload = {
        name: document.getElementById('fbName').value,
        email: document.getElementById('fbEmail').value,
        contact_number: document.getElementById('fbContact').value,
        address: document.getElementById('fbAddress').value,
        rating: fbRating,
        insights_feedback: document.getElementById('fbInsights').value
    };

    try {
        const response = await fetch('/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        
        if(result.status === 'success') {
            document.getElementById('feedbackForm').reset();
            // Reset stars if they exist
            if(typeof updateStars === 'function') updateStars(0);
            showToast("Feedback submitted successfully. Thank you!", "success");
        }
    } catch(e) {
        showToast("Failed to submit feedback. Please try again.", "error");
    }
}

// Helper to find and update most affected group
function updateMostAffectedGroup(demographics) {
    if(!demographics) return;
    
    let maxCount = -1;
    let mainGroup = "Male";
    
    for (const [group, count] of Object.entries(demographics)) {
        if (count > maxCount) {
            maxCount = count;
            mainGroup = group;
        }
    }
    
    const element = document.getElementById('affectedGroupVal');
    if(element) {
        element.textContent = mainGroup;
        
        // Update icon based on group
        const cardIcon = element.closest('.summary-card').querySelector('i');
        if(cardIcon) {
            cardIcon.className = 'fas';
            if(mainGroup === 'Female') cardIcon.classList.add('fa-female'); 
            else if(mainGroup === 'Male') cardIcon.classList.add('fa-male');
            else if(mainGroup === 'Child') cardIcon.classList.add('fa-child');
            else if(mainGroup === 'Senior Citizen') cardIcon.classList.add('fa-user-clock');
            
            // Fallback classes
            if(mainGroup === 'Female') cardIcon.className = 'fas fa-female';
            if(mainGroup === 'Male') cardIcon.className = 'fas fa-male';
            if(mainGroup === 'Child') cardIcon.className = 'fas fa-child';
            if(mainGroup === 'Senior Citizen') cardIcon.className = 'fas fa-user-clock';
        }
    }
}

// Data Filters Interaction - Fully Connected Flow
async function applyDashboardFilters() {
    const state = document.getElementById('filterState').value;
    const type = document.getElementById('filterType').value;
    const year = document.getElementById('filterYear').value;

    const alertBtn = document.querySelector('.btn-primary');
    if (!alertBtn) return;
    
    const originalText = alertBtn.innerHTML;
    alertBtn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Processing...";
    alertBtn.disabled = true;

    showToast("Connecting to analytical server...", "info", 1000);

    // Single Logical Flow: Fetch from Backend -> Process -> Update UI
    await initializeDashboard({
        state: state,
        type: type,
        year: year
    });
    
    setTimeout(() => { 
        alertBtn.innerHTML = "<i class='fas fa-check'></i> Updated"; 
        alertBtn.disabled = false;
        setTimeout(() => { alertBtn.innerHTML = originalText; }, 1500);
        showToast("Dashboard Synchronized Successfully", "success", 2000); 
    }, 500);
}


// On load runner
window.onload = function() {
    loadMap();
    initializeDashboard();
    initShakeDetection();
};
