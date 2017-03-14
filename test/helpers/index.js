/*
 * helpers.js: Test helpers for winston
 *
 * (C) 2010 Charlie Robbins
 * MIT LICENSE
 *
 */

var assume = require('assume'),
    fs = require('fs'),
    path = require('path'),
    through = require('through2'),
    spawn = require('child_process').spawn,
    stream = require('stream'),
    util = require('util'),
    winston = require('../../lib/winston');

var helpers = exports;

/**
 * Returns a new winston.Logger instance which will invoke
 * the `write` method on each call to `.log`
 *
 * @param {function} write Write function for the specified stream
 * @returns {Logger} A winston.Logger instance
 */
helpers.createLogger = function (write) {
  var writeable = new stream.Writable({
    objectMode: true,
    write: write
  });

  return new winston.Logger({
    transports: [
      new winston.transports.Stream({ stream: writeable })
    ]
  });
};

/**
 * Returns a new writeable stream with the specified write function.
 * @param {function} write Write function for the specified stream
 * @returns {stream.Writeable} A writeable stream instance
 */
helpers.writeable = function (write) {
  return new stream.Writable({
    objectMode: true,
    write: write
  });
};

/**
 * Creates a new ExceptionHandler instance with a new
 * winston.Logger instance with the specified options
 *
 * @param {Object} opts Options for the logger associated
 *                 with the ExceptionHandler
 * @returns {ExceptionHandler} A new ExceptionHandler instance
 */
helpers.exceptionHandler = function (opts) {
  var logger = new winston.Logger(opts);
  return new winston.ExceptionHandler(logger);
};

/**
 * Removes all listeners to `process.on('uncaughtException')`
 * and returns an object that allows you to restore them later.
 *
 * @returns {Object} Facade to restore uncaughtException handlers.
 */
helpers.clearExceptions = function () {
  var listeners = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');

  return {
    restore: function () {
      process.removeAllListeners('uncaughtException');
      listeners.forEach(function (fn) {
        process.on('uncaughtException', fn);
      });
    }
  };
};

/**
 * Throws an exception with the specified `msg`
 * @param {String} msg Error mesage to use
 */
helpers.throw = function (msg) {
  throw new Error(msg);
};

/**
 * Attempts to unlink the specifyed `filename` ignoring errors
 * @param {String} File Full path to attempt to unlink.
 */
helpers.tryUnlink = function (filename) {
  try { fs.unlinkSync(filename); }
  catch (ex) { }
};

/**
 * Returns a stream that will emit data for the `filename` if it exists
 * and is capable of being opened.
 * @param  {filename} Full path to attempt to read from.
 * @return {Stream} Stream instance to the contents of the file
 */
helpers.tryRead = function tryRead(filename) {
  var proxy = through();
  (function inner() {
    var stream = fs.createReadStream(filename)
      .once('open', function () {
        stream.pipe(proxy);
      })
      .once('error', function (err) {
        if (err.code === 'ENOENT') {
          return setImmediate(inner);
        }
        proxy.emit('error', err);
      });
  })();

  return proxy;
}

/**
 * Simple test helper which creates an instance
 * of the `colorize` format and asserts that the
 * correct `info` object was processed.
 */
helpers.assumeFormatted = function (format, info, assertion) {
  return function (done) {
    var writeable = helpers.writeable(function (info) {
      assertion(info);
      done();
    });

    format.pipe(writeable);
    format.write(info);
  };
}

/**
 * Assumes the process structure associated with an ExceptionHandler
 * for the `obj` provided.
 * @param  {Object} obj Ordinary object to assert against.
 */
helpers.assertProcessInfo = function (obj) {
  assume(obj.pid).is.a('number');
  assume(obj.uid).is.a('number');
  assume(obj.gid).is.a('number');
  assume(obj.cwd).is.a('string');
  assume(obj.execPath).is.a('string');
  assume(obj.version).is.a('string');
  assume(obj.argv).is.an('array');
  assume(obj.memoryUsage).is.an('object');
};

/**
 * Assumes the OS structure associated with an ExceptionHandler
 * for the `obj` provided.
 * @param  {Object} obj Ordinary object to assert against.
 */
helpers.assertOsInfo = function (obj) {
  assume(obj.loadavg).is.an('array');
  assume(obj.uptime).is.a('number');
};

/**
 * Assumes the trace structure associated with an ExceptionHandler
 * for the `trace` provided.
 * @param  {Object} trace Ordinary object to assert against.
 */
helpers.assertTrace = function (trace) {
  trace.forEach(function (site) {
    assume(!site.column || typeof site.column === 'number').true();
    assume(!site.line || typeof site.line === 'number').true();
    assume(!site.file || typeof site.file === 'string').true();
    assume(!site.method || typeof site.method === 'string').true();
    assume(!site.function || typeof site.function === 'string').true();
    assume(typeof site.native === 'boolean').true();
  });
};

/**
 * Assumes the `logger` provided is a `winston.Logger` at the specified `level`.
 * @param  {Logger} logger `winston` Logger to assert against
 * @param  {String} level Target level logger is expected at.
 */
