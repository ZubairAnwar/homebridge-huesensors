# homebridge-huesensors

Enable or disable all Hue Motion Sensors using Siri.  This is useful when you don't want your lights to turn off/on automatically.

Credit goes to huejay for their API wrapper.

This version supports multiple bridges. You will need a username for each bridge and the bridge IP.

You also need to specify which sensors you want to enable and disable. Specify them in the "Filter" array of your config file.

For configuration information see sample-config file.

## Serial number

Each entry in the `accessories` list appears in Apple Home as one switch, which turns the Hue sensors in its `filter` on or off. Apple Home shows the switch's serial number in its settings. Apps that keep their own records per accessory, such as Controller for HomeKit, use it to tell accessories apart, so each switch needs a different one.

If you leave `serialNumber` out, the serial number is `huesensors-` followed by the entry's `name`, for example `huesensors-Hue Sensors`. To choose one yourself, add `serialNumber` to that entry and give each switch a different value:

```json
{
    "accessory": "HueSensors",
    "name": "Hue Sensors",
    "serialNumber": "hue-sensors-downstairs",
    "filter": ["Kitchen sensor"],
    "bridges": [{ "IP": "192.168.x.x", "username": "bridge username" }]
}
```

Only the serial number changes. The switch stays in Apple Home with its room, scenes and automations, because Homebridge tells accessories apart by their `name`, not their serial number. Changing the `name` does make Apple Home treat the switch as a new accessory.
