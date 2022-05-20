import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";

import * as ffmpeg from "fluent-ffmpeg";


import { v4 as uuidv4 } from "uuid";
import * as AWS from "aws-sdk";

import { AuthProvider, ResourceManager } from "@mcma/client";
import { Job, JobParameterBag, JobProfile, JobStatus, McmaException, McmaTracker, TransformJob, Utils } from "@mcma/core";
import { S3Locator } from "@mcma/aws-s3";
import { awsV4Auth } from "@mcma/aws-client";
import * as stream from "stream";

const { AwsProfile, AwsRegion } = process.env;

AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: AwsProfile });
AWS.config.region = AwsRegion;

const TERRAFORM_OUTPUT = "../../deployment/terraform.output.json";

const MEDIA_FILE = "C:/Media/2015_GF_ORF_00_18_09_conv.mp4";

const s3 = new AWS.S3();

export function log(entry?: any) {
    if (typeof entry === "object") {
        console.log(JSON.stringify(entry, null, 2));
    } else {
        console.log(entry);
    }
}


async function uploadFileToBucket(bucket: string, filename: string) {
    const fileStream = fs.createReadStream(filename);
    fileStream.on("error", function (err) {
        console.log("File Error", err);
    });

    const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: bucket,
        Key: path.basename(filename),
        Body: fileStream,
        ContentType: mime.lookup(filename) || "application/octet-stream"
    };

    let isPresent = true;

    try {
        console.log("checking if file is already present");
        await s3.headObject({ Bucket: uploadParams.Bucket, Key: uploadParams.Key }).promise();
        console.log("Already present. Not uploading again");
    } catch (error) {
        isPresent = false;
    }

    if (!isPresent) {
        console.log("Not present. Uploading");
        await s3.upload(uploadParams).promise();
    }

    return new S3Locator({
        bucket: uploadParams.Bucket,
        key: uploadParams.Key,
        url: s3.getSignedUrl("getObject", {
            Bucket: uploadParams.Bucket,
            Key: uploadParams.Key,
            Expires: 3600
        })
    });
}

async function waitForJobCompletion(job: Job, resourceManager: ResourceManager): Promise<Job> {
    console.log("Job is " + job.status);

    while (job.status !== JobStatus.Completed &&
           job.status !== JobStatus.Failed &&
           job.status !== JobStatus.Canceled) {

        await Utils.sleep(1000);
        job = await resourceManager.get<Job>(job.id);
        console.log("Job is " + job.status);
    }

    return job;
}

async function startJob(resourceManager: ResourceManager, inputFile: S3Locator) {
    let [jobProfile] = await resourceManager.query(JobProfile, { name: "ExtractThumbnail" });

    // if not found bail out
    if (!jobProfile) {
        throw new McmaException("JobProfile 'ExtractThumbnail' not found");
    }

    let job = new TransformJob({
        jobProfileId: jobProfile.id,
        jobInput: new JobParameterBag({
            inputFile
        }),
        tracker: new McmaTracker({
            "id": uuidv4(),
            "label": "Test - ExtractThumbnail"
        })
    });

    return resourceManager.create(job);
}

async function testJob(resourceManager: ResourceManager, inputFile: S3Locator) {
    let job;

    console.log("Creating job");
    job = await startJob(resourceManager, inputFile);

    console.log("job.id = " + job.id);
    job = await waitForJobCompletion(job, resourceManager);

    console.log(JSON.stringify(job, null, 2));
}

function uploadFromStream(s3: AWS.S3, bucket: string, key: string, contentType?: string) {
    const pass = new stream.PassThrough();

    s3.upload({ Bucket: bucket, Key: key, Body: pass, ContentType: contentType }, function (err: Error, data: any) {
        console.log(err, data);
    });

    return pass;
}

async function test() {
    const terraformOutput = JSON.parse(fs.readFileSync(TERRAFORM_OUTPUT, "utf8"));
    const uploadBucket = terraformOutput.upload_bucket.value;

    const uploadStream = uploadFromStream(s3, uploadBucket, "test.jpg", "image/jpeg");

    ffmpeg("C:/Media/2015_GF_ORF_00_18_09_conv.mp4")
        .setFfmpegPath("C:/Apps/ffmpeg-4.2.4-win64-static/bin/ffmpeg.exe")
        .seekInput(1)
        .frames(1)
        .size("320x?")
        .aspect("16:9")
        .autopad()
        .outputFormat("mjpeg")
        .output(uploadStream)
        .on("end", function () {
            log("Finished");
        })
        .run();
}

