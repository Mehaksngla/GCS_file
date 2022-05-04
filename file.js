const _ = require('lodash');
const Promise = require('bluebird');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const uuid = require('uuid');
const sanitize = require('sanitize-filename');
const moment = require('moment');
const config = require("../../lib/config")();
const FOLDER = 'uploads';
let BUCKET;
/**
 * Initialize file storage.
 */
async function init() {
    let gapiConfKey = config.GCM.secret;
    if (_.isNil(gapiConfKey)) {
        throw new Error('GAPI_CONF_KEY is not defined in environment.');
    }
    const file = path.join(__dirname, '../..', 'mayamdai-77f45bd3d6e2.json')
    const storage = new Storage({ keyFilename: file });
    BUCKET = storage.bucket(process.env.GCS_BUCKET || config.uploads.bucket);
}
module.exports.init = init;

/**
 * Sanitize the file name.
 * @param {string} filename file name
 * @returns {string} sanitized name
 */
function sanitizeFileName(filename) {
    filename = sanitize(filename);
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const baseFixed = _.camelCase(base);
    return baseFixed + ext;
}

/**
 * Generate a file key for given file name
 * @param {string} filename file name
 */
function genFileKey(filename) {
    // sanitize
    filename = sanitizeFileName(filename);

    // file key
    return `${uuid.v4()}-${filename}`;

    // return file key
    // return fileKey;
}

/**
 * Upload given stream to file storage.
 * Returns file metadata object with has fileKey property used later to access the file.
 * @param {string} filename file name
 * @param {stream.Readable} stream readable stream
 * @returns {Promise} upload promise
 */
async function upload(filename, stream, mimetype) {
    init();
    return new Promise((resolve, reject) => {
        // callback
        const cb = _.once((e, d) => e ? reject(e) : resolve(d));

        // file key
        const fileKey = genFileKey(filename);

        // metadata
        const metadata = {
            // 'contentType': mimetype || '*/*',
            'metadata': { 'name': filename }
        };

        // create file on bucket
        const file = BUCKET.file(path.join(FOLDER, fileKey));

        // write stream
        const dest = file.createWriteStream({ resumable: false });

        // handle upload error
        dest.once('error', (e) => cb(e));

        // handle upload finish
        dest.once('finish', () => {
            // set metadata
            file.setMetadata(metadata)
                .then((d) => cb(null, _.assign(d[0], { fileKey: fileKey })))
                .catch((e) => cb(e));
        });

        // upload
        stream.pipe(dest);
    });
}
module.exports.upload = upload;


/**
 * Download file form storage using the fileKey generated on upload.
 * Returns an object with propertiy metadata and a stream() funstion to get readable stream.
 * @param {string} fileKey file key.
 * @returns {Promise<{metadata:object, stream:function}>} promise of metadata and stream function.
 */
async function download(fileKey) {
    // get file from storage
    const file = BUCKET.file(path.join(FOLDER, fileKey));

    // return object with file metadata and stream function
    return file.getMetadata()
        .then(m => {
            // metadata
            const meta = m[0];
            if ('storage#object' !== meta.kind) {
                // must be a stprage object
                return `No such file: ${fileKey}.`
            } else {
                // return info
                return { 'metadata': meta, stream: () => file.createReadStream() };
            }
        })
        .catch(e => {
            // handle file not found
            if (403 === e.code || 404 === e.code) {
                return `No such file: ${fileKey}.`;
            } else {
                throw e;
            }
        });
}
module.exports.download = download;


/**
 * Generate a signed upload url.
 * @param {string} filename file name
 */
async function genUploadURL(filename, mimetype) {
    // file key
    const fileKey = genFileKey(filename);

    // create file on bucket
    const file = BUCKET.file(path.join(FOLDER, fileKey));

    // generate upload url
    return file.getSignedUrl({
        'action': 'write',
        'expires': moment().add(2, 'minutes').toDate(),
        // 'contentType': mimetype || '*/*'
    }).then((url) => {
        return {
            'url': url[0],
            'key': fileKey
        };
    });
}
module.exports.genUploadURL = genUploadURL;


/**
 * Generate a signed download url.
 * @param {string} fileKey file key.
 */
async function genDownloadURL(fileKey) {

    // get file from storage
    const file = BUCKET.file(path.join(FOLDER, fileKey));

    // generate upload url
    return file.getSignedUrl({
        'action': 'read',
        'expires': moment().add(5, 'years').toDate()
    }).then((url) => {
        return {
            'url': url[0],
            'key': fileKey
        };
    });
}
module.exports.genDownloadURL = genDownloadURL;
