/**
 * emergency.js - Mobile-specific emergency enhancements using Capacitor.
 * This file implements direct phone calling, SMS with GPS, and background geolocation.
 */

const EmergencyMobile = {
    // Configuration - Placeholders for values requested from user
    config: {
        emergencyNumber: '112', // Standard emergency number
        hostedUrl: window.location.origin // Fallback to current origin if URL not provided
    },

    /**
     * Initialize Emergency Native Features
     */
    async init() {
        console.log("Emergency Mobile System Initializing...");
        
        // Check if running on native platform
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            console.log("Native platform detected. Setting up mobile listeners.");
            this.requestPermissions();
            this.setupBackgroundGeolocation();
        } else {
            console.warn("Not running on a native platform. Some features will be simulated.");
        }
    },

    /**
     * Request all necessary permissions for mobile emergency features
     */
    async requestPermissions() {
        try {
            const { Geolocation } = Capacitor.Plugins;
            const status = await Geolocation.requestPermissions();
            console.log("Geolocation permission status:", status);
            
            // SMS and Call permissions are handled by the native plugins upon use usually
            // but we log the attempt here.
        } catch (e) {
            console.error("Error requesting permissions:", e);
        }
    },

    /**
     * Comprehensive Mobile SOS Trigger
     * Does GPS capture, SMS, and Phone Call
     */
    async triggerMobileSOS() {
        console.log("🚨 TRIGGERING MOBILE SOS 🚨");
        
        try {
            // 1. Get Live GPS Coordinates
            const { Geolocation } = Capacitor.Plugins;
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 10000
            });
            
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
            
            // 2. Prepare Alert Message
            const username = document.querySelector('.nav-links + .user-actions span')?.textContent?.replace('Welcome, ', '') || 'A user';
            const alertMsg = `🚨 EMERGENCY ALERT: ${username} is in danger! My Live Location: ${mapsLink}`;
            
            // 3. Send SMS to Emergency Contacts
            await this.sendSmsAlert(alertMsg);
            
            // 4. Trigger Direct Phone Call
            await this.makeEmergencyCall();
            
            if (typeof showToast === 'function') showToast("Mobile emergency alerts triggered!", "success");

        } catch (error) {
            console.error("Mobile SOS Error:", error);
            // Fallback to standard tel link if plugin fails
            window.location.href = `tel:${this.config.emergencyNumber}`;
        }
    },

    /**
     * Send SMS using capacitor-sms
     */
    async sendSmsAlert(message) {
        if (!window.Capacitor || !window.Capacitor.isPluginAvailable('Sms')) {
            console.log("SMS Plugin not available. Message:", message);
            return;
        }

        const { Sms } = Capacitor.Plugins;
        const contacts = JSON.parse(localStorage.getItem('emergencyContacts') || '[]');
        const phoneNumbers = contacts.map(c => typeof c === 'string' ? c : c.phone).filter(p => !!p);

        if (phoneNumbers.length > 0) {
            try {
                await Sms.send({
                    numbers: phoneNumbers,
                    text: message
                });
                console.log("SMS alerts sent successfully.");
            } catch (e) {
                console.error("Failed to send SMS:", e);
            }
        } else {
            console.warn("No emergency contacts found for SMS.");
        }
    },

    /**
     * Make phone call using @capacitor-community/call-number
     */
    async makeEmergencyCall() {
        if (!window.Capacitor || !window.Capacitor.isPluginAvailable('CallNumber')) {
            window.location.href = `tel:${this.config.emergencyNumber}`;
            return;
        }

        const { CallNumber } = Capacitor.Plugins;
        try {
            await CallNumber.call({
                number: this.config.emergencyNumber,
                bypassAppChooser: true
            });
        } catch (e) {
            console.error("Call failed:", e);
            window.location.href = `tel:${this.config.emergencyNumber}`;
        }
    },

    /**
     * Setup Background Geolocation tracking
     */
    async setupBackgroundGeolocation() {
        if (!window.Capacitor || !window.Capacitor.isPluginAvailable('BackgroundGeolocation')) {
            return;
        }

        const { BackgroundGeolocation } = Capacitor.Plugins;
        
        try {
            await BackgroundGeolocation.addWatcher({
                backgroundTitle: "Emergency Tracking",
                backgroundMessage: "Your location is being tracked for safety.",
                requestPermissions: true,
                stale: false,
                distanceFilter: 10
            }, async (location, error) => {
                if (error) {
                    if (error.code === "NOT_AUTHORIZED") {
                        console.error("Background location not authorized.");
                    }
                    return;
                }
                
                // Send update to server if available
                if (location && typeof sendAlert === 'function') {
                    await sendAlert("Background Tracking Update", location.latitude, location.longitude);
                }
            });
            console.log("Background geolocation watcher added.");
        } catch (e) {
            console.error("Background location setup failed:", e);
        }
    }
};

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => EmergencyMobile.init());

/**
 * Hook into existing SOS Logic
 * We override or wrap the existing sos() function if it exists.
 */
const originalSos = window.sos;
window.sos = async function() {
    console.log("Intercepted SOS trigger for mobile enhancement.");
    // Run existing logic first (Siren, etc.)
    if (typeof originalSos === 'function') {
        originalSos();
    }
    
    // Then run native mobile enhancements
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        EmergencyMobile.triggerMobileSOS();
    }
};
