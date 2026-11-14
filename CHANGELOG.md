# Changelog

## 0.2.1 (2026-11-14)

- Each switch now has its own serial number, `huesensors-<name>`, instead of the same `homebridge-huesensors` on every switch. An optional `serialNumber` config setting overrides it. After updating and restarting Homebridge, existing switches show the new serial number and stay paired in Apple Home.

## 0.2.0 (2026-04-01)

- Uses the Hue API v2, for the Hue Bridge Pro, and works with current Homebridge versions.
