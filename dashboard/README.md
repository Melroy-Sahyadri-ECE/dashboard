# Dashboard - Real-Time Monitoring System

A modern, dark-themed dashboard for real-time monitoring of railway track health with GPS tracking, vibration analysis, and gauge measurements.

## Features

### 📍 Track Map
- GPS-based track visualization
- Color-coded pins (Green/Yellow/Red) based on verdict
- Ready for Google Maps integration
- Real-time location tracking

### 📊 Health Profile
- Vibration score monitoring vs chainage (km)
- Visual trend analysis
- Critical threshold detection

### 📐 Gauge Profile
- Gauge deviation tracking from 1676mm nominal
- Chainage-based measurements
- Tolerance monitoring

### 📈 Live FFT
- Real-time frequency spectrum analysis
- Last measurement visualization
- Signal processing insights

### 📋 Events Table
- Comprehensive event logging
- Timestamp and chainage tracking
- Verdict classification
- Vibration scores and gauge readings

### 📊 Summary Stats
- **Circular Chart**: Visual distribution of Good, Suspicious, and Critical readings
- Total readings counter
- Critical and suspect count tracking
- Average vibration score
- Maximum gauge deviation
- Real-time statistics

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Charts**: Chart.js
- **Maps**: Placeholder for Google Maps API
- **Styling**: Custom CSS with dark theme
- **Fonts**: Inter (Google Fonts)

## Getting Started

### Prerequisites
- Python 3.x (for local server)
- Modern web browser
- Internet connection (for CDN resources)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Melroy-Sahyadri-ECE/dashboard.git
cd dashboard
```

2. Start a local server:
```bash
python -m http.server 8000
```

3. Open your browser and navigate to:
```
http://localhost:8000
```

## Project Structure

```
dashboard/
├── index.html          # Main HTML file
├── css/
│   └── style.css      # Styling and theme
├── js/
│   ├── app.js         # Main application logic
│   ├── datasource.js  # Data source management
│   ├── trackmap.js    # Track map functionality
│   ├── health.js      # Health profile charts
│   ├── gauge.js       # Gauge profile charts
│   ├── fft.js         # FFT visualization
│   ├── events.js      # Events table
│   ├── summary.js     # Summary statistics with circular chart
│   └── settings.js    # Settings panel
└── README.md          # This file
```

## Features in Detail

### Color Coding System
- 🟢 **Green**: Good condition (normal readings)
- 🟡 **Yellow**: Suspicious (warning threshold)
- 🔴 **Red**: Critical (requires immediate attention)

### Data Visualization
- Interactive charts with Chart.js
- Responsive design for all screen sizes
- Real-time data updates
- Smooth animations and transitions

### Settings Panel
- Configurable data source endpoints
- Panel-specific settings
- Live/Demo mode toggle

## Upcoming Features

- [ ] Google Maps integration
- [ ] Real-time data streaming
- [ ] Export functionality (PDF/CSV)
- [ ] Advanced filtering options
- [ ] User authentication
- [ ] Historical data analysis
- [ ] Mobile app version

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Contact

For questions or support, please open an issue on GitHub.
