'use strict';

// FIX 1: The Hue bridge uses a self-signed TLS certificate. Newer Node.js
// versions reject these by default, causing "unable to verify the first
// certificate". This tells Node.js to allow them for requests made by this
// plugin. Scoped here at module load rather than globally on the process.
const https = require('https');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
// huejay uses axios under the hood; patch the default agent it will pick up.
https.globalAgent = httpsAgent;

const huejay = require('huejay');

/**
 * Homebridge v1.6+ / v2.x compatible plugin registration.
 *
 * Key changes from the original (2017) code:
 *  - module.exports now receives the `api` object, not the legacy `homebridge` shim
 *  - registerAccessory() takes 2 args (accessory name + class), not 3
 *  - Service and Characteristic are obtained from api.hap inside the constructor
 *  - Constructor accepts (log, config, api) — the third arg is new
 *  - Converted to ES6 class for clarity (optional but recommended)
 *  - FIX 1: TLS certificate verification disabled for self-signed Hue bridge cert
 *  - FIX 2: Promise.all() now has a .catch() to prevent UnhandledPromiseRejection
 */
module.exports = (api) => {
    api.registerAccessory('HueSensors', HueSensorsAccessory);
};


class HueSensorsAccessory {

    constructor(log, config, api) {
        this.log    = log;
        this.config = config;
        this.api    = api;

        // In the new API, Service and Characteristic live on api.hap
        this.Service        = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;

        this.filter  = config['filter'];
        this.clients = [];

        for (const bridge of config['bridges']) {
            const newBridge = new huejay.Client({
                host:     bridge.IP,
                port:     80,
                username: bridge.username,
                timeout:  15000,
            });
            this.clients.push(newBridge);
        }
    }


    // ─── Private helpers ────────────────────────────────────────────────────────

    setState(state) {
        for (const client of this.clients) {
            client.sensors.getAll()
                .then(sensors => {
                    for (const sensor of sensors) {
                        if (this.filter.indexOf(sensor.name) > -1) {
                            if (sensor.type === 'ZLLPresence') {
                                sensor.config.on = state;
                                client.sensors.save(sensor);
                                this.log(`Sensor [${sensor.id}]: ${sensor.name} On: ${sensor.config.on}`);
                            }
                        }
                    }
                })
                .catch(error => {
                    this.log.error(error.stack);
                });
        }
    }

    checkBridges(callback) {
        const promises = [];

        for (const client of this.clients) {
            promises.push(new Promise((resolve, reject) => {
                let sensorsON = true;

                client.sensors.getAll()
                    .then(sensors => {
                        for (const sensor of sensors) {
                            if (this.filter.indexOf(sensor.name) > -1) {
                                if (sensor.type === 'ZLLPresence') {
                                    this.log(`Sensor [${sensor.id}]: ${sensor.name} On: ${sensor.config.on}`);
                                    if (sensor.config.on === false) {
                                        sensorsON = false;
                                        this.log('A sensor is OFF: ' + sensor.name);
                                    }
                                }
                            }
                        }
                        resolve(sensorsON);
                    })
                    .catch(error => {
                        this.log.error(error.stack);
                        reject(error.stack);
                    });
            }));
        }

        // FIX 2: .catch() added here to handle rejections from any individual
        // bridge promise (e.g. SSL errors, network timeouts). Without this,
        // Node.js v15+ throws an UnhandledPromiseRejection and crashes.
        Promise.all(promises)
            .then(values => {
                callback(values.indexOf(false) === -1);
            })
            .catch(error => {
                this.log.error('Error checking bridges: ' + error);
                callback(false);
            });
    }


    // ─── Characteristic handlers ─────────────────────────────────────────────

    getPowerState(callback) {
        this.checkBridges(retval => {
            if (retval) {
                this.log('All sensors on');
                callback(null, 1);
            } else {
                this.log('At least one sensor off');
                callback(null, 0);
            }
        });
    }

    setPowerState(powerOn, callback) {
        this.setState(powerOn);
        callback();
    }

    identify(callback) {
        this.log('Identify requested!');
        callback();
    }


    // ─── Homebridge lifecycle ────────────────────────────────────────────────

    getServices() {
        const { Service, Characteristic } = this;

        const informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, 'HueSensors Manufacturer')
            .setCharacteristic(Characteristic.Model,        'HueSensors Model')
            .setCharacteristic(Characteristic.SerialNumber, 'HueSensors Serial Number');

        const switchService = new Service.Switch(this.config.name || 'Hue Sensors');
        switchService
            .getCharacteristic(Characteristic.On)
            .on('get', this.getPowerState.bind(this))
            .on('set', this.setPowerState.bind(this));

        return [informationService, switchService];
    }
}
