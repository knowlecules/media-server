"use strict";

var fs = require('fs');
var http = require('http');
var lactate = require('lactate');
var rapidRest = require('rapid-rest');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var path = require('path');

/*
 * Media Server options
 * subDirectoryResolver:   A function to resolve the subDirectory based on the image identity.
 *                      Default takes the last 5 bits of the ID. Created Directory names are cached
 * rootDirectory: path to the root Directory for the image files
 */



function MediaServer(options) {
    var self = this;

    function notFound(req, res) {
        res.writeHead(404);
        res.end();
    }

    function subDirectoryResolver(ref) {
        return parseInt((new Buffer(ref)).toString().substr(0,8), 16) & 0x7fff;
    }

    function uniqueNameResolver(ref) {
        self.hMac = crypto.createHmac("md5", 'secret');
        return self.hMac.update(ref).digest('hex');
    }

    function urlToRelativePath(url) {
        var imageId = uniqueNameResolver(url),
            extension = path.extname(url),
            subDirectoryId = subDirectoryResolver(imageId);

        if (subDirectoryId && !(new RegExp("\/" + subDirectoryId + "\/")).test(url)) { //
            return "/" + subDirectoryId + "/" + imageId + extension;
        }
        return url;
    }

    this.opts = {
        "rootDirectory" : options.rootDirectory || "public",
        "match" : "",
        "not_found" : notFound,
        "urlToRelativePath" : options.urlToRelativePath || urlToRelativePath
    };

    if (options.mediaHost) {
        options.not_found = function (req, origRes) {
            var proxyOptions = {
                host: options.mediaHost,
                port: 80,
                path: req.origUrl
            };

            http.get(proxyOptions, function (res) {
                var imageData = '';
                res.setEncoding('binary');
                res.headers = {"content-type": origRes.headers["content-type"], "cache-control": origRes.headers["cache-control"]};

                res.on('data', function (chunk) {
                    imageData += chunk;
                });

                res.on('end', function () {
                    var filePath =  "./" + self.opts.rootDirectory + (req.origUrl ? req.url : this.opts.urlToRelativePath(req.url));
                    mkdirp(filePath.replace(/([\\\/][^\\\/\.]*\.\w*)$/, ""), function (e) {
                        if (!e || (e && e.code === 'EEXIST')) {
                            fs.writeFile(filePath, imageData, 'binary', function (err) {
                                if (err) {
                                    throw err;
                                }
                                self.mediaFiles.serve(req, origRes);
                            });
                        } else {
                            throw e;
                        }
                    });
                });
            });
        };
    }

    if (options) {
        this.set(options);
    }

    this.mediaFiles = lactate.dir(this.opts.rootDirectory, options);

    this.routes = rapidRest();

    // Listen on a port or optionally create a server
    this.listen = function (port, options) {
        if (false === (this instanceof MediaServer)) {
            return new MediaServer(options);
        }
        this.routes.listen(port);
    };

    // Routes to listen for
    this.routeImages = function (routeDesc, fileUidExtractor) {
        if (fileUidExtractor) {
            self.uniqueNameResolver = fileUidExtractor;
        }
        this.routes(routeDesc)('get', function (req, res, params, jsonData) {
            self.serveFile(req, res);
        });
    };

    // Correct path and serve files
    this.serveFile = function (req, res) {
        req.origUrl = req.url;
        req.url = this.opts.urlToRelativePath(req.url);
        self.mediaFiles.serve(req, res);
    };

}
module.exports.MediaServer = MediaServer;

/**
 * Set option
 *
 * @param {String} key
 * @param val
 */
MediaServer.prototype.set = function (key, val) {

    if (typeof key === 'object') {
        var keys = Object.keys(key);
        return keys.forEach(function (opt) {
            this.set(opt, key[opt]);
        }, this);
    }

    key = key.replace(/\s/g, '_');

    if (!this.opts.hasOwnProperty(key)) {
        return;
    }

    this.opts[key] = val;
};
