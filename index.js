var Service;
var Characteristic;
var Accessory;
var AccessoryType;
var UUIDGen;
var net = require('net');
var http = require('http');
var pollingToEvent = require('polling-to-event');

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.platformAccessory;
    AccessoryType = homebridge.hap.Accessory.Categories;
    UUIDGen = homebridge.hap.uuid;
    //homebridge.registerAccessory("homebridge-rotel-arkku", "RotelA", RotelA);
    homebridge.registerPlatform("homebridge-rotel-arkku", "RotelAmp", RotelAmp);
}

function RotelAmp(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.devices = [];
    this.accessories = [];
    this.name = config["name"];

    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
}

RotelAmp.prototype = {
    accessories: function(callback) {
        callback(this.accessories);
    },
    didFinishLaunching: function() {
        this.log.debug("RotelAmp did finish launching");
        var amplifiers = this.config.accessories;
        this.accessories = []
        this.devices = [];
        for (i = 0; i < amplifiers.length; ++i) {
            var device = new RotelA(this.log, amplifiers[i], this.api, this);
            this.devices.push(device);
            if (device.platformAccessory) {
                device.platformAccessory.reachable = true;
                this.accessories.push(device.platformAccessory);
            }
        }
        this.api.publishExternalAccessories("homebridge-rotel-arkku", this.accessories);
    },
    configureAccessory: function(accessory) {
        this.log("configureAccessory called: %s", accessory);
    }
}

function RotelA(log, config, api, platform) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.platform = platform;
    var that = this;

    this.name = config["name"];
    this.ipAddress = config["ip_address"];
    this.port = config["port"];
    this.uuid = config["uuid"] || UUIDGen.generate("homebridge-rotel-arkku-" + this.name);
    this.interval = config["poll_interval"] || 300;
    this.serialNumber = config["serial_number"] || "00000";
    this.model = config["model"] || "Rotel Amplifier";
    this.isSpeakerSelectionEnabled = !(config["hide_speaker_switches"] || false);
    this.enabledServices = [];
    this.maxInputSource = 0;
    this.inputServiceBySource = {};
    this.inputSourceByIndex = {};
    this.inputIndexBySource = {};
    this.speakerAName = config["speaker_a_name"] || (this.name + " Output A");
    this.speakerBName = config["speaker_b_name"] || (this.name + " Output B");
    this.inputSources = (config["input_sources"] || {
        'opt1': 'Optical 1',
        'opt2': 'Optical 2',
        'coax1': 'Coaxial 1',
        'coax2': 'Coaxial 2',
        'bal_xlr': 'XLR',
        'pc_usb': 'PC USB',
        'usb': 'USB Device',
        'cd': 'CD',
        'phono': 'Phono',
        'tuner': 'Tuner',
        'aux1': 'Aux 1',
        'aux2': 'Aux 2'
    });

    this.usePlatformAccessory = this.platform ? true : false;

    this.attempt = 0;
    this.statePower = 0;
    this.stateVolume = 0;
    this.stateInput = -1;
    this.stateMuted = 0;

    if (this.interval <= 10) {
        this.interval = 11;
    }

    this.log("Rotel init %s (%s:%s) interval %s seconds: %s", this.name, this.ipAddress, this.port, this.interval, this.uuid);

    var statusEmitter = pollingToEvent(function(done) {
        that.getPowerState(function(error, response) {
            that.log.debug("Get power state: %s / %s", error, response);
            done(error, response, that.attempt);
        }, "statuspoll");
    }, {
        longpolling: true,
        interval: that.interval * 1000,
        longpollEventName: "statuspoll_power"
    });

    statusEmitter.on("statuspoll_power", function(data) {
        that.statePower = data;
        if (that.tvService) {
            that.log.debug("Polling power state");
            that.tvService.getCharacteristic(Characteristic.Active).setValue(that.statePower, null, "statuspoll");
        }
    });

    var volumeEmitter = pollingToEvent(function(done) {
        that.getVolume(function(error, response) {
            that.log.debug("Get volume: %s / %s", error, response);
            done(error, response, that.attempt);
        }, "statuspoll");
    }, {
        longpolling: true,
        interval: that.interval * 1000 + 7,
        longpollEventName: "statuspoll_volume"
    });

    statusEmitter.on("statuspoll_volume", function(data) {
        that.stateVolume = data;
        if (that.speakerService) {
            that.log.debug("Polling volume");
            that.speakerService.getCharacteristic(Characteristic.Volume).setValue(that.stateVolume, null, "statuspoll");
        }
    });

    var inputEmitter = pollingToEvent(function(done) {
        that.getInputSource(function(error, response) {
            that.log.debug("Get input: %s / %s", error, response);
            done(error, response, that.attempt);
        }, "statuspoll");
    }, {
        longpolling: true,
        interval: that.interval * 1000 + 11,
        longpollEventName: "statuspoll_input"
    });

    statusEmitter.on("statuspoll_input", function(data) {
        that.stateInput = data;
        if (that.tvService) {
            that.log.debug("Polling input");
            that.tvService.getCharacteristic(Characteristic.ActiveIdentifier).setValue(that.stateInput, null, "statuspoll");
        }
    });

    if (this.isSpeakerSelectionEnabled) {
        var speakerEmitterA = pollingToEvent(function(done) {
            that.getVolume(function(error, response) {
                that.log.debug("Get speaker A: %s / %s", error, response);
                done(error, response, that.attempt);
            }, "statuspoll");
        }, {
            longpolling: true,
            interval: that.interval * 1000 + 11,
            longpollEventName: "statuspoll_speakerA"
        });

        statusEmitter.on("statuspoll_speakerA", function(data) {
            that.stateSpeakerA = data;
            if (that.speakerServiceA) {
                that.log.debug("Polling speaker A state");
                that.speakerServiceA.getCharacteristic(Characteristic.On).setValue(that.stateSpeakerA, null, "statuspoll");
            }
        });

        var speakerEmitterB = pollingToEvent(function(done) {
            that.getVolume(function(error, response) {
                that.log.debug("Get speaker B: %s / %s", error, response);
                done(error, response, that.attempt);
            }, "statuspoll");
        }, {
            longpolling: true,
            interval: that.interval * 1000 + 11,
            longpollEventName: "statuspoll_speakerB"
        });

        statusEmitter.on("statuspoll_speakerB", function(data) {
            that.stateSpeakerB = data;
            if (that.speakerServiceB) {
                that.log.debug("Polling speaker B state");
                that.speakerServiceB.getCharacteristic(Characteristic.On).setValue(that.stateSpeakerB, null, "statuspoll");
            }
        });
    }

    this.prepareServices();
}

