module.exports = function (RED) {
  var events = require("events");
  var btSerialPort = require("bluetooth-serial-port");

  function SerialPortNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    node.btAddress = config.btAddress;
    node.serialReconnectTime = config.serialReconnectTime * 1000 || 30000;
  }
  RED.nodes.registerType("bt-serial-port", SerialPortNode);

  function btSerialOutNode(n) {
    RED.nodes.createNode(this, n);
    this.btSerial = n.btSerial;
    this.btSerialConfig = RED.nodes.getNode(this.btSerial);

    if (this.btSerialConfig) {
      var node = this;
      node.btPort = btSerialPool.get(this.btSerialConfig);

      node.on("input", function (msg) {
        if (!msg.hasOwnProperty("payload")) { return; } // do nothing unless we have a payload
        if (!node.btPort.port.isOpen()) { return; }

        node.btPort.write(msg.payload, function (err, bytes) {
          if (err) {
            var errmsg = err.toString();
            node.error(errmsg, msg);
          }
        });
      });
      node.btPort.on('ready', function () {
        node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
      });
      node.btPort.on('closed', function () {
        node.status({ fill: "red", shape: "ring", text: "node-red:common.status.not-connected" });
      });
    }
    else {
      this.error("Missing BT Serial Port Config");
    }

    this.on("close", function (done) {
      if (this.btSerialConfig) {
        node.status({ fill: "red", shape: "ring", text: "node-red:common.status.not-connected" });
        btSerialPool.close(this.btSerialConfig.btAddress, done);
      }
      else {
        done();
      }
    });
  }
  RED.nodes.registerType("bt serial out", btSerialOutNode);

  function btSerialInNode(n) {
    RED.nodes.createNode(this, n);
    this.btSerial = n.btSerial;
    this.btSerialConfig = RED.nodes.getNode(this.btSerial);

    if (this.btSerialConfig) {
      var node = this;
      node.status({ fill: "grey", shape: "dot", text: "node-red:common.status.not-connected" });
      node.btPort = btSerialPool.get(this.btSerialConfig);

      node.btPort.on('data', function (msgout) {
        node.send({ payload: msgout });
      });
      node.btPort.on('ready', function () {
        node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
      });
      node.btPort.on('closed', function () {
        node.status({ fill: "red", shape: "ring", text: "node-red:common.status.not-connected" });
      });
    }
    else {
      this.error("Missing BT Serial Port Config");
    }

    this.on("close", function (done) {
      if (this.btSerialConfig) {
        node.status({ fill: "red", shape: "ring", text: "node-red:common.status.not-connected" });
        btSerialPool.close(this.btSerialConfig.btAddress, done);
      }
      else {
        done();
      }
    });
  }
  RED.nodes.registerType("bt serial in", btSerialInNode);


  var btSerialPool = (function () {
    var connections = {};
    return {
      get: function (btSerialConfig) {
        var id = btSerialConfig.btAddress;
        var serialReconnectTime = btSerialConfig.serialReconnectTime;
        if (connections[id]) { return connections[id]; }

        connections[id] = (function () {
          var obj = {
            _emitter: new events.EventEmitter(),
            port: null,
            _closing: false,
            tout: null,
            on: function (a, b) { this._emitter.on(a, b); },
            close: function (cb) { this.port.close(); cb(); },
            write: function (m, cb) { this.port.write(m, cb); },
          }

          var olderr = "";
          var setupBTSerial = function () {
            obj.port = new btSerialPort.BluetoothSerialPort();
            obj.port.findSerialPortChannel(btSerialConfig.btAddress, function (channel) {
              obj.port.connect(btSerialConfig.btAddress,
                channel,
                function () {
                  if (obj.tout) { clearTimeout(obj.tout); obj.tout = null; }
                  olderr = "";
                  RED.log.info(RED._("BTSerial - Open", { port: id }));
                  obj._emitter.emit('ready');

                  obj.port.on('data', function (buffer) {
                    obj._emitter.emit('data', buffer);
                  });

                  obj.port.on('failure', function (err) {
                    RED.log.error(RED._("BTSerial - Failure", { port: id, error: err.toString() }));
                    obj._emitter.emit('closed');
                    if (obj.tout) { clearTimeout(obj.tout); }
                    obj.tout = setTimeout(function () {
                      setupBTSerial();
                    }, serialReconnectTime);
                  });

                  obj.port.on('closed', function (err) {
                    if (!obj._closing) {
                      RED.log.error(RED._("BTSerial - Closed", { port: id }));
                      obj._emitter.emit('closed');
                      if (obj.tout) { clearTimeout(obj.tout); }
                      obj.tout = setTimeout(function () {
                        setupBTSerial();
                      }, serialReconnectTime);
                    }
                  });
                },
                function (err) {
                  if (err.toString() !== olderr) {
                    olderr = err.toString();
                    RED.log.error(`BTSerial - Can't connect '${btSerialConfig.btAddress}' - '${olderr}'`, { port: id, error: olderr });
                  }
                  // obj._emitter.emit('closed');
                  obj.tout = setTimeout(function () {
                    setupBTSerial();
                  }, serialReconnectTime);
                })
            },
              function () {
                RED.log.error(`BTSerial - Didn't find a Serial Port on '${btSerialConfig.btAddress}'`, { port: id, error: olderr });
                obj.tout = setTimeout(function () {
                  setupBTSerial();
                }, serialReconnectTime);
              })
          }
          setupBTSerial();
          return obj;
        }());
        return connections[id];
      },
      close: function (port, done) {
        if (connections[port]) {
          if (connections[port].tout != null) {
            clearTimeout(connections[port].tout);
          }
          connections[port]._closing = true;
          try {
            connections[port].close(function () {
              RED.log.info(RED._("BTSerial - Closed", { port: port }));
              done();
            });
          }
          catch (err) { }
          delete connections[port];
        }
        else {
          done();
        }
      }
    }
  }());
}