helpers.assertLogger = function (logger, level) {
  assume(logger).instanceOf(winston.Logger);
  assume(logger.log).is.a('function');
  assume(logger.add).is.a('function');
  assume(logger.remove).is.a('function');
  assume(logger.level).equals(level || 'info');
  Object.keys(logger.levels).forEach(function (method) {
    assume(logger[method]).is.a('function');
  });
};

/**
 * Asserts that the script located at `options.script` logs a single exception
 * (conforming to the ExceptionHandler structure) at the specified `options.logfile`.
 * @param  {Object} options Configuration for this test.
 * @return {function} Test macro asserting that `options.script` performs the
 *                    expected behavior.
 */
helpers.assertHandleExceptions = function (options) {
  return function (done) {
    var child = spawn('node', [options.script]);

    if (process.env.DEBUG) {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stdout);
    }

    helpers.tryUnlink(options.logfile);
    child.on('exit', function () {
      fs.readFile(options.logfile, function (err, data) {
        assume(err).equals(null);
        data = JSON.parse(data);

        assume(data).is.an('object');
        helpers.assertProcessInfo(data.process);
        helpers.assertOsInfo(data.os);
        helpers.assertTrace(data.trace);
        if (options.message) {
          assume(data.message).include('uncaughtException: ' + options.message);
        }

        done();
      });
    });
  };
};

helpers.assertFailedTransport = function (transport) {
  return {
    topic: function () {
      var self = this;
      transport.on('error', function(emitErr){
        transport.log('error', 'test message 2', {}, function(logErr, logged){
          self.callback(emitErr, logErr);
        });
      });
      transport.log('error', 'test message');
    },
    "should emit an error": function (emitErr, logErr) {
      assert.instanceOf(emitErr, Error);
      assert.equal(emitErr.code, 'ENOENT');
    },
    "should enter noop failed state": function (emitErr, logErr) {
      assert.instanceOf(logErr, Error);
      assert.equal(transport._failures, transport.maxRetries);
    }
  };
};

helpers.testNpmLevels = function (transport, assertMsg, assertFn) {
  return helpers.testLevels(winston.config.npm.levels, transport, assertMsg, assertFn);
};

helpers.testSyslogLevels = function (transport, assertMsg, assertFn) {
  return helpers.testLevels(winston.config.syslog.levels, transport, assertMsg, assertFn);
};

helpers.testLevels = function (levels, transport, assertMsg, assertFn) {
  var tests = {};

  Object.keys(levels).forEach(function (level) {
    var test = {
      topic: function () {
        transport.log(level, 'test message', {}, this.callback.bind(this, null));
      }
    };

    test[assertMsg] = assertFn;
    tests['with the ' + level + ' level'] = test;
  });

  var metadatatest = {
    topic: function () {
      transport.log('info', 'test message', { metadata: true }, this.callback.bind(this, null));
    }
  };

  metadatatest[assertMsg] = assertFn;
  tests['when passed metadata'] = metadatatest;

  var primmetadatatest = {
    topic: function () {
      transport.log('info', 'test message', 'metadata', this.callback.bind(this, null));
    }
  };

  primmetadatatest[assertMsg] = assertFn;
  tests['when passed primitive metadata'] = primmetadatatest;

  var circmetadata = { };
  circmetadata['metadata'] = circmetadata;

  var circmetadatatest = {
    topic: function () {
      transport.log('info', 'test message', circmetadata, this.callback.bind(this, null));
    }
  };

  circmetadatatest[assertMsg] = assertFn;
  tests['when passed circular metadata'] = circmetadatatest;

  return tests;
};

helpers.assertOptionsThrow = function (options, errMsg) {
  return function () {
    assert.throws(
      function () {
        try {
          new (winston.transports.Console)(options);
        } catch (err) {
          throw(err);
        }
      },
      new RegExp('^' + errMsg.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$')
    );
  }
};

helpers.assertStderrLevels = function (transport, stderrLevels) {
  return function () {
    assume(JSON.stringify(Object.keys(transport.stderrLevels).sort()))
      .equals(JSON.stringify(stderrLevels.sort()));
  }
};

helpers.testLoggingToStreams = function (levels, transport, stderrLevels, stdMocks) {
  return {
    topic: function () {
      stdMocks.use();
      transport.showLevel = true;
      Object.keys(levels).forEach(function (level) {
        transport.log(
            level,
            level + ' should go to ' + (stderrLevels.indexOf(level) > -1 ? 'stderr' : 'stdout'),
            {},
            function () {}
        );
      });
      var output = stdMocks.flush();
      stdMocks.restore();
      this.callback(null, output, levels);
    },
    "output should go to the appropriate streams": function (ign, output, levels) {
      var outCount = 0,
          errCount = 0;
      Object.keys(levels).forEach(function (level) {
        var line;
        if (stderrLevels.indexOf(level) > -1) {
          line = output.stderr[errCount++];
          assert.equal(line, level + ': ' + level + ' should go to stderr\n');
        } else {
          line = output.stdout[outCount++];
          assert.equal(line, level + ': ' + level + ' should go to stdout\n');
        }
      });
    }
  }
};
