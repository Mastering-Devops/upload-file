'use strict';
const AWS = require('aws-sdk');
var gm = require('gm')
    .subClass({imageMagick: true}); // Enable ImageMagick integration.



class ImageResize {
    constructor(srcKey,paths) {
        this.srcKey = srcKey;
        this.paths = paths;
    }

    validate() {
        // Infer the image type.
        let typeMatch = this.srcKey.match(/\.([^.]*)$/);
        if (!typeMatch) {
            throw "No se pudo determinar el tipo de imagen.";
        }

        let imageType = typeMatch[1].toLowerCase();
        if (imageType !== "jpg" && imageType !== "png") {
            throw `Tipo de imagen no compatible: ${imageType}`;
        }

        if (this.is_resize()) {
            throw "Esta imagen no se debe redimencionar";
        }

    }


    is_resize() {
        if (this.srcKey === this.paths['original']) {
            return false;
        }
        let path_values = Object.values(this.paths);
        return Object.values(path_values).some(s => s === this.srcKey)

    }

    get_size_image(objectFile) {
        return new Promise((resolve, reject) => {
            gm(objectFile.Body).size(function (err, size) {
                if (err) {
                    reject(err);
                } else {
                    resolve({width: size.width, height: size.height});
                }
            });
        });
    }

    get_size_resize(keyitem) {
        let size = 0;
        switch (keyitem) {
            case 'small':
                size = 900;
                break;
            case 'medium':
                size = 1200;
                break;
            case 'large':
                size = 1500;
                break;
            default:
                let custom = keyitem.split("-");
                if (custom[0] === 'custom' && custom.length === 2) {
                    size = parseInt(custom[1])
                }
                break;
        }
        return size;
    }

    resize_image(objectFile, image_size, max_width) {
        return new Promise((resolve, reject) => {
            let scalingFactor = max_width / image_size.width;
            if (scalingFactor > 1) {
                // si la imagen es mas pequeña que el tamaño a redemensionar
                // no se efectua esta accion
                scalingFactor = 1;
            }
            let width = scalingFactor * image_size.width;
            let height = scalingFactor * image_size.height;

            gm(objectFile.Body)
                .resize(width, height)
                .stream(function (err, stdout, stderr) {
                    if (err) reject(err);
                    let chunks = [];
                    stdout.on('data', function (chunk) {
                        chunks.push(chunk);
                    });
                    stdout.on('end', function () {
                        let image = Buffer.concat(chunks);
                        resolve(image);
                    });
                    stderr.on('data', function (data) {
                        console.log(`stderr data:`, data);
                    })
                });
        });


    }


}

class Storage {


    constructor(path) {
        this.path = path;
        this.s3 = new AWS.S3();
    }

    get id() {
        let items = this.path.split("/");
        let idid = items[items.length - 1];
        let id = idid.split(".");
        return id[0]
    }

    getObject() {
        let s3Params = {
            Bucket: process.env.UPLOAD_FILE_STORAGE,
            Key: this.path
        };
        return this.s3.getObject(s3Params).promise();
    }

    putObject(image, contentType, path_image) {
        return this.s3.putObject({
            Bucket: process.env.UPLOAD_FILE_STORAGE,
            Key: path_image,
            Body: image,
            ContentType: contentType
        }).promise();
    }

    async get_path() {
        const dynamo = new AWS.DynamoDB.DocumentClient();
        const params = {
            TableName: process.env.UPLOAD_FILE_DB,
            Key: {
                fileId: this.id,
            },
        };
        let rs = await dynamo.get(params).promise();

        if (typeof rs.Item === 'undefined') {
            throw `Db vacia id: ${id}`;
        }

        if (typeof rs.Item.path === 'undefined') {
            throw "no hay imagenes para redimencionar";
        }

        return rs.Item.path;
    }


}

module.exports.image = async (event, context) => {

    try {
        let srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));

        let storage = new Storage(srcKey);

        let image_resize = new ImageResize(srcKey, await storage.get_path());

        image_resize.validate();

        let objectFile = await storage.getObject();

        let image_size = await image_resize.get_size_image(objectFile);

        for (let key in image_resize.paths) {
            let size_resize = image_resize.get_size_resize(key);
            if (size_resize >= 50) {
                let resize = await image_resize.resize_image(objectFile, image_size, size_resize);
                await storage.putObject(resize, objectFile.ContentType, image_resize.paths[key]);
            }
        }
    }
    catch (error) {
        console.error(error);
    }

};