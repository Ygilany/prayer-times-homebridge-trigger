# Prayer Times Scheduler

A Node.js application that automatically fetches daily prayer times (Fajr, Dhuhr, Asr, Maghrib, Isha) from the Aladhan API and triggers HomeKit scenes via Homebridge HTTP webhooks at the scheduled times.

## Features

- 🕌 Automatically fetches daily prayer times from Aladhan API
- ⏰ Schedules triggers for 5 daily prayers (Fajr, Dhuhr, Asr, Maghrib, Isha)
- 🔄 Auto-refreshes schedule at midnight each day
- 🏠 Integrates with Homebridge via HTTP webhooks
- 💾 Memory-efficient with proper timer cleanup
- 🛡️ Graceful shutdown handling for process managers

## Prerequisites

- Node.js (v18 or higher recommended for TypeScript/ESM support)
- npm or yarn
- Docker and Docker Compose (for Homebridge setup)
- Homebridge with HTTP WebHooks plugin (optional, if using HomeKit integration)
- PM2 (for production deployment)
- TypeScript and tsx (installed via npm dependencies)

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

**Note:** This project uses TypeScript and runs with `tsx` for direct TypeScript execution (no compilation step required).

## Configuration

Configuration is done via environment variables using a `.env` file (recommended) or by editing defaults in `timings.ts`.

### Using Environment Variables (Recommended)

1. **Copy the example file:**
```bash
cp .env.example .env
```

2. **Edit `.env` with your settings:**
```bash
# API Configuration
API_CITY=Cincinnati
API_COUNTRY=US
API_STATE=Ohio
API_METHOD=2
API_TIMEZONE=EST

# Homebridge Configuration
HOME_BRIDGE_HOST=127.0.0.1
WEBHOOK_PORT=51828
ACCESSORY_ID=dailyScene
```

### Configuration Options

