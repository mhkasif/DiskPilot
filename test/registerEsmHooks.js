'use strict';
// require() this before importing renderer modules. module.register() exists since Node 20.6
// and needs an absolute URL for the hooks file (a relative specifier fails on 20.6).
const path = require('node:path');
const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register(pathToFileURL(path.join(__dirname, 'esmHooks.mjs')).href);