async function main() {
    console.log("Starting test service");

    const terraformOutput = JSON.parse(fs.readFileSync(TERRAFORM_OUTPUT, "utf8"));
    const uploadBucket = terraformOutput.upload_bucket.value;

    const servicesUrl = terraformOutput.service_registry.value.services_url;
    const servicesAuthType = terraformOutput.service_registry.value.auth_type;
    const servicesAuthContext: any | undefined = undefined;

    const resourceManagerConfig = {
        servicesUrl,
        servicesAuthType,
        servicesAuthContext
    };

    const resourceManager = new ResourceManager(resourceManagerConfig, new AuthProvider().add(awsV4Auth(AWS)));

    // console.log(`Uploading media file ${MEDIA_FILE}`);
    // const mediaFileLocator = await uploadFileToBucket(uploadBucket, MEDIA_FILE);
    const mediaFileLocator = new S3Locator({url: "https://pt-rovers-mam-dev-media-eu-west-1.s3.eu-west-1.amazonaws.com/eu-west-1%3A6282b0ae-bbc6-47ae-b3f8-c9d42aa220b6/20220519T133327/Tom%20Hanks%27%20Amazing%20Clint%20Eastwood%20Impression%20-%20The%20Graham%20Norton%20Show.mp4?response-content-disposition=inline&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEDEaCWV1LXdlc3QtMyJHMEUCIQDtIVqfzegM3oLvaF7M944Xz5l2Xc1KYaz4d8X58u137wIgQkYQ0IkbhkSsLRPo97HXV%2B9qM0NziWaLeDVq13kKKiEq%2BwIIGRACGgwwODM1MzQ0NTA0NjUiDDCdvMtGdkXPOH0PsyrYAmxb71wzyW0vsYqu4bZxWa5UTtytLe%2FLY2zpqksZW8L4vQWuefdHqnQmMQec%2Bbmw7wEvV7%2FiRcHtjI5OVpYHym2R2HDdCDpZ%2BIwPaThGbbwynU4A5v7zDGVKptWKH5upRICQjTVayzmjcmkv%2FiROBmMsmxetnFDTH52WgGUmP8oYxaBpDySHI1eN9G8ws%2BO5ao2ADVlJ8o41OyCKe3U2u8km0zLNJiHZYmCoKacpX1qQLN%2B3%2FrZm0aVqsMXpUE9TH6ad7KiTCXa6456inpYUdXyTlQEN%2BJVqpJ%2FgDBo3SYjOYMK5qLkilh6xUdszQjvlUgJcbIyz%2FGc9%2FonBdaH7fC%2FFbLqHZ5axVlojQZChffQJ6BobwcF0H4SeUy86baI0bEZXSHG%2FF4LVHETb%2BtGsYF6qI8LDHk%2BZ4yP0Po277bm7f6BTKj442pG1zdfOHdg4pyVFhCYP%2BxqmMI%2BAn5QGOrMCeIF6OVSa90ktxkjV8p2iTW6hStPtwlpCHq0BN0%2FlFyThshiErNXaahpJ2ARfnZghltW6ulkWn3VuX8Od56U%2F8dZfKsn7ZtivNR0k2T87q4cBdsBR0MSkeK4o%2Fjos80%2FlkQjcEqdt4fGbeSnu8BYGvWaiQYdmUffjDAlboFtPioB8oB84yeyHH9JIWTH8JBrwwZzTiJtGTFRGzePWvTEsgfVkwmu2jKAPwTM5ArSwt6W2lVWTDIIqfdV4Lwo79gpDiZT4BJ8vR8vbnltr2QbDw2VJdnEohPFm5FxQSg0erL1ZtuVTVHuuPrwA64wy2kBxhTr71Iz6OgJlX9sEguzIOGQbZY0XSz%2FlXBN41ci3B5hMRwJTE9bsfgghUuUEhdkI3RLeySQzOGKkY4u7yRgkJRcYEg%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20220520T202749Z&X-Amz-SignedHeaders=host&X-Amz-Expires=43200&X-Amz-Credential=ASIARG4YKR4QQ4NWGX3G%2F20220520%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Signature=e57d92be653d08527237e3fc1e814d1f019d1ce246f3e77f3ea65df2e01672c4" })

    await testJob(resourceManager, mediaFileLocator);
}

main().then(() => console.log("Done")).catch(e => console.error(e));
