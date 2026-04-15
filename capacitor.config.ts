import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.crimeanalysis.app',
  appName: 'Crime Analysis',
  webDir: 'static',
  server: {
    // ⚠️ REPLACE THIS with your hosted Flask application URL
    url: 'https://your-flask-app.com',
    cleartext: true
  },
  plugins: {
    BackgroundGeolocation: {
      // Background Geolocation plugin settings
      backgroundTitle: 'Emergency Tracking',
      backgroundMessage: 'Tracking your location for safety.',
      requestPermissions: true
    }
  }
};

export default config;
