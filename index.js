'use strict';

const https = require('https');

// The Hue Bridge uses a self-signed TLS certificate. We create a dedicated
// agent that skips verification, used only for requests in this plugin.
const hueAgent = new https.Agent({ rejectUnauthorized: false });

module.exports = (api) => {
    api.registerAccessory('HueSensors', HueSensorsAccessory);
};


class HueSensorsAccessory {

    constructor(log, config, api) {
        this.log    = log;
        this.config = config;
        this.api    = api;

        this.Service        = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;

        this.filter  = config['filter'];   // e.g. ["Living Room Sensor"]
        this.bridges = config['bridges'];  // e.g. [{IP, username}]
    }


    // ─── Hue API v2 helpers ──────────────────────────────────────────────────

    hueRequest(bridge, method, path, body = null) {
        return new Promise((resolve, reject) => {
            const bodyStr = body ? JSON.stringify(body) : null;

            const options = {
                hostname: bridge.IP,
                port:     443,
                path:     `/clip/v2${path}`,
                method:   method,
                headers:  {
                    'hue-application-key': bridge.username,
                    'Content-Type':        'application/json',
                    ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
                },
                agent: hueAgent,
            };

            const req = https.request(options, (res) => {
                let raw = '';
                res.on('data', chunk => raw += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed.errors && parsed.errors.length > 0) {
                            reject(new Error(parsed.errors[0].description));
                        } else {
                            resolve(parsed.data || []);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse bridge response: ${raw}`));
                    }
                });
            });

            req.on('error', reject);
            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }

    async getFilteredMotionSensors(bridge) {
        const [devices, motions] = await Promise.all([
            this.hueRequest(bridge, 'GET', '/resource/device'),
            this.hueRequest(bridge, 'GET', '/resource/motion'),
        ]);

        const deviceNames = {};
        for (const device of devices) {
            deviceNames[device.id] = device.metadata?.name;
        }

        const matched = [];
        for (const motion of motions) {
            const ownerName = deviceNames[motion.owner?.rid];
            if (ownerName && this.filter.includes(ownerName)) {
                matched.push({
                    bridge,
                    motionId: motion.id,
                    name:     ownerName,
                    enabled:  motion.enabled,
                });
            }
        }
        return matched;
    }

    async getAllFilteredMotionSensors() {
        const results = await Promise.all(
            this.bridges.map(bridge => this.getFilteredMotionSensors(bridge))
        );
        return results.flat();
    }


    // ─── Homebridge lifecycle ────────────────────────────────────────────────

    getServices() {
        const { Service, Characteristic } = this;

        const informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, 'Signify')
            .setCharacteristic(Characteristic.Model,        'Hue Motion Sensor')
            .setCharacteristic(Characteristic.SerialNumber, 'homebridge-huesensors');

        const switchService = new Service.Switch(this.config.name || 'Hue Sensors');

        // Use the promise-based onGet/onSet handlers (Homebridge 1.3+).
        // The old callback-based .on('get') / .on('set') pattern causes HomeKit
        // to sometimes skip calling 'set' if it believes the state hasn't changed,
        // which is why toggling the switch had no effect.
        switchService.getCharacteristic(Characteristic.On)
            .onGet(async () => {
                const sensors = await this.getAllFilteredMotionSensors();
                if (sensors.length === 0) {
                    this.log.warn('No matching sensors found — check filter names match the Hue app exactly');
                    return false;
                }
                const allOn = sensors.every(s => s.enabled);
                for (const sensor of sensors) {
                    this.log(`Sensor "${sensor.name}": enabled=${sensor.enabled}`);
                }
                return allOn;
            })
            .onSet(async (value) => {
                this.log(`Setting all filtered sensors to enabled=${value}`);
                const sensors = await this.getAllFilteredMotionSensors();
                if (sensors.length === 0) {
                    this.log.warn('No matching sensors found — nothing to set');
                    return;
                }
                await Promise.all(
                    sensors.map(sensor =>
                        this.hueRequest(
                            sensor.bridge,
                            'PUT',
                            `/resource/motion/${sensor.motionId}`,
                            { enabled: Boolean(value) }
                        )
                        .then(() => {
                            this.log(`Sensor "${sensor.name}": set enabled=${Boolean(value)}`);
                        })
                        .catch(error => {
                            this.log.error(`Failed to update "${sensor.name}": ${error.message}`);
                        })
                    )
                );
            });

        return [informationService, switchService];
    }
}
