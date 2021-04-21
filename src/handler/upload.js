'use strict';
const AWS = require('aws-sdk');
const uuidv4 = require('uuid/v4');
const path = require('path');

function get_url_upload(upload_file) {
    let s3 = new AWS.S3();
    let s3Params = {
        Bucket: process.env.UPLOAD_FILE_STORAGE,
        Key: upload_file.original_path,
        ContentType: upload_file.file_type,
        ACL: 'public-read',
    };
    return s3.getSignedUrl('putObject', s3Params);
}

function persist_info(upload_file) {
    const dynamo = new AWS.DynamoDB.DocumentClient();
    const params = {
        TableName: process.env.UPLOAD_FILE_DB,
        Item: {
            fileId: upload_file.id,
            original_name: upload_file.file_name,
            type: upload_file.file_type,
            size: upload_file.size,
            path: upload_file.path
        }
    };
    return dynamo.put(params).promise();
}



class UploadFile {
    constructor(id, file_name, file_type, application_path, size) {
        this.id = id;
        this.file_name = file_name;
        this.file_type = file_type;
        this.application_path = application_path;
        this.size = size;
    }

    get new_name() {
        return `${this.id}${path.extname(this.file_name)}`;
    }

    get path() {
        /*
            [ { type: 'small' },
              { type: 'large' },
              { type: 'custom', resolution: '500' } ]

            {
            small:'pepe/questions/small/uuid.jpg',
            large:'pepe/questions/large/uuid.jpg',
            custom-500:'pepe/questions/custom-500/uuid.jpg',
            }
        */
        let path = {
            'original': `${this.application_path}/${this.new_name}`
        };
        for (let key in this.size) {
            let item = this.size[key];
            let type_name = (item.type === 'custom') ? `custom-${item.resolution}` : item.type;
            path[type_name] = `${this.application_path}/${type_name}/${this.new_name}`;
        }
        return path;
    }

    get original_path() {
        return this.path['original']
    }
}

module.exports.image = async (event, context) => {

    let params = JSON.parse(event.body);

    let file_id = uuidv4();
    let upload_file = new UploadFile(file_id, params.file_name, params.file_type, params.application_path, params.size);
    let uploadURL = get_url_upload(upload_file);
    await persist_info(upload_file);

    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
            success: true,
            code: 21,
            message: '',
            data: {
                uploadURL,
                file_id,
                path: upload_file.path
            }
        }),
    };
};
