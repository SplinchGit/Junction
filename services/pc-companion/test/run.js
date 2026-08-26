"use strict";

// Loading node:test suites directly keeps validation usable in locked-down
// Windows environments that deny the test runner permission to spawn workers.
require("./protocol.test");
require("./app.test");
