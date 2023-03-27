import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";

import * as ffmpeg from "fluent-ffmpeg";
import * as stream from "stream";

import { v4 as uuidv4 } from "uuid";
import * as AWS from "aws-sdk";

import { AuthProvider, ResourceManager, ResourceManagerConfig } from "@mcma/client";
import { Job, JobParameterBag, JobProfile, JobStatus, McmaException, McmaTracker, TransformJob, Utils } from "@mcma/core";
import { S3Locator } from "@mcma/aws-s3";
import { awsV4Auth } from "@mcma/aws-client";

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
        console.log("Job is " + job.status + (job.progress ? " " + job.progress + "%" : ""));
    }

    return job;
}

async function startJob(resourceManager: ResourceManager, inputFile: S3Locator) {
    let [jobProfile] = await resourceManager.query(JobProfile, { name: "FFmpegExtractThumbnail" });

    // if not found bail out
    if (!jobProfile) {
        throw new McmaException("JobProfile 'FFmpegExtractThumbnail' not found");
    }

    let job = new TransformJob({
        jobProfileId: jobProfile.id,
        jobInput: new JobParameterBag({
            inputFile,
            width: 320,
            aspectRatio: "16:9",
            autoPadding: true,
        }),
        tracker: new McmaTracker({
            "id": uuidv4(),
            "label": "Test - FFmpegExtractThumbnail"
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
        .setFfmpegPath("C:/Apps/ffmpeg-4.2.3-win64-static/bin/ffmpeg.exe")
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
    // await test();
    // return;

    console.log("Starting test service");

    const terraformOutput = JSON.parse(fs.readFileSync(TERRAFORM_OUTPUT, "utf8"));
    const uploadBucket = terraformOutput.upload_bucket.value;

    const serviceRegistryUrl = terraformOutput.service_registry.value.service_url;
    const serviceRegistryAuthType = terraformOutput.service_registry.value.auth_type;

    const resourceManagerConfig: ResourceManagerConfig = {
        serviceRegistryUrl,
        serviceRegistryAuthType,
    };

    const resourceManager = new ResourceManager(resourceManagerConfig, new AuthProvider().add(awsV4Auth(AWS)));

    console.log(`Uploading media file ${MEDIA_FILE}`);
    const mediaFileLocator = await uploadFileToBucket(uploadBucket, MEDIA_FILE);

    await testJob(resourceManager, mediaFileLocator);
}

main().then(() => console.log("Done")).catch(e => console.error(e));
