# Homebridge Setup Guide

This guide will help you set up Homebridge with Docker for the Prayer Times scheduler.

## Raspberry Pi Setup

This setup is optimized for Raspberry Pi 5 (ARM64). The Docker Compose configuration is set for `linux/arm64` platform.

**Network Configuration:**
- Since both the prayer times script and Homebridge run on the same Pi, use `127.0.0.1` for webhook calls
- Homebridge is accessible on your network for HomeKit via `network_mode: host`
- No firewall changes needed for local webhook calls (127.0.0.1)

## Quick Start

1. **Start Homebridge:**
```bash
docker-compose up -d
```

2. **Access Config UI:**
   - Open `http://localhost:8581` in your browser
   - Complete the initial setup wizard
   - Note the Homebridge PIN (you'll need this to add it to HomeKit)

3. **Add to HomeKit:**
   - Open the Home app on your iPhone/iPad
   - Tap "+" → "Add Accessory"
   - Scan the QR code or enter the PIN from the Config UI

## Plugin Installation

The required plugins should be automatically installed based on `homebridge/package.json`:

- **homebridge-dummy**: Creates a switch that can be toggled
- **homebridge-http-webhooks**: Receives HTTP webhook calls
- **homebridge-config-ui-x**: Web-based configuration interface

If plugins don't install automatically:

1. Go to the Config UI (`http://localhost:8581`)
2. Navigate to "Plugins"
3. Search and install:
   - `homebridge-dummy`
   - `homebridge-http-webhooks`

## Configuration

### First-Time Setup

When Homebridge starts for the first time, it will generate a new `config.json`. You have two options:

**Option 1: Use the provided config.json**
1. Stop Homebridge: `docker-compose down`
2. Copy the provided `homebridge/config.json` (or merge it with the generated one)
3. Start Homebridge: `docker-compose up -d`

**Option 2: Configure via Config UI**
1. After initial setup, go to Config UI
2. Navigate to "Plugins" → "HttpWebHooks"
3. Configure:
   - Webhook Port: `51828`
   - Add accessory with ID: `dailyScene`
   - Set target accessory: `Prayer Times Switch`
   - Set target property: `On`

### Verify Configuration

1. **Check Dummy Switch:**
   - In HomeKit, you should see "Prayer Times Switch"
   - You can manually toggle it to test

2. **Test Webhook:**
```bash
curl "http://localhost:51828/?accessoryId=dailyScene&state=true"
```
   - This should toggle the "Prayer Times Switch" in HomeKit

3. **Verify in Config UI:**
   - Go to `http://localhost:8581`
   - Check that both plugins are loaded
   - Verify the HttpWebHooks configuration shows `dailyScene`

## Connecting Prayer Times Script

1. **On Raspberry Pi (Recommended):**
```javascript
const HOME_BRIDGE_HOST = '127.0.0.1';  // Both script and Homebridge on same Pi
const WEBHOOK_PORT = 51828;
const ACCESSORY_ID = 'dailyScene';
```
   - This keeps webhook calls local to the Pi
   - No network traffic, faster and more reliable

2. **If running script on different machine:**
```javascript
const HOME_BRIDGE_HOST = '<PI_IP_ADDRESS>';  // Your Raspberry Pi's IP
const WEBHOOK_PORT = 51828;
const ACCESSORY_ID = 'dailyScene';
```
   - Find Pi's IP: `hostname -I` on the Pi
   - Ensure port 51828 is accessible (check firewall on Pi)
   - Test: `curl "http://<PI_IP>:51828/?accessoryId=dailyScene&state=true"`

3. **Test the connection:**
   - Run the prayer times script
   - Check Homebridge logs: `docker-compose logs -f homebridge`
   - Verify webhook calls are received

## Troubleshooting

### Homebridge won't start
- Check Docker is running: `docker ps`
- Check logs: `docker-compose logs homebridge`
- Verify ports aren't in use: `netstat -tulpn | grep -E '51826|51828|8581'`

### Plugins not found
- Check `homebridge/package.json` has the plugins listed
- Restart container: `docker-compose restart homebridge`
- Check logs for plugin installation errors

### Webhook not working
- Verify webhook port in config matches `timings.js` (51828)
- Check accessory ID matches (`dailyScene`)
- Test manually with curl command above
- Check Homebridge logs for webhook requests

### Switch not appearing in HomeKit
- Remove and re-add Homebridge to HomeKit
- Check that the Dummy Switch plugin is installed
- Verify `config.json` has the switch configured

## Advanced Configuration

### Custom Timezone

Edit `docker-compose.yml`:
```yaml
environment:
  - TZ=America/New_York  # Change to your timezone
```

### Persistent Storage

The `homebridge` directory is mounted as a volume, so all configuration persists across container restarts.

### Network Mode

The compose file uses `network_mode: host` for simplicity. This is ideal for Raspberry Pi as it:
- Makes Homebridge directly accessible on your network for HomeKit
- Simplifies webhook access (no port mapping needed)
- Works seamlessly with local webhook calls (127.0.0.1)

For production on Raspberry Pi, this configuration is recommended and secure when on a local network.

## Security Notes

- The webhook endpoint (port 51828) is unauthenticated by default
- Consider restricting access via firewall if on a public network
- The Config UI (port 8581) should be secured in production environments

