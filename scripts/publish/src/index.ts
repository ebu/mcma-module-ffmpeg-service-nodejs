import * as fs from "fs";
import { McmaException } from "@mcma/core";
import { GetBucketLocationCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";

const { MODULE_NAMESPACE, MODULE_NAME, MODULE_VERSION, MODULE_REPOSITORY } = process.env;

let s3Client = new S3Client({ credentials: fromIni() });

async function main() {
    console.log("Publishing to Module Repository");
    console.log("Repository: " + MODULE_REPOSITORY);
    console.log("Namespace:  " + MODULE_NAMESPACE);
    console.log("Name:       " + MODULE_NAME);
    console.log("Version:    " + MODULE_VERSION);

    const objectKey = `${MODULE_NAMESPACE}/${MODULE_NAME}/aws/${MODULE_VERSION}/module.zip`;

    const locationCommandOutput = await s3Client.send(new GetBucketLocationCommand({ Bucket: MODULE_REPOSITORY }));
    s3Client = new S3Client({
        credentials: fromIni(),
        region: locationCommandOutput.LocationConstraint ?? "us-east-1"
    });

    console.log("Checking if version already exists");
    let exists = true;
    try {
        await s3Client.send(new HeadObjectCommand({
            Bucket: MODULE_REPOSITORY,
            Key: objectKey
        }));
    } catch {
        exists = false;
    }
    if (exists) {
        throw new McmaException("Version already exists in module repository. Change the version number!");
    }

    console.log("Uploading AWS version");
    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: MODULE_REPOSITORY,
            Key: objectKey,
            Body: fs.createReadStream("../../aws/build/dist/module.zip"),
            ACL: "public-read"
        }));
    } catch (error) {
        // in case of a private bucket with restrictions we just try again without public-read ACL
        await s3Client.send(new PutObjectCommand({
            Bucket: MODULE_REPOSITORY,
            Key: objectKey,
            Body: fs.createReadStream("../../aws/build/dist/module.zip"),
        }));
    }
}

main().then(() => console.log("Done")).catch(reason => console.error(reason));