RotelA.prototype = {
    setPowerState: function(state, callback, context) {
        if (context && context == "statuspoll") {
            callback(null, this.statePower);
            return;
        }
		var that = this;
		this.doRequest("power " + (state ? "on" : "off"), function(result) {
			if (result != null) {
				that.statePower = state;
				that.log("Set power state: %s %s", that.statePower, result);
                if (that.tvService) {
                    // Force a status update on the service
                    that.tvService.getCharacteristic(Characteristic.Active)
                        .setValue(that.statePower, null, "statuspoll");
                }
			} else {
				that.log("Failed to set power " + (state ? "on" : "off"));
            }
			callback(null, that.statePower);
		});
    },

    getPowerState: function(callback, context) {
        if (!(context && context == "statuspoll")) {
            callback(null, this.statePower);
            return;
        }
        this.log.debug("Get power state");
		var that = this;
		this.doRequest("? on", function(result) {
            var gotState = result ? 1 : 0;
            if (gotState != that.statePower) {
                that.statePower = gotState;
                that.log("Got power state: %s", result);
            }
			callback(null, that.statePower);
		});
    },

    pressRemoteButton: function(remoteKey, callback, context) {
        var button = "";
        var that = this;
        switch (remoteKey) {
        case Characteristic.RemoteKey.REWIND:
            button = "fast_back";
            break;
        case Characteristic.RemoteKey.FAST_FORWARD:
            button = "fast_fwd";
            break;
        case Characteristic.RemoteKey.NEXT_TRACK:
            button = "track_fwd";
            break;
        case Characteristic.RemoteKey.PREVIOUS_TRACK:
            button = "track_back";
            break;
        case Characteristic.RemoteKey.ARROW_UP:
            this.volumeIncrement(true, null, context);
            break;
        case Characteristic.RemoteKey.ARROW_DOWN:
            this.volumeIncrement(false, null, context);
            break;
        case Characteristic.RemoteKey.ARROW_LEFT:
            button = "left";
            break;
            /*
            var targetInput = this.stateInput - 1;
            if (targetInput < 1) {
                targetInput = this.maxInputSource;
            }
            this.setInputSource(targetInput, (x, src) => {
                if (src) {
                    that.log.debug("Switched to next previous input: %s", src);
                    that.stateInput = src;
                    if (that.tvService) {
                        that.tvService.getCharacteristic(Characteristic.ActiveIdentifier).setValue(that.stateInput, null, "statuspoll");
                    }
                }
                callback(null, remoteKey);
            }, context);
            return;
            */
        case Characteristic.RemoteKey.ARROW_RIGHT:
            button = "right";
            break;
            /*
            var targetInput = this.stateInput + 1;
            if (targetInput > this.maxInputSource) {
                targetInput = 1;
            }
            this.setInputSource(targetInput, (x, src) => {
                if (src) {
                    that.log.debug("Switched to next input: %s", src);
                    that.stateInput = src;
                    if (that.tvService) {
                        that.tvService.getCharacteristic(Characteristic.ActiveIdentifier).setValue(that.stateInput, null, "statuspoll");
                    }
                }
                callback(null, remoteKey);
            }, context);
            return;
            */
        case Characteristic.RemoteKey.SELECT:
            button = "enter";
            break;
        case Characteristic.RemoteKey.BACK:
            button = "exit";
            break;
        case Characteristic.RemoteKey.EXIT:
            button = "exit";
            break;
        case Characteristic.RemoteKey.PLAY_PAUSE:
            button = "pause";
            break;
        case Characteristic.RemoteKey.INFORMATION:
            button = "menu";
            break;
        default:
            button = "";
            break;
        }
        if (button != "") {
            this.sendButton(button);
        }
        callback(null, remoteKey);
    },

    pressSettingsButton: function(state, callback, context) {
        this.sendButton("menu");
        callback(null, state);
    },

    sendButton(button) {
        var that = this;
        this.doRequest("key " + button, function(result) {
            that.log.debug("Sent remote button %s: %s", button, result);
        });
    },

    pressVolumeButton: function(isDown, callback, context) {
        var volume = this.stateVolume;
        if (isDown) {
            volume -= 2;
        } else {
            volume += 2;
        }
        if (volume < 0) {
            volume = 0;
        } else if (volume > 100) {
            volume = 100;
        }
		if (volume != this.stateVolume) {
            this.setVolume(volume, callback, context);
		} else {
            callback(null, this.stateVolume);
		}
    },

    getVolume: function(callback, context) {
        if (!(context && context == "statuspoll")) {
            callback(null, this.stateVolume);
            return;
        }
		var that = this;
        this.log.debug("Get volume");
		this.doRequest("? vol", function(result) {
			if (result != null && result >= 0 && result <= 100) {
				that.stateVolume = result;
			}
			that.log.debug("Got volume: %s", that.stateVolume);
			callback(null, that.stateVolume);
		});
    },

    setVolume: function(volume, callback, context) {
        if (context && context == "statuspoll") {
            callback(null, this.stateVolume);
            return;
        }
		var that = this;
		this.doRequest("vol " + volume, function(result) {
			if (result) {
				that.stateVolume = volume;
				that.log.debug("Set volume: %s %s", that.stateVolume, result);
			}
			callback(null, that.stateVolume);
		});
    },

    volumeIncrement: function(isUp, callback, context) {
		var that = this;
		this.doRequest("vol " + (isUp ? "up" : "down"), function(result) {
			if (result != null && result >= 0 && result <= 100) {
				that.stateVolume = result;
                that.speakerService.getCharacteristic(Characteristic.Volume).setValue(that.stateVolume, null, "statuspoll");
			}
            if (callback) {
                callback(null, that.stateVolume);
            }
		});
    },

    getMuted: function(callback, context) {
        if (!(context && context == "statuspoll")) {
            callback(null, this.stateMuted);
            return;
        }
        this.log.debug("Get muted");
		var that = this;
		this.doRequest("? mute", function(result) {
			if (result != null) {
                that.stateMuted = result ? 1 : 0;
                that.log.debug("Got muted state: ", result);
			}
			callback(null, that.stateMuted);
		});
    },

    setMuted: function(muted, callback, context) {
        if (context && context == "statuspoll") {
            callback(null, this.stateMuted);
            return;
        }
		var that = this;
		this.doRequest("mute " + (muted ? "on" : "off"), function(result) {
			if (result != null) {
                that.stateMuted = result ? 1 : 0;
                that.log("Set muted state: ", result);
			}
			callback(null, that.stateMuted);
		});
    },

    getInputSource: function(callback, context) {
        this.log.debug("Get input source");
		var that = this;
		this.doRequest("? source", function(result) {
			if (result) {
				var inputSource = that.inputIndexBySource[result];
				if (inputSource) {
					that.stateInput = inputSource;
					that.log.debug("Got input source: %s %s", that.stateInput, that.inputSourceByIndex[that.stateInput]);
				}
			}
			callback(null, that.stateInput);
		});
    },

    setInputSource: function(source, callback, context) {
        var sourceId = this.inputSourceByIndex[source];
        if ((context && context == "statuspoll") || !sourceId) {
            callback(null, this.stateInput);
            return;
        }
		var that = this;
		this.doRequest("source " + sourceId, function(result) {
			if (result) {
				that.stateInput = source;
				that.log("Set input source: %s %s %s", that.stateInput, that.inputSourceByIndex[that.stateInput], result);
			}
			callback(null, that.stateInput);
		});
    },

    getSpeakerStateA: function(callback, context) {
        this.log.debug("Get speaker state A");
		var that = this;
		this.doRequest("? a", function(result) {
			if (result != null) {
                that.stateSpeakerA = result;
                that.log.debug("Got speaker state A: %s", that.stateSpeakerA);
			}
			callback(null, that.stateSpeakerA);
		});
    },

    setSpeakerStateA: function(state, callback, context) {
        if ((context && context == "statuspoll")) {
            callback(null, this.stateInput);
            return;
        }
		var that = this;
		this.doRequest("a " + state, function(result) {
			if (result != null) {
				that.stateSpeakerA = state;
				that.log("Set speaker state A: %s", that.stateSpeakerA);
			}
			callback(null, that.stateSpeakerA);
		});
    },

    getSpeakerStateB: function(callback, context) {
        this.log.debug("Get speaker state B");
		var that = this;
		this.doRequest("? b", function(result) {
			if (result != null) {
                that.stateSpeakerB = result;
                that.log.debug("Got speaker state B: %s", that.stateSpeakerB);
			}
			callback(null, that.stateSpeakerB);
		});
    },

    setSpeakerStateB: function(state, callback, context) {
        if ((context && context == "statuspoll")) {
            callback(null, this.stateInput);
            return;
        }
		var that = this;
		this.doRequest("b " + state, function(result) {
			if (result != null) {
				that.stateSpeakerB = state;
				that.log("Set speaker state B: %s", that.stateSpeakerB);
			}
			callback(null, that.stateSpeakerB);
		});
    },

    identify: function(callback) {
        this.log.debug("Identify called " + this.name);
        callback();
    },

    prepareServices: function() {
        var that = this;
        var fullName = this.name;

        if (this.usePlatformAccessory) {
            fullName = this.platform.name + ' ' + this.name;
            this.log("Setting up as a platform accessory: %s", fullName);
            this.platformAccessory = new Accessory(fullName, this.uuid, AccessoryType.TELEVISION);
            this.informationService = this.platformAccessory.getService(Service.AccessoryInformation);
        } else {
            this.platformAccessory = null;
            this.informationService = new Service.AccessoryInformation();
            this.informationService
                .setCharacteristic(Characteristic.Name, this.name);
            this.enabledServices.push(this.informationService);
        }

        this.informationService
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.Manufacturer, 'Rotel')
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.serialNumber);

        this.tvService = new Service.Television(this.name, this.name + 'TV');
        this.tvService
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE)
            .setCharacteristic(Characteristic.ActiveIdentifier, this.stateInput)
            .setCharacteristic(Characteristic.Active, this.statePower);

        this.tvService.getCharacteristic(Characteristic.Active)
            .on('get', this.getPowerState.bind(this))
            .on('set', this.setPowerState.bind(this));
        this.tvService.getCharacteristic(Characteristic.RemoteKey)
            .on('set', this.pressRemoteButton.bind(this));
        this.tvService.getCharacteristic(Characteristic.PowerModeSelection)
            .on('set', this.pressSettingsButton.bind(this));
        this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
            .on('get', this.getInputSource.bind(this))
            .on('set', this.setInputSource.bind(this));
        this.enabledServices.push(this.tvService);

        this.speakerService = new Service.TelevisionSpeaker(this.name + ' Volume', this.name + 'Speaker');
        this.speakerService
            .setCharacteristic(Characteristic.Name, this.name + ' Volume')
            .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
            .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
        this.speakerService
            .getCharacteristic(Characteristic.Mute)
            .on('get', this.getMuted.bind(this))
            .on('set', this.setMuted.bind(this));
        this.speakerService
            .getCharacteristic(Characteristic.VolumeSelector)
            .on('set', this.pressVolumeButton.bind(this));
        this.speakerService
            .addCharacteristic(Characteristic.Volume)
            .on('get', this.getVolume.bind(this))
            .on('set', this.setVolume.bind(this));
        this.tvService.addLinkedService(this.speakerService);
        this.enabledServices.push(this.speakerService);

        this.inputSourceByIndex = { };
        this.inputIndexBySource = { };
        var sourceIndex = 0;
        for (var sourceId in this.inputSources) {
            sourceIndex++;
            var sourceName = this.inputSources[sourceId] || sourceId;

            this.inputSourceByIndex[sourceIndex] = sourceId;
            this.inputIndexBySource[sourceId] = sourceIndex;
            this.log("Input %s is %s: %s", sourceIndex, sourceId, sourceName);

            var inputSource = new Service.InputSource(this.name, this.name + 'Input' + sourceId.toUpperCase());
            inputSource
                .setCharacteristic(Characteristic.Identifier, sourceIndex)
                .setCharacteristic(Characteristic.Name, this.name + ' ' + sourceId + ' in')
                .setCharacteristic(Characteristic.ConfiguredName, sourceName)
                .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
                .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
            this.tvService.addLinkedService(inputSource);

            this.inputServiceBySource[sourceId] = inputSource;
            this.enabledServices.push(inputSource);
        }

        if (this.isSpeakerSelectionEnabled) {
            this.speakerServiceA = new Service.Switch(this.name + ' Output A', this.name + 'SpeakerA');
            this.speakerServiceB = new Service.Switch(this.name + ' Output B', this.name + 'SpeakerB');

            this.speakerServiceA
                .getCharacteristic(Characteristic.On)
                .on('get', this.getSpeakerStateA.bind(this))
                .on('set', this.setSpeakerStateA.bind(this));
            this.speakerServiceA
                .setCharacteristic(Characteristic.Name, this.speakerAName);
            this.enabledServices.push(this.speakerServiceA);

            this.speakerServiceB
                .getCharacteristic(Characteristic.On)
                .on('get', this.getSpeakerStateB.bind(this))
                .on('set', this.setSpeakerStateB.bind(this));
            this.speakerServiceB
                .setCharacteristic(Characteristic.Name, this.speakerBName);
            this.enabledServices.push(this.speakerServiceB);
        }

        this.maxInputSource = sourceIndex;

        if (this.platformAccessory) {
            for (var i = 0; i < this.enabledServices.length; ++i) {
                var service = this.enabledServices[i];
                this.log.debug("Adding service: %s", service);
                try {
                    this.platformAccessory.addService(service);
                } catch (error) {
                    this.log("Failed to add service: %s\nFailed service: %s", error, service);
                }
            }
        }

        return this.enabledServices;
    },

    getServices: function() {
        return this.enabledServices;
    },

	doRequest: function(request, callback) {
		var client = new net.Socket();
		var port = this.port;
		var host = this.ipAddress;
		var log = this.log;
        var didTimeout = false;
        var results = "";

        client.setTimeout(8000, function() {
            log.debug("Request timed out (%s)", request);
            didTimeout = true;
            client.end();
        });

        client.connect(port, host, function() {  
            log.debug("Sending: %s", request);
            client.write(request + "\n");  
        });  
    
        client.on('data', function(data) {  
            log.debug("Read (%s): %s", request, data);
            results += data || "";
            client.end();
        });

        client.on('close', function() {  
            var result = ((results || "") + "").trim();
            var numericResult = /^[-]?\d+$/.test(result) ? Number(result) : NaN;
            if (result === "") {
                result = null;
            } else if (!isNaN(numericResult)) {
                result = numericResult;
            } else if (result == "true" || result == "on") {
                result = 1;
            } else if (result == "false" || result == "off") {
                result = 0;
            }
            log.debug("Close request (%s): %s", request, result);
            callback(result);
        });
    
        client.on('error', function() {  
            if (!didTimeout) {
                log("Request error (%s)", request);
                client.end();
            }
        });

        //client.on('end', function() {  
        //    log("End request (%s): %s", request, results);
        //});
	}
};