**API Configuration:**
- `API_CITY`: Your city name
- `API_COUNTRY`: Your country code (e.g., "US", "CA", "GB")
- `API_STATE`: Your state/province (optional, for some countries)
- `API_METHOD`: Calculation method (2 = ISNA, see [Aladhan API docs](https://aladhan.com/prayer-times-api))
- `API_TIMEZONE`: Your timezone (e.g., "EST", "PST", "UTC")

**Homebridge Configuration:**
- `HOME_BRIDGE_HOST`: IP address or hostname of your Homebridge server
  - For Raspberry Pi: Use `127.0.0.1` or `localhost` (both script and Homebridge on same Pi)
  - For remote setup: Use your Pi's IP address (e.g., `192.168.1.100`)
- `WEBHOOK_PORT`: Port configured in Homebridge HTTP WebHooks plugin (default: 51828)
- `ACCESSORY_ID`: The ID of your pushbutton accessory in Homebridge (default: `dailyScene`)

### Alternative: Edit Defaults in Code

If you prefer not to use `.env` files, you can edit the default values directly in `timings.ts`. The environment variables will override these defaults if set.

## Docker Setup (Homebridge)

**Important:** Set up Homebridge first before running the prayer times script. While the script can run without Homebridge, webhook triggers will fail until Homebridge is running.

This project includes a Docker Compose configuration for running Homebridge with the required plugins.

### Prerequisites

- Docker and Docker Compose installed
- Ports available: 51826 (Homebridge), 51828 (Webhooks), 8581 (Config UI)

### Raspberry Pi Setup

This configuration is optimized for Raspberry Pi. The Docker Compose file includes ARM platform support.

**Network Configuration on Raspberry Pi:**

Since both the prayer times script and Homebridge run on the same Raspberry Pi:

1. **For the prayer times script** (`timings.ts`):
   - Use `HOME_BRIDGE_HOST = '127.0.0.1'` or `'localhost'`
   - This works because the script and Homebridge are on the same machine
   - The webhook calls stay local to the Pi

2. **For HomeKit access**:
   - Homebridge uses `network_mode: host`, so it's accessible on your local network
   - Access Config UI from other devices: `http://<PI_IP_ADDRESS>:8581`
   - HomeKit will discover Homebridge on your local network automatically

3. **Finding your Pi's IP address:**
```bash
hostname -I
# or
ip addr show | grep "inet " | grep -v 127.0.0.1
```

**Platform Note:** The docker-compose.yml is configured for Raspberry Pi 5 (`platform: linux/arm64`). If you're using:
- Raspberry Pi 2/3 or Pi 4 with 32-bit OS: Change to `platform: linux/arm/v7`
- Different architecture: Change to `platform: linux/amd64` or remove the platform line

### Starting Homebridge

1. **Start Homebridge container:**
```bash
docker-compose up -d
```

2. **View logs:**
```bash
docker-compose logs -f homebridge
```

3. **Stop Homebridge:**
```bash
docker-compose down
```

4. **Restart Homebridge:**
```bash
docker-compose restart homebridge
```

### Accessing Homebridge

- **Config UI**: Open `http://localhost:8581` in your browser
- **Homebridge**: The bridge will be available on port 51826

### Initial Setup

1. When you first start Homebridge, you'll need to:
   - Open the Config UI at `http://localhost:8581`
   - Complete the initial setup wizard
   - Add Homebridge to your HomeKit app using the QR code or PIN

2. **Configure Plugins** (if not already in config.json):
   - The `homebridge-dummy` plugin provides the switch that gets toggled
   - The `homebridge-http-webhooks` plugin receives webhook calls from the prayer times script

### Configuration Files

- `docker-compose.yml`: Docker Compose configuration
- `homebridge/config.json`: Homebridge configuration with:
  - Dummy Switch accessory ("Prayer Times Switch")
  - HTTP WebHooks platform (port 51828, accessory ID: "dailyScene")

### Updating Configuration

1. Edit `homebridge/config.json` as needed
2. Restart the container:
```bash
docker-compose restart homebridge
```

### Troubleshooting Docker

**Container won't start:**
- Check if ports are already in use: `netstat -tulpn | grep -E '51826|51828|8581'`
- Check Docker logs: `docker-compose logs homebridge`

**Plugins not loading:**
- Check the Homebridge logs in the Config UI
- Verify `homebridge/package.json` has the correct plugin dependencies
- Restart the container after adding new plugins

**Webhook not working:**
- Verify the webhook port (51828) is accessible
- Check that `ACCESSORY_ID` in `timings.ts` (or `.env`) matches the `id` in `homebridge/config.json`
- If Homebridge is in Docker, ensure `HOME_BRIDGE_HOST` points to the correct address
- Test the webhook manually: `curl "http://localhost:51828/?accessoryId=dailyScene&state=true"`

### Network Configuration

**Raspberry Pi (Recommended Setup):**
- Both prayer times script and Homebridge run on the same Pi
- Use `HOME_BRIDGE_HOST = '127.0.0.1'` or `'localhost'` in `.env` or `timings.ts`
- Webhook calls stay local (no network traffic)
- Homebridge is accessible on your network for HomeKit via `network_mode: host`

**If running the prayer times script on a different machine:**
1. Update `HOME_BRIDGE_HOST` in `.env` or `timings.ts` to the Raspberry Pi's IP address
2. Ensure the Pi's firewall allows connections on port 51828:
   ```bash
   sudo ufw allow 51828/tcp
   ```
3. Test connectivity: `curl "http://<PI_IP>:51828/?accessoryId=dailyScene&state=true"`

**Note:** Since the Docker Compose uses `network_mode: host`, the webhook port (51828) is directly accessible on the Pi. This is ideal for Raspberry Pi setups as it simplifies networking.

## Running the Application

**Prerequisite:** Make sure Homebridge is running (see Docker Setup section above) before starting the prayer times script.

### Development (One-time run)

```bash
# Using npm script
npm start

# Or directly with tsx
npx tsx timings.ts

# Or with watch mode for development
npm run dev
```

### Production with PM2

PM2 is recommended for running this application in production as it provides:
- Automatic restarts on crashes
- Process monitoring
- Log management
- Startup script generation

#### Installing PM2

```bash
# Install PM2 globally
npm install -g pm2
```

#### Starting the Application with PM2 (TypeScript)

Since this project uses TypeScript, PM2 needs to use `tsx` to run the TypeScript files directly:

```bash
# Start the application with tsx
pm2 start tsx --name prayer-times -- timings.ts

# Or with additional options
pm2 start tsx --name prayer-times --log-date-format "YYYY-MM-DD HH:mm:ss Z" -- timings.ts

# Alternative: Use npx to ensure tsx is available
pm2 start npx --name prayer-times -- tsx timings.ts
```

**Note:** Make sure `tsx` is installed (it's in `devDependencies`). If you get errors, install it globally:
```bash
npm install -g tsx
```

#### PM2 Management Commands

```bash
# View running processes
pm2 list

# View logs
pm2 logs prayer-times

# View real-time logs
pm2 logs prayer-times --lines 50

# Stop the application
pm2 stop prayer-times

# Restart the application
pm2 restart prayer-times

# Delete the application from PM2
pm2 delete prayer-times

# View process information
pm2 info prayer-times

# Monitor CPU and memory usage
pm2 monit
```

#### PM2 Startup Script (Auto-start on boot)

To automatically start the application when your system boots:

```bash
# Generate startup script
pm2 startup

# This will output a command like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u yourusername --hp /home/yourusername

# Save current PM2 process list
pm2 save
```

After running `pm2 startup` and `pm2 save`, the application will automatically start on system reboot.

#### PM2 Ecosystem File (Recommended for TypeScript)

For TypeScript projects, the `ecosystem.config.cjs` file uses `npx tsx` to ensure `tsx` is found from `node_modules`:

```javascript
module.exports = {
  apps: [{
    name: 'prayer-times',
    script: 'npx',
    args: 'tsx timings.ts',
    interpreter: 'node',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

Then start with:
```bash
pm2 start ecosystem.config.cjs
```

**Note:** The config uses `npx tsx` instead of just `tsx` because `tsx` is a local dependency. If you prefer to install `tsx` globally, you can change it to:
```javascript
script: 'tsx',
args: 'timings.ts',
```

**Troubleshooting:** If you get "Script not found: tsx" error, make sure:
1. You've run `npm install` to install dependencies
2. The ecosystem.config.cjs uses `npx tsx` (as shown above)
3. Or install tsx globally: `npm install -g tsx` and change config to use `script: 'tsx'`

## How It Works

1. **Initial Fetch**: On startup, the application fetches today's prayer times from the Aladhan API
2. **Schedule Creation**: It schedules `setTimeout` timers for each of the 5 prayer times (Fajr, Dhuhr, Asr, Maghrib, Isha)
3. **Daily Refresh**: At midnight, the application:
   - Clears all existing timers
   - Fetches the next day's prayer times
   - Schedules new timers
4. **Trigger Execution**: When a prayer time is reached, it triggers the HomeKit scene via HTTP webhook
5. **Memory Management**: All timers are properly tracked and cleaned up to prevent memory leaks

## Troubleshooting

### Application not scheduling times

- Check that the API is returning valid data: `curl "YOUR_API_URL"`
- Verify the prayer time format in the API response matches "HH:mm"
- Check logs: `pm2 logs prayer-times`

### Timers not firing

- Verify system time is correct
- Check that prayer times haven't already passed (times in the past are skipped)
- Review logs for any errors

### Memory issues

- The application includes automatic timer cleanup
- If memory grows, restart with PM2: `pm2 restart prayer-times`
- Monitor memory: `pm2 monit`

### PM2 issues

- If PM2 doesn't start on boot, re-run `pm2 startup` and `pm2 save`
- Check PM2 logs: `pm2 logs`
- Verify PM2 is running: `pm2 status`

## API Reference

This application uses the [Aladhan Prayer Times API](https://aladhan.com/prayer-times-api).

### Response Format

The API returns prayer times in the following format:

```json
{
  "data": {
    "timings": {
      "Fajr": "06:14",
      "Dhuhr": "12:25",
      "Asr": "14:59",
      "Maghrib": "17:18",
      "Isha": "18:36"
    }
  }
}
```

## License

ISC

## Contributing

Feel free to submit issues and enhancement requests!

