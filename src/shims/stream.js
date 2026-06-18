const EventEmitter = require("events");

class Stream extends EventEmitter {
  constructor() {
    super();
  }
}

class Readable extends Stream {
  constructor() {
    super();
  }
}

class Writable extends Stream {
  constructor() {
    super();
  }
}

class Duplex extends Stream {
  constructor() {
    super();
  }
}

class Transform extends Duplex {
  constructor() {
    super();
  }
}

class PassThrough extends Transform {
  constructor() {
    super();
  }
}

Stream.Readable = Readable;
Stream.Writable = Writable;
Stream.Duplex = Duplex;
Stream.Transform = Transform;
Stream.PassThrough = PassThrough;
Stream.Stream = Stream;

module.exports = Stream;
module.exports.Readable = Readable;
module.exports.Writable = Writable;
module.exports.Duplex = Duplex;
module.exports.Transform = Transform;
module.exports.PassThrough = PassThrough;
module.exports.Stream = Stream;
module.exports.default = Stream;
