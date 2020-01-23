/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */
(function () {
    /* global require, exports, module */
    /* global FILESYSTEM_PREFIX */
    /* global FileReader */
    /* global atob, btoa, Blob */

    if (window.require === undefined) {
        console.error(
            'Electron Node.js integration is disabled, you can not use cordova-file-plugin without it\n' +
            'Check docs how to enable Node.js integration: https://cordova.apache.org/docs/en/latest/guide/platforms/electron/#quick-start'
        );
        return;
    }

    const nodeRequire = global.require;
    const nodePath = nodeRequire('path');
    const fs = nodeRequire('fs');
    const app = nodeRequire('electron').remote.app;

    const LocalFileSystem = require('./LocalFileSystem');
    const FileSystem = require('./FileSystem');
    const FileEntry = require('./FileEntry');
    const FileError = require('./FileError');
    const DirectoryEntry = require('./DirectoryEntry');
    const File = require('./File');

    (function (exports, global) {
        var indexedDB = global.indexedDB || global.mozIndexedDB;
        if (!indexedDB) {
            throw 'Firefox OS File plugin: indexedDB not supported';
        }

        var fs_ = null;

        var idb_ = {};
        idb_.db = null;
        var FILE_STORE_ = 'entries';

        var DIR_SEPARATOR = '/';

        // https://github.com/electron/electron/blob/master/docs/api/app.md#appgetpathname
        const pathsPrefix = {
            applicationDirectory: app.getAppPath(),
            dataDirectory: app.getPath('userData'),
            cacheDirectory: app.getPath('cache'),
            tempDirectory: app.getPath('temp'),
            documentsDirectory: app.getPath('documents')
        };

        var unicodeLastChar = 65535;

    /** * Exported functionality ***/

        // list a directory's contents (files and folders).
        exports.readEntries = function (successCallback, errorCallback, args) {
            const fullPath = args[0];

            if (typeof successCallback !== 'function') {
                throw Error('Expected successCallback argument.');
            }

            fs.readdir(fullPath, {withFileTypes: true}, (err, files) => {
                if (err) {
                    if (errorCallback) {
                        errorCallback(FileError.NOT_FOUND_ERR);
                    }
                    return;
                }
                const result = [];
                files.forEach(d => {
                    let path = fullPath + d.name;
                    if (d.isDirectory()) {
                        path += nodePath.sep;
                    }
                    result.push({
                        isDirectory: d.isDirectory(),
                        isFile: d.isFile(),
                        name: d.name,
                        fullPath: path,
                        filesystemName: 'temporary',
                        nativeURL: path
                    });
                });
                successCallback(result);
            });
        };

        exports.getFile = function (successCallback, errorCallback, args) {
            const path = args[0] + args[1];
            const options = args[2] || {};
            const exists = fs.existsSync(path);
            const baseName = nodeRequire('path').basename(path);

            function createFile() {
                fs.open(path, 'w', (err, fd) => {
                    if (err) {
                        if (errorCallback) {
                            errorCallback(FileError.INVALID_STATE_ERR);
                        }
                        return;
                    }
                    fs.close(fd, (err) => {
                        if (err) {
                            if (errorCallback) {
                                errorCallback(FileError.INVALID_STATE_ERR);
                            }
                            return;
                        }
                        successCallback(new FileEntry(baseName, path));
                    });
                })
            }

            if (options.create === true && options.exclusive === true && exists) {
                // If create and exclusive are both true, and the path already exists,
                // getFile must fail.
                if (errorCallback) {
                    errorCallback(FileError.PATH_EXISTS_ERR);
                }
            } else if (options.create === true && !exists) {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getFile must create it as a zero-length file and return a corresponding
                // FileEntry.
                createFile();
            } else if (options.create === true && exists) {
                if (fs.statSync(path).isFile()) {
                    // Overwrite file, delete then create new.
                    createFile();
                } else {
                    if (errorCallback) {
                        errorCallback(FileError.INVALID_MODIFICATION_ERR);
                    }
                }
            } else if (!options.create && !exists) {
                // If create is not true and the path doesn't exist, getFile must fail.
                if (errorCallback) {
                    errorCallback(FileError.NOT_FOUND_ERR);
                }
            } else if (!options.create && exists && fs.statSync(path).isDirectory()) {
                // If create is not true and the path exists, but is a directory, getFile
                // must fail.
                if (errorCallback) {
                    errorCallback(FileError.TYPE_MISMATCH_ERR);
                }
            } else {
                // Otherwise, if no other error occurs, getFile must return a FileEntry
                // corresponding to path.
                successCallback(new FileEntry(baseName, path));
            }
        };

        exports.getFileMetadata = function (successCallback, errorCallback, args) {
            const fullPath = args[0];
            fs.stat(fullPath, (err, stats) => {
                if (err) {
                    if (errorCallback) {
                        errorCallback(FileError.NOT_FOUND_ERR);
                    }
                    return;
                }
                const baseName = nodeRequire('path').basename(fullPath);
                successCallback(new File(baseName, fullPath, '', stats.mtime, stats.size));
            });
        };

        exports.getMetadata = function (successCallback, errorCallback, args) {
            fs.stat(args[0], (err, stats) => {
                if (err) {
                    if (errorCallback) {
                        errorCallback(FileError.NOT_FOUND_ERR);
                    }
                    return;
                }
                successCallback({
                    modificationTime: stats.mtime,
                    size: stats.size
                });
            });
        };

        exports.setMetadata = function (successCallback, errorCallback, args) {
            var fullPath = args[0];
            var metadataObject = args[1];

            fs.utime(fullPath, metadataObject.modificationTime, metadataObject.modificationTime, (err) => {
                if (err) {
                    if (errorCallback) {
                        errorCallback(FileError.NOT_FOUND_ERR);
                        return;
                    }
                    successCallback();
                }
            });
        };

        exports.write = function (successCallback, errorCallback, args) {
            const fileName = args[0];
            const data = args[1];
            const position = args[2];
            const isBinary = args[3]; // eslint-disable-line no-unused-vars

            if (!data) {
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
                return;
            }

            const buf = Buffer.from(data);
            const promisify = nodeRequire('util').promisify;
            let bytesWritten = 0;
            promisify(fs.open)(fileName, 'a')
                .then(fd => {
                    return promisify(fs.write)(fd, buf, 0, buf.length, position)
                              .then(bw => bytesWritten = bw)
                              .finally(() => promisify(fs.close)(fd));
                })
                .then(() => successCallback(bytesWritten))
                .catch(() => {
                    if (errorCallback) {
                        errorCallback(FileError.INVALID_MODIFICATION_ERR)
                    }
                });
        };

        exports.readAsText = function (successCallback, errorCallback, args) {
            var fileName = args[0];
            var enc = args[1];
            var startPos = args[2];
            var endPos = args[3];

            readAs('text', fileName, enc, startPos, endPos, successCallback, errorCallback);
        };

        exports.readAsDataURL = function (successCallback, errorCallback, args) {
            var fileName = args[0];
            var startPos = args[1];
            var endPos = args[2];

            readAs('dataURL', fileName, null, startPos, endPos, successCallback, errorCallback);
        };

        exports.readAsBinaryString = function (successCallback, errorCallback, args) {
            var fileName = args[0];
            var startPos = args[1];
            var endPos = args[2];

            readAs('binaryString', fileName, null, startPos, endPos, successCallback, errorCallback);
        };

        exports.readAsArrayBuffer = function (successCallback, errorCallback, args) {
            var fileName = args[0];
            var startPos = args[1];
            var endPos = args[2];

            readAs('arrayBuffer', fileName, null, startPos, endPos, successCallback, errorCallback);
        };

        exports.remove = function (successCallback, errorCallback, args) {
            const fullPath = args[0];

            fs.stat(fullPath, (err, stats) => {
                if (err) {
                    if (errorCallback) {
                        errorCallback(FileError.NOT_FOUND_ERR);
                    }
                    return;
                }
                const rm = stats.isDirectory() ? fs.rmdir : fs.unlink;
                rm(fullPath, (err) => {
                    if (err) {
                        if (errorCallback) {
                            errorCallback(FileError.NO_MODIFICATION_ALLOWED_ERR);
                        }
                        return;
                    }
                    successCallback();
                });
            });
        };

        exports.removeRecursively = function (successCallback, errorCallback, args) {
            const fullPath = args[0];

            exports.readEntries((entries) => {
                if (entries.length === 0) {
                    exports.remove(successCallback, errorCallback, [fullPath]);
                }
                entries.forEach(entry => {
                    if (entry.isDirectory) {
                        exports.removeRecursively(() => {
                            exports.remove(() => {
                                exports.remove(successCallback, errorCallback, [fullPath]);
                            }, errorCallback, [entry.fullPath]);
                        }, errorCallback, [entry.fullPath]);
                    } else {
                        exports.remove(successCallback, errorCallback, [entry.fullPath]);
                    }
                });
            }, errorCallback, [fullPath]);
        };

        exports.getDirectory = function (successCallback, errorCallback, args) {
            const path = args[0] + args[1];
            const options = args[2] || {};
            const exists = fs.existsSync(path);
            const baseName = nodeRequire('path').basename(path);

            if (options.create === true && options.exclusive === true && exists) {
                // If create and exclusive are both true, and the path already exists,
                // getDirectory must fail.
                if (errorCallback) {
                    errorCallback(FileError.PATH_EXISTS_ERR);
                }
            } else if (options.create === true && !exists) {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getDirectory must create it as a zero-length file and return a corresponding
                // MyDirectoryEntry.
                fs.mkdir(path, (err) => {
                    if (err) {
                        if (errorCallback) {
                            errorCallback(FileError.PATH_EXISTS_ERR);
                        }
                        return;
                    }
                    successCallback(new DirectoryEntry(baseName, path));
                })
            } else if (options.create === true && exists) {
                if (fs.statSync(path).isDirectory()) {
                    successCallback(new DirectoryEntry(baseName, path));
                } else if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
            } else if (!options.create && !exists) {
                // If create is not true and the path doesn't exist, getDirectory must fail.
                if (errorCallback) {
                    errorCallback(FileError.NOT_FOUND_ERR);
                }
            } else if (!options.create && exists && fs.statSync(path).isFile()) {
                // If create is not true and the path exists, but is a file, getDirectory
                // must fail.
                if (errorCallback) {
                    errorCallback(FileError.TYPE_MISMATCH_ERR);
                }
            } else {
                // Otherwise, if no other error occurs, getDirectory must return a
                // DirectoryEntry corresponding to path.
                successCallback(new DirectoryEntry(baseName, path));
            }
        };

        exports.getParent = function (successCallback, errorCallback, args) {
            if (typeof successCallback !== 'function') {
                throw Error('Expected successCallback argument.');
            }

            const parentPath = nodePath.dirname(args[0]);
            const parentName = nodePath.basename(parentPath);
            const path = nodePath.dirname(parentPath) + nodePath.sep;

            exports.getDirectory(successCallback, errorCallback, [path, parentName, {create: false}]);
        };

        exports.copyTo = function (successCallback, errorCallback, args) {
            const srcPath = args[0];
            const dstDir = args[1];
            const dstName = args[2];

            fs.copyFile(srcPath, dstDir + dstName, (err) => {
                if (err) {
                    if (errorCallback) {
                        errorCallback(FileError.INVALID_MODIFICATION_ERR);
                    }
                    return;
                }
                exports.getFile(successCallback, errorCallback, [dstDir, dstName]);
            });
        };

        exports.moveTo = function (successCallback, errorCallback, args) {
            var srcPath = args[0];
            // parentFullPath and name parameters is ignored because
            // args is being passed downstream to exports.copyTo method
            var parentFullPath = args[1]; // eslint-disable-line
            var name = args[2]; // eslint-disable-line

            exports.copyTo(function (fileEntry) {

                exports.remove(function () {
                    successCallback(fileEntry);
                }, errorCallback, [srcPath]);

            }, errorCallback, args);
        };

        exports.resolveLocalFileSystemURI = function (successCallback, errorCallback, args) {
            let path = args[0];

            // support for encodeURI
            if (/\%5/g.test(path) || /\%20/g.test(path)) {  // eslint-disable-line no-useless-escape
                path = decodeURI(path);
            }

            // support for cdvfile
            if (path.trim().substr(0, 7) === 'cdvfile') {
                if (path.indexOf('cdvfile://localhost') === -1) {
                    if (errorCallback) {
                        errorCallback(FileError.ENCODING_ERR);
                    }
                    return;
                }

                var indexPersistent = path.indexOf('persistent');
                var indexTemporary = path.indexOf('temporary');

                // cdvfile://localhost/persistent/path/to/file
                if (indexPersistent !== -1) {
                    path = pathsPrefix.dataDirectory + path.substr(indexPersistent + 10);
                } else if (indexTemporary !== -1) {
                    path = pathsPrefix.tempDirectory + path.substr(indexTemporary + 9);
                } else {
                    if (errorCallback) {
                        errorCallback(FileError.ENCODING_ERR);
                    }
                    return;
                }
            }

            if (path.indexOf(pathsPrefix.dataDirectory) === 0 && !fs.existsSync(pathsPrefix.dataDirectory)) {
                fs.mkdirSync(pathsPrefix.dataDirectory, {recursive: true});
            }

            if (!fs.existsSync(path)) {
                if (errorCallback) {
                    errorCallback(FileError.NOT_FOUND_ERR);
                }
                return;
            }

            const baseName = nodeRequire('path').basename(path);
            if (fs.statSync(path).isDirectory()) {
                successCallback(new DirectoryEntry(baseName, path));
            } else {
                successCallback(new FileEntry(baseName, path));
            }
        };

        exports.requestAllPaths = function (successCallback) {
            successCallback(pathsPrefix);
        };

    /** * Helpers ***/

        /**
         * Interface to wrap the native File interface.
         *
         * This interface is necessary for creating zero-length (empty) files,
         * something the Filesystem API allows you to do. Unfortunately, File's
         * constructor cannot be called directly, making it impossible to instantiate
         * an empty File in JS.
         *
         * @param {Object} opts Initial values.
         * @constructor
         */
        function MyFile (opts) {
            var blob_ = new Blob(); // eslint-disable-line no-undef

            this.size = opts.size || 0;
            this.name = opts.name || '';
            this.type = opts.type || '';
            this.lastModifiedDate = opts.lastModifiedDate || null;
            this.storagePath = opts.storagePath || '';

            // Need some black magic to correct the object's size/name/type based on the
            // blob that is saved.
            Object.defineProperty(this, 'blob_', {
                enumerable: true,
                get: function () {
                    return blob_;
                },
                set: function (val) {
                    blob_ = val;
                    this.size = blob_.size;
                    this.name = blob_.name;
                    this.type = blob_.type;
                    this.lastModifiedDate = blob_.lastModifiedDate;
                }.bind(this)
            });
        }

        MyFile.prototype.constructor = MyFile;

        var MyFileHelper = {
            toJson: function (myFile, success) {
                /*
                    Safari private browse mode cannot store Blob object to indexeddb.
                    Then use pure json object instead of Blob object.
                */
                var fr = new FileReader();
                fr.onload = function (ev) {
                    var base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(fr.result)));
                    success({
                        opt: {
                            size: myFile.size,
                            name: myFile.name,
                            type: myFile.type,
                            lastModifiedDate: myFile.lastModifiedDate,
                            storagePath: myFile.storagePath
                        },
                        base64: base64
                    });
                };
                fr.readAsArrayBuffer(myFile.blob_);
            },
            setBase64: function (myFile, base64) {
                if (base64) {
                    var arrayBuffer = (new Uint8Array(
                        [].map.call(atob(base64), function (c) { return c.charCodeAt(0); })
                    )).buffer;

                    myFile.blob_ = new Blob([arrayBuffer], { type: myFile.type });
                } else {
                    myFile.blob_ = new Blob();
                }
            }
        };

        // When saving an entry, the fullPath should always lead with a slash and never
        // end with one (e.g. a directory). Also, resolve '.' and '..' to an absolute
        // one. This method ensures path is legit!
        function resolveToFullPath_ (cwdFullPath, path) {
            path = path || '';
            var fullPath = path;
            var prefix = '';

            cwdFullPath = cwdFullPath || DIR_SEPARATOR;
            if (cwdFullPath.indexOf(FILESYSTEM_PREFIX) === 0) {
                prefix = cwdFullPath.substring(0, cwdFullPath.indexOf(DIR_SEPARATOR, FILESYSTEM_PREFIX.length));
                cwdFullPath = cwdFullPath.substring(cwdFullPath.indexOf(DIR_SEPARATOR, FILESYSTEM_PREFIX.length));
            }

            var relativePath = path[0] !== DIR_SEPARATOR;
            if (relativePath) {
                fullPath = cwdFullPath;
                if (cwdFullPath !== DIR_SEPARATOR) {
                    fullPath += DIR_SEPARATOR + path;
                } else {
                    fullPath += path;
                }
            }

            // Remove doubled separator substrings
            var re = new RegExp(DIR_SEPARATOR + DIR_SEPARATOR, 'g');
            fullPath = fullPath.replace(re, DIR_SEPARATOR);

            // Adjust '..'s by removing parent directories when '..' flows in path.
            var parts = fullPath.split(DIR_SEPARATOR);
            for (var i = 0; i < parts.length; ++i) {
                var part = parts[i];
                if (part === '..') {
                    parts[i - 1] = '';
                    parts[i] = '';
                }
            }
            fullPath = parts.filter(function (el) {
                return el;
            }).join(DIR_SEPARATOR);

            // Add back in leading slash.
            if (fullPath[0] !== DIR_SEPARATOR) {
                fullPath = DIR_SEPARATOR + fullPath;
            }

            // Replace './' by current dir. ('./one/./two' -> one/two)
            fullPath = fullPath.replace(/\.\//g, DIR_SEPARATOR);

            // Replace '//' with '/'.
            fullPath = fullPath.replace(/\/\//g, DIR_SEPARATOR);

            // Replace '/.' with '/'.
            fullPath = fullPath.replace(/\/\./g, DIR_SEPARATOR);

            // Remove '/' if it appears on the end.
            if (fullPath[fullPath.length - 1] === DIR_SEPARATOR &&
                fullPath !== DIR_SEPARATOR) {
                fullPath = fullPath.substring(0, fullPath.length - 1);
            }

            var storagePath = prefix + fullPath;
            storagePath = decodeURI(storagePath);
            fullPath = decodeURI(fullPath);

            return {
                storagePath: storagePath,
                fullPath: fullPath,
                fileName: fullPath.split(DIR_SEPARATOR).pop(),
                fsName: prefix.split(DIR_SEPARATOR).pop()
            };
        }

        function fileEntryFromIdbEntry (fileEntry) {
            // IDB won't save methods, so we need re-create the FileEntry.
            var clonedFileEntry = new FileEntry(fileEntry.name, fileEntry.fullPath, fileEntry.filesystem);
            clonedFileEntry.file_ = fileEntry.file_;

            return clonedFileEntry;
        }

        function readAs (what, fullPath, encoding, startPos, endPos, successCallback, errorCallback) {
            exports.getFile(function (fileEntry) {
                var fileReader = new FileReader(); // eslint-disable-line no-undef
                var blob = fileEntry.file_.blob_.slice(startPos, endPos);

                fileReader.onload = function (e) {
                    successCallback(e.target.result);
                };

                fileReader.onerror = errorCallback;

                switch (what) {
                case 'text':
                    fileReader.readAsText(blob, encoding);
                    break;
                case 'dataURL':
                    fileReader.readAsDataURL(blob);
                    break;
                case 'arrayBuffer':
                    fileReader.readAsArrayBuffer(blob);
                    break;
                case 'binaryString':
                    fileReader.readAsBinaryString(blob);
                    break;
                }

            }, errorCallback, [fullPath, null]);
        }

    /** * Core logic to handle IDB operations ***/

        idb_.open = function (dbName, successCallback, errorCallback) {
            var self = this;

            // TODO: FF 12.0a1 isn't liking a db name with : in it.
            var request = indexedDB.open(dbName.replace(':', '_')/*, 1 /*version */);

            request.onerror = errorCallback || onError;

            request.onupgradeneeded = function (e) {
                // First open was called or higher db version was used.

                // console.log('onupgradeneeded: oldVersion:' + e.oldVersion,
                //           'newVersion:' + e.newVersion);

                self.db = e.target.result;
                self.db.onerror = onError;

                if (!self.db.objectStoreNames.contains(FILE_STORE_)) {
                    self.db.createObjectStore(FILE_STORE_/*, {keyPath: 'id', autoIncrement: true} */);
                }
            };

            request.onsuccess = function (e) {
                self.db = e.target.result;
                self.db.onerror = onError;
                successCallback(e);
            };

            request.onblocked = errorCallback || onError;
        };

        idb_.close = function () {
            this.db.close();
            this.db = null;
        };

        idb_.get = function (fullPath, successCallback, errorCallback) {
            if (!this.db) {
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
                return;
            }

            var tx = this.db.transaction([FILE_STORE_], 'readonly');

            var request = tx.objectStore(FILE_STORE_).get(fullPath);

            tx.onabort = errorCallback || onError;
            tx.oncomplete = function () {
                var entry = request.result;
                if (entry && entry.file_json) {
                    /*
                        Safari private browse mode cannot store Blob object to indexeddb.
                        Then use pure json object instead of Blob object.
                    */
                    entry.file_ = new MyFile(entry.file_json.opt);
                    MyFileHelper.setBase64(entry.file_, entry.file_json.base64);
                    delete entry.file_json;
                }
                successCallback(entry);
            };
        };

        idb_.getAllEntries = function (fullPath, storagePath, successCallback, errorCallback) {
            if (!this.db) {
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
                return;
            }

            var results = [];

            if (storagePath[storagePath.length - 1] === DIR_SEPARATOR) {
                storagePath = storagePath.substring(0, storagePath.length - 1);
            }

            var range = IDBKeyRange.bound(storagePath + DIR_SEPARATOR + ' ', // eslint-disable-line no-undef
                storagePath + DIR_SEPARATOR + String.fromCharCode(unicodeLastChar));

            var tx = this.db.transaction([FILE_STORE_], 'readonly');
            tx.onabort = errorCallback || onError;
            tx.oncomplete = function () {
                results = results.filter(function (val) {
                    var pathWithoutSlash = val.fullPath;

                    if (val.fullPath[val.fullPath.length - 1] === DIR_SEPARATOR) {
                        pathWithoutSlash = pathWithoutSlash.substr(0, pathWithoutSlash.length - 1);
                    }

                    var valPartsLen = pathWithoutSlash.split(DIR_SEPARATOR).length;
                    var fullPathPartsLen = fullPath.split(DIR_SEPARATOR).length;

                    /* Input fullPath parameter  equals '//' for root folder */
                    /* Entries in root folder has valPartsLen equals 2 (see below) */
                    if (fullPath[fullPath.length - 1] === DIR_SEPARATOR && fullPath.trim().length === 2) {
                        fullPathPartsLen = 1;
                    } else if (fullPath[fullPath.length - 1] === DIR_SEPARATOR) {
                        fullPathPartsLen = fullPath.substr(0, fullPath.length - 1).split(DIR_SEPARATOR).length;
                    } else {
                        fullPathPartsLen = fullPath.split(DIR_SEPARATOR).length;
                    }

                    if (valPartsLen === fullPathPartsLen + 1) {
                        // If this a subfolder and entry is a direct child, include it in
                        // the results. Otherwise, it's not an entry of this folder.
                        return val;
                    } else return false;
                });

                successCallback(results);
            };

            var request = tx.objectStore(FILE_STORE_).openCursor(range);

            request.onsuccess = function (e) {
                var cursor = e.target.result;
                if (cursor) {
                    var val = cursor.value;

                    results.push(val.isFile ? fileEntryFromIdbEntry(val) : new DirectoryEntry(val.name, val.fullPath, val.filesystem));
                    cursor['continue']();
                }
            };
        };

        idb_['delete'] = function (fullPath, successCallback, errorCallback, isDirectory) {
            if (!idb_.db) {
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
                return;
            }

            var tx = this.db.transaction([FILE_STORE_], 'readwrite');
            tx.oncomplete = successCallback;
            tx.onabort = errorCallback || onError;
            tx.oncomplete = function () {
                if (isDirectory) {
                    // We delete nested files and folders after deleting parent folder
                    // We use ranges: https://developer.mozilla.org/en-US/docs/Web/API/IDBKeyRange
                    fullPath = fullPath + DIR_SEPARATOR;

                    // Range contains all entries in the form fullPath<symbol> where
                    // symbol in the range from ' ' to symbol which has code `unicodeLastChar`
                    var range = IDBKeyRange.bound(fullPath + ' ', fullPath + String.fromCharCode(unicodeLastChar)); // eslint-disable-line no-undef

                    var newTx = this.db.transaction([FILE_STORE_], 'readwrite');
                    newTx.oncomplete = successCallback;
                    newTx.onabort = errorCallback || onError;
                    newTx.objectStore(FILE_STORE_)['delete'](range);
                } else {
                    successCallback();
                }
            };
            tx.objectStore(FILE_STORE_)['delete'](fullPath);
        };

        idb_.put = function (entry, storagePath, successCallback, errorCallback, retry) {
            if (!this.db) {
                if (errorCallback) {
                    errorCallback(FileError.INVALID_MODIFICATION_ERR);
                }
                return;
            }

            var tx = this.db.transaction([FILE_STORE_], 'readwrite');
            tx.onabort = errorCallback || onError;
            tx.oncomplete = function () {
                // TODO: Error is thrown if we pass the request event back instead.
                successCallback(entry);
            };

            try {
                tx.objectStore(FILE_STORE_).put(entry, storagePath);
            } catch (e) {
                if (e.name === 'DataCloneError') {
                    tx.oncomplete = null;
                    /*
                        Safari private browse mode cannot store Blob object to indexeddb.
                        Then use pure json object instead of Blob object.
                    */

                    var successCallback2 = function (entry) {
                        entry.file_ = new MyFile(entry.file_json.opt);
                        delete entry.file_json;
                        successCallback(entry);
                    };

                    if (!retry) {
                        if (entry.file_ && entry.file_ instanceof MyFile && entry.file_.blob_) {
                            MyFileHelper.toJson(entry.file_, function (json) {
                                entry.file_json = json;
                                delete entry.file_;
                                idb_.put(entry, storagePath, successCallback2, errorCallback, true);
                            });
                            return;
                        }
                    }
                }
                throw e;
            }
        };

        // Global error handler. Errors bubble from request, to transaction, to db.
        function onError (e) {
            switch (e.target.errorCode) {
            case 12:
                console.log('Error - Attempt to open db with a lower version than the ' +
                        'current one.');
                break;
            default:
                console.log('errorCode: ' + e.target.errorCode);
            }

            console.log(e, e.code, e.message);
        }

    })(module.exports, window);

    require('cordova/exec/proxy').add('File', module.exports);
})();
